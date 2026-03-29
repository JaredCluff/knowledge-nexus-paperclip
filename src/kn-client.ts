import type {
  SearchParams,
  IngestParams,
  MemoryParams,
  ReminderParams,
  Provenance,
} from "./types.js";

interface KnResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export class KnClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private headers(provenance?: Provenance): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (provenance?.agentId) h["X-Paperclip-Agent"] = provenance.agentId;
    if (provenance?.companyId) h["X-Paperclip-Company"] = provenance.companyId;
    if (provenance?.projectId) h["X-Paperclip-Project"] = provenance.projectId;
    if (provenance?.runId) h["X-Paperclip-Run"] = provenance.runId;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    provenance?: Provenance,
    retry = false,
  ): Promise<KnResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(provenance),
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        return { ok: false, status: 401, error: "KN authentication failed — check API key in plugin config" };
      }

      if (res.status === 429) {
        if (retry) {
          return { ok: false, status: 429, error: "KN rate limit exceeded" };
        }
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return this.request<T>(method, path, body, provenance, true);
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
        error: `Cannot reach KN at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async search(params: SearchParams, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", "/query/unified", {
      query: params.query,
      scope: params.scope ?? "auto",
      max_results: params.max_results ?? 10,
      node_filter: params.node_filter,
    }, provenance);
  }

  async ingest(params: IngestParams, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", "/documents/ingest", {
      title: params.title,
      content: params.content,
      target_store: params.target_store ?? "auto",
      tags: params.tags ?? [],
      source_metadata: params.source_metadata,
      summary: params.summary,
    }, provenance);
  }

  async ingestWithRetry(params: IngestParams, provenance?: Provenance): Promise<KnResponse> {
    const res = await this.ingest(params, provenance);
    if (!res.ok && res.status >= 500) {
      return this.request("POST", "/documents/ingest", {
        title: params.title,
        content: params.content,
        target_store: params.target_store ?? "auto",
        tags: params.tags ?? [],
        source_metadata: params.source_metadata,
        summary: params.summary,
      }, provenance, true);
    }
    return res;
  }

  async memoryRemember(
    content: string,
    factType: string,
    importance: number,
    tags: string[],
    provenance?: Provenance,
  ): Promise<KnResponse> {
    return this.request("POST", "/research/memory/facts", {
      content,
      fact_type: factType,
      importance,
      tags,
    }, provenance);
  }

  async memoryRecall(query: string, maxFacts: number, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", "/research/memory/context", {
      query,
      max_facts: maxFacts,
    }, provenance);
  }

  async memoryList(maxFacts: number, provenance?: Provenance): Promise<KnResponse> {
    return this.request("GET", `/research/memory/facts?limit=${maxFacts}`, undefined, provenance);
  }

  async memoryStats(provenance?: Provenance): Promise<KnResponse> {
    return this.request("GET", "/research/memory/stats", undefined, provenance);
  }

  async memoryForget(factId: string, provenance?: Provenance): Promise<KnResponse> {
    return this.request("DELETE", `/research/memory/facts/${factId}`, undefined, provenance);
  }

  async reminderCreate(
    title: string,
    dueAt: string,
    provenance?: Provenance,
  ): Promise<KnResponse> {
    return this.request("POST", "/reminders", {
      title,
      remind_at: dueAt,
      source_type: "agent_created",
    }, provenance);
  }

  async reminderList(provenance?: Provenance): Promise<KnResponse> {
    return this.request("GET", "/reminders", undefined, provenance);
  }

  async reminderSnooze(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", `/reminders/${id}/snooze`, {}, provenance);
  }

  async reminderDismiss(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", `/reminders/${id}/dismiss`, {}, provenance);
  }

  async reminderComplete(id: string, provenance?: Provenance): Promise<KnResponse> {
    return this.request("POST", `/reminders/${id}/complete`, {}, provenance);
  }

  async health(): Promise<{ ok: boolean; status: string; message?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (res.ok) return { ok: true, status: "ok" };
      return { ok: false, status: "degraded", message: `KN returned ${res.status}` };
    } catch (err) {
      return { ok: false, status: "error", message: `Cannot reach KN: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
