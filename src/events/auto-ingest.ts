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
