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
    return { ok: errors.length === 0, errors, warnings: [] };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
