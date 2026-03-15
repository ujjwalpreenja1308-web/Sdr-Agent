import type {
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
  LaunchReadiness,
  LaunchResult,
  MeetingPrepItem,
  OnboardingProfile,
  PipelineSnapshot,
  ProspectRunSummary,
  ProspectVerificationRequest,
  ReplyDecisionRequest,
  ReplyQueueItem,
  StreamingChatRequest,
  WebhookReceipt,
  WorkspaceSummary,
} from '@pipeiq/shared'

export type {
  AgentCatalog,
  AgentChatResponse,
  AgentId,
  AgentPlan,
  ApprovalItem,
  CampaignSummary,
  ConnectionStatus,
  ConnectionTarget,
  InstantlyWebhookSubscription,
  IntegrationCheckResult,
  LaunchReadiness,
  LaunchResult,
  MeetingPrepItem,
  OnboardingProfile,
  PipelineSnapshot,
  ProspectRunSummary,
  ReplyQueueItem,
  WorkspaceSummary,
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function authHeaders(): HeadersInit {
  const envToken = import.meta.env.VITE_API_TOKEN
  const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem('pipeiq_jwt') : null
  const token = envToken || storedToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string; error?: string }
      | null
    throw new Error(payload?.detail ?? payload?.error ?? `Request failed: ${response.status}`)
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
  const payload: ProspectVerificationRequest = {
    external_user_id: externalUserId,
  }
  return request<PipelineSnapshot>(`/api/prospects/${workspaceId}/verify-emails`, {
    method: 'POST',
    body: JSON.stringify(payload),
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

export function decideReply(
  replyId: string,
  decision: ReplyDecisionRequest['decision'],
  workspaceId = 'default',
) {
  return request<ReplyQueueItem>(
    `/api/replies/${replyId}/decision?workspace_id=${encodeURIComponent(workspaceId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  )
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

export function decideApproval(
  approvalId: string,
  decision: ApprovalDecisionRequest['decision'],
  workspaceId = 'default',
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

export function checkIntegration(toolkit: string, workspaceId = 'default') {
  return request<IntegrationCheckResult>(`/api/integrations/${workspaceId}/${toolkit}/check`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function getAgentCatalog(workspaceId = 'default') {
  return request<AgentCatalog>(`/api/agents/${workspaceId}/catalog`)
}

export function getAgentPlan(payload: AgentPlanRequest) {
  return request<AgentPlan>('/api/agents/plan', {
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
