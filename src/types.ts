export interface KnPluginConfig {
  /** KN API gateway URL (handles search, reminders, auth) */
  knBaseUrl: string;
  /** KN research service URL (handles memory endpoints) */
  knResearchUrl: string;
  /** KN service account email */
  knEmail: string;
  /** KN service account password */
  knPassword: string;
  defaultScope: string;
  autoIngestOnComplete: boolean;
  autoIngestTargetStore: string;
}

export const DEFAULT_CONFIG: KnPluginConfig = {
  knBaseUrl: "http://localhost:8100",
  knResearchUrl: "http://localhost:8090",
  knEmail: "",
  knPassword: "",
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
