export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

export type JsonObject = {
  [key: string]: JsonValue
}

export type PlanTier = 'starter' | 'growth' | 'scale' | string
export type WorkspaceMemberRole = 'owner' | 'admin' | 'member' | string
export type ContactStatus = 'drafted' | 'ready_for_review' | 'approved_to_launch' | 'revision_requested' | string
export type CampaignStatus = 'draft' | 'idle' | 'staged' | 'running' | 'completed' | string
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | string
export type ApprovalPriority = 'low' | 'medium' | 'high' | string
export type ApprovalType = 'batch_send' | 'reply_review' | 'sequence_update' | string

export interface Organization {
  id: string
  name: string
  plan_tier: PlanTier
  stripe_customer_id: string | null
  trial_ends_at: string | null
  created_at: string
}

export interface Workspace {
  id: string
  org_id: string
  name: string
  apollo_key_enc: string | null
  instantly_key_enc: string | null
  composio_entity_id: string | null
  created_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceMemberRole
  created_at: string
}

export interface ICPConfig {
  id: string
  workspace_id: string
  industries: string[]
  titles: string[]
  company_sizes: string[]
  geos: string[]
  pain_points: string | null
  cta: string | null
  voice_guidelines: string | null
  apollo_filter_json: JsonObject
  strategy_json: JsonObject
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  workspace_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  company: string | null
  linkedin_url: string | null
  apollo_id: string | null
  status: ContactStatus
  enriched_at: string | null
  never_contact: boolean
  signal_type: string | null
  signal_detail: string | null
  created_at: string
}

export interface EmailDraft {
  id: string
  contact_id: string
  workspace_id: string
  subject_1: string | null
  subject_2: string | null
  subject_3: string | null
  subject_4: string | null
  body_1: string | null
  body_2: string | null
  body_3: string | null
  body_4: string | null
  personalization_signal: string | null
  quality_score: number | null
  approved_at: string | null
  instantly_lead_id: string | null
  created_at: string
}

export interface Campaign {
  id: string
  workspace_id: string
  instantly_campaign_id: string | null
  week_start: string
  contact_count: number
  status: CampaignStatus
  template_json: JsonObject
  created_at: string
}

export interface Reply {
  id: string
  contact_id: string | null
  workspace_id: string
  reply_text: string | null
  classification: string | null
  confidence: number | null
  draft_response: string | null
  approved_at: string | null
  sent_at: string | null
  instantly_email_id: string | null
  resume_at: string | null
  created_at: string
}

export interface Meeting {
  id: string
  contact_id: string | null
  workspace_id: string
  scheduled_at: string | null
  calendar_event_id: string | null
  prep_brief_json: JsonObject
  outcome: string | null
  outcome_notes: string | null
  created_at: string
}

export interface ApprovalQueueItem {
  id: string
  workspace_id: string
  type: ApprovalType
  payload_json: JsonObject
  status: ApprovalStatus
  priority: ApprovalPriority
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface PerformanceMetrics {
  id: string
  workspace_id: string
  week_start: string
  contacts_sourced: number
  emails_sent: number
  open_rate: number
  reply_rate: number
  positive_reply_rate: number
  meetings_booked: number
  top_signal: string | null
  top_subject: string | null
  created_at: string
}

export interface ChatMessage {
  id: string
  workspace_id: string
  role: string
  content: string
  tool_calls_json: JsonValue[]
  created_at: string
}

export interface WorkspaceSettings {
  id: string
  workspace_id: string
  auto_approve_json: JsonObject
  sending_schedule_json: JsonObject
  optimization_enabled: boolean
  weekly_report_enabled: boolean
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  workspace_id: string
  action: string
  entity_type: string
  entity_id: string | null
  actor_type: string
  actor_id: string | null
  metadata_json: JsonObject
  created_at: string
}
