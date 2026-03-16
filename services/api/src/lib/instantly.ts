import type { ContactPreview, OnboardingProfile } from '@pipeiq/shared'

import { executeConnectedTool } from './composio.js'

const INSTANTLY_CREATE_CAMPAIGN = 'INSTANTLY_CREATE_CAMPAIGN'
const INSTANTLY_ACTIVATE_CAMPAIGN = 'INSTANTLY_ACTIVATE_CAMPAIGN'
const INSTANTLY_ADD_LEADS_BULK = 'INSTANTLY_ADD_LEADS_BULK'
const INSTANTLY_GET_CAMPAIGN_SENDING_STATUS = 'INSTANTLY_GET_CAMPAIGN_SENDING_STATUS'
const INSTANTLY_GET_CURRENT_WORKSPACE = 'INSTANTLY_GET_CURRENT_WORKSPACE'
const INSTANTLY_LIST_ACCOUNTS = 'INSTANTLY_LIST_ACCOUNTS'

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

export type InstantlyAccount = {
  email: string
  status: number | null
}

export type InstantlyCampaignCreateResult = {
  id: string
  name: string
  summary: string
  raw: Record<string, unknown>
}

export type InstantlyCampaignActivationResult = {
  id: string
  status: number | null
  summary: string
  raw: Record<string, unknown>
}

export type LiveInstantlyLaunchResult = {
  campaignId: string
  campaignName: string
  importedCount: number
  senderEmails: string[]
  summary: string
  diagnostics: string
  raw: {
    create: Record<string, unknown>
    import: Record<string, unknown>
    activate: Record<string, unknown>
    diagnostics: Record<string, unknown>
  }
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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
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

function sequenceVariant(subject: string, body: string): Record<string, unknown> {
  return {
    subject,
    body,
  }
}

function approvedLead(contact: ContactPreview): InstantlyLeadInput {
  const [firstName = '', ...rest] = contact.full_name.split(' ')
  return {
    email: contact.email,
    firstName,
    lastName: rest.join(' '),
    companyName: contact.company,
    personalization: contact.signal_detail,
  }
}

function timezoneForLaunch(): string {
  return 'America/Detroit'
}

function weekdaySchedule(): Record<string, boolean> {
  return {
    '0': false,
    '1': true,
    '2': true,
    '3': true,
    '4': true,
    '5': true,
    '6': false,
  }
}

function isoDateToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function bodyStep(contact: ContactPreview, onboarding: OnboardingProfile): { subject: string; body: string } {
  const firstName = contact.full_name.split(' ')[0] ?? 'there'
  const productName = onboarding.product_name || 'PipeIQ'
  return {
    subject: `${productName} for ${contact.title}s who need outbound that converts`,
    body: `Hi ${firstName} - most teams at ${contact.company} hit the same wall: ${onboarding.pain_points || 'manual outbound and slow follow-up'}. ${onboarding.value_proposition || 'PipeIQ runs prospecting, messaging, launches, and reply handling as one operator layer.'} Worth ${onboarding.call_to_action || 'a short walkthrough'}?`,
  }
}

function followUpStep(
  onboarding: OnboardingProfile,
  stepNumber: number,
): { subject: string; body: string; delay: number } {
  const productName = onboarding.product_name || 'PipeIQ'
  if (stepNumber === 2) {
    return {
      subject: `${productName} for lean outbound teams`,
      body: `Quick follow-up. Teams usually adopt ${productName} when outbound ops are fragmented across sourcing, sequencing, replies, and meeting handoff. If useful, I can share the exact workflow.`,
      delay: 2,
    }
  }
  return {
    subject: `Should I close this out?`,
    body: `Last note from me. If outbound is already covered, I will stop here. If not, I can send a tighter breakdown of how PipeIQ replaces manual SDR operations without adding headcount.`,
    delay: 4,
  }
}

function buildCampaignPayload(params: {
  campaignName: string
  senderEmails: string[]
  onboarding: OnboardingProfile
  contacts: ContactPreview[]
}): Record<string, unknown> {
  const firstContact = params.contacts[0]
  const firstStep = firstContact
    ? bodyStep(firstContact, params.onboarding)
    : {
        subject: `${params.onboarding.product_name || 'PipeIQ'} outbound system`,
        body: params.onboarding.value_proposition || 'PipeIQ runs the outbound operator layer.',
      }
  const secondStep = followUpStep(params.onboarding, 2)
  const thirdStep = followUpStep(params.onboarding, 3)

  return {
    name: params.campaignName,
    email_list: params.senderEmails,
    stop_on_reply: true,
    stop_on_auto_reply: true,
    allow_risky_contacts: true,
    open_tracking: true,
    link_tracking: false,
    daily_limit: Math.max(params.contacts.length, 25),
    daily_max_leads: Math.max(params.contacts.length, 25),
    email_gap: 20,
    sequences: [
      {
        steps: [
          {
            type: 'email',
            delay: 0,
            variants: [sequenceVariant(firstStep.subject, firstStep.body)],
          },
          {
            type: 'email',
            delay: secondStep.delay,
            variants: [sequenceVariant(secondStep.subject, secondStep.body)],
          },
          {
            type: 'email',
            delay: thirdStep.delay,
            variants: [sequenceVariant(thirdStep.subject, thirdStep.body)],
          },
        ],
      },
    ],
    campaign_schedule: {
      start_date: isoDateToday(),
      schedules: [
        {
          name: 'Default weekday schedule',
          timing: {
            from: '09:00',
            to: '17:00',
          },
          days: weekdaySchedule(),
          timezone: timezoneForLaunch(),
        },
      ],
    },
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

export async function listInstantlyAccounts(params: {
  workspaceId: string
  orgId: string
}): Promise<InstantlyAccount[]> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_LIST_ACCOUNTS,
    arguments: {
      limit: 100,
      status: 1,
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly account listing failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const nested = asRecord(raw.data)
  const items = nested ? asArray(nested.items) : asArray(raw.items)

  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      email: asString(item.email) ?? '',
      status: asNumber(item.status),
    }))
    .filter((item) => item.email.length > 0)
}

