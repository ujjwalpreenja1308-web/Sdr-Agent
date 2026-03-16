import type { JsonObject } from './entities.js'

export type ConnectionMode = 'oauth' | 'api_key'
export type ConnectionState = 'not_connected' | 'pending' | 'connected'

export interface ConnectionTarget {
  toolkit: string
  label: string
  category: 'required' | 'optional'
  mode: ConnectionMode
  description: string
  status: ConnectionState
  required_for_phase: string
  note?: string | null
  connection_id?: string | null
}

export interface MetricCard {
  label: string
  value: string
  caption: string
}

export interface OperatorEvent {
  id: string
  workspace_id: string
  action: string
  entity_type: string
  entity_id: string | null
  actor_type: string
  actor_id: string | null
  summary: string
  metadata_json: JsonObject
  created_at: string
}

export type ExecutionRunStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'in_progress'

export interface ExecutionRun {
  id: string
  workspace_id: string
  scope: string
  execution_key: string
  status: ExecutionRunStatus
  summary: string
  actor_type: string
  actor_id: string | null
  started_at: string
  completed_at: string | null
  metadata_json: JsonObject
}

export interface BuildPhase {
  name: string
  duration: string
  outcome: string
  status: 'active' | 'next' | 'later'
}

export interface WorkspaceSummary {
  id: string
  name: string
  greeting: string
  proposition: string
  phase_focus: string
  onboarding_completed: boolean
  onboarding_progress: number
  metrics: MetricCard[]
  phases: BuildPhase[]
  strategy_questions: string[]
  connections: ConnectionTarget[]
}

export interface AuthWorkspaceOption {
  id: string
  name: string
}

export interface AuthSession {
  user_id: string
  org_id: string
  workspace_id: string
  workspaces: AuthWorkspaceOption[]
  claims: Record<string, unknown>
}

export interface OnboardingProfile {
  workspace_id: string
  product_name: string
  product_description: string
  target_customer: string
  value_proposition: string
  pain_points: string
  call_to_action: string
  voice_guidelines: string
  industries: string[]
  titles: string[]
  company_sizes: string[]
  geos: string[]
  exclusions: string[]
}

export interface PipelineMetric {
  label: string
  value: string
  caption: string
  tone: 'default' | 'success' | 'warning'
}

export interface ContactPreview {
  id: string
  full_name: string
  email: string
  title: string
  company: string
  apollo_id?: string | null
  linkedin_url?: string | null
  signal_type: string
  signal_detail: string
  quality_score: number
  status: 'drafted' | 'ready_for_review' | 'approved_to_launch' | 'revision_requested'
  email_verification_status: 'unverified' | 'valid' | 'risky' | 'invalid'
  email_verification_score?: number | null
  email_verification_note?: string | null
  verification_checked_at?: string | null
  subject: string
  body_preview: string
}

export interface ApprovalSample {
  contact_id: string
  contact_name: string
  company: string
  signal: string
  subject: string
  body: string
}

export interface ApprovalItem {
  id: string
  type: 'batch_send' | 'reply_review' | 'sequence_update'
  title: string
  summary: string
  status: 'pending' | 'approved' | 'rejected'
  priority: 'high' | 'medium' | 'low'
  created_at: string
  sample_size: number
  samples: ApprovalSample[]
}

export interface PipelineSnapshot {
  workspace_id: string
  metrics: PipelineMetric[]
  contacts: ContactPreview[]
}

export interface ProspectRunSummary {
  workspace_id: string
  status: 'idle' | 'completed'
  mode: 'live' | 'mock'
  sourced_count: number
  enriched_count: number
  deduped_count: number
  filters: string[]
  note: string
  last_run_at: string
}

export interface LaunchChecklistItem {
  id: string
  label: string
  detail: string
  status: 'complete' | 'pending'
}

export interface LaunchReadiness {
  workspace_id: string
  ready_to_launch: boolean
  progress: number
  stage: 'setup' | 'ready' | 'staged'
  contacts_ready: number
  pending_approvals: number
  blockers: string[]
  next_action: string
  checklist: LaunchChecklistItem[]
}

export interface LaunchResult {
  workspace_id: string
  status: 'blocked' | 'staged'
  campaign_name?: string | null
  campaign_id?: string | null
  provider?: string | null
  mode?: 'live' | 'mock' | null
  contacts_launched: number
  message: string
  blockers: string[]
}

