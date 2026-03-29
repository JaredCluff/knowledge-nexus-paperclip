import type { PluginToolsClient, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
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
  tools: PluginToolsClient,
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
