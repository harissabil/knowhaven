// Response shapes of the FastAPI backend (backend/src/brain/api/*). Keep in sync with the
// OpenAPI schema at /openapi.json; field names here are the wire names.

export interface RoleOut { id: string; key: string; name: string; is_system: boolean }

export interface MemberOut {
  user_id: string;
  name: string;
  email: string;
  status: "active" | "pending" | string;
  roles: string[]; // role keys
  department: string | null;
  title: string | null;
  joined_at: string;
}

export interface InviteOut {
  id: string;
  role_id: string;
  role_key: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  revoked: boolean;
  link?: string | null; // only in the create response
}

export interface ContainerOut {
  id: string;
  source: string;
  external_id: string;
  name: string;
  tier: "hidden" | "gated" | "open" | string;
  mapped: boolean;
  role_ids: string[];
  owner_user_id: string | null;
  authority_default: string | null;
  item_count: number;
  created_at: string;
}

export interface ManagerOut { id: string; scope_type: "role" | "container" | string; scope_id: string; manager_user_id: string }

export interface TopicOut {
  topic_key: string;
  display_name: string;
  aliases?: string[];
  owner_user_id?: string | null;
  fallback_contact: string;
  tier?: string;
  container_id?: string | null;
}

/** GET /api/admin/pii: {role_id: [pii_type]} */
export type PiiMatrix = Record<string, string[]>;
export const PII_TYPES = ["nik", "phone", "email", "npwp", "bank_account"] as const;

export interface UploadOut {
  container_id: string;
  storage_key: string;
  created: number;
  updated: number;
  unchanged: number;
  item_ids: string[];
  injection_flagged: string[];
}

export interface SourceOut {
  id: string;
  type: string;
  source: string;
  title: string | null;
  container: string;
  author: string | null;
  created_at: string;
  updated_at: string;
  url: string | null;
  authority: string;
  injection_flag: boolean;
  structured: Record<string, unknown> | null;
  chunks: { citation_id: string; anchor: string | null; text: string }[];
  download_url: string | null;
}

export interface ConversationOut { id: string; title: string | null; channel: string; created_at: string }
export interface HistoryCitation { id: string; type: string; title: string; container: string; date: string | null }
export interface MessageOut {
  role: "user" | "assistant" | string;
  content: string;
  citations: string[];
  created_at: string;
  query_id: string | null;
  stale: boolean;
  sources: HistoryCitation[]; // re-checked against current permissions on every load
  decision_path: string | null;
}

export interface AuditRowOut {
  seq: number;
  ts: string;
  event_type: string;
  query_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  channel: string | null;
  query_text: string | null;
  language: string | null;
  intent: string | null;
  permission_version: number | null;
  roles_snapshot: string[];
  retrieved_item_ids: string[];
  filtered_count: number | null;
  decision_path: string | null;
  response_text: string | null;
  citations: string[];
  model_ids: Record<string, string> | null;
  prompt_version: string | null;
  latency_ms: number | null;
  details: Record<string, unknown> | null;
  row_hash: string;
}
export interface TraceStepOut { step: number; label: string; name: string; ms: number | null; summary: string | null; detail?: Record<string, unknown> | null; started_at?: string | null }
export interface QueryDetailOut { audit: AuditRowOut; trace: TraceStepOut[] }
export interface VerifyOut { ok: boolean; rows: number; first_bad_seq: number | null; verified_at: string }
export interface SummaryOut {
  since: string;
  queries: number;
  by_decision: Record<string, number>;
  by_channel: Record<string, number>;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  admin_events: number;
  total_filtered: number;
}

export interface AccessRequestOut {
  id: string;
  topic_key: string;
  topic_name?: string | null;
  container_id?: string | null;
  container_name?: string | null;
  requester_id: string;
  requester_name?: string | null;
  requester_email?: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "expired" | string;
  approver_id?: string | null;
  approver_name?: string | null;
  decided_at?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export interface ActionDraftOut {
  id: string;
  kind: string;
  target_system: string;
  target_ref: string;
  target_title?: string | null;
  payload: Record<string, unknown>;
  diff: string;
  evidence_ids: string[];
  created_by_query_id?: string | null;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | string;
  approver_id?: string | null;
  approver_name?: string | null;
  decided_at?: string | null;
  executed_at?: string | null;
  exec_result?: Record<string, unknown> | null;
  created_at: string;
}

export interface TokenOut { id: string; label: string; created_at: string; last_used_at: string | null; revoked: boolean }
export interface TokenCreated extends TokenOut { token: string; mcp_json: string }

/** GET /api/documents/folders */
export interface FolderOut {
  id: string;
  name: string;
  source: "upload_folder" | "whatsapp_group" | string;
  tier: string;
  mapped: boolean;
  role_names: string[]; // who can read it; empty = nobody yet
  document_count: number;
  visible_to_me: boolean;
  can_upload: boolean;
}

/** GET /api/documents, /api/documents/{id} */
export interface DocumentOut {
  id: string;
  title: string | null;
  filename: string;
  folder_id: string;
  folder_name: string;
  type: string;
  authority: string;
  created_at: string;
  updated_at: string;
  revisions: number;
  uploaded_by: string | null;
  chunk_count: number;
  injection_flag: boolean;
  has_pii: boolean;
  can_read: boolean;
  can_manage: boolean;
  can_download: boolean;
}

export interface TenantSettingsOut { name: string; slug: string; default_contact: string | null; profile: string | null }
