import type { PluginToolsClient, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
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
  tools: PluginToolsClient,
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
