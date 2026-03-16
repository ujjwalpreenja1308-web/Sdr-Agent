import type {
  AuthSession,
  AgentActionRequest,
  AgentActionResult,
  AgentCatalog,
  AgentChatResponse,
  AgentId,
  AgentPlan,
  AgentPlanRequest,
  ApiKeyConnectionRequest,
  ApprovalDecisionRequest,
  ApprovalItem,
  CampaignSummary,
  ConnectionLaunch,
  ConnectionStatus,
  ConnectionTarget,
  InstantlyWebhookSubscription,
  IntegrationCheckResult,
  KnowledgePipeline,
  KnowledgeStatus,
  LaunchReadiness,
  LaunchResult,
  MeetingPrepItem,
  OnboardingProfile,
  OperatorEvent,
  PipelineSnapshot,
  ProspectRunSummary,
  ProspectVerificationRequest,
  ReplyDecisionRequest,
  ReplyQueueItem,
  StreamingChatRequest,
  WebhookReceipt,
  WorkspaceSummary,
  WarmingInboxCreateRequest,
  WarmingInboxUpdateRequest,
  WarmingInboxSummary,
  WarmingOverview,
  WarmingInboxStats,
  WarmingRunResult,
  // Sequences
  Sequence,
  SequenceStep,
  SequenceEnrollment,
  SequenceEnrollmentWithContact,
  SequenceSummary,
  SequenceWithSteps,
  SequenceStats,
  SequenceCreateRequest,
  SequenceUpdateRequest,
  SequenceStepUpdateRequest,
  SequenceEnrollRequest,
  SequenceTickResult,
} from '@pipeiq/shared'

export type {
  AuthSession,
  AgentActionResult,
  AgentCatalog,
  AgentChatResponse,
  WarmingInboxSummary,
  WarmingOverview,
  WarmingInboxStats,
  WarmingRunResult,
  WarmingInboxCreateRequest,
  WarmingInboxUpdateRequest,
  AgentId,
  AgentPlan,
  ApprovalItem,
  CampaignSummary,
  ConnectionStatus,
  ConnectionTarget,
  InstantlyWebhookSubscription,
  IntegrationCheckResult,
  KnowledgePipeline,
  KnowledgeStatus,
  LaunchReadiness,
  LaunchResult,
  MeetingPrepItem,
  OnboardingProfile,
  OperatorEvent,
  PipelineSnapshot,
  ProspectRunSummary,
  ReplyQueueItem,
  WorkspaceSummary,
  // Sequences
  Sequence,
  SequenceStep,
  SequenceEnrollment,
  SequenceEnrollmentWithContact,
  SequenceSummary,
  SequenceWithSteps,
  SequenceStats,
  SequenceCreateRequest,
  SequenceUpdateRequest,
  SequenceStepUpdateRequest,
  SequenceEnrollRequest,
  SequenceTickResult,
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const WORKSPACE_STORAGE_KEY = 'pipeiq_workspace_id'

function storedWorkspaceId(): string | null {
  return typeof window !== 'undefined'
    ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    : null
}

export function saveWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId)
}

