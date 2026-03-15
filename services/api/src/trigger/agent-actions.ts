import { logger, task } from '@trigger.dev/sdk/v3'

import type { AgentId } from '@pipeiq/shared'

import { executeAgentAction } from '../agents/actions.js'

type AgentActionPayload = {
  workspaceId: string
  orgId: string
  prompt?: string
  agentId?: AgentId
}

export const runAgentActionTask = task({
  id: 'run-agent-action',
  run: async (payload: AgentActionPayload) => {
    logger.info('Running PipeIQ agent action', payload)
    return executeAgentAction({
      workspaceId: payload.workspaceId,
      orgId: payload.orgId,
      ...(payload.prompt ? { prompt: payload.prompt } : {}),
      ...(payload.agentId ? { preferredAgentId: payload.agentId } : {}),
    })
  },
})

export const runProspectorTask = task({
  id: 'run-prospector-agent',
  run: async (payload: Omit<AgentActionPayload, 'agentId'>) => {
    logger.info('Running Prospector agent', payload)
    return executeAgentAction({
      workspaceId: payload.workspaceId,
      orgId: payload.orgId,
      ...(payload.prompt ? { prompt: payload.prompt } : {}),
      preferredAgentId: 'prospector',
    })
  },
})

export const runLauncherTask = task({
  id: 'run-launcher-agent',
  run: async (payload: Omit<AgentActionPayload, 'agentId'>) => {
    logger.info('Running Launcher agent', payload)
    return executeAgentAction({
      workspaceId: payload.workspaceId,
      orgId: payload.orgId,
      ...(payload.prompt ? { prompt: payload.prompt } : {}),
      preferredAgentId: 'launcher',
    })
  },
})
