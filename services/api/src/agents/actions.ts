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
} from '../lib/instantly.js'
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
        details: ['Connect Apollo through Composio first.'],
        next_action: 'Connect Apollo, then rerun the Prospector.',
      }
    }

    const onboarding = store.getOnboarding(params.workspaceId)
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
      'Prospector ran Apollo live through Composio.',
    )

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
    const campaignId =
      extractCampaignId(params.prompt) ||
      currentCampaign.campaign_id ||
      null

    if (!campaignId) {
      const workspace = await getInstantlyWorkspace({
        workspaceId: params.workspaceId,
        orgId: params.orgId,
      })
      return {
        workspace_id: params.workspaceId,
        selected_agent_id: agentId,
        selected_agent_label: agent.label,
        executed: false,
        summary: 'Launcher reached Instantly but needs a target campaign id to import approved leads.',
        details: [
          'Instantly connection is live.',
          `Workspace lookup succeeded: ${JSON.stringify(workspace)}`,
          'Include a campaign id in the prompt, for example: launch campaign_id abc123',
        ],
        next_action: 'Provide an Instantly campaign id, then rerun the Launcher.',
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
