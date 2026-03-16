import { configure, runs, tasks } from '@trigger.dev/sdk/v3'

import type {
  AgentActionRequest,
  AgentActionResult,
  AgentActionRun,
  AgentId,
  AgentRunState,
  AgentRunStatus,
} from '@pipeiq/shared'

import { agentDefinition, type AgentDefinition } from '../agents/registry.js'
import type {
  runAgentActionTask,
  runLauncherTask,
  runProspectorTask,
} from '../trigger/agent-actions.js'
import { env } from './env.js'

type AgentTaskPayload = {
  workspaceId: string
  orgId: string
  prompt?: string
  agentId?: AgentId
}

type TriggerTaskSelection = {
  taskId: 'run-agent-action' | 'run-prospector-agent' | 'run-launcher-agent'
  agent: AgentDefinition
}

let triggerConfigured = false

function ensureTriggerConfigured(): void {
  if (triggerConfigured) {
    return
  }

  if (!env.triggerSecretKey) {
    throw new Error('TRIGGER_SECRET_KEY is missing. Trigger.dev routes are unavailable.')
  }

  configure({
    accessToken: env.triggerSecretKey,
  })
  triggerConfigured = true
}

function taskSelection(agentId?: AgentId): TriggerTaskSelection {
  if (agentId === 'prospector') {
    return {
      taskId: 'run-prospector-agent',
      agent: agentDefinition('prospector'),
    }
  }

  if (agentId === 'launcher') {
    return {
      taskId: 'run-launcher-agent',
      agent: agentDefinition('launcher'),
    }
  }

  return {
    taskId: 'run-agent-action',
    agent: agentDefinition(agentId ?? 'operator'),
  }
}

function mapRunStatus(status: string): AgentRunStatus {
  switch (status) {
    case 'QUEUED':
    case 'DELAYED':
    case 'PENDING_VERSION':
    case 'DEQUEUED':
      return 'queued'
    case 'EXECUTING':
      return 'executing'
    case 'WAITING':
      return 'waiting'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELED':
    case 'EXPIRED':
      return 'canceled'
    case 'FAILED':
    case 'CRASHED':
    case 'SYSTEM_FAILURE':
    case 'TIMED_OUT':
      return 'failed'
    default:
      return 'queued'
  }
}

async function triggerTask(
  taskId: TriggerTaskSelection['taskId'],
  payload: AgentTaskPayload,
): Promise<string> {
  if (taskId === 'run-prospector-agent') {
    const handle = await tasks.trigger<typeof runProspectorTask>(taskId, payload)
    return handle.id
  }

  if (taskId === 'run-launcher-agent') {
    const handle = await tasks.trigger<typeof runLauncherTask>(taskId, payload)
    return handle.id
  }

  const handle = await tasks.trigger<typeof runAgentActionTask>(taskId, payload)
  return handle.id
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Trigger.dev run failed.'
}

function resultFromOutput(output: unknown): AgentActionResult | undefined {
  if (!output || typeof output !== 'object') {
    return undefined
  }

  const candidate = output as Partial<AgentActionResult>
  if (
    typeof candidate.workspace_id === 'string' &&
    typeof candidate.selected_agent_id === 'string' &&
    typeof candidate.selected_agent_label === 'string' &&
    typeof candidate.executed === 'boolean' &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.details)
  ) {
    return candidate as AgentActionResult
  }

  return undefined
}

function payloadMetadata(payload: unknown): {
  workspaceId?: string
  agentId?: AgentId
} {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const candidate = payload as Partial<AgentTaskPayload>
  return {
    ...(typeof candidate.workspaceId === 'string'
      ? { workspaceId: candidate.workspaceId }
      : {}),
    ...(typeof candidate.agentId === 'string'
      ? { agentId: candidate.agentId }
      : {}),
  }
}

export async function enqueueAgentRun(
  payload: AgentActionRequest,
  orgId: string,
): Promise<AgentActionRun> {
  ensureTriggerConfigured()

  const selection = taskSelection(payload.agent_id)
  const runId = await triggerTask(selection.taskId, {
    workspaceId: payload.workspace_id,
    orgId,
    ...(payload.prompt ? { prompt: payload.prompt } : {}),
    ...(payload.agent_id ? { agentId: payload.agent_id } : {}),
  })

  return {
    run_id: runId,
    task_id: selection.taskId,
    workspace_id: payload.workspace_id,
    selected_agent_id: selection.agent.id,
    selected_agent_label: selection.agent.label,
    status: 'queued',
    queued: true,
    next_poll_path: `/api/agents/runs/${runId}`,
  }
}

export async function getAgentRunState(runId: string): Promise<AgentRunState> {
  ensureTriggerConfigured()

  const run = await runs.retrieve(runId)
  const output = resultFromOutput(run.output)
  const payload = payloadMetadata(run.payload)
  const selectedAgentId = output?.selected_agent_id ?? payload.agentId ?? 'operator'
  const agent = agentDefinition(selectedAgentId)

  return {
    run_id: run.id,
    task_id: run.taskIdentifier,
    workspace_id: output?.workspace_id ?? payload.workspaceId ?? '',
    selected_agent_id: output?.selected_agent_id ?? agent.id,
    selected_agent_label: output?.selected_agent_label ?? agent.label,
    status: mapRunStatus(run.status),
    is_completed: run.isCompleted,
    is_success: run.isSuccess,
    ...(output ? { result: output } : {}),
    ...(!run.isSuccess && run.error ? { error: normalizeError(run.error) } : {}),
  }
}
