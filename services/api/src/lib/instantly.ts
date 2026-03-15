import { executeConnectedTool } from './composio.js'

const INSTANTLY_ADD_LEADS_BULK = 'INSTANTLY_ADD_LEADS_BULK'
const INSTANTLY_GET_CAMPAIGN_SENDING_STATUS = 'INSTANTLY_GET_CAMPAIGN_SENDING_STATUS'
const INSTANTLY_GET_CURRENT_WORKSPACE = 'INSTANTLY_GET_CURRENT_WORKSPACE'

export type InstantlyLeadInput = {
  email: string
  firstName?: string
  lastName?: string
  companyName?: string
  personalization?: string
}

export type InstantlyLeadImportResult = {
  accepted: boolean
  importedCount: number
  summary: string
  raw: Record<string, unknown>
}

export type InstantlyCampaignStatus = {
  summary: string
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeLead(lead: InstantlyLeadInput): Record<string, unknown> {
  return {
    email: lead.email,
    first_name: lead.firstName ?? '',
    last_name: lead.lastName ?? '',
    company_name: lead.companyName ?? '',
    personalization: lead.personalization ?? '',
  }
}

export async function addInstantlyLeadsBulk(params: {
  workspaceId: string
  orgId: string
  campaignId: string
  leads: InstantlyLeadInput[]
}): Promise<InstantlyLeadImportResult> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_ADD_LEADS_BULK,
    arguments: {
      campaign_id: params.campaignId,
      verify: true,
      leads: params.leads.map(normalizeLead),
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly bulk lead import failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const importedCount =
    asNumber(raw.imported) ??
    asNumber(raw.count) ??
    asNumber(raw.total_imported) ??
    asArray(raw.leads).length

  return {
    accepted: true,
    importedCount,
    summary: `Imported ${importedCount} leads into Instantly campaign ${params.campaignId}.`,
    raw,
  }
}

export async function getInstantlyCampaignSendingStatus(params: {
  workspaceId: string
  orgId: string
  campaignId: string
}): Promise<InstantlyCampaignStatus> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_GET_CAMPAIGN_SENDING_STATUS,
    arguments: {
      id: params.campaignId,
      with_ai_summary: true,
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly campaign diagnostics failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const summary =
    (typeof raw.ai_summary === 'string' && raw.ai_summary) ||
    (typeof raw.summary === 'string' && raw.summary) ||
    `Fetched sending diagnostics for campaign ${params.campaignId}.`

  return {
    summary,
    raw,
  }
}

export async function getInstantlyWorkspace(params: {
  workspaceId: string
  orgId: string
}): Promise<Record<string, unknown>> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_GET_CURRENT_WORKSPACE,
    arguments: {},
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly workspace lookup failed.')
  }

  return asRecord(response.data) ?? {}
}
