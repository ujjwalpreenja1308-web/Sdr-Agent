import type {
  AgentCatalog,
  AgentChatResponse,
  AgentId,
  AgentPlan,
  AgentSummary,
} from '@pipeiq/shared'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import { buildAdaptiveContext } from '../lib/adaptive.js'
import { env } from '../lib/env.js'
import { getOpenAiClient } from '../lib/openai.js'
import { queryKnowledge } from '../lib/rag.js'
import { agentDefinition, agentRegistry } from './registry.js'
import { getWorkspaceContext, workspaceContextText } from './workspace-context.js'

const keywordRouting: Array<{ agentId: AgentId; keywords: string[] }> = [
  { agentId: 'strategist', keywords: ['icp', 'strategy', 'positioning', 'cta', 'offer', 'messaging'] },
  { agentId: 'prospector', keywords: ['prospect', 'apollo', 'filter', 'leads', 'sourcing', 'verify'] },
  { agentId: 'copywriter', keywords: ['copy', 'email', 'subject', 'rewrite', 'personalization'] },
  { agentId: 'launcher', keywords: ['launch', 'campaign', 'ready', 'blocker', 'approve', 'stage'] },
  { agentId: 'reply', keywords: ['reply', 'inbox', 'response', 'objection', 'interested'] },
  { agentId: 'meetings', keywords: ['meeting', 'calendar', 'book', 'schedule'] },
]

function readinessStatus(ready: boolean, needsAttention: boolean): AgentSummary['status'] {
  if (ready) {
    return 'ready'
  }
  return needsAttention ? 'attention' : 'blocked'
}

function agentStatus(agentId: AgentId, workspaceId: string): AgentSummary {
  const agent = agentDefinition(agentId)
  const context = getWorkspaceContext(workspaceId)
  const connected = new Set(
    context.workspace.connections
      .filter((connection) => connection.status === 'connected')
      .map((connection) => connection.toolkit),
  )
  const pendingApprovals = context.approvals.filter((item) => item.status === 'pending').length
  const pendingReplies = context.replies.filter((item) => item.status === 'pending').length
  const verifiedContacts = context.pipeline.contacts.filter(
    (contact) =>
      contact.email_verification_status === 'valid' ||
      contact.email_verification_status === 'risky',
  ).length

  const summaryByAgent: Record<AgentId, Omit<AgentSummary, 'id' | 'label' | 'description' | 'focus' | 'suggested_prompts'>> = {
    operator: {
      status: readinessStatus(
        context.workspace.onboarding_completed && connected.size > 0,
        context.readiness.blockers.length > 0,
      ),
      rationale:
        context.readiness.blockers[0] ??
        'Operator has enough workspace state to coordinate the next action.',
    },
    strategist: {
      status: readinessStatus(
        context.workspace.onboarding_completed,
        context.workspace.onboarding_progress >= 40,
      ),
      rationale: context.workspace.onboarding_completed
        ? 'Strategy inputs are populated and can be refined.'
        : 'Needs stronger onboarding inputs before strategy recommendations are reliable.',
    },
    prospector: {
      status: readinessStatus(
        connected.has('apollo'),
        context.workspace.onboarding_completed,
      ),
      rationale: connected.has('apollo')
        ? 'Apollo connection is available for sourcing.'
        : 'Apollo is not connected yet.',
    },
    copywriter: {
      status: readinessStatus(
        context.pipeline.contacts.length > 0,
        verifiedContacts > 0,
      ),
      rationale:
        context.pipeline.contacts.length > 0
          ? 'There are sourced contacts and generated drafts to improve.'
          : 'Needs sourced contacts before copy review becomes meaningful.',
    },
    launcher: {
      status: readinessStatus(
        context.readiness.ready_to_launch,
        pendingApprovals > 0 || verifiedContacts > 0,
      ),
      rationale:
        context.readiness.ready_to_launch
          ? 'Launch conditions are satisfied.'
          : context.readiness.blockers[0] ?? 'Launch prerequisites are incomplete.',
    },
    reply: {
      status: readinessStatus(
        pendingReplies > 0,
        connected.has('gmail') || context.campaign.status === 'running',
      ),
      rationale:
        pendingReplies > 0
          ? 'There are replies waiting for triage.'
          : 'No pending replies yet.',
    },
    meetings: {
      status: readinessStatus(
        context.meetings.length > 0,
        pendingReplies > 0,
      ),
      rationale:
        context.meetings.length > 0
          ? 'Meetings are in flight and prep can be improved.'
          : 'No booked meetings yet.',
    },
  }

  const summary = summaryByAgent[agentId]

  return {
    id: agent.id,
    label: agent.label,
    description: agent.description,
    focus: agent.focus,
    status: summary.status,
    rationale: summary.rationale,
    suggested_prompts: agent.defaultPrompts,
  }
}