export interface CampaignSummary {
  workspace_id: string
  status: 'idle' | 'staged' | 'running'
  campaign_name?: string | null
  campaign_id?: string | null
  provider: string
  mode: 'live' | 'mock'
  contacts_launched: number
  reply_rate: number
  positive_replies: number
  meetings_booked: number
  last_sync_at: string
}

export interface ReplyQueueItem {
  id: string
  workspace_id: string
  contact_id: string
  recipient_email?: string | null
  thread_id?: string | null
  contact_name: string
  company: string
  classification:
    | 'INTERESTED'
    | 'OBJECTION'
    | 'NOT_NOW'
    | 'REFERRAL'
    | 'OUT_OF_OFFICE'
    | 'UNSUBSCRIBE'
  confidence: number
  summary: string
  draft_reply: string
  status: 'pending' | 'approved' | 'sent' | 'dismissed'
  requires_human: boolean
  received_at: string
}

export interface MeetingPrepItem {
  id: string
  workspace_id: string
  contact_id: string
  contact_name: string
  company: string
  scheduled_for: string
  status: 'prep_ready' | 'booked'
  calendar_event_id?: string | null
  prep_brief: string[]
  owner_note: string
}

export interface InstantlyWebhookSubscription {
  workspace_id: string
  configured: boolean
  webhook_id?: string | null
  target_url?: string | null
  event_type: string
  secret_configured: boolean
}

export interface WebhookReceipt {
  workspace_id: string
  event_type: string
  accepted: boolean
  action: string
}

export interface ConnectionLaunch {
  toolkit: string
  session_id: string
  connection_id: string
  redirect_url?: string | null
  status: string
  mode: ConnectionMode
  note?: string | null
}

export interface ConnectionStatus {
  toolkit: string
  connection_id?: string | null
  status: ConnectionState
  mode: ConnectionMode
  note?: string | null
}

export interface IntegrationCheckResult {
  workspace_id: string
  toolkit: string
  connection_status: 'not_connected' | 'pending' | 'connected' | 'error'
  source: 'composio' | 'api_key'
  summary: string
  details: string[]
  checked_at: string
}

export interface AgentChatResponse {
  response: string
  connected_toolkits: string[]
  model_mode: 'live' | 'offline'
  selected_agent_id?: AgentId
  selected_agent_label?: string
  suggested_prompts?: string[]
}

export type AgentId =
  | 'operator'
  | 'strategist'
  | 'prospector'
  | 'copywriter'
  | 'launcher'
  | 'reply'
  | 'meetings'

export interface AgentSummary {
  id: AgentId
  label: string
  description: string
  focus: string
  status: 'ready' | 'attention' | 'blocked'
  rationale: string
  suggested_prompts: string[]
}

export interface AgentCatalog {
  workspace_id: string
  recommended_agent_id: AgentId
  agents: AgentSummary[]
}

export interface AgentPlanSection {
  title: string
  bullets: string[]
}

export interface AgentPlan {
  workspace_id: string
  selected_agent_id: AgentId
  selected_agent_label: string
  summary: string
  blockers: string[]
  next_actions: string[]
  sections: AgentPlanSection[]
}

export interface AgentPlanRequest {
  workspace_id: string
  prompt?: string
  agent_id?: AgentId
}

export interface AgentActionRequest {
  workspace_id: string
  prompt?: string
  agent_id?: AgentId
}

export interface AgentActionResult {
  workspace_id: string
  selected_agent_id: AgentId
  selected_agent_label: string
  executed: boolean
  summary: string
  details: string[]
  next_action?: string
}

export type AgentRunStatus =
  | 'queued'
  | 'executing'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface AgentActionRun {
  run_id: string
  task_id: string
  workspace_id: string
  selected_agent_id: AgentId
  selected_agent_label: string
  status: AgentRunStatus
  queued: boolean
  next_poll_path: string
}

export interface AgentRunState {
  run_id: string
  task_id: string
  workspace_id: string
  selected_agent_id: AgentId
  selected_agent_label: string
  status: AgentRunStatus
  is_completed: boolean
  is_success: boolean
  result?: AgentActionResult
  error?: string
}

export interface OAuthConnectionRequest {
  workspace_id: string
  external_user_id: string
  toolkit: string
  callback_url?: string
}

export interface ApiKeyConnectionRequest {
  workspace_id: string
  external_user_id: string
  toolkit: string
  label: string
  api_key: string
}

export interface ProspectVerificationRequest {
  external_user_id: string
}

export interface IntegrationCheckRequest {
  external_user_id?: string
}

export interface ApprovalDecisionRequest {
  decision: 'approved' | 'rejected'
}

export interface ReplyDecisionRequest {
  decision: 'approved' | 'dismissed'
}

