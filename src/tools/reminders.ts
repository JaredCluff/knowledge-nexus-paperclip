import type { PluginToolsClient, ToolResult, ToolRunContext } from "@paperclipai/plugin-sdk";
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
  tools: PluginToolsClient,
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
