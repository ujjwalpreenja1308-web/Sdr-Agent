import { logger, task } from '@trigger.dev/sdk/v3'

import type { AgentId } from '@pipeiq/shared'

import { executeAgentAction } from '../agents/actions.js'
import { logWorkspaceEvent } from '../lib/activity.js'

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
    try {
      const result = await executeAgentAction({
        workspaceId: payload.workspaceId,
        orgId: payload.orgId,
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        ...(payload.agentId ? { preferredAgentId: payload.agentId } : {}),
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: result.executed ? 'agent.run.completed' : 'agent.run.blocked',
        entityType: 'agent_run',
        entityId: result.selected_agent_id,
        actorType: 'agent',
        actorId: result.selected_agent_id,
        summary: result.summary,
        metadata: {
          selected_agent_id: result.selected_agent_id,
          executed: result.executed,
        },
      })
      return result
    } catch (error) {
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'agent.run.failed',
        entityType: 'agent_run',
        entityId: payload.agentId ?? 'operator',
        actorType: 'agent',
        actorId: payload.agentId ?? 'operator',
        summary: error instanceof Error ? error.message : 'Agent background run failed.',
        metadata: {},
      })
      throw error
    }
  },
})

export const runProspectorTask = task({
  id: 'run-prospector-agent',
  run: async (payload: Omit<AgentActionPayload, 'agentId'>) => {
    logger.info('Running Prospector agent', payload)
    try {
      const result = await executeAgentAction({
        workspaceId: payload.workspaceId,
        orgId: payload.orgId,
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        preferredAgentId: 'prospector',
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: result.executed ? 'agent.run.completed' : 'agent.run.blocked',
        entityType: 'agent_run',
        entityId: result.selected_agent_id,
        actorType: 'agent',
        actorId: result.selected_agent_id,
        summary: result.summary,
        metadata: {
          selected_agent_id: result.selected_agent_id,
          executed: result.executed,
        },
      })
      return result
    } catch (error) {
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'agent.run.failed',
        entityType: 'agent_run',
        entityId: 'prospector',
        actorType: 'agent',
        actorId: 'prospector',
        summary: error instanceof Error ? error.message : 'Prospector background run failed.',
        metadata: {},
      })
      throw error
    }
  },
})

export const runLauncherTask = task({
  id: 'run-launcher-agent',
  run: async (payload: Omit<AgentActionPayload, 'agentId'>) => {
    logger.info('Running Launcher agent', payload)
    try {
      const result = await executeAgentAction({
        workspaceId: payload.workspaceId,
        orgId: payload.orgId,
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        preferredAgentId: 'launcher',
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: result.executed ? 'agent.run.completed' : 'agent.run.blocked',
        entityType: 'agent_run',
        entityId: result.selected_agent_id,
        actorType: 'agent',
        actorId: result.selected_agent_id,
        summary: result.summary,
        metadata: {
          selected_agent_id: result.selected_agent_id,
          executed: result.executed,
        },
      })
      return result
    } catch (error) {
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'agent.run.failed',
        entityType: 'agent_run',
        entityId: 'launcher',
        actorType: 'agent',
        actorId: 'launcher',
        summary: error instanceof Error ? error.message : 'Launcher background run failed.',
        metadata: {},
      })
      throw error
    }
  },
})