export interface InstantlyWebhookRegistrationRequest {
  workspace_id: string
  target_url: string
}

export interface InstantlyWebhookEvent {
  timestamp?: string | null
  event_type: string
  workspace?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  lead_email?: string | null
  email_account?: string | null
  unibox_url?: string | null
  step?: number | null
  variant?: number | null
  is_first?: boolean | null
  email_id?: string | null
  email_subject?: string | null
  email_text?: string | null
  email_html?: string | null
  reply_text_snippet?: string | null
  reply_subject?: string | null
  reply_text?: string | null
  reply_html?: string | null
  [key: string]: string | number | boolean | null | undefined
}

export interface AgentChatRequest {
  workspace_id: string
  external_user_id: string
  prompt: string
  agent_id?: AgentId
}

export interface StreamingChatRequest {
  workspace_id: string
  message: string
  agent_id?: AgentId
}

// ─── RAG / Knowledge ─────────────────────────────────────────────────────────

export type KnowledgePipeline = 'playbooks' | 'company'

export interface KnowledgeUploadRequest {
  text?: string
  chunks?: string[]
}

export interface KnowledgeStatus {
  pipeline: KnowledgePipeline
  chunk_count: number
  last_updated: string | null
}

// ─── Bandwidth ───────────────────────────────────────────────────────────────

export interface ToolCapacity {
  toolkit: string
  metric: string
  value: number | null
  unit: string
  note: string
}

export interface BandwidthEstimate {
  workspace_id: string
  daily_send_capacity: number
  monthly_lead_capacity: number
  tool_capacities: ToolCapacity[]
  bottleneck: string
  recommendation: string
  estimated_at: string
}

// ─── Observability ───────────────────────────────────────────────────────────

export interface ObservabilityRun extends ExecutionRun {
  input_snapshot?: JsonObject | null
  output_snapshot?: JsonObject | null
}

// ─── Adaptive learning ───────────────────────────────────────────────────────

export type AdaptiveSignalType = 'reply_correction' | 'approval_rejection'

export interface AdaptiveSignalRequest {
  signal_type: AdaptiveSignalType
  original_value?: string
  corrected_value?: string
  context?: JsonObject
}

// ─── Extended reply decision ─────────────────────────────────────────────────

export interface ReplyDecisionRequestExtended extends ReplyDecisionRequest {
  corrected_classification?: string
  rejection_note?: string
}

// ─── Deliverability / Email Warming ──────────────────────────────────────────

/** Inbox summary sent to the frontend (passwords stripped) */
export interface WarmingInboxSummary {
  id: string
  workspace_id: string
  email: string
  display_name: string | null
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  imap_host: string
  imap_port: number
  daily_target: number
  current_daily_sent: number
  warmup_enabled: boolean
  use_for_outreach: boolean
  health_score: number
  spam_rate: number
  bounce_rate: number
  inbox_placement_rate: number
  last_warmed_at: string | null
  status: string
  error_note: string | null
  created_at: string
  updated_at: string
}

export interface WarmingInboxCreateRequest {
  email: string
  display_name?: string
  smtp_host: string
  smtp_port?: number
  smtp_user: string
  smtp_pass: string      // plaintext — encrypted server-side
  smtp_secure?: boolean
  imap_host: string
  imap_port?: number
  imap_user: string
  imap_pass: string      // plaintext — encrypted server-side
  daily_target?: number
  use_for_outreach?: boolean
}

export interface WarmingInboxUpdateRequest {
  display_name?: string
  daily_target?: number
  warmup_enabled?: boolean
  use_for_outreach?: boolean
  status?: string
  // credential updates (optional)
  smtp_pass?: string
  imap_pass?: string
}

export interface WarmingStatsDay {
  date: string
  target_sends: number
  actual_sends: number
  actual_opens: number
  actual_replies: number
  spam_hits: number
}

export interface WarmingInboxStats {
  inbox_id: string
  email: string
  health_score: number
  days: WarmingStatsDay[]
  total_sent_7d: number
  total_opens_7d: number
  total_replies_7d: number
  spam_hits_7d: number
}

export interface WarmingOverview {
  workspace_id: string
  total_inboxes: number
  active_inboxes: number
  paused_inboxes: number
  error_inboxes: number
  total_sent_today: number
  total_capacity_today: number
  average_health_score: number
  inboxes: WarmingInboxSummary[]
}

export interface WarmingRunResult {
  workspace_id: string
  triggered_at: string
  inboxes_processed: number
  emails_sent: number
  errors: string[]
}
