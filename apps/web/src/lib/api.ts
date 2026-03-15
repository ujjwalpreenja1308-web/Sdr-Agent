export type ConnectionTarget = {
  toolkit: string
  label: string
  category: 'required' | 'optional'
  mode: 'oauth' | 'api_key'
  description: string
  status: 'not_connected' | 'pending' | 'connected'
  required_for_phase: string
  note?: string | null
  connection_id?: string | null
}

export type MetricCard = {
  label: string
  value: string
  caption: string
}

export type BuildPhase = {
  name: string
  duration: string
  outcome: string
  status: 'active' | 'next' | 'later'
}

export type WorkspaceSummary = {
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

export type OnboardingProfile = {
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

export type PipelineMetric = {
  label: string
  value: string
  caption: string
  tone: 'default' | 'success' | 'warning'
}

export type ContactPreview = {
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

export type ApprovalSample = {
  contact_id: string
  contact_name: string
  company: string
  signal: string
  subject: string
  body: string
}

export type ApprovalItem = {
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

export type PipelineSnapshot = {
  workspace_id: string
  metrics: PipelineMetric[]
  contacts: ContactPreview[]
}

export type ProspectRunSummary = {
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

export type LaunchChecklistItem = {
  id: string
  label: string
  detail: string
  status: 'complete' | 'pending'
}

export type LaunchReadiness = {
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

export type LaunchResult = {
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

export type CampaignSummary = {
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

export type ReplyQueueItem = {
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

export type MeetingPrepItem = {
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

export type InstantlyWebhookSubscription = {
  workspace_id: string
  configured: boolean
  webhook_id?: string | null
  target_url?: string | null
  event_type: string
  secret_configured: boolean
}

export type WebhookReceipt = {
  workspace_id: string
  event_type: string
  accepted: boolean
  action: string
}

export type ConnectionLaunch = {
  toolkit: string
  session_id: string
  connection_id: string
  redirect_url?: string | null
  status: string
  mode: 'oauth' | 'api_key'
  note?: string | null
}

export type ConnectionStatus = {
  toolkit: string
  connection_id?: string | null
  status: 'not_connected' | 'pending' | 'connected'
  mode: 'oauth' | 'api_key'
  note?: string | null
}

export type IntegrationCheckResult = {
  workspace_id: string
  toolkit: string
  connection_status: 'not_connected' | 'pending' | 'connected' | 'error'
  source: 'composio'
  summary: string
  details: string[]
  checked_at: string
}

export type AgentChatResponse = {
  response: string
  connected_toolkits: string[]
  model_mode: 'live' | 'offline'
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? `Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export function getWorkspace(workspaceId = 'default') {
  return request<WorkspaceSummary>(`/api/workspaces/${workspaceId}`)
}

export function getOnboarding(workspaceId = 'default') {
  return request<OnboardingProfile>(`/api/onboarding/${workspaceId}`)
}

export function updateOnboarding(workspaceId: string, payload: OnboardingProfile) {
  return request<OnboardingProfile>(`/api/onboarding/${workspaceId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getPipeline(workspaceId = 'default') {
  return request<PipelineSnapshot>(`/api/pipeline/${workspaceId}`)
}

export function getProspectRun(workspaceId = 'default') {
  return request<ProspectRunSummary>(`/api/prospects/${workspaceId}`)
}

export function runProspectSearch(workspaceId = 'default') {
  return request<ProspectRunSummary>(`/api/prospects/${workspaceId}/run`, {
    method: 'POST',
  })
}

export function verifyProspectEmails(workspaceId: string, externalUserId: string) {
  return request<PipelineSnapshot>(`/api/prospects/${workspaceId}/verify-emails`, {
    method: 'POST',
    body: JSON.stringify({ external_user_id: externalUserId }),
  })
}

export function generatePipeline(workspaceId = 'default') {
  return request<PipelineSnapshot>(`/api/pipeline/${workspaceId}/generate`, {
    method: 'POST',
  })
}

export function getLaunchReadiness(workspaceId = 'default') {
  return request<LaunchReadiness>(`/api/launch/${workspaceId}/readiness`)
}

export function stageLaunch(workspaceId = 'default') {
  return request<LaunchResult>(`/api/launch/${workspaceId}`, {
    method: 'POST',
  })
}

export function getCampaign(workspaceId = 'default') {
  return request<CampaignSummary>(`/api/campaigns/${workspaceId}`)
}

export function getReplies(workspaceId = 'default') {
  return request<ReplyQueueItem[]>(`/api/replies/${workspaceId}`)
}

export function decideReply(replyId: string, decision: 'approved' | 'dismissed') {
  return request<ReplyQueueItem>(`/api/replies/${replyId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}

export function getMeetings(workspaceId = 'default') {
  return request<MeetingPrepItem[]>(`/api/meetings/${workspaceId}`)
}

export function getInstantlyWebhook(workspaceId = 'default') {
  return request<InstantlyWebhookSubscription>(`/api/webhooks/instantly/${workspaceId}`)
}

export function registerInstantlyWebhook(payload: {
  workspace_id: string
  target_url: string
}) {
  return request<InstantlyWebhookSubscription>('/api/webhooks/instantly/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getApprovals(workspaceId = 'default') {
  return request<ApprovalItem[]>(`/api/approvals/${workspaceId}`)
}

export function launchOauthConnection(payload: {
  workspace_id: string
  external_user_id: string
  toolkit: string
  callback_url?: string
}) {
  return request<ConnectionLaunch>('/api/connections/authorize', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function saveApiKeyConnection(payload: {
  workspace_id: string
  external_user_id: string
  toolkit: string
  label: string
  secret_hint: string
}) {
  return request<ConnectionStatus>('/api/connections/api-key', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function pollConnection(connectionId: string) {
  return request<ConnectionStatus>(`/api/connections/${connectionId}`)
}

export function checkIntegration(toolkit: string, workspaceId = 'default', externalUserId?: string) {
  return request<IntegrationCheckResult>(`/api/integrations/${workspaceId}/${toolkit}/check`, {
    method: 'POST',
    body: JSON.stringify({ external_user_id: externalUserId }),
  })
}

export function chatWithAgent(payload: {
  workspace_id: string
  external_user_id: string
  prompt: string
}) {
  return request<AgentChatResponse>('/api/agents/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function decideApproval(approvalId: string, decision: 'approved' | 'rejected') {
  return request<ApprovalItem>(`/api/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  })
}