export function selectAgent(workspaceId: string, prompt?: string, preferredAgentId?: AgentId): AgentId {
  if (preferredAgentId) {
    return preferredAgentId
  }

  const normalizedPrompt = prompt?.toLowerCase().trim() ?? ''
  if (normalizedPrompt.length > 0) {
    for (const route of keywordRouting) {
      if (route.keywords.some((keyword) => normalizedPrompt.includes(keyword))) {
        return route.agentId
      }
    }
  }

  const context = getWorkspaceContext(workspaceId)
  if (!context.workspace.onboarding_completed) {
    return 'strategist'
  }
  if (context.workspace.connections.some((connection) => connection.category === 'required' && connection.status !== 'connected')) {
    return 'operator'
  }
  if (context.prospectRun.status !== 'completed') {
    return 'prospector'
  }
  if (context.readiness.pending_approvals > 0) {
    return 'copywriter'
  }
  if (!context.readiness.ready_to_launch) {
    return 'launcher'
  }
  if (context.replies.filter((reply) => reply.status === 'pending').length > 0) {
    return 'reply'
  }
  if (context.meetings.length > 0) {
    return 'meetings'
  }
  return 'operator'
}

export function getAgentCatalog(workspaceId: string): AgentCatalog {
  const recommendedAgentId = selectAgent(workspaceId)
  return {
    workspace_id: workspaceId,
    recommended_agent_id: recommendedAgentId,
    agents: (Object.keys(agentRegistry) as AgentId[]).map((agentId) =>
      agentStatus(agentId, workspaceId),
    ),
  }
}

export function buildAgentPlan(workspaceId: string, prompt?: string, preferredAgentId?: AgentId): AgentPlan {
  const context = getWorkspaceContext(workspaceId)
  const selectedAgentId = selectAgent(workspaceId, prompt, preferredAgentId)
  const selectedAgent = agentDefinition(selectedAgentId)
  const pendingApprovals = context.approvals.filter((item) => item.status === 'pending')
  const pendingReplies = context.replies.filter((item) => item.status === 'pending')
  const verifiedContacts = context.pipeline.contacts.filter(
    (contact) =>
      contact.email_verification_status === 'valid' ||
      contact.email_verification_status === 'risky',
  )

  const sections = [
    {
      title: 'Current state',
      bullets: [
        `${context.workspace.onboarding_progress}% onboarding completeness`,
        `${context.workspace.connections.filter((connection) => connection.status === 'connected').length} tools connected`,
        `${context.prospectRun.deduped_count} prospects sourced, ${verifiedContacts.length} verified`,
        `${pendingApprovals.length} approvals pending, ${pendingReplies.length} replies pending`,
      ],
    },
    {
      title: 'Launch picture',
      bullets: context.readiness.checklist.map(
        (item) => `${item.label}: ${item.status === 'complete' ? 'complete' : 'pending'}`,
      ),
    },
  ]

  const nextActions =
    context.readiness.blockers.length > 0
      ? context.readiness.blockers.slice(0, 3)
      : [
          context.readiness.next_action,
          pendingReplies.length > 0
            ? 'Clear the reply queue so positive intent moves toward meetings.'
            : 'Tighten copy and targeting before raising campaign volume.',
        ]

  return {
    workspace_id: workspaceId,
    selected_agent_id: selectedAgentId,
    selected_agent_label: selectedAgent.label,
    summary:
      prompt && prompt.trim().length > 0
        ? `${selectedAgent.label} is best suited for this request based on the current workspace state and your prompt.`
        : `${selectedAgent.label} is the most relevant agent for the current workspace state.`,
    blockers: context.readiness.blockers,
    next_actions: nextActions,
    sections,
  }
}

