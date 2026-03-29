# Knowledge Nexus Paperclip Plugin — Design Spec

**Date:** 2026-03-29
**Repo:** JaredCluff/knowledge-nexus-paperclip
**License:** MIT

## Purpose

Give Paperclip-orchestrated agents access to Knowledge Nexus as a shared memory and knowledge layer. Paperclip handles orchestration (who does what, when, at what cost); KN handles knowledge (what agents know, and how they learn). This plugin bridges the two so every agent in a Paperclip company gains institutional memory without Paperclip needing to build a knowledge store.

## Architecture

Direct REST client. The plugin talks to KN's API gateway over HTTP, authenticating with an operator-provided API key. No MCP, no NATS — just REST calls from tool handlers and event listeners.

```
Paperclip Agent
    ↓ (calls tool)
Plugin Worker (knowledge-nexus-paperclip)
    ↓ (REST / fetch)
KN API Gateway (api.knowledgenexus.ai or self-hosted)
    ↓
KN Services (retrieval, ingestion, memory, reminders)
```

## Plugin Identity

- **Manifest ID:** `knowledgenexus.knowledge-nexus`
- **API Version:** 1
- **Categories:** `["knowledge-management", "productivity"]`

## Instance Configuration

Operator sets these during plugin install in Paperclip:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `knBaseUrl` | string | `https://api.knowledgenexus.ai` | KN API gateway URL |
| `apiKey` | string | *(required)* | KN API key for authentication |
| `defaultScope` | string | `auto` | Default search scope: auto, personal, department, corporate |
| `autoIngestOnComplete` | boolean | `true` | Auto-ingest issue documents when tasks complete |
| `autoIngestTargetStore` | string | `auto` | Which KN store to auto-ingest into |

## Capabilities Requested

- `agent.tools.register` — register the 4 tool groups
- `events.subscribe` — listen for `issue.updated` events
- `plugin.state.read` / `plugin.state.write` — dedupe tracking for auto-ingest
- `issues.read` — read issue documents for auto-ingestion
- `companies.read` — resolve company context

## Agent Tools

### kn_search

Query across KN knowledge stores with K2K semantic routing.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | yes | | Natural language search query |
| `scope` | string | no | config `defaultScope` | auto, personal, department, corporate |
| `max_results` | integer | no | 10 | Maximum results to return |
| `node_filter` | string[] | no | | Filter by node types |

**KN Endpoint:** `POST /query/unified`

**Returns:** Search results with titles, excerpts, confidence scores, and source provenance.

### kn_ingest

Store new knowledge into KN from agent task output.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | yes | | Document title |
| `content` | string | yes | | Document content (markdown) |
| `target_store` | string | no | `auto` | Which KN store to place in |
| `tags` | string[] | no | | Tags for categorization |
| `source_metadata` | object | no | | Source tracking metadata |
| `summary` | string | no | | Optional summary |

**KN Endpoint:** `POST /documents/ingest` (via API gateway)

**Returns:** Confirmation with document ID and target store.

### kn_memory

Persistent cross-session memory for agents. Facts survive across Paperclip heartbeat runs.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `action` | string | yes | | remember, recall, list, stats, forget |
| `content` | string | conditional | | Fact content (required for remember) |
| `fact_type` | string | no | `key_info` | user_preference, decision, key_info, action_item, topic, entity, insight |
| `importance` | number | no | 5.0 | Importance score 1-10 |
| `tags` | string[] | no | | Tags for categorization |
| `query` | string | conditional | | Search query (required for recall) |
| `max_facts` | integer | no | 10 | Max facts for recall/list |
| `fact_id` | string | conditional | | Required for forget (delete) |

**KN Endpoints:**
- remember: `POST /research/memory/facts`
- recall: `POST /research/memory/context`
- list: `GET /research/memory/facts`
- stats: `GET /research/memory/stats`
- forget: `DELETE /research/memory/facts/{fact_id}`

