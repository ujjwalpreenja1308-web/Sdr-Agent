import type {
  AgentActionResult,
  AgentId,
  ContactPreview,
} from '@pipeiq/shared'

import { searchApolloProspects } from '../lib/apollo.js'
import {
  addInstantlyLeadsBulk,
  getInstantlyCampaignSendingStatus,
  getInstantlyWorkspace,
  launchInstantlyCampaign,
} from '../lib/instantly.js'
import { beginExecution, executionKey, finishExecution } from '../lib/execution-runs.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { agentDefinition } from './registry.js'
import { buildAgentPlan, selectAgent } from './service.js'

function extractCampaignId(prompt?: string): string | null {
  if (!prompt) {
    return null
  }

  const patterns = [
    /campaign_id[:=\s]+([A-Za-z0-9_-]+)/i,
    /campaign[:=\s]+([A-Za-z0-9_-]+)/i,
  ]

  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (match?.[1]) {
      return match[1]
    }
  }

  return null
}

function connectedToolkits(workspaceId: string): Set<string> {
  return new Set(
    getRuntimeStore()
      .getWorkspaceSummary(workspaceId)
      .connections.filter((connection) => connection.status === 'connected')
      .map((connection) => connection.toolkit),
  )
}

function launcherLead(contact: ContactPreview) {
  const [firstName = '', ...rest] = contact.full_name.split(' ')
  return {
    email: contact.email,
    firstName,
    lastName: rest.join(' '),
    companyName: contact.company,
    personalization: contact.signal_detail,
  }
}

