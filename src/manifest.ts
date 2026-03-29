import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "knowledgenexus.knowledge-nexus",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Knowledge Nexus",
  description:
    "Gives Paperclip agents access to Knowledge Nexus — search institutional knowledge, store findings, remember facts across sessions, and manage reminders.",
  author: "Jared Cluff",
  categories: ["workspace"],
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
