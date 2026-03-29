# Knowledge Nexus Paperclip Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Paperclip plugin that gives agents access to Knowledge Nexus search, ingestion, memory, and reminders via REST API, with auto-ingestion of completed issue documents.

**Architecture:** Direct REST client plugin using `@paperclipai/plugin-sdk`. The plugin registers 4 agent tools (kn_search, kn_ingest, kn_memory, kn_reminder) and subscribes to `issue.updated` events for auto-ingestion. A `KnClient` class wraps all KN API calls with auth and error handling.

**Tech Stack:** TypeScript, `@paperclipai/plugin-sdk` 1.0.0, native `fetch`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/manifest.ts` | Plugin manifest: ID, capabilities, config schema, tool declarations |
| `src/worker.ts` | Plugin entry: `definePlugin` + `setup`, wires tools and events |
| `src/kn-client.ts` | REST client: auth, provenance headers, error mapping, retry |
| `src/tools/search.ts` | `kn_search` tool handler → `POST /query/unified` |
| `src/tools/ingest.ts` | `kn_ingest` tool handler → `POST /documents/ingest` |
| `src/tools/memory.ts` | `kn_memory` tool handler → `/research/memory/*` |
| `src/tools/reminders.ts` | `kn_reminder` tool handler → `/reminders/*` |
| `src/events/auto-ingest.ts` | `issue.updated` handler: fetch docs, ingest, dedupe |
| `src/types.ts` | Shared types: config shape, tool params, provenance |
| `package.json` | Dependencies, build config |
| `tsconfig.json` | TypeScript config |
| `LICENSE` | MIT license |
| `README.md` | Usage, config, tool reference |

---

### Task 1: Scaffold project and config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `LICENSE`
- Create: `src/types.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@knowledgenexus/paperclip-plugin",
  "version": "0.1.0",
  "description": "Knowledge Nexus plugin for Paperclip — gives agents shared memory and knowledge",
  "type": "module",
  "private": false,
  "license": "MIT",
  "paperclipPlugin": {
    "manifest": "./dist/manifest.js",
    "worker": "./dist/worker.js"
  },
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create LICENSE**

Standard MIT license with `Copyright (c) 2026 Jared Cluff`.

- [ ] **Step 4: Create src/types.ts**

```typescript
export interface KnPluginConfig {
  knBaseUrl: string;
  apiKey: string;
  defaultScope: string;
  autoIngestOnComplete: boolean;
  autoIngestTargetStore: string;
}

export const DEFAULT_CONFIG: KnPluginConfig = {
  knBaseUrl: "https://api.knowledgenexus.ai",
  apiKey: "",
  defaultScope: "auto",
  autoIngestOnComplete: true,
  autoIngestTargetStore: "auto",
};

export interface Provenance {
  agentId?: string;
  companyId: string;
  projectId?: string;
  runId?: string;
}

export interface SearchParams {
  query: string;
  scope?: string;
  max_results?: number;
  node_filter?: string[];
}

export interface IngestParams {
  title: string;
  content: string;
  target_store?: string;
  tags?: string[];
  source_metadata?: Record<string, unknown>;
  summary?: string;
}

export interface MemoryParams {
  action: "remember" | "recall" | "list" | "stats" | "forget";
  content?: string;
  fact_type?: string;
  importance?: number;
  tags?: string[];
  query?: string;
  max_facts?: number;
  fact_id?: string;
}

export interface ReminderParams {
  action: "create" | "list" | "snooze" | "dismiss" | "complete";
  title?: string;
  due_at?: string;
  reminder_id?: string;
}
```

- [ ] **Step 5: Install dependencies and verify build**

Run: `npm install && npx tsc --noEmit`
Expected: Clean install, no type errors

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json LICENSE src/types.ts
git commit -m "feat: scaffold project with types and config"
```

---

### Task 2: KnClient REST wrapper

**Files:**
- Create: `src/kn-client.ts`

- [ ] **Step 1: Create src/kn-client.ts**

```typescript
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
        if (retry) {
          return { ok: false, status: res.status, error: "KN service unavailable" };
        }
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
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/kn-client.ts
git commit -m "feat: add KnClient REST wrapper with auth and error handling"
```

---

### Task 3: Tool handlers

**Files:**
- Create: `src/tools/search.ts`
- Create: `src/tools/ingest.ts`
- Create: `src/tools/memory.ts`
- Create: `src/tools/reminders.ts`

- [ ] **Step 1: Create src/tools/search.ts**

```typescript
import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { KnClient } from "../kn-client.js";
import type { KnPluginConfig, Provenance, SearchParams } from "../types.js";

function provenance(runCtx: ToolRunContext): Provenance {
  return {
    agentId: runCtx.agentId,
    companyId: runCtx.companyId,
    projectId: runCtx.projectId ?? undefined,
    runId: runCtx.runId ?? undefined,
  };
}

export function registerSearchTool(
  tools: { register: Function },
  client: KnClient,
  config: KnPluginConfig,
): void {
  tools.register(
    "kn_search",
    {
      displayName: "Knowledge Nexus Search",
      description:
        "Search across Knowledge Nexus stores. Returns documents with titles, excerpts, confidence scores, and source provenance. Use this to find institutional knowledge, past decisions, research, and documentation.",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          scope: {
            type: "string",
            enum: ["auto", "personal", "department", "corporate"],
            description: "Knowledge scope to search",
          },
          max_results: { type: "integer", description: "Maximum results (default 10)" },
          node_filter: {
            type: "array",
            items: { type: "string" },
            description: "Filter by node types",
          },
        },
        required: ["query"],
      },
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const p = params as SearchParams;
      if (!p.query) return { error: "query is required" };

      const res = await client.search(
        { ...p, scope: p.scope ?? config.defaultScope },
        provenance(runCtx),
      );

      if (!res.ok) return { error: res.error };
      return {
        content: JSON.stringify(res.data, null, 2),
        data: res.data,
      };
    },
  );
}
```

- [ ] **Step 2: Create src/tools/ingest.ts**

```typescript
import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { KnClient } from "../kn-client.js";
import type { IngestParams, Provenance } from "../types.js";

function provenance(runCtx: ToolRunContext): Provenance {
  return {
    agentId: runCtx.agentId,
    companyId: runCtx.companyId,
    projectId: runCtx.projectId ?? undefined,
    runId: runCtx.runId ?? undefined,
  };
}

export function registerIngestTool(
  tools: { register: Function },
  client: KnClient,
): void {
  tools.register(
    "kn_ingest",
    {
      displayName: "Knowledge Nexus Ingest",
      description:
        "Store new knowledge into Knowledge Nexus. Use this to persist research findings, task results, decisions, and documentation so other agents can find them later.",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Document content (markdown)" },
          target_store: {
            type: "string",
            description: "Target KN store (default: auto)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for categorization",
          },
          source_metadata: {
            type: "object",
            description: "Source tracking metadata",
          },
          summary: { type: "string", description: "Optional summary" },
        },
        required: ["title", "content"],
      },
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const p = params as IngestParams;
      if (!p.title || !p.content) return { error: "title and content are required" };

      const res = await client.ingest(p, provenance(runCtx));
      if (!res.ok) return { error: res.error };
      return {
        content: `Ingested "${p.title}" into Knowledge Nexus`,
        data: res.data,
      };
    },
  );
}
```

- [ ] **Step 3: Create src/tools/memory.ts**

```typescript
import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { KnClient } from "../kn-client.js";
import type { MemoryParams, Provenance } from "../types.js";

function provenance(runCtx: ToolRunContext): Provenance {
  return {
    agentId: runCtx.agentId,
    companyId: runCtx.companyId,
    projectId: runCtx.projectId ?? undefined,
    runId: runCtx.runId ?? undefined,
  };
}

export function registerMemoryTool(
  tools: { register: Function },
  client: KnClient,
): void {
  tools.register(
    "kn_memory",
    {
      displayName: "Knowledge Nexus Memory",
      description:
        "Persistent cross-session memory. Remember facts, recall context, list stored facts, or forget. Facts survive across Paperclip heartbeat runs — use this to build up knowledge over time.",
      parametersSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["remember", "recall", "list", "stats", "forget"],
            description: "Memory action to perform",
          },
          content: { type: "string", description: "Fact content (for remember)" },
          fact_type: {
            type: "string",
            enum: ["user_preference", "decision", "key_info", "action_item", "topic", "entity", "insight"],
            description: "Type of fact (default: key_info)",
          },
          importance: { type: "number", description: "Importance 1-10 (default: 5.0)" },
          tags: { type: "array", items: { type: "string" }, description: "Tags" },
          query: { type: "string", description: "Search query (for recall)" },
          max_facts: { type: "integer", description: "Max facts to return (default: 10)" },
          fact_id: { type: "string", description: "Fact ID (for forget)" },
        },
        required: ["action"],
      },
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const p = params as MemoryParams;
      const prov = provenance(runCtx);

      switch (p.action) {
        case "remember": {
          if (!p.content) return { error: "content is required for remember" };
          const res = await client.memoryRemember(
            p.content,
            p.fact_type ?? "key_info",
            p.importance ?? 5.0,
            p.tags ?? [],
            prov,
          );
          if (!res.ok) return { error: res.error };
          return { content: `Remembered: "${p.content}"`, data: res.data };
        }
        case "recall": {
          if (!p.query) return { error: "query is required for recall" };
          const res = await client.memoryRecall(p.query, p.max_facts ?? 10, prov);
          if (!res.ok) return { error: res.error };
          return { content: JSON.stringify(res.data, null, 2), data: res.data };
        }
        case "list": {
          const res = await client.memoryList(p.max_facts ?? 10, prov);
          if (!res.ok) return { error: res.error };
          return { content: JSON.stringify(res.data, null, 2), data: res.data };
        }
        case "stats": {
          const res = await client.memoryStats(prov);
          if (!res.ok) return { error: res.error };
          return { content: JSON.stringify(res.data, null, 2), data: res.data };
        }
        case "forget": {
          if (!p.fact_id) return { error: "fact_id is required for forget" };
          const res = await client.memoryForget(p.fact_id, prov);
          if (!res.ok) return { error: res.error };
          return { content: `Forgot fact ${p.fact_id}`, data: res.data };
        }
        default:
          return { error: `Unknown memory action: ${p.action}` };
      }
    },
  );
}
```

- [ ] **Step 4: Create src/tools/reminders.ts**

```typescript
import type { ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
import type { KnClient } from "../kn-client.js";
import type { ReminderParams, Provenance } from "../types.js";

function provenance(runCtx: ToolRunContext): Provenance {
  return {
    agentId: runCtx.agentId,
    companyId: runCtx.companyId,
    projectId: runCtx.projectId ?? undefined,
    runId: runCtx.runId ?? undefined,
  };
}

export function registerReminderTool(
  tools: { register: Function },
  client: KnClient,
): void {
  tools.register(
    "kn_reminder",
    {
      displayName: "Knowledge Nexus Reminder",
      description:
        "Create and manage AI reminders through Knowledge Nexus. Use this to set follow-up reminders, track deadlines, and schedule future actions.",
      parametersSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "list", "snooze", "dismiss", "complete"],
            description: "Reminder action",
          },
          title: { type: "string", description: "Reminder title (for create)" },
          due_at: { type: "string", description: "ISO 8601 due date (for create)" },
          reminder_id: { type: "string", description: "Reminder ID (for snooze/dismiss/complete)" },
        },
        required: ["action"],
      },
    },
    async (params: unknown, runCtx: ToolRunContext): Promise<ToolResult> => {
      const p = params as ReminderParams;
      const prov = provenance(runCtx);

      switch (p.action) {
        case "create": {
          if (!p.title) return { error: "title is required for create" };
          if (!p.due_at) return { error: "due_at is required for create" };
          const res = await client.reminderCreate(p.title, p.due_at, prov);
          if (!res.ok) return { error: res.error };
          return { content: `Created reminder: "${p.title}"`, data: res.data };
        }
        case "list": {
          const res = await client.reminderList(prov);
          if (!res.ok) return { error: res.error };
          return { content: JSON.stringify(res.data, null, 2), data: res.data };
        }
        case "snooze": {
          if (!p.reminder_id) return { error: "reminder_id is required for snooze" };
          const res = await client.reminderSnooze(p.reminder_id, prov);
          if (!res.ok) return { error: res.error };
          return { content: `Snoozed reminder ${p.reminder_id}`, data: res.data };
        }
        case "dismiss": {
          if (!p.reminder_id) return { error: "reminder_id is required for dismiss" };
          const res = await client.reminderDismiss(p.reminder_id, prov);
          if (!res.ok) return { error: res.error };
          return { content: `Dismissed reminder ${p.reminder_id}`, data: res.data };
        }
        case "complete": {
          if (!p.reminder_id) return { error: "reminder_id is required for complete" };
          const res = await client.reminderComplete(p.reminder_id, prov);
          if (!res.ok) return { error: res.error };
          return { content: `Completed reminder ${p.reminder_id}`, data: res.data };
        }
        default:
          return { error: `Unknown reminder action: ${p.action}` };
      }
    },
  );
}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/tools/
git commit -m "feat: add kn_search, kn_ingest, kn_memory, kn_reminder tool handlers"
```

---

### Task 4: Auto-ingest event handler

**Files:**
- Create: `src/events/auto-ingest.ts`

- [ ] **Step 1: Create src/events/auto-ingest.ts**

```typescript
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { Issue } from "@paperclipai/shared";
import type { KnClient } from "../kn-client.js";
import type { KnPluginConfig } from "../types.js";

const DEDUPE_NAMESPACE = "auto-ingest";

function dedupeKey(issueId: string, docId: string, revision: number): string {
  return `${issueId}:${docId}:${revision}`;
}

async function isAlreadyIngested(
  ctx: PluginContext,
  companyId: string,
  key: string,
): Promise<boolean> {
  const val = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    namespace: DEDUPE_NAMESPACE,
    stateKey: key,
  });
  return val != null;
}

async function markIngested(
  ctx: PluginContext,
  companyId: string,
  key: string,
): Promise<void> {
  await ctx.state.set(
    {
      scopeKind: "company",
      scopeId: companyId,
      namespace: DEDUPE_NAMESPACE,
      stateKey: key,
    },
    { ingestedAt: new Date().toISOString() },
  );
}

export function registerAutoIngest(
  ctx: PluginContext,
  client: KnClient,
  config: KnPluginConfig,
): void {
  if (!config.autoIngestOnComplete) return;

  ctx.events.on("issue.updated", async (event: PluginEvent) => {
    const payload = event.payload as { issue?: Issue; changes?: Record<string, unknown> };
    const issue = payload.issue;
    if (!issue) return;

    // Only act on transitions to "done"
    const changes = payload.changes;
    if (!changes || changes.status !== "done") return;
    if (issue.status !== "done") return;

    const companyId = event.companyId;
    const identifier = issue.identifier ?? issue.id;

    ctx.logger.info(`[auto-ingest] Issue ${identifier} completed, checking documents`);

    // Fetch issue documents
    let docSummaries;
    try {
      docSummaries = await ctx.issues.documents.list(issue.id, companyId);
    } catch (err) {
      ctx.logger.warn(`[auto-ingest] Failed to list documents for ${identifier}: ${err}`);
      return;
    }

    if (!docSummaries || docSummaries.length === 0) {
      ctx.logger.info(`[auto-ingest] No documents on ${identifier}, skipping`);
      return;
    }

    let ingested = 0;
    for (const summary of docSummaries) {
      const key = dedupeKey(issue.id, summary.id, summary.latestRevisionNumber ?? 0);

      if (await isAlreadyIngested(ctx, companyId, key)) {
        ctx.logger.info(`[auto-ingest] Already ingested ${identifier}/${summary.key}, skipping`);
        continue;
      }

      // Fetch full document body
      let doc;
      try {
        doc = await ctx.issues.documents.get(issue.id, summary.key, companyId);
      } catch (err) {
        ctx.logger.warn(`[auto-ingest] Failed to get doc ${summary.key} for ${identifier}: ${err}`);
        continue;
      }

      if (!doc?.body) {
        ctx.logger.info(`[auto-ingest] Empty doc ${summary.key} for ${identifier}, skipping`);
        continue;
      }

      // Build tags from issue labels and project
      const tags: string[] = [];
      if (issue.labelIds) tags.push(...issue.labelIds);
      if (issue.projectId) tags.push(`project:${issue.projectId}`);

      const res = await client.ingestWithRetry(
        {
          title: `${identifier} — ${summary.key}`,
          content: doc.body,
          target_store: config.autoIngestTargetStore,
          tags,
          source_metadata: {
            source: "paperclip",
            issueId: issue.id,
            projectId: issue.projectId,
            companyId,
            agentId: issue.assigneeAgentId,
            completedAt: issue.completedAt,
            documentKey: summary.key,
          },
        },
        { companyId },
      );

      if (res.ok) {
        await markIngested(ctx, companyId, key);
        ingested++;
        ctx.logger.info(`[auto-ingest] Ingested ${identifier}/${summary.key}`);
      } else {
        ctx.logger.warn(`[auto-ingest] Failed to ingest ${identifier}/${summary.key}: ${res.error}`);
      }
    }

    ctx.logger.info(`[auto-ingest] ${identifier}: ingested ${ingested}/${docSummaries.length} documents`);
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/events/auto-ingest.ts
git commit -m "feat: add auto-ingest event handler for completed issues"
```

---

### Task 5: Plugin manifest

**Files:**
- Create: `src/manifest.ts`

- [ ] **Step 1: Create src/manifest.ts**

```typescript
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "knowledgenexus.knowledge-nexus",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Knowledge Nexus",
  description:
    "Gives Paperclip agents access to Knowledge Nexus — search institutional knowledge, store findings, remember facts across sessions, and manage reminders.",
  author: "Jared Cluff",
  categories: ["knowledge-management", "productivity"],
  capabilities: [
    "agent.tools.register",
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "issues.read",
    "issue.documents.read",
    "companies.read",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      knBaseUrl: {
        type: "string",
        description: "Knowledge Nexus API gateway URL",
        default: "https://api.knowledgenexus.ai",
      },
      apiKey: {
        type: "string",
        description: "Knowledge Nexus API key",
      },
      defaultScope: {
        type: "string",
        enum: ["auto", "personal", "department", "corporate"],
        description: "Default search scope",
        default: "auto",
      },
      autoIngestOnComplete: {
        type: "boolean",
        description: "Auto-ingest issue documents when tasks complete",
        default: true,
      },
      autoIngestTargetStore: {
        type: "string",
        description: "Target KN store for auto-ingested documents",
        default: "auto",
      },
    },
    required: ["apiKey"],
  },
  tools: [
    {
      name: "kn_search",
      displayName: "Knowledge Nexus Search",
      description: "Search across Knowledge Nexus stores for institutional knowledge.",
      parametersSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string" },
          max_results: { type: "integer" },
          node_filter: { type: "array", items: { type: "string" } },
        },
        required: ["query"],
      },
    },
    {
      name: "kn_ingest",
      displayName: "Knowledge Nexus Ingest",
      description: "Store new knowledge into Knowledge Nexus.",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          target_store: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          source_metadata: { type: "object" },
          summary: { type: "string" },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "kn_memory",
      displayName: "Knowledge Nexus Memory",
      description: "Persistent cross-session memory for agents.",
      parametersSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["remember", "recall", "list", "stats", "forget"] },
          content: { type: "string" },
          fact_type: { type: "string" },
          importance: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
          query: { type: "string" },
          max_facts: { type: "integer" },
          fact_id: { type: "string" },
        },
        required: ["action"],
      },
    },
    {
      name: "kn_reminder",
      displayName: "Knowledge Nexus Reminder",
      description: "Create and manage AI reminders.",
      parametersSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "list", "snooze", "dismiss", "complete"] },
          title: { type: "string" },
          due_at: { type: "string" },
          reminder_id: { type: "string" },
        },
        required: ["action"],
      },
    },
  ],
};

export default manifest;
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/manifest.ts
git commit -m "feat: add plugin manifest with config schema and tool declarations"
```

---

### Task 6: Worker entry point

**Files:**
- Create: `src/worker.ts`

- [ ] **Step 1: Create src/worker.ts**

```typescript
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginHealthDiagnostics,
} from "@paperclipai/plugin-sdk";
import { KnClient } from "./kn-client.js";
import { DEFAULT_CONFIG, type KnPluginConfig } from "./types.js";
import { registerSearchTool } from "./tools/search.js";
import { registerIngestTool } from "./tools/ingest.js";
import { registerMemoryTool } from "./tools/memory.js";
import { registerReminderTool } from "./tools/reminders.js";
import { registerAutoIngest } from "./events/auto-ingest.js";

let knClient: KnClient | null = null;

function getConfig(ctx: PluginContext): KnPluginConfig {
  const raw = ctx.config as Partial<KnPluginConfig>;
  return {
    knBaseUrl: raw.knBaseUrl ?? DEFAULT_CONFIG.knBaseUrl,
    apiKey: raw.apiKey ?? DEFAULT_CONFIG.apiKey,
    defaultScope: raw.defaultScope ?? DEFAULT_CONFIG.defaultScope,
    autoIngestOnComplete: raw.autoIngestOnComplete ?? DEFAULT_CONFIG.autoIngestOnComplete,
    autoIngestTargetStore: raw.autoIngestTargetStore ?? DEFAULT_CONFIG.autoIngestTargetStore,
  };
}

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx: PluginContext) {
    const config = getConfig(ctx);

    if (!config.apiKey) {
      ctx.logger.warn("Knowledge Nexus plugin: no API key configured — tools will return errors");
    }

    knClient = new KnClient(config.knBaseUrl, config.apiKey);

    // Register agent tools
    registerSearchTool(ctx.tools, knClient, config);
    registerIngestTool(ctx.tools, knClient);
    registerMemoryTool(ctx.tools, knClient);
    registerReminderTool(ctx.tools, knClient);

    // Register event handlers
    registerAutoIngest(ctx, knClient, config);

    ctx.logger.info(`Knowledge Nexus plugin ready (${config.knBaseUrl})`);
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    if (!knClient) {
      return { status: "error", message: "Plugin not initialized" };
    }
    const h = await knClient.health();
    return {
      status: h.ok ? "ok" : "error",
      message: h.message ?? (h.ok ? "Knowledge Nexus reachable" : "Knowledge Nexus unreachable"),
    };
  },

  async onConfigChanged(newConfig) {
    const raw = newConfig as Partial<KnPluginConfig>;
    const config: KnPluginConfig = {
      knBaseUrl: raw.knBaseUrl ?? DEFAULT_CONFIG.knBaseUrl,
      apiKey: raw.apiKey ?? DEFAULT_CONFIG.apiKey,
      defaultScope: raw.defaultScope ?? DEFAULT_CONFIG.defaultScope,
      autoIngestOnComplete: raw.autoIngestOnComplete ?? DEFAULT_CONFIG.autoIngestOnComplete,
      autoIngestTargetStore: raw.autoIngestTargetStore ?? DEFAULT_CONFIG.autoIngestTargetStore,
    };
    knClient = new KnClient(config.knBaseUrl, config.apiKey);
  },

  async onValidateConfig(config) {
    const errors: string[] = [];
    const typed = config as Partial<KnPluginConfig>;
    if (!typed.apiKey) {
      errors.push("apiKey is required");
    }
    if (typed.knBaseUrl && typeof typed.knBaseUrl !== "string") {
      errors.push("knBaseUrl must be a string");
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
```

- [ ] **Step 2: Verify full build**

Run: `npx tsc`
Expected: Clean compilation, `dist/` directory created with all `.js` and `.d.ts` files

- [ ] **Step 3: Verify dist structure**

Run: `ls -R dist/`
Expected:
```
dist/
  manifest.js
  manifest.d.ts
  worker.js
  worker.d.ts
  kn-client.js
  kn-client.d.ts
  types.js
  types.d.ts
  tools/
    search.js, search.d.ts
    ingest.js, ingest.d.ts
    memory.js, memory.d.ts
    reminders.js, reminders.d.ts
  events/
    auto-ingest.js, auto-ingest.d.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: add worker entry point wiring tools and events"
```

---

### Task 7: README and publish prep

**Files:**
- Create: `README.md`
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 2: Create README.md**

```markdown
# Knowledge Nexus Plugin for Paperclip

Gives [Paperclip](https://github.com/paperclipai/paperclip) agents access to [Knowledge Nexus](https://knowledgenexus.ai) — search institutional knowledge, store findings, remember facts across sessions, and manage reminders.

## Install

Add this plugin to your Paperclip instance. Configure it with your Knowledge Nexus API key.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `knBaseUrl` | string | `https://api.knowledgenexus.ai` | KN API URL |
| `apiKey` | string | *(required)* | KN API key |
| `defaultScope` | string | `auto` | Search scope: auto, personal, department, corporate |
| `autoIngestOnComplete` | boolean | `true` | Auto-ingest docs when issues complete |
| `autoIngestTargetStore` | string | `auto` | Target KN store for auto-ingest |

## Agent Tools

### kn_search
Search across Knowledge Nexus stores. Returns documents with titles, excerpts, confidence scores, and source provenance.

### kn_ingest
Store new knowledge — research findings, task results, decisions, documentation.

### kn_memory
Persistent cross-session memory. Remember facts that survive across Paperclip heartbeat runs.

Actions: `remember`, `recall`, `list`, `stats`, `forget`

### kn_reminder
Create and manage AI reminders — follow-ups, deadlines, scheduled actions.

Actions: `create`, `list`, `snooze`, `dismiss`, `complete`

## Auto-Ingestion

When enabled (default), completed issues automatically have their documents ingested into Knowledge Nexus with full provenance metadata. Deduplication prevents re-ingestion of the same document revision.

## Build

```bash
npm install
npm run build
```

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore README.md
git commit -m "docs: add README and gitignore"
```

---

### Task 8: Create GitHub repo and push

- [ ] **Step 1: Create remote repo**

Run: `gh repo create JaredCluff/knowledge-nexus-paperclip --public --description "Knowledge Nexus plugin for Paperclip — gives agents shared memory and knowledge" --license MIT`

- [ ] **Step 2: Rename branch and push**

```bash
git branch -m master main
git remote add origin https://github.com/JaredCluff/knowledge-nexus-paperclip.git
git push -u origin main
```

- [ ] **Step 3: Verify**

Run: `gh repo view JaredCluff/knowledge-nexus-paperclip`
Expected: Public repo with MIT license, all files visible