export async function createInstantlyCampaign(params: {
  workspaceId: string
  orgId: string
  name: string
  senderEmails: string[]
  onboarding: OnboardingProfile
  contacts: ContactPreview[]
}): Promise<InstantlyCampaignCreateResult> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_CREATE_CAMPAIGN,
    arguments: buildCampaignPayload({
      campaignName: params.name,
      senderEmails: params.senderEmails,
      onboarding: params.onboarding,
      contacts: params.contacts,
    }),
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly campaign creation failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const campaign = asRecord(raw.data) ?? raw
  const id = asString(campaign.id)
  const name = asString(campaign.name) ?? params.name

  if (!id) {
    throw new Error('Instantly campaign creation returned no campaign id.')
  }

  return {
    id,
    name,
    summary: `Created Instantly campaign ${name}.`,
    raw: campaign,
  }
}

export async function activateInstantlyCampaign(params: {
  workspaceId: string
  orgId: string
  campaignId: string
}): Promise<InstantlyCampaignActivationResult> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: INSTANTLY_ACTIVATE_CAMPAIGN,
    arguments: {
      id: params.campaignId,
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Instantly campaign activation failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const campaign = asRecord(raw.data) ?? raw
  const id = asString(campaign.id) ?? params.campaignId
  const status = asNumber(campaign.status)

  return {
    id,
    status,
    summary: `Activated Instantly campaign ${id}.`,
    raw: campaign,
  }
}

export async function launchInstantlyCampaign(params: {
  workspaceId: string
  orgId: string
  campaignName: string
  onboarding: OnboardingProfile
  contacts: ContactPreview[]
}): Promise<LiveInstantlyLaunchResult> {
  const senderEmails = (await listInstantlyAccounts(params))
    .filter((account) => account.status === 1 || account.status === null)
    .map((account) => account.email)

  if (senderEmails.length === 0) {
    throw new Error('Instantly has no active sender accounts available for this workspace.')
  }

  const create = await createInstantlyCampaign({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    name: params.campaignName,
    senderEmails,
    onboarding: params.onboarding,
    contacts: params.contacts,
  })
  const importResult = await addInstantlyLeadsBulk({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    campaignId: create.id,
    leads: params.contacts.map(approvedLead),
  })
  const activate = await activateInstantlyCampaign({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    campaignId: create.id,
  })
  const diagnostics = await getInstantlyCampaignSendingStatus({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    campaignId: create.id,
  })

  return {
    campaignId: create.id,
    campaignName: create.name,
    importedCount: importResult.importedCount,
    senderEmails,
    summary: `Created, populated, and activated Instantly campaign ${create.name}.`,
    diagnostics: diagnostics.summary,
    raw: {
      create: create.raw,
      import: importResult.raw,
      activate: activate.raw,
      diagnostics: diagnostics.raw,
    },
  }
}
