# Knowledge Nexus Plugin for Paperclip

Gives [Paperclip](https://github.com/paperclipai/paperclip) agents access to [Knowledge Nexus](https://knowledgenexus.ai) -- search institutional knowledge, store findings, remember facts across sessions, and manage reminders.

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
Store new knowledge -- research findings, task results, decisions, documentation.

### kn_memory
Persistent cross-session memory. Remember facts that survive across Paperclip heartbeat runs.

Actions: `remember`, `recall`, `list`, `stats`, `forget`

### kn_reminder
Create and manage AI reminders -- follow-ups, deadlines, scheduled actions.

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