export async function executeAgentAction(params: {
  workspaceId: string
  orgId: string
  prompt?: string
  preferredAgentId?: AgentId
}): Promise<AgentActionResult> {
  const store = getRuntimeStore()
  const agentId = selectAgent(params.workspaceId, params.prompt, params.preferredAgentId)
  const agent = agentDefinition(agentId)
  const plan = buildAgentPlan(params.workspaceId, params.prompt, agentId)
  const connected = connectedToolkits(params.workspaceId)

  if (agentId === 'prospector') {
    if (!connected.has('apollo')) {
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Prospector cannot run because Apollo is not connected.',
        details: ['Save an Apollo API key first.'],
        next_action: 'Save an Apollo API key, then rerun the Prospector.',
      }
    }

    const onboarding = store.getOnboarding(params.workspaceId)
    const prospectExecutionKey = executionKey([onboarding, 'agent'])
    const prospectExecution = await beginExecution({
      workspaceId: params.workspaceId,
      scope: 'agent.prospector',
      executionKey: prospectExecutionKey,
      actorType: 'agent',
      actorId: agentId,
      summary: 'Starting Prospector execution.',
    })
    if (prospectExecution.kind !== 'started') {
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Prospector already ran recently for this targeting setup.',
        details: ['Using the existing sourced prospect set to avoid duplicate runs.'],
        next_action: 'Review sourced prospects or change targeting before rerunning.',
      }
    }
    try {
      const prospects = await searchApolloProspects({
        workspaceId: params.workspaceId,
        orgId: params.orgId,
        onboarding,
        limit: 10,
      })

      store.applyProspectSearch(
        params.workspaceId,
        prospects,
        'live',
        'Prospector ran Apollo live through the saved Apollo API key.',
      )
      await finishExecution({
        workspaceId: params.workspaceId,
        scope: 'agent.prospector',
        runId: prospectExecution.runId,
        executionKey: prospectExecutionKey,
        actorType: 'agent',
        actorId: agentId,
        status: 'completed',
        summary: `Prospector sourced ${prospects.length} prospects.`,
        metadata: {
          prospect_count: prospects.length,
        },
      })

      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: true,
        summary: `Prospector sourced ${prospects.length} live Apollo prospects.`,
        details: prospects.slice(0, 5).map(
          (prospect) => `${prospect.fullName} at ${prospect.company} (${prospect.title})`,
        ),
        next_action:
          prospects.length > 0
            ? 'Verify sourced emails with Hunter before generating the batch.'
            : 'Tighten Apollo filters and rerun prospecting.',
      }
    } catch (error) {
      await finishExecution({
        workspaceId: params.workspaceId,
        scope: 'agent.prospector',
        runId: prospectExecution.runId,
        executionKey: prospectExecutionKey,
        actorType: 'agent',
        actorId: agentId,
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Prospector execution failed.',
        metadata: {},
      })
      throw error
    }
  }

  if (agentId === 'launcher') {
    if (!connected.has('instantly')) {
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Launcher cannot run because Instantly is not connected.',
        details: ['Connect Instantly through Composio first.'],
        next_action: 'Connect Instantly, then rerun the Launcher.',
      }
    }

    const pipeline = store.getPipeline(params.workspaceId)
    const approvedContacts = pipeline.contacts.filter(
      (contact) => contact.status === 'approved_to_launch',
    )

    if (approvedContacts.length === 0) {
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Launcher is blocked because no contacts are approved to launch.',
        details: plan.blockers,
        next_action: 'Approve the generated batch before trying to launch.',
      }
    }

    const currentCampaign = store.getCampaign(params.workspaceId)
    const promptCampaignId = extractCampaignId(params.prompt)
    const campaignId = promptCampaignId || currentCampaign.campaign_id || null

    const launchExecutionKey = executionKey([
      campaignId ?? 'auto-create',
      approvedContacts.map((contact) => contact.id),
    ])
    const launchExecution = await beginExecution({
      workspaceId: params.workspaceId,
      scope: 'agent.launcher',
      executionKey: launchExecutionKey,
      actorType: 'agent',
      actorId: agentId,
      summary: `Starting Launcher execution for campaign ${campaignId}.`,
    })
    if (launchExecution.kind !== 'started') {
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Launcher already ran recently for this campaign and approved contact set.',
        details: ['Using the existing campaign state to avoid duplicate lead imports.'],
        next_action: 'Wait for reply activity or change the approved batch before rerunning.',
      }
    }

    try {
      if (!campaignId) {
        const workspaceInfo = await getInstantlyWorkspace({
          workspaceId: params.workspaceId,
          orgId: params.orgId,
        })
        const launch = await launchInstantlyCampaign({
          workspaceId: params.workspaceId,
          orgId: params.orgId,
          campaignName: `${store.getWorkspaceSummary(params.workspaceId).name} - Agent Launch`,
          onboarding: store.getOnboarding(params.workspaceId),
          contacts: approvedContacts,
        })
        store.recordInstantlyLaunch(
          params.workspaceId,
          launch.campaignId,
          launch.importedCount,
          launch.summary,
        )
        await finishExecution({
          workspaceId: params.workspaceId,
          scope: 'agent.launcher',
          runId: launchExecution.runId,
          executionKey: launchExecutionKey,
          actorType: 'agent',
          actorId: agentId,
          status: 'completed',
          summary: launch.summary,
          metadata: {
            campaign_id: launch.campaignId,
            imported_count: launch.importedCount,
          },
        })

        return {
          workspace_id: params.workspaceId,
          selected_agent_id: agentId,
          selected_agent_label: agent.label,
          executed: true,
          summary: launch.summary,
          details: [
            `${launch.importedCount} approved contacts were imported into the new campaign.`,
            `Sender accounts: ${launch.senderEmails.join(', ')}`,
            `Workspace lookup: ${JSON.stringify(workspaceInfo)}`,
            launch.diagnostics,
          ],
          next_action: 'Monitor reply activity and webhook ingestion after launch.',
        }
      }

      const importResult = await addInstantlyLeadsBulk({
        workspaceId: params.workspaceId,
        orgId: params.orgId,
        campaignId,
        leads: approvedContacts.map(launcherLead),
      })
      const diagnostics = await getInstantlyCampaignSendingStatus({
        workspaceId: params.workspaceId,
        orgId: params.orgId,
        campaignId,
      })
      store.recordInstantlyLaunch(
        params.workspaceId,
        campaignId,
        importResult.importedCount,
        importResult.summary,
      )
      await finishExecution({
        workspaceId: params.workspaceId,
        scope: 'agent.launcher',
        runId: launchExecution.runId,
        executionKey: launchExecutionKey,
        actorType: 'agent',
        actorId: agentId,
        status: 'completed',
        summary: importResult.summary,
        metadata: {
          campaign_id: campaignId,
          imported_count: importResult.importedCount,
        },
      })

      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: true,
        summary: importResult.summary,
        details: [
          `${approvedContacts.length} approved contacts were prepared for import.`,
          diagnostics.summary,
        ],
        next_action: 'Monitor reply activity and webhook ingestion after launch.',
      }
    } catch (error) {
      await finishExecution({
        workspaceId: params.workspaceId,
        scope: 'agent.launcher',
        runId: launchExecution.runId,
        executionKey: launchExecutionKey,
        actorType: 'agent',
        actorId: agentId,
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Launcher execution failed.',
        metadata: {
          campaign_id: campaignId ?? null,
        },
      })
      throw error
    }
  }

  return {
    workspace_id: params.workspaceId,
    selected_agent_id: agentId,
    selected_agent_label: agent.label,
    executed: false,
    summary: `${agent.label} does not have a direct execution path yet.`,
    details: plan.next_actions,
    ...(plan.next_actions[0] ? { next_action: plan.next_actions[0] } : {}),
  }
}