function authHeaders(): HeadersInit {
  const envToken = import.meta.env.VITE_API_TOKEN
  const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('pipeiq_jwt') : null
  const token = envToken || storedToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  let response: Response
  try {
    const { headers: extraHeaders, signal: _ignored, ...restInit } = init ?? {}
    response = await fetch(`${apiUrl}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(extraHeaders ?? {}),
      },
      signal: controller.signal,
      ...restInit,
    })
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string; error?: string }
      | null
    throw new Error(payload?.detail ?? payload?.error ?? `Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export function getAuthSession() {
  return request<AuthSession>('/auth/me')
}

export function getWorkspace(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<WorkspaceSummary>(`/api/workspaces/${workspaceId}`)
}

export function getOnboarding(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<OnboardingProfile>(`/api/onboarding/${workspaceId}`)
}

export function updateOnboarding(workspaceId: string, payload: OnboardingProfile) {
  return request<OnboardingProfile>(`/api/onboarding/${workspaceId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function getPipeline(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<PipelineSnapshot>(`/api/pipeline/${workspaceId}`)
}

export function getActivity(workspaceId: string = storedWorkspaceId() ?? '', limit = 20) {
  return request<OperatorEvent[]>(
    `/api/activity/${workspaceId}?limit=${encodeURIComponent(String(limit))}`,
  )
}

export function getProspectRun(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<ProspectRunSummary>(`/api/prospects/${workspaceId}`)
}

export function runProspectSearch(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<ProspectRunSummary>(`/api/prospects/${workspaceId}/run`, {
    method: 'POST',
  })
}

export function verifyProspectEmails(workspaceId: string, externalUserId: string) {
  const payload: ProspectVerificationRequest = {
    external_user_id: externalUserId,
  }
  return request<PipelineSnapshot>(`/api/prospects/${workspaceId}/verify-emails`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function generatePipeline(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<PipelineSnapshot>(`/api/pipeline/${workspaceId}/generate`, {
    method: 'POST',
  })
}

export function getLaunchReadiness(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<LaunchReadiness>(`/api/launch/${workspaceId}/readiness`)
}

export function stageLaunch(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<LaunchResult>(`/api/launch/${workspaceId}`, {
    method: 'POST',
  })
}

export function getCampaign(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<CampaignSummary>(`/api/campaigns/${workspaceId}`)
}

export function getReplies(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<ReplyQueueItem[]>(`/api/replies/${workspaceId}`)
}

export function decideReply(
  replyId: string,
  decision: ReplyDecisionRequest['decision'],
  workspaceId: string = storedWorkspaceId() ?? '',
) {
  return request<ReplyQueueItem>(
    `/api/replies/${replyId}/decision?workspace_id=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  )
}

export function getMeetings(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<MeetingPrepItem[]>(`/api/meetings/${workspaceId}`)
}

export function getInstantlyWebhook(workspaceId: string = storedWorkspaceId() ?? '') {
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

export function getApprovals(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<ApprovalItem[]>(`/api/approvals/${workspaceId}`)
}

export function decideApproval(
  approvalId: string,
  decision: ApprovalDecisionRequest['decision'],
  workspaceId: string = storedWorkspaceId() ?? '',
) {
  return request<ApprovalItem>(
    `/api/approvals/${approvalId}/decision?workspace_id=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  )
}

export function launchOauthConnection(payload: {
  workspace_id: string
  external_user_id: string
  toolkit: string
  callback_url?: string
}) {
  return request<ConnectionLaunch>('/connections/initiate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function saveApiKeyConnection(payload: ApiKeyConnectionRequest) {
  return request<ConnectionStatus>('/api/connections/api-key', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function pollConnection(connectionId: string) {
  return request<ConnectionStatus>(`/connections/status/${connectionId}`)
}

export function checkIntegration(toolkit: string, workspaceId: string = storedWorkspaceId() ?? '') {
  return request<IntegrationCheckResult>(`/api/integrations/${workspaceId}/${toolkit}/check`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function getAgentCatalog(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<AgentCatalog>(`/api/agents/${workspaceId}/catalog`)
}

export function getAgentPlan(payload: AgentPlanRequest) {
  return request<AgentPlan>('/api/agents/plan', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function executeAgentAction(payload: AgentActionRequest) {
  return request<AgentActionResult>('/api/agents/act', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

type StreamHandlers = {
  onDelta: (delta: string) => void
  onDone?: (finalText: string) => void
  onMeta?: (payload: {
    model?: string
    selected_agent_id?: AgentId
    selected_agent_label?: string
    suggested_prompts?: string[]
  }) => void
}

export async function streamChatWithAgent(
  payload: StreamingChatRequest,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${apiUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as
      | { detail?: string; error?: string }
      | null
    throw new Error(json?.detail ?? json?.error ?? `Request failed: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Streaming response body was empty.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completeText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const lines = event.split('\n')
      const eventType = lines.find((line) => line.startsWith('event:'))?.replace('event:', '').trim()
      const dataLine = lines.find((line) => line.startsWith('data:'))?.replace('data:', '').trim()
      if (!eventType || !dataLine) {
        continue
      }

      const payloadJson = JSON.parse(dataLine) as {
        delta?: string
        response?: string
        error?: string
      }

      if (eventType === 'delta' && payloadJson.delta) {
        completeText += payloadJson.delta
        handlers.onDelta(payloadJson.delta)
      }

      if (eventType === 'meta') {
        handlers.onMeta?.(payloadJson as {
          model?: string
          selected_agent_id?: AgentId
          selected_agent_label?: string
          suggested_prompts?: string[]
        })
      }

      if (eventType === 'done') {
        handlers.onDone?.(payloadJson.response ?? completeText)
      }

      if (eventType === 'error') {
        throw new Error(payloadJson.error ?? 'Streaming failed.')
      }
    }
  }
}

export async function chatWithAgent(payload: {
  workspace_id: string
  external_user_id: string
  prompt: string
  agent_id?: AgentId
}) {
  return request<AgentChatResponse>('/api/agents/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function acceptInstantlyWebhook(payload: Record<string, unknown>) {
  return request<WebhookReceipt>('/webhooks/instantly', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getKnowledgeStatus(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<{ workspace_id: string; pipelines: KnowledgeStatus[] }>(
    `/api/knowledge/${workspaceId}/status`,
  )
}

export function uploadKnowledge(
  workspaceId: string,
  pipeline: KnowledgePipeline,
  text: string,
) {
  return request<{ workspace_id: string; pipeline: string; ingested: boolean; chunk_count: number }>(
    `/api/knowledge/${workspaceId}/${pipeline}`,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    },
  )
}

export function deleteKnowledge(workspaceId: string, pipeline: KnowledgePipeline) {
  return request<{ workspace_id: string; pipeline: string; deleted: boolean }>(
    `/api/knowledge/${workspaceId}/${pipeline}`,
    { method: 'DELETE' },
  )
}

// ─── Warming / Deliverability ─────────────────────────────────────────────────

export function getWarmingOverview(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<WarmingOverview>(`/api/warming/${workspaceId}`)
}

export function addWarmingInbox(workspaceId: string, payload: WarmingInboxCreateRequest) {
  return request<WarmingInboxSummary>(`/api/warming/${workspaceId}/inboxes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateWarmingInbox(
  workspaceId: string,
  inboxId: string,
  payload: WarmingInboxUpdateRequest,
) {
  return request<WarmingInboxSummary>(`/api/warming/${workspaceId}/inboxes/${inboxId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteWarmingInbox(workspaceId: string, inboxId: string) {
  return request<{ ok: boolean }>(`/api/warming/${workspaceId}/inboxes/${inboxId}`, {
    method: 'DELETE',
  })
}

export function getWarmingInboxStats(workspaceId: string, inboxId: string) {
  return request<WarmingInboxStats>(
    `/api/warming/${workspaceId}/inboxes/${inboxId}/stats`,
  )
}

export function runWarmingCycle(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<WarmingRunResult>(`/api/warming/${workspaceId}/run`, { method: 'POST' })
}

export function testWarmingCredentials(
  workspaceId: string,
  payload: {
    smtp_host: string; smtp_port: number; smtp_user: string; smtp_pass: string; smtp_secure: boolean
    imap_host: string; imap_port: number; imap_user: string; imap_pass: string
  },
) {
  return request<{ smtp: { ok: boolean; error?: string }; imap: { ok: boolean; error?: string }; ok: boolean }>(
    `/api/warming/${workspaceId}/test-credentials`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

// ─── Email Sequences ───────────────────────────────────────────────────────────

export function getSequences(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<SequenceSummary[]>(`/api/sequences/${workspaceId}`)
}

export function getSequence(workspaceId: string, sequenceId: string) {
  return request<SequenceWithSteps>(`/api/sequences/${workspaceId}/${sequenceId}`)
}

export function createSequence(workspaceId: string, payload: SequenceCreateRequest) {
  return request<SequenceWithSteps>(`/api/sequences/${workspaceId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSequence(workspaceId: string, sequenceId: string, payload: SequenceUpdateRequest) {
  return request<Sequence>(`/api/sequences/${workspaceId}/${sequenceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteSequence(workspaceId: string, sequenceId: string) {
  return request<{ ok: boolean }>(`/api/sequences/${workspaceId}/${sequenceId}`, {
    method: 'DELETE',
  })
}

export function addSequenceStep(
  workspaceId: string,
  sequenceId: string,
  payload: Omit<SequenceStepUpdateRequest, never> & { step_type?: 'icebreaker' | 'follow_up' | 'breakup' },
) {
  return request<SequenceStep>(`/api/sequences/${workspaceId}/${sequenceId}/steps`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSequenceStep(
  workspaceId: string,
  sequenceId: string,
  stepId: string,
  payload: SequenceStepUpdateRequest,
) {
  return request<SequenceStep>(`/api/sequences/${workspaceId}/${sequenceId}/steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteSequenceStep(workspaceId: string, sequenceId: string, stepId: string) {
  return request<{ ok: boolean }>(
    `/api/sequences/${workspaceId}/${sequenceId}/steps/${stepId}`,
    { method: 'DELETE' },
  )
}

export function enrollInSequence(workspaceId: string, sequenceId: string, contactIds: string[]) {
  return request<{ enrolled: number; skipped: number }>(
    `/api/sequences/${workspaceId}/${sequenceId}/enroll`,
    { method: 'POST', body: JSON.stringify({ contact_ids: contactIds }) },
  )
}

export function getSequenceEnrollments(workspaceId: string, sequenceId: string) {
  return request<SequenceEnrollmentWithContact[]>(
    `/api/sequences/${workspaceId}/${sequenceId}/enrollments`,
  )
}

export function pauseEnrollment(workspaceId: string, sequenceId: string, enrollmentId: string) {
  return request<{ ok: boolean }>(
    `/api/sequences/${workspaceId}/${sequenceId}/enrollments/${enrollmentId}/pause`,
    { method: 'POST' },
  )
}

export function resumeEnrollment(workspaceId: string, sequenceId: string, enrollmentId: string) {
  return request<{ ok: boolean }>(
    `/api/sequences/${workspaceId}/${sequenceId}/enrollments/${enrollmentId}/resume`,
    { method: 'POST' },
  )
}

export function triggerSequenceTick(workspaceId: string = storedWorkspaceId() ?? '') {
  return request<SequenceTickResult>(`/api/sequences/${workspaceId}/tick`, { method: 'POST' })
}
