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
  source: 'composio'
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
  secret_hint: string
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
