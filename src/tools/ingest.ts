import type { PluginToolsClient, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
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
  tools: PluginToolsClient,
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