**Returns:** Stored fact with ID and memory tier, or recalled facts matching query.

### kn_reminder

Create and manage AI reminders through KN.

**Parameters:**
| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `action` | string | yes | | create, list, snooze, dismiss, complete |
| `title` | string | conditional | | Reminder title (required for create) |
| `due_at` | string | no | | ISO 8601 due date |
| `reminder_id` | string | conditional | | Required for snooze/dismiss/complete |

**KN Endpoint:** REST endpoints under `/reminders`.

**Returns:** Reminder object or list.

### Provenance Headers

All tool calls include provenance headers so KN can track which Paperclip agent stored or queried what:

- `Authorization: Bearer {apiKey}`
- `X-Paperclip-Agent: {agentId}`
- `X-Paperclip-Company: {companyId}`
- `X-Paperclip-Project: {projectId}`
- `X-Paperclip-Run: {runId}`

## Event-Driven Auto-Ingestion

When `autoIngestOnComplete` is true, the plugin subscribes to `issue.updated` events.

**Flow:**

1. **Filter:** Only act when issue status changed to `done`.
2. **Fetch:** Read the issue's documents (plan, analysis, work products) via Paperclip's issues API.
3. **Ingest:** For each document with content, call KN `POST /documents/ingest`:
   - `title`: `"{issue identifier} - {document key}"` (e.g. `"PC-42 - plan"`)
   - `content`: document body (markdown)
   - `target_store`: operator's configured `autoIngestTargetStore`
   - `tags`: issue labels + project name
   - `source_metadata`: `{ source: "paperclip", issueId, projectId, companyId, agentId, completedAt }`
4. **Dedupe:** Track ingested documents in plugin state (company-scoped) using key `{issueId}:{documentId}:{revisionNumber}`. Same revision never ingested twice. New revisions (reopened and re-completed issues) are ingested.

**Error handling:** Logs but does not fail on individual document ingestion errors. Partial ingestion is better than none.

## KnClient

Thin REST wrapper class. No external HTTP library — uses built-in `fetch`.

**Constructor:** `new KnClient(baseUrl: string, apiKey: string)`

**Methods:**
- `search(params, provenance)` → `POST /query/unified`
- `ingest(params, provenance)` → `POST /documents/ingest`
- `memory(params, provenance)` → `/research/memory/*` endpoints
- `reminder(params, provenance)` → `/reminders` endpoints
- `health()` → `GET /health`

**Error handling:**
- `401` → ToolResult with error: "KN authentication failed - check API key in plugin config"
- `429` → Retry once after `Retry-After` header, then return rate limit error
- `5xx` → ToolResult with error: "KN service unavailable" (no retry for tools, one retry for auto-ingest)
- Network error → ToolResult with error: "Cannot reach KN at {baseUrl}"
- All errors logged via `ctx.logger`

**Health check:** `onHealth()` pings `GET /health` on KN base URL. Reports ok / degraded / error.

## File Structure

```
knowledge-nexus-paperclip/
├── src/
│   ├── manifest.ts          — PaperclipPluginManifestV1 export
│   ├── worker.ts            — definePlugin + setup, registers tools & events
│   ├── kn-client.ts         — KnClient class (REST wrapper)
│   ├── tools/
│   │   ├── search.ts        — kn_search handler
│   │   ├── ingest.ts        — kn_ingest handler
│   │   ├── memory.ts        — kn_memory handler
│   │   └── reminders.ts     — kn_reminder handler
│   └── events/
│       └── auto-ingest.ts   — issue.updated handler + dedupe logic
├── package.json
├── tsconfig.json
├── LICENSE                   — MIT
└── README.md
```

## Dependencies

- `@paperclipai/plugin-sdk` — peer dependency
- `typescript` — dev dependency
- No other runtime dependencies (fetch is built-in)

## Build

`tsc` compiles to `dist/`. Worker entrypoint: `dist/worker.js`.