async function buildSystemPrompt(workspaceId: string, agentId: AgentId, prompt?: string): Promise<string> {
  const context = getWorkspaceContext(workspaceId)
  const agent = agentDefinition(agentId)

  // Fetch RAG + adaptive context in parallel (gracefully degrade to empty if unavailable)
  const queryText = prompt ?? agent.focus
  const [playbookChunks, companyChunks, adaptiveCtx] = await Promise.all([
    queryKnowledge(workspaceId, 'playbooks', queryText, 3).catch(() => [] as string[]),
    queryKnowledge(workspaceId, 'company', queryText, 3).catch(() => [] as string[]),
    buildAdaptiveContext(workspaceId).catch(() => ''),
  ])

  const parts: string[] = [
    ...agent.systemInstructions,
    'Respond in plain language with short paragraphs and crisp action lists when useful.',
    'Ground every recommendation in the current workspace state.',
    'If something is blocked, say exactly why and what should happen next.',
    'Do not invent completed tool actions, launches, sends, or replies.',
  ]

  if (playbookChunks.length > 0) {
    parts.push('', 'Relevant sales playbook guidance:', ...playbookChunks.map((c) => `- ${c}`))
  }

  if (companyChunks.length > 0) {
    parts.push('', 'Company background context:', ...companyChunks.map((c) => `- ${c}`))
  }

  if (adaptiveCtx.length > 0) {
    parts.push('', adaptiveCtx)
  }

  parts.push('', 'Workspace state:', workspaceContextText(context))

  return parts.join('\n')
}

export async function runAgentChat(params: {
  workspaceId: string
  prompt: string
  history: ChatCompletionMessageParam[]
  preferredAgentId?: AgentId
}): Promise<{
  agentId: AgentId
  content: string
  result: AgentChatResponse
}> {
  const agentId = selectAgent(params.workspaceId, params.prompt, params.preferredAgentId)
  const agent = agentDefinition(agentId)
  const openai = getOpenAiClient()
  const systemPrompt = await buildSystemPrompt(params.workspaceId, agentId, params.prompt)
  const response = await openai.chat.completions.create({
    model: env.openAiModel,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...params.history,
      {
        role: 'user',
        content: params.prompt,
      },
    ],
  })
  const content = response.choices[0]?.message?.content ?? ''
  return {
    agentId,
    content,
    result: {
      response: content,
      connected_toolkits: getWorkspaceContext(params.workspaceId).workspace.connections
        .filter((connection) => connection.status === 'connected')
        .map((connection) => connection.toolkit),
      model_mode: env.openAiApiKey ? 'live' : 'offline',
      selected_agent_id: agentId,
      selected_agent_label: agent.label,
      suggested_prompts: agent.defaultPrompts,
    },
  }
}

export async function createAgentStream(params: {
  workspaceId: string
  prompt: string
  history: ChatCompletionMessageParam[]
  preferredAgentId?: AgentId
}) {
  const agentId = selectAgent(params.workspaceId, params.prompt, params.preferredAgentId)
  const agent = agentDefinition(agentId)
  const openai = getOpenAiClient()
  const systemPrompt = await buildSystemPrompt(params.workspaceId, agentId, params.prompt)
  const stream = await openai.chat.completions.create({
    model: env.openAiModel,
    stream: true,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      ...params.history,
      {
        role: 'user',
        content: params.prompt,
      },
    ],
  })

  return {
    agent,
    agentId,
    stream,
  }
}
