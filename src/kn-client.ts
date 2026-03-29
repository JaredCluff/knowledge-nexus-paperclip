import type {
  SearchParams,
  IngestParams,
  Provenance,
} from "./types.js";

interface KnResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

interface JwtTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export class KnClient {
  private apiUrl: string;
  private researchUrl: string;
  private email: string;
  private password: string;
  private tokens: JwtTokens | null = null;

  constructor(apiUrl: string, researchUrl: string, email: string, password: string) {
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.researchUrl = researchUrl.replace(/\/+$/, "");
    this.email = email;
    this.password = password;
  }

  private async ensureAuth(): Promise<string> {
    if (this.tokens && Date.now() < this.tokens.expiresAt - 60_000) {
      return this.tokens.accessToken;
    }
    return this.login();
  }

  private async login(): Promise<string> {
    const res = await fetch(`${this.apiUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) throw new Error(`KN login failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.tokens.accessToken;
  }

  private headers(token: string, provenance?: Provenance): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (provenance?.agentId) h["X-Paperclip-Agent"] = provenance.agentId;
    if (provenance?.companyId) h["X-Paperclip-Company"] = provenance.companyId;
    if (provenance?.projectId) h["X-Paperclip-Project"] = provenance.projectId;
    if (provenance?.runId) h["X-Paperclip-Run"] = provenance.runId;
    return h;
  }

  private async request<T>(
    baseUrl: string,
    method: string,
    path: string,
    body?: unknown,
    provenance?: Provenance,
    retry = false,
  ): Promise<KnResponse<T>> {
    const url = `${baseUrl}${path}`;
    try {
      const token = await this.ensureAuth();
      const res = await fetch(url, {
        method,
        headers: this.headers(token, provenance),
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        if (!retry) {
          this.tokens = null;
          return this.request<T>(baseUrl, method, path, body, provenance, true);
        }
        return { ok: false, status: 401, error: "KN authentication failed — check email/password in plugin config" };
      }

      if (res.status === 429) {
        if (retry) return { ok: false, status: 429, error: "KN rate limit exceeded" };
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.request<T>(baseUrl, method, path, body, provenance, true);
      }

      if (res.status >= 500) {
        return { ok: false, status: res.status, error: "KN service unavailable" };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: text || `KN returned ${res.status}` };
      }

      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: `Cannot reach KN at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Shortcut: request against API gateway */
  private api<T>(method: string, path: string, body?: unknown, prov?: Provenance, retry?: boolean) {
    return this.request<T>(this.apiUrl, method, path, body, prov, retry);
  }

  /** Shortcut: request against research/nginx gateway */
  private research<T>(method: string, path: string, body?: unknown, prov?: Provenance, retry?: boolean) {
    return this.request<T>(this.researchUrl, method, path, body, prov, retry);
  }

  // ── Search ────────────────────────────────────────────────────────
  async search(params: SearchParams, provenance?: Provenance): Promise<KnResponse> {
    const qs = new URLSearchParams({ q: params.query });
    if (params.max_results) qs.set("limit", String(params.max_results));
    if (params.scope && params.scope !== "auto") qs.set("type", params.scope);
    return this.api("GET", `/search?${qs}`, undefined, provenance);
  }

  // ── Ingest ────────────────────────────────────────────────────────
  async ingest(params: IngestParams, provenance?: Provenance): Promise<KnResponse> {
    return this.api("POST", "/search/documents", {
      query: params.title,
      auto_ingest: true,
      limit: 1,
    }, provenance);
  }

  async ingestWithRetry(params: IngestParams, provenance?: Provenance): Promise<KnResponse> {
    const res = await this.ingest(params, provenance);
    if (!res.ok && res.status >= 500) {
      return this.ingest(params, provenance);
    }
    return res;
  }

  // ── Memory (via research/nginx gateway) ───────────────────────────
  async memoryRemember(
    content: string,
    factType: string,
    importance: number,
    tags: string[],
    provenance?: Provenance,
  ): Promise<KnResponse> {
    return this.research("POST", "/research/memory/facts", {
      content,
      fact_type: factType,
      importance,
      tags,
    }, provenance);
  }

  async memoryRecall(query: string, maxFacts: number, provenance?: Provenance): Promise<KnResponse> {
    return this.research("POST", "/research/memory/context", {
      query,
      max_facts: maxFacts,
    }, provenance);
  }

  async memoryList(maxFacts: number, provenance?: Provenance): Promise<KnResponse> {
    return this.research("GET", `/research/memory/facts?limit=${maxFacts}`, undefined, provenance);
  }

  async memoryStats(provenance?: Provenance): Promise<KnResponse> {
    return this.research("GET", "/research/memory/stats", undefined, provenance);
  }

  async memoryForget(factId: string, provenance?: Provenance): Promise<KnResponse> {
    return this.research("DELETE", `/research/memory/facts/${factId}`, undefined, provenance);
  }

  // ── Reminders ─────────────────────────────────────────────────────
  async reminderCreate(
    title: string,
    dueAt: string,
    provenance?: Provenance,
  ): Promise<KnResponse> {
    return this.api("POST", "/reminders", {
      title,
      remind_at: dueAt,
      source_type: "agent_created",
    }, provenance);
  }

  async reminderList(provenance?: Provenance): Promise<KnResponse> {
    return this.api("GET", "/reminders", undefined, provenance);
  }

  async reminderSnooze(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.api("POST", `/reminders/${id}/snooze`, {}, provenance);
  }

  async reminderDismiss(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.api("POST", `/reminders/${id}/dismiss`, {}, provenance);
  }

  async reminderComplete(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.api("POST", `/reminders/${id}/complete`, {}, provenance);
  }

  // ── Health ────────────────────────────────────────────────────────
  async health(): Promise<{ ok: boolean; status: string; message?: string }> {
    try {
      const res = await fetch(`${this.apiUrl}/health`);
      if (res.ok) return { ok: true, status: "ok" };
      return { ok: false, status: "degraded", message: `KN returned ${res.status}` };
    } catch (err) {
      return { ok: false, status: "error", message: `Cannot reach KN: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
