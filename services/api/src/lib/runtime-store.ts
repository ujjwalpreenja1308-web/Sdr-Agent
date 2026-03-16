import {
  type ApprovalQueueItem,
  type ApprovalItem,
  type ApprovalSample,
  type Campaign,
  type CampaignSummary,
  type Contact,
  type ConnectionLaunch,
  type ConnectionState,
  type ConnectionStatus,
  type ConnectionTarget,
  type ContactPreview,
  type EmailDraft,
  type ICPConfig,
  type InstantlyWebhookEvent,
  type InstantlyWebhookSubscription,
  type IntegrationCheckResult,
  type JsonObject,
  type LaunchChecklistItem,
  type LaunchReadiness,
  type LaunchResult,
  type Meeting,
  type MeetingPrepItem,
  type MetricCard,
  type OnboardingProfile,
  type PipelineMetric,
  type PipelineSnapshot,
  type ProspectRunSummary,
  type Reply,
  type ReplyQueueItem,
  type WebhookReceipt,
  type WorkspaceSettings,
  type WorkspaceSummary,
} from '@pipeiq/shared'
import { ensureWorkspaceRecord, getSupabaseAdmin, isSupabasePersistenceEnabled } from './supabase.js'

type ConnectionRecord = {
  connectionId: string
  sessionId: string
  toolkit: string
  mode: ConnectionTarget['mode']
  status: ConnectionState
  externalUserId: string
  note: string
  connectedAccountId?: string
}

type WorkspaceState = {
  onboarding: OnboardingProfile
  prospectRun: ProspectRunSummary
  contacts: ContactPreview[]
  drafts: EmailDraft[]
  approvals: ApprovalItem[]
  campaign: CampaignSummary
  replies: ReplyQueueItem[]
  meetings: MeetingPrepItem[]
  webhook: InstantlyWebhookSubscription
  pipelineGenerated: boolean
  connections: Map<string, ConnectionRecord>
}

type ProspectSeed = {
  fullName: string
  title: string
  company: string
  email: string
  apolloId?: string | null
  linkedinUrl?: string | null
  signalType: string
  signalDetail: string
  score: number
}

type WorkspaceConnectionRow = {
  workspace_id: string
  toolkit: string
  connection_request_id: string | null
  connected_account_id: string | null
  session_id: string | null
  status: string
  mode: string
  external_user_id: string | null
  note: string | null
}

type ProspectRunRow = {
  workspace_id: string
  status: string
  mode: string
  sourced_count: number
  enriched_count: number
  deduped_count: number
  filters_json: unknown
  note: string
  last_run_at: string
}

type WebhookSubscriptionRow = {
  workspace_id: string
  provider: string
  configured: boolean
  webhook_id: string | null
  target_url: string | null
  event_type: string
  secret_configured: boolean
}

const DEFAULT_WORKSPACE_NAME = 'PipeIQ Launch Workspace'

function nowIso(): string {
  return new Date().toISOString()
}

function onboardingCompletion(profile: OnboardingProfile): number {
  const tracked = [
    profile.product_name,
    profile.product_description,
    profile.target_customer,
    profile.value_proposition,
    profile.pain_points,
    profile.call_to_action,
    profile.voice_guidelines,
    profile.industries.join(','),
    profile.titles.join(','),
    profile.company_sizes.join(','),
    profile.geos.join(','),
  ]
  const complete = tracked.filter((value) => value.trim().length > 0).length
  return Math.floor((complete / tracked.length) * 100)
}

function isOnboardingComplete(profile: OnboardingProfile): boolean {
  return onboardingCompletion(profile) >= 80
}

function isSendableStatus(status: ContactPreview['email_verification_status']): boolean {
  return status === 'valid' || status === 'risky'
}

function defaultConnections(): ConnectionTarget[] {
  return [
    {
      toolkit: 'apollo',
      label: 'Apollo',
      category: 'required',
      mode: 'api_key',
      description: 'Lead search and enrichment through the customer Apollo API key.',
      status: 'not_connected',
      required_for_phase: 'Prospect agent',
      note: 'Save an Apollo API key so PipeIQ can run people search and enrichment directly.',
    },
    {
      toolkit: 'instantly',
      label: 'Instantly',
      category: 'required',
      mode: 'oauth',
      description: 'Campaign launch and reply lifecycle through Composio.',
      status: 'not_connected',
      required_for_phase: 'Campaign launch',
      note: 'Connect through the Composio-hosted flow.',
    },
    {
      toolkit: 'hunter',
      label: 'Hunter',
      category: 'required',
      mode: 'oauth',
      description: 'Email verification before launch.',
      status: 'not_connected',
      required_for_phase: 'Email verification',
      note: 'Connect through the Composio-hosted flow.',
    },
    {
      toolkit: 'gmail',
      label: 'Google Workspace / Gmail',
      category: 'required',
      mode: 'oauth',
      description: 'Inbox and reply workflows.',
      status: 'not_connected',
      required_for_phase: 'Inbox and reply workflows',
    },
    {
      toolkit: 'googlecalendar',
      label: 'Google Calendar',
      category: 'optional',
      mode: 'oauth',
      description: 'Scheduling and meeting booking.',
      status: 'not_connected',
      required_for_phase: 'Meeting agent',
    },
    {
      toolkit: 'calendly',
      label: 'Calendly',
      category: 'optional',
      mode: 'oauth',
      description: 'Alternative scheduling surface.',
      status: 'not_connected',
      required_for_phase: 'Meeting agent',
    },
    {
      toolkit: 'hubspot',
      label: 'HubSpot',
      category: 'optional',
      mode: 'oauth',
      description: 'CRM sync target.',
      status: 'not_connected',
      required_for_phase: 'Growth tier',
    },
  ]
}

function defaultOnboarding(workspaceId: string): OnboardingProfile {
  return {
    workspace_id: workspaceId,
    product_name: '',
    product_description: '',
    target_customer: '',
    value_proposition: '',
    pain_points: '',
    call_to_action: '',
    voice_guidelines: '',
    industries: [],
    titles: [],
    company_sizes: [],
    geos: [],
    exclusions: [],
  }
}

function defaultProspectRun(workspaceId: string): ProspectRunSummary {
  return {
    workspace_id: workspaceId,
    status: 'idle',
    mode: 'mock',
    sourced_count: 0,
    enriched_count: 0,
    deduped_count: 0,
    filters: [],
    note: 'No Apollo prospect run has been executed yet.',
    last_run_at: nowIso(),
  }
}

function defaultCampaign(workspaceId: string): CampaignSummary {
  return {
    workspace_id: workspaceId,
    status: 'idle',
    provider: 'instantly',
    mode: 'mock',
    contacts_launched: 0,
    reply_rate: 0,
    positive_replies: 0,
    meetings_booked: 0,
    last_sync_at: nowIso(),
  }
}

function defaultWebhook(workspaceId: string): InstantlyWebhookSubscription {
  return {
    workspace_id: workspaceId,
    configured: false,
    event_type: 'all_events',
    secret_configured: false,
  }
}

function fullName(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  const combined = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ')
  if (combined.length > 0) {
    return combined
  }
  return email?.split('@')[0] ?? 'Unknown contact'
}

function asJsonObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function asConnectionRecordArray(value: unknown): ConnectionRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (typeof item === 'object' && item !== null ? (item as Partial<ConnectionRecord>) : null))
    .filter(
      (item): item is Partial<ConnectionRecord> =>
        item !== null &&
        typeof item.connectionId === 'string' &&
        typeof item.toolkit === 'string',
    )
    .map((item) => ({
      connectionId: item.connectionId!,
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
      toolkit: item.toolkit!,
      mode: item.mode === 'api_key' ? 'api_key' : 'oauth',
      status:
        item.status === 'connected' || item.status === 'pending'
          ? item.status
          : 'not_connected',
      externalUserId: typeof item.externalUserId === 'string' ? item.externalUserId : '',
      note: typeof item.note === 'string' ? item.note : '',
      ...(typeof item.connectedAccountId === 'string'
        ? { connectedAccountId: item.connectedAccountId }
        : {}),
    }))
}

export class RuntimeStore {
  private readonly states = new Map<string, WorkspaceState>()
  private readonly connections = new Map<string, { workspaceId: string; toolkit: string }>()

  private ensure(workspaceId: string): WorkspaceState {
    const existing = this.states.get(workspaceId)
    if (existing) {
      return existing
    }

    const created: WorkspaceState = {
      onboarding: defaultOnboarding(workspaceId),
      prospectRun: defaultProspectRun(workspaceId),
      contacts: [],
      drafts: [],
      approvals: [],
      campaign: defaultCampaign(workspaceId),
      replies: [],
      meetings: [],
      webhook: defaultWebhook(workspaceId),
      pipelineGenerated: false,
      connections: new Map<string, ConnectionRecord>(),
    }
    this.states.set(workspaceId, created)
    return created
  }

  getWorkspaceSummary(workspaceId: string): WorkspaceSummary {
    const state = this.ensure(workspaceId)
    const completion = onboardingCompletion(state.onboarding)
    const connectedCount = Array.from(state.connections.values()).filter(
      (item) => item.status === 'connected',
    ).length

    const metrics: MetricCard[] = [
      {
        label: 'Onboarding',
        value: `${completion}%`,
        caption: 'Strategy intake completion against the current onboarding flow.',
      },
      {
        label: 'Pending Approvals',
        value: String(state.approvals.filter((item) => item.status === 'pending').length),
        caption: 'Human review items still blocking launch.',
      },
      {
        label: 'Connected Tools',
        value: String(connectedCount),
        caption: 'Authenticated tools currently available in this workspace.',
      },
    ]

    const connections = defaultConnections().map((connection) => {
      const record = state.connections.get(connection.toolkit)
      return {
        ...connection,
        mode: record?.mode ?? connection.mode,
        status: record?.status ?? 'not_connected',
        connection_id: record?.connectedAccountId ?? record?.connectionId ?? null,
        note: record?.note ?? connection.note ?? null,
      }
    })

    return {
      id: workspaceId,
      name:
        state.onboarding.product_name.trim().length > 0
          ? `${state.onboarding.product_name} Workspace`
          : DEFAULT_WORKSPACE_NAME,
      greeting:
        state.onboarding.product_description.trim().length > 0
          ? state.onboarding.product_description
          : 'Connect your stack, answer a few strategy questions, then let PipeIQ run the outbound loop.',
      proposition:
        state.onboarding.value_proposition.trim().length > 0
          ? state.onboarding.value_proposition
          : 'Pre-rendered outbound, approvals where needed, and a single agent surface for the full pipeline.',
      phase_focus:
        state.contacts.length > 0
          ? 'Prospects are ready for batch generation and launch review.'
          : 'Core scaffold: onboarding, connections, prospecting, approvals, and AI SDR control plane.',
      onboarding_completed: isOnboardingComplete(state.onboarding),
      onboarding_progress: completion,
      metrics,
      phases: [
        {
          name: 'Phase 1',
          duration: 'Weeks 1-4',
          outcome: 'Onboarding, prospect flow, personalization, approvals, and campaign launch seam.',
          status: 'active',
        },
        {
          name: 'Phase 2',
          duration: 'Weeks 5-7',
          outcome: 'Reply intelligence, scheduling, and real-time approval events.',
          status: 'next',
        },
        {
          name: 'Phase 3+',
          duration: 'Weeks 8-14',
          outcome: 'Meetings, AI chat depth, analytics, billing, and launch polish.',
          status: 'later',
        },
      ],
      strategy_questions:
        state.onboarding.target_customer.trim().length > 0
          ? [
              'Review your saved ICP and messaging inputs before running the next batch.',
              'Connect Apollo, Hunter, and Instantly to unlock prospecting, verification, and launch.',
              'Authorize Gmail or Google Calendar to prepare reply and meeting workflows.',
            ]
          : [
              'Who is your highest-conviction ICP this quarter?',
              'What pain points create urgency in the first email?',
              'Which CTA converts best: meeting, teardown, or audit?',
              'Which industries or company stages should always be excluded?',
            ],
      connections,
    }
  }

  getOnboarding(workspaceId: string): OnboardingProfile {
    return structuredClone(this.ensure(workspaceId).onboarding)
  }

  updateOnboarding(workspaceId: string, onboarding: OnboardingProfile): OnboardingProfile {
    const state = this.ensure(workspaceId)
    state.onboarding = structuredClone(onboarding)
    state.pipelineGenerated = false
    state.prospectRun = {
      ...defaultProspectRun(workspaceId),
      filters: this.prospectFilters(workspaceId),
      note: 'Update the Apollo prospect run because the onboarding profile changed.',
    }
    state.contacts = []
    state.drafts = []
    state.approvals = []
    state.campaign = defaultCampaign(workspaceId)
    state.replies = []
    state.meetings = []
    return this.getOnboarding(workspaceId)
  }

  getProspectRun(workspaceId: string): ProspectRunSummary {
    return structuredClone(this.ensure(workspaceId).prospectRun)
  }

  runProspectSearch(workspaceId: string): ProspectRunSummary {
    const state = this.ensure(workspaceId)
    const onboarding = state.onboarding
    const generated = [
      {
        fullName: 'John Smith',
        title: onboarding.titles[0] ?? 'CEO',
        company: 'Acme Corp',
        email: 'john@acmecorp.com',
        signalType: 'Apollo search match',
        signalDetail: onboarding.target_customer || 'Matches the saved target profile.',
        score: 91,
      },
      {
        fullName: 'Sarah Lee',
        title: onboarding.titles[1] ?? 'VP Marketing',
        company: 'TechCo',
        email: 'sarah@techco.com',
        signalType: 'Apollo search match',
        signalDetail: onboarding.pain_points || 'Matches the saved pain-point pattern.',
        score: 88,
      },
      {
        fullName: 'Mike Chen',
        title: onboarding.titles[2] ?? 'Head of Sales',
        company: 'BuildCo',
        email: 'mike@buildco.com',
        signalType: 'Apollo search match',
        signalDetail: onboarding.value_proposition || 'Aligned to the saved offer.',
        score: 86,
      },
    ]

    return this.applyProspectSearch(
      workspaceId,
      generated,
      'mock',
      'Apollo prospecting is scaffolded in this migration. Replace with the live Apollo API key flow.',
    )
  }

  applyProspectSearch(
    workspaceId: string,
    generated: ProspectSeed[],
    mode: 'live' | 'mock',
    note: string,
  ): ProspectRunSummary {
    const state = this.ensure(workspaceId)
    state.contacts = generated.map((item, index) => ({
      id: `contact_${workspaceId}_${index + 1}`,
      full_name: item.fullName,
      email: item.email,
      title: item.title,
      company: item.company,
      apollo_id: item.apolloId ?? null,
      linkedin_url: item.linkedinUrl ?? null,
      signal_type: item.signalType,
      signal_detail: item.signalDetail,
      quality_score: item.score,
      status: 'drafted',
      email_verification_status: 'unverified',
      subject: 'Awaiting personalization',
      body_preview:
        'Prospect sourced and enriched. Generate the batch to create the pre-rendered sequence.',
    }))
    state.approvals = []
    state.drafts = []
    state.pipelineGenerated = false
    state.campaign = defaultCampaign(workspaceId)
    state.replies = []
    state.meetings = []
    state.prospectRun = {
      workspace_id: workspaceId,
      status: 'completed',
      mode,
      sourced_count: generated.length,
      enriched_count: generated.length,
      deduped_count: generated.length,
      filters: this.prospectFilters(workspaceId),
      note,
      last_run_at: nowIso(),
    }
    return this.getProspectRun(workspaceId)
  }

  verifyProspects(workspaceId: string): PipelineSnapshot {
    const state = this.ensure(workspaceId)
    state.contacts = state.contacts.map((contact, index) => ({
      ...contact,
      email_verification_status: index === state.contacts.length - 1 ? 'risky' : 'valid',
      email_verification_score: index === state.contacts.length - 1 ? 0.72 : 0.94,
      email_verification_note:
        index === state.contacts.length - 1
          ? 'Hunter status: accept_all'
          : 'Hunter status: valid',
      verification_checked_at: nowIso(),
    }))
    return this.getPipeline(workspaceId)
  }

  applyProspectVerificationResults(
    workspaceId: string,
    outcomes: Array<{
      contactId: string
      status: ContactPreview['email_verification_status']
      score?: number | null
      note?: string | null
      checkedAt: string
    }>,
  ): PipelineSnapshot {
    const state = this.ensure(workspaceId)
    const outcomeByContactId = new Map(outcomes.map((outcome) => [outcome.contactId, outcome] as const))
    state.contacts = state.contacts.map((contact) => {
      const outcome = outcomeByContactId.get(contact.id)
      if (!outcome) {
        return contact
      }
      return {
        ...contact,
        email_verification_status: outcome.status,
        email_verification_score: outcome.score ?? null,
        email_verification_note: outcome.note ?? null,
        verification_checked_at: outcome.checkedAt,
      }
    })
    return this.getPipeline(workspaceId)
  }

  generatePipeline(workspaceId: string): PipelineSnapshot {
    const state = this.ensure(workspaceId)
    const eligible = state.contacts.filter((contact) =>
      isSendableStatus(contact.email_verification_status),
    )

    if (!isOnboardingComplete(state.onboarding)) {
      throw new Error('Complete onboarding before generating the first batch.')
    }
    if (state.prospectRun.status !== 'completed') {
      throw new Error('Run Apollo prospecting before generating the first batch.')
    }
    if (eligible.length === 0) {
      throw new Error('Verify prospect emails with Hunter before generating the first batch.')
    }

    state.contacts = eligible.map((contact, index) => {
      const firstName = contact.full_name.split(' ')[0] ?? 'there'
      const productName = state.onboarding.product_name || 'PipeIQ'
      return {
        ...contact,
        status: index < 2 ? 'ready_for_review' : 'drafted',
        subject: `${productName} for ${contact.title}s who need outbound that converts`,
        body_preview: `Hi ${firstName} - most teams at ${contact.company} hit the same wall: ${state.onboarding.pain_points || 'manual outbound and slow reply handling'}. ${state.onboarding.value_proposition || 'PipeIQ runs the operator layer for prospecting, copy, replies, and meetings.'} Worth ${state.onboarding.call_to_action || 'a 20-minute teardown'}?`,
      }
    })

    const samples: ApprovalSample[] = state.contacts.slice(0, 3).map((contact) => ({
      contact_id: contact.id,
      contact_name: contact.full_name,
      company: contact.company,
      signal: contact.signal_type,
      subject: contact.subject,
      body: contact.body_preview,
    }))

    state.approvals = [
      {
        id: `approval_${workspaceId}_batch`,
        type: 'batch_send',
        title: 'Generated outbound batch is ready',
        summary: `${samples.length} AI-personalized samples are ready for human review before launch.`,
        status: 'pending',
        priority: 'high',
        created_at: nowIso(),
        sample_size: samples.length,
        samples,
      },
    ]
    state.drafts = []
    state.pipelineGenerated = true
    return this.getPipeline(workspaceId)
  }

  getPipeline(workspaceId: string): PipelineSnapshot {
    const state = this.ensure(workspaceId)
    const readyCount = state.contacts.filter((contact) =>
      ['drafted', 'ready_for_review', 'approved_to_launch'].includes(contact.status),
    ).length
    const verifiedCount = state.contacts.filter((contact) =>
      isSendableStatus(contact.email_verification_status),
    ).length
    const approvedCount = state.contacts.filter(
      (contact) =>
        contact.status === 'approved_to_launch' &&
        isSendableStatus(contact.email_verification_status),
    ).length

    const metrics: PipelineMetric[] = [
      {
        label: 'Contacts sourced',
        value: String(state.contacts.length),
        caption: 'Apollo-sourced prospects currently in the workspace pipeline.',
        tone: 'default',
      },
      {
        label: 'Emails verified',
        value: String(verifiedCount),
        caption: 'Hunter-verified contacts that are safe or risky enough to use in the batch.',
        tone: verifiedCount > 0 ? 'success' : 'default',
      },
      {
        label: 'Ready for review',
        value: String(readyCount),
        caption: 'Drafts staged for a batch approval decision.',
        tone: 'warning',
      },
      {
        label: 'Approved to launch',
        value: String(approvedCount),
        caption: 'Contacts unlocked for Instantly launch.',
        tone: 'success',
      },
    ]

    return {
      workspace_id: workspaceId,
      metrics,
      contacts: structuredClone(state.contacts),
    }
  }

  listContacts(workspaceId: string): ContactPreview[] {
    return structuredClone(this.ensure(workspaceId).contacts)
  }

  listEmailDrafts(workspaceId: string): EmailDraft[] {
    return structuredClone(this.ensure(workspaceId).drafts)
  }

  saveEmailDrafts(workspaceId: string, drafts: EmailDraft[]): EmailDraft[] {
    const state = this.ensure(workspaceId)
    state.drafts = drafts.map((draft) => structuredClone(draft))

    for (const draft of state.drafts) {
      const contact = state.contacts.find((item) => item.id === draft.contact_id)
      if (!contact) {
        continue
      }

      contact.subject = draft.subject_1 ?? contact.subject
      contact.body_preview = draft.body_1 ?? contact.body_preview
      if (contact.status === 'drafted') {
        contact.status = 'ready_for_review'
      }
    }

    return this.listEmailDrafts(workspaceId)
  }

  getLaunchReadiness(workspaceId: string): LaunchReadiness {
    const state = this.ensure(workspaceId)
    const connectedToolkits = new Set(
      Array.from(state.connections.values())
        .filter((connection) => connection.status === 'connected')
        .map((connection) => connection.toolkit),
    )
    const verifiedContacts = state.contacts.filter((contact) =>
      isSendableStatus(contact.email_verification_status),
    ).length
    const approvedContacts = state.contacts.filter(
      (contact) =>
        contact.status === 'approved_to_launch' &&
        isSendableStatus(contact.email_verification_status),
    ).length
    const pendingApprovals = state.approvals.filter((item) => item.status === 'pending').length

    const checklist: LaunchChecklistItem[] = [
      {
        id: 'onboarding',
        label: 'Strategy intake saved',
        detail: 'Product, ICP, value proposition, and CTA are captured.',
        status: isOnboardingComplete(state.onboarding) ? 'complete' : 'pending',
      },
      {
        id: 'apollo',
        label: 'Apollo connected',
        detail: 'Prospecting and enrichment seam is available.',
        status: connectedToolkits.has('apollo') ? 'complete' : 'pending',
      },
      {
        id: 'hunter',
        label: 'Hunter connected',
        detail: 'Email verification is available.',
        status: connectedToolkits.has('hunter') ? 'complete' : 'pending',
      },
      {
        id: 'instantly',
        label: 'Instantly connected',
        detail: 'Campaign creation and sending seam is available.',
        status: connectedToolkits.has('instantly') ? 'complete' : 'pending',
      },
      {
        id: 'prospects',
        label: 'Apollo prospects sourced',
        detail: 'Search and enrichment completed for the current ICP.',
        status: state.prospectRun.status === 'completed' ? 'complete' : 'pending',
      },
      {
        id: 'verification',
        label: 'Prospect emails verified',
        detail: 'Hunter has classified which sourced emails are safe to send.',
        status: verifiedContacts > 0 ? 'complete' : 'pending',
      },
      {
        id: 'batch',
        label: 'First batch personalized',
        detail: 'Contacts and pre-rendered copy exist for review.',
        status: state.pipelineGenerated ? 'complete' : 'pending',
      },
      {
        id: 'approval',
        label: 'Human approval complete',
        detail: 'At least one contact is approved to launch.',
        status: approvedContacts > 0 && pendingApprovals === 0 ? 'complete' : 'pending',
      },
    ]

    const blockers: string[] = []
    if (!isOnboardingComplete(state.onboarding)) {
      blockers.push('Complete onboarding to define the ICP and offer.')
    }
    if (!connectedToolkits.has('apollo') || !connectedToolkits.has('hunter') || !connectedToolkits.has('instantly')) {
      blockers.push('Connect required tools: Apollo, Hunter, and Instantly.')
    }
    if (state.prospectRun.status !== 'completed') {
      blockers.push('Run Apollo prospecting to source and enrich the first contact set.')
    }
    if (verifiedContacts === 0) {
      blockers.push('Verify sourced emails with Hunter before generating the first batch.')
    }
    if (!state.pipelineGenerated) {
      blockers.push('Generate the first personalized batch from the sourced prospects.')
    }
    if (pendingApprovals > 0 || approvedContacts === 0) {
      blockers.push('Approve the generated batch before staging a campaign.')
    }

    const completedItems = checklist.filter((item) => item.status === 'complete').length
    const ready = blockers.length === 0

    return {
      workspace_id: workspaceId,
      ready_to_launch: ready,
      progress: Math.floor((completedItems / checklist.length) * 100),
      stage: state.campaign.status === 'running' ? 'staged' : ready ? 'ready' : 'setup',
      contacts_ready: approvedContacts,
      pending_approvals: pendingApprovals,
      blockers,
      next_action: ready ? 'Stage the first campaign in Instantly.' : blockers[0] ?? 'Continue setup.',
      checklist,
    }
  }

  stageLaunch(workspaceId: string): LaunchResult {
    const state = this.ensure(workspaceId)
    const readiness = this.getLaunchReadiness(workspaceId)
    if (!readiness.ready_to_launch) {
      return {
        workspace_id: workspaceId,
        status: 'blocked',
        contacts_launched: 0,
        message: 'Launch is still blocked by setup or approval gaps.',
        blockers: readiness.blockers,
      }
    }

    const launched = state.contacts.filter(
      (contact) => contact.status === 'approved_to_launch',
    ).length

    state.campaign = {
      workspace_id: workspaceId,
      status: 'running',
      campaign_name: `${this.getWorkspaceSummary(workspaceId).name} - First Outbound Wave`,
      campaign_id: `cmp_${workspaceId}`,
      provider: 'instantly',
      mode: 'mock',
      contacts_launched: launched,
      reply_rate: 0,
      positive_replies: 0,
      meetings_booked: 0,
      last_sync_at: nowIso(),
    }

    return {
      workspace_id: workspaceId,
      status: 'staged',
      campaign_name: state.campaign.campaign_name ?? null,
      campaign_id: state.campaign.campaign_id ?? null,
      provider: state.campaign.provider,
      mode: state.campaign.mode,
      contacts_launched: launched,
      message: 'Campaign launched into the running state.',
      blockers: [],
    }
  }

  recordInstantlyLaunch(
    workspaceId: string,
    campaignId: string,
    importedCount: number,
    summary: string,
  ): LaunchResult {
    const state = this.ensure(workspaceId)
    state.campaign = {
      workspace_id: workspaceId,
      status: 'running',
      campaign_name: state.campaign.campaign_name ?? `${this.getWorkspaceSummary(workspaceId).name} - Instantly Campaign`,
      campaign_id: campaignId,
      provider: 'instantly',
      mode: 'live',
      contacts_launched: importedCount,
      reply_rate: state.campaign.reply_rate,
      positive_replies: state.campaign.positive_replies,
      meetings_booked: state.campaign.meetings_booked,
      last_sync_at: nowIso(),
    }

    return {
      workspace_id: workspaceId,
      status: 'staged',
      campaign_name: state.campaign.campaign_name ?? null,
      campaign_id: campaignId,
      provider: 'instantly',
      mode: 'live',
      contacts_launched: importedCount,
      message: summary,
      blockers: [],
    }
  }

  currentLaunchResult(workspaceId: string, message?: string): LaunchResult {
    const campaign = this.getCampaign(workspaceId)
    return {
      workspace_id: workspaceId,
      status: campaign.status === 'idle' ? 'blocked' : 'staged',
      campaign_name: campaign.campaign_name ?? null,
      campaign_id: campaign.campaign_id ?? null,
      provider: campaign.provider,
      mode: campaign.mode,
      contacts_launched: campaign.contacts_launched,
      message: message ?? 'Launch state already exists for this workspace.',
      blockers: campaign.status === 'idle' ? this.getLaunchReadiness(workspaceId).blockers : [],
    }
  }

  getCampaign(workspaceId: string): CampaignSummary {
    return structuredClone(this.ensure(workspaceId).campaign)
  }

  getWebhook(workspaceId: string): InstantlyWebhookSubscription {
    return structuredClone(this.ensure(workspaceId).webhook)
  }

  setWebhook(workspaceId: string, webhookId: string, targetUrl: string): InstantlyWebhookSubscription {
    const state = this.ensure(workspaceId)
    state.webhook = {
      workspace_id: workspaceId,
      configured: true,
      webhook_id: webhookId,
      target_url: targetUrl,
      event_type: 'all_events',
      secret_configured: false,
    }
    return this.getWebhook(workspaceId)
  }

  listReplies(workspaceId: string): ReplyQueueItem[] {
    return structuredClone(this.ensure(workspaceId).replies)
  }

  addProcessedReply(
    workspaceId: string,
    reply: ReplyQueueItem,
    createApproval: boolean,
  ): ReplyQueueItem {
    const state = this.ensure(workspaceId)
    const existingIndex = state.replies.findIndex((item) => item.id === reply.id)
    if (existingIndex >= 0) {
      state.replies[existingIndex] = structuredClone(reply)
    } else {
      state.replies.push(structuredClone(reply))
    }

    if (createApproval) {
      const approvalId = `approval_reply_${reply.id}`
      state.approvals = [
        {
          id: approvalId,
          type: 'reply_review',
          title: `Reply review for ${reply.contact_name}`,
          summary: reply.summary,
          status: 'pending',
          priority: reply.classification === 'INTERESTED' ? 'high' : 'medium',
          created_at: nowIso(),
          sample_size: 1,
          samples: [
            {
              contact_id: reply.contact_id,
              contact_name: reply.contact_name,
              company: reply.company,
              signal: reply.classification,
              subject: 'Reply review',
              body: reply.draft_reply,
            },
          ],
        },
        ...state.approvals.filter((item) => item.id !== approvalId),
      ]
    }

    state.campaign.reply_rate =
      state.campaign.contacts_launched > 0
        ? Number(((state.replies.length / state.campaign.contacts_launched) * 100).toFixed(1))
        : 0
    state.campaign.positive_replies = state.replies.filter(
      (item) => item.classification === 'INTERESTED',
    ).length

    return structuredClone(reply)
  }

  upsertMeetingHandoff(
    workspaceId: string,
    meeting: MeetingPrepItem,
  ): MeetingPrepItem {
    const state = this.ensure(workspaceId)
    const existingIndex = state.meetings.findIndex((item) => item.id === meeting.id)
    if (existingIndex >= 0) {
      state.meetings[existingIndex] = structuredClone(meeting)
    } else {
      state.meetings.push(structuredClone(meeting))
    }
    state.campaign.meetings_booked = state.meetings.filter((item) => item.status === 'booked').length
    return structuredClone(meeting)
  }

  decideReply(workspaceId: string, replyId: string, decision: 'approved' | 'dismissed'): ReplyQueueItem {
    const state = this.ensure(workspaceId)
    const reply = state.replies.find((item) => item.id === replyId)
    if (!reply) {
      throw new Error(`Unknown reply id: ${replyId}`)
    }
    reply.status = decision === 'approved' ? 'sent' : 'dismissed'
    if (decision === 'approved' && reply.classification === 'INTERESTED') {
      const meetingId = `meeting_${reply.contact_id}`
      const existingMeeting = state.meetings.find((item) => item.id === meetingId)
      const meeting = existingMeeting ?? {
        id: meetingId,
        workspace_id: workspaceId,
        contact_id: reply.contact_id,
        contact_name: reply.contact_name,
        company: reply.company,
        scheduled_for: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'prep_ready' as const,
        calendar_event_id: null,
        prep_brief: [
          `${reply.company} already replied positively to outbound.`,
          'Lead with the same pain pattern that triggered the conversation.',
          'Share availability options or convert this handoff into a booked meeting once the prospect confirms.',
        ],
        owner_note: 'Generated from the reply workflow after positive intent.',
      }
      this.upsertMeetingHandoff(workspaceId, meeting)
    }
    return structuredClone(reply)
  }

  listMeetings(workspaceId: string): MeetingPrepItem[] {
    return structuredClone(this.ensure(workspaceId).meetings)
  }

  listApprovals(workspaceId: string): ApprovalItem[] {
    return structuredClone(this.ensure(workspaceId).approvals)
  }

  decideApproval(workspaceId: string, approvalId: string, decision: 'approved' | 'rejected'): ApprovalItem {
    const state = this.ensure(workspaceId)
    const approval = state.approvals.find((item) => item.id === approvalId)
    if (!approval) {
      throw new Error(`Unknown approval id: ${approvalId}`)
    }
    approval.status = decision
    const nextStatus =
      decision === 'approved' ? 'approved_to_launch' : 'revision_requested'
    for (const sample of approval.samples) {
      const contact = state.contacts.find((item) => item.id === sample.contact_id)
      if (contact) {
        contact.status = nextStatus
      }
    }
    return structuredClone(approval)
  }

  ingestInstantlyEvent(workspaceId: string, event: InstantlyWebhookEvent): WebhookReceipt {
    const state = this.ensure(workspaceId)
    let action = 'ignored'

    if (event.event_type === 'reply_received' || event.event_type === 'lead_interested') {
      const email = event.lead_email ?? 'unknown@example.com'
      const contact = state.contacts.find(
        (item) => item.email.toLowerCase() === email.toLowerCase(),
      )
      const reply: ReplyQueueItem = {
        id: event.email_id ?? `reply_${state.replies.length + 1}`,
        workspace_id: workspaceId,
        contact_id: contact?.id ?? `contact_unknown_${state.replies.length + 1}`,
        recipient_email: contact?.email ?? email,
        thread_id:
          (typeof event.gmail_thread_id === 'string' && event.gmail_thread_id) ||
          (typeof event.thread_id === 'string' && event.thread_id) ||
          event.email_id ||
          null,
        contact_name: contact?.full_name ?? email.split('@')[0] ?? 'Unknown contact',
        company: contact?.company ?? 'Unknown company',
        classification:
          event.event_type === 'lead_interested' ? 'INTERESTED' : 'OBJECTION',
        confidence: 0.91,
        summary: event.reply_text_snippet ?? event.reply_text ?? 'Instantly webhook reply received.',
        draft_reply:
          event.event_type === 'lead_interested'
            ? 'Thanks for the interest. I can send over two time options for next week.'
            : 'Fair question. PipeIQ sits on top of your existing stack and handles the operator layer.',
        status: 'pending',
        requires_human: true,
        received_at: event.timestamp ?? nowIso(),
      }
      const existingReplyIndex = state.replies.findIndex((item) => item.id === reply.id)
      if (existingReplyIndex >= 0) {
        state.replies[existingReplyIndex] = reply
      } else {
        state.replies.push(reply)
      }
      state.campaign.reply_rate =
        state.campaign.contacts_launched > 0
          ? Number(((state.replies.length / state.campaign.contacts_launched) * 100).toFixed(1))
          : 0
      state.campaign.positive_replies = state.replies.filter(
        (reply) => reply.classification === 'INTERESTED',
      ).length
      action = 'reply_queued'
    }

    if (event.event_type === 'lead_meeting_booked') {
      action = 'meeting_booked'
    }

    return {
      workspace_id: workspaceId,
      event_type: event.event_type,
      accepted: true,
      action,
    }
  }

  createReengagementDraft(
    workspaceId: string,
    contactId: string,
    subject: string,
    body: string,
  ): ApprovalItem {
    const state = this.ensure(workspaceId)
    const contact = state.contacts.find((item) => item.id === contactId)
    if (!contact) {
      throw new Error(`Unknown contact id: ${contactId}`)
    }

    const approvalId = `approval_reengage_${contactId}`
    const approval: ApprovalItem = {
      id: approvalId,
      type: 'sequence_update',
      title: `Re-engage ${contact.full_name}`,
      summary: 'A re-engagement draft is ready after a NOT_NOW reply.',
      status: 'pending',
      priority: 'medium',
      created_at: nowIso(),
      sample_size: 1,
      samples: [
        {
          contact_id: contact.id,
          contact_name: contact.full_name,
          company: contact.company,
          signal: 'NOT_NOW re-engagement',
          subject,
          body,
        },
      ],
    }

    state.approvals = [
      approval,
      ...state.approvals.filter((item) => item.id !== approvalId),
    ]

    return structuredClone(approval)
  }

  recordConnectionLaunch(
    workspaceId: string,
    toolkit: string,
    externalUserId: string,
    sessionId: string,
    connectionId: string,
    note: string,
  ): ConnectionLaunch {
    const state = this.ensure(workspaceId)
    state.connections.set(toolkit, {
      toolkit,
      connectionId,
      sessionId,
      mode: 'oauth',
      status: 'pending',
      externalUserId,
      note,
    })
    this.connections.set(connectionId, { workspaceId, toolkit })

    return {
      toolkit,
      session_id: sessionId,
      connection_id: connectionId,
      redirect_url: null,
      status: 'pending',
      mode: 'oauth',
      note,
    }
  }

  setConnectionStatus(
    workspaceId: string,
    toolkit: string,
    status: ConnectionState,
    note: string,
    connectedAccountId?: string,
  ): ConnectionStatus {
    const state = this.ensure(workspaceId)
    const existing = state.connections.get(toolkit)
    if (!existing) {
      throw new Error(`Unknown toolkit: ${toolkit}`)
    }
    existing.status = status
    existing.note = note
    if (connectedAccountId) {
      existing.connectedAccountId = connectedAccountId
    }
    this.connections.set(existing.connectionId, { workspaceId, toolkit })
    return {
      toolkit,
      connection_id: connectedAccountId ?? existing.connectionId,
      status,
      mode: existing.mode,
      note,
    }
  }

  getConnectionByRequestId(connectionId: string): { workspaceId: string; toolkit: string } | null {
    return this.connections.get(connectionId) ?? null
  }

  async hydrateWorkspace(workspaceId: string, orgId: string): Promise<void> {
    this.ensure(workspaceId)
    if (!isSupabasePersistenceEnabled()) {
      return
    }

    await ensureWorkspaceRecord(workspaceId, orgId)
    const supabase = getSupabaseAdmin()

    const [
      icpResult,
      settingsResult,
      connectionsResult,
      prospectRunResult,
      webhookResult,
      contactsResult,
      draftsResult,
      campaignsResult,
      repliesResult,
      meetingsResult,
      approvalsResult,
    ] = await Promise.all([
      supabase.from('icp_configs').select('*').eq('workspace_id', workspaceId).limit(1).maybeSingle<ICPConfig>(),
      supabase.from('workspace_settings').select('*').eq('workspace_id', workspaceId).limit(1).maybeSingle<WorkspaceSettings>(),
      supabase.from('workspace_connections').select('*').eq('workspace_id', workspaceId).returns<WorkspaceConnectionRow[]>(),
      supabase.from('prospect_runs').select('*').eq('workspace_id', workspaceId).limit(1).maybeSingle<ProspectRunRow>(),
      supabase.from('webhook_subscriptions').select('*').eq('workspace_id', workspaceId).eq('provider', 'instantly').limit(1).maybeSingle<WebhookSubscriptionRow>(),
      supabase.from('contacts').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true }).returns<Contact[]>(),
      supabase.from('email_drafts').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: true }).returns<EmailDraft[]>(),
      supabase.from('campaigns').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).returns<Campaign[]>(),
      supabase.from('replies').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).returns<Reply[]>(),
      supabase.from('meetings').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).returns<Meeting[]>(),
      supabase.from('approval_queue').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).returns<ApprovalQueueItem[]>(),
    ])

    const state = this.ensure(workspaceId)
    const icp = icpResult.data ?? null
    const settings = settingsResult.data ?? null
    const runtimeJson = asJsonObject(settings?.sending_schedule_json)
    const strategyJson = asJsonObject(icp?.strategy_json)
    const draftRows = draftsResult.data ?? []
    const draftByContactId = new Map(draftRows.map((draft) => [draft.contact_id, draft] as const))

    state.onboarding = {
      workspace_id: workspaceId,
      product_name: typeof strategyJson.product_name === 'string' ? strategyJson.product_name : '',
      product_description:
        typeof strategyJson.product_description === 'string' ? strategyJson.product_description : '',
      target_customer:
        typeof strategyJson.target_customer === 'string' ? strategyJson.target_customer : '',
      value_proposition:
        typeof strategyJson.value_proposition === 'string' ? strategyJson.value_proposition : '',
      pain_points: icp?.pain_points ?? '',
      call_to_action: icp?.cta ?? '',
      voice_guidelines: icp?.voice_guidelines ?? '',
      industries: icp?.industries ?? [],
      titles: icp?.titles ?? [],
      company_sizes: icp?.company_sizes ?? [],
      geos: icp?.geos ?? [],
      exclusions: asStringArray(strategyJson.exclusions),
    }

    const connectionRecords: ConnectionRecord[] = (connectionsResult.data ?? []).map((row) => {
      const status: ConnectionState =
        row.status === 'connected' || row.status === 'pending'
          ? row.status
          : 'not_connected'

      return {
        connectionId:
          row.connected_account_id ??
          row.connection_request_id ??
          `connection_${workspaceId}_${row.toolkit}`,
        sessionId: row.session_id ?? '',
        toolkit: row.toolkit,
        mode: row.mode === 'api_key' ? 'api_key' : 'oauth',
        status,
        externalUserId: row.external_user_id ?? '',
        note: row.note ?? '',
        ...(row.connected_account_id
          ? { connectedAccountId: row.connected_account_id }
          : {}),
      }
    })
    state.connections = new Map(connectionRecords.map((record) => [record.toolkit, record] as const))
    for (const record of connectionRecords) {
      this.connections.set(record.connectionId, { workspaceId, toolkit: record.toolkit })
    }

    state.prospectRun = prospectRunResult.data
      ? {
          workspace_id: workspaceId,
          status:
            prospectRunResult.data.status === 'completed' ? 'completed' : 'idle',
          mode: prospectRunResult.data.mode === 'live' ? 'live' : 'mock',
          sourced_count: prospectRunResult.data.sourced_count,
          enriched_count: prospectRunResult.data.enriched_count,
          deduped_count: prospectRunResult.data.deduped_count,
          filters: asStringArray(prospectRunResult.data.filters_json),
          note: prospectRunResult.data.note,
          last_run_at: prospectRunResult.data.last_run_at,
        }
      : defaultProspectRun(workspaceId)

    state.webhook = webhookResult.data
      ? {
          workspace_id: workspaceId,
          configured: webhookResult.data.configured,
          webhook_id: webhookResult.data.webhook_id,
          target_url: webhookResult.data.target_url,
          event_type: webhookResult.data.event_type,
          secret_configured: webhookResult.data.secret_configured,
        }
      : defaultWebhook(workspaceId)

    state.contacts = (contactsResult.data ?? []).map((contact) => {
      const draft = draftByContactId.get(contact.id)
      const qualityScore =
        typeof contact.quality_score === 'number'
          ? contact.quality_score
          : typeof draft?.quality_score === 'number'
            ? draft.quality_score
            : 80

      return {
        id: contact.id,
        full_name: fullName(contact.first_name, contact.last_name, contact.email),
        email: contact.email ?? '',
        title: contact.title ?? 'Unknown title',
        company: contact.company ?? 'Unknown company',
        apollo_id: contact.apollo_id ?? null,
        linkedin_url: contact.linkedin_url ?? null,
        signal_type: contact.signal_type ?? 'Apollo search match',
        signal_detail: contact.signal_detail ?? 'Matched current targeting filters.',
        quality_score: qualityScore,
        status: (contact.status as ContactPreview['status']) ?? 'drafted',
        email_verification_status:
          (contact.email_verification_status ?? 'unverified') as ContactPreview['email_verification_status'],
        email_verification_score: contact.email_verification_score ?? null,
        email_verification_note: contact.email_verification_note ?? null,
        verification_checked_at: contact.verification_checked_at ?? null,
        subject: draft?.subject_1 ?? 'Awaiting personalization',
        body_preview:
          draft?.body_1 ??
          'Prospect sourced and enriched. Generate the batch to create the pre-rendered sequence.',
      }
    })

    state.drafts = draftRows.map((draft) => structuredClone(draft))

    const contactById = new Map(state.contacts.map((contact) => [contact.id, contact] as const))
    state.approvals = (approvalsResult.data ?? []).map((item) => {
      const payload = asJsonObject(item.payload_json)
      return {
        id: item.id,
        type: (item.type as ApprovalItem['type']) ?? 'batch_send',
        title: typeof payload.title === 'string' ? payload.title : 'Approval item',
        summary: typeof payload.summary === 'string' ? payload.summary : '',
        status: (item.status as ApprovalItem['status']) ?? 'pending',
        priority: (item.priority as ApprovalItem['priority']) ?? 'medium',
        created_at: item.created_at,
        sample_size:
          typeof payload.sample_size === 'number'
            ? payload.sample_size
            : Array.isArray(payload.samples)
              ? payload.samples.length
              : 0,
        samples: Array.isArray(payload.samples)
          ? (payload.samples as unknown as ApprovalSample[])
          : [],
      }
    })

    state.replies = (repliesResult.data ?? []).map((reply) => {
      const contact = reply.contact_id ? contactById.get(reply.contact_id) : undefined
      return {
        id: reply.id,
        workspace_id: workspaceId,
        contact_id: reply.contact_id ?? `contact_unknown_${reply.id}`,
        recipient_email: contact?.email ?? null,
        thread_id: reply.instantly_email_id ?? null,
        contact_name: contact?.full_name ?? 'Unknown contact',
        company: contact?.company ?? 'Unknown company',
        classification:
          (reply.classification as ReplyQueueItem['classification']) ?? 'OBJECTION',
        confidence: reply.confidence ?? 0.8,
        summary: reply.reply_text ?? 'Reply received.',
        draft_reply: reply.draft_response ?? '',
        status:
          reply.sent_at
            ? 'sent'
            : reply.approved_at
              ? 'approved'
              : 'pending',
        requires_human: !(reply.sent_at || reply.approved_at),
        received_at: reply.created_at,
      }
    })

    state.meetings = (meetingsResult.data ?? []).map((meeting) => {
      const contact = meeting.contact_id ? contactById.get(meeting.contact_id) : undefined
      const prep = asJsonObject(meeting.prep_brief_json)
      return {
        id: meeting.id,
        workspace_id: workspaceId,
        contact_id: meeting.contact_id ?? `contact_unknown_${meeting.id}`,
        contact_name: contact?.full_name ?? 'Unknown contact',
        company: contact?.company ?? 'Unknown company',
        scheduled_for: meeting.scheduled_at ?? nowIso(),
        status: meeting.scheduled_at ? 'booked' : 'prep_ready',
        calendar_event_id: meeting.calendar_event_id ?? null,
        prep_brief: asStringArray(prep.items),
        owner_note: typeof prep.owner_note === 'string' ? prep.owner_note : '',
      }
    })

    const latestCampaign = (campaignsResult.data ?? [])[0]
    if (latestCampaign) {
      const meta = asJsonObject(latestCampaign.template_json)
      state.campaign = {
        workspace_id: workspaceId,
        status: (latestCampaign.status as CampaignSummary['status']) ?? 'idle',
        campaign_name: typeof meta.campaign_name === 'string' ? meta.campaign_name : null,
        campaign_id: latestCampaign.instantly_campaign_id ?? latestCampaign.id,
        provider: typeof meta.provider === 'string' ? meta.provider : 'instantly',
        mode: meta.mode === 'live' ? 'live' : 'mock',
        contacts_launched: latestCampaign.contact_count,
        reply_rate: typeof meta.reply_rate === 'number' ? meta.reply_rate : 0,
        positive_replies:
          typeof meta.positive_replies === 'number' ? meta.positive_replies : 0,
        meetings_booked:
          typeof meta.meetings_booked === 'number' ? meta.meetings_booked : 0,
        last_sync_at:
          typeof meta.last_sync_at === 'string' ? meta.last_sync_at : latestCampaign.created_at,
      }
    } else {
      state.campaign = defaultCampaign(workspaceId)
    }

    state.pipelineGenerated =
      typeof runtimeJson.pipeline_generated === 'boolean'
        ? runtimeJson.pipeline_generated
        : state.drafts.length > 0 || state.approvals.length > 0
  }

  async resolveConnectionLookup(
    connectionId: string,
    orgId: string,
  ): Promise<{ workspaceId: string; toolkit: string } | null> {
    const cached = this.getConnectionByRequestId(connectionId)
    if (cached) {
      return cached
    }

    if (!isSupabasePersistenceEnabled()) {
      return null
    }

    const supabase = getSupabaseAdmin()
    const result = await supabase
      .from('workspaces')
      .select('id')
      .eq('org_id', orgId)

    if (result.error) {
      return null
    }

    for (const workspace of result.data ?? []) {
      const workspaceId = String(workspace.id)
      await this.hydrateWorkspace(workspaceId, orgId)
      const match = this.getConnectionByRequestId(connectionId)
      if (match) {
        return match
      }
    }

    return null
  }

  async persistWorkspace(workspaceId: string, orgId: string): Promise<void> {
    if (!isSupabasePersistenceEnabled()) {
      return
    }

    const state = this.ensure(workspaceId)
    const supabase = getSupabaseAdmin()
    const summary = this.getWorkspaceSummary(workspaceId)

    await ensureWorkspaceRecord(workspaceId, orgId)
    await supabase.from('workspaces').update({ name: summary.name }).eq('id', workspaceId).eq('org_id', orgId)

    await supabase.from('icp_configs').delete().eq('workspace_id', workspaceId)
    await supabase.from('icp_configs').insert({
      workspace_id: workspaceId,
      industries: state.onboarding.industries,
      titles: state.onboarding.titles,
      company_sizes: state.onboarding.company_sizes,
      geos: state.onboarding.geos,
      pain_points: state.onboarding.pain_points,
      cta: state.onboarding.call_to_action,
      voice_guidelines: state.onboarding.voice_guidelines,
      apollo_filter_json: {},
      strategy_json: {
        product_name: state.onboarding.product_name,
        product_description: state.onboarding.product_description,
        target_customer: state.onboarding.target_customer,
        value_proposition: state.onboarding.value_proposition,
        exclusions: state.onboarding.exclusions,
      },
      created_at: nowIso(),
      updated_at: nowIso(),
    })

    await supabase.from('workspace_settings').upsert({
      workspace_id: workspaceId,
      auto_approve_json: {},
      sending_schedule_json: {
        pipeline_generated: state.pipelineGenerated,
      },
      optimization_enabled: true,
      weekly_report_enabled: true,
      updated_at: nowIso(),
    }, { onConflict: 'workspace_id' })

    await supabase.from('workspace_connections').delete().eq('workspace_id', workspaceId)
    if (state.connections.size > 0) {
      await supabase.from('workspace_connections').insert(
        Array.from(state.connections.values()).map((connection) => ({
          workspace_id: workspaceId,
          toolkit: connection.toolkit,
          connection_request_id:
            connection.connectedAccountId ? connection.connectionId : connection.connectionId,
          connected_account_id: connection.connectedAccountId ?? null,
          session_id: connection.sessionId || null,
          status: connection.status,
          mode: connection.mode,
          external_user_id: connection.externalUserId || null,
          note: connection.note || null,
          updated_at: nowIso(),
        })),
      )
    }

    await supabase.from('prospect_runs').upsert({
      workspace_id: workspaceId,
      status: state.prospectRun.status,
      mode: state.prospectRun.mode,
      sourced_count: state.prospectRun.sourced_count,
      enriched_count: state.prospectRun.enriched_count,
      deduped_count: state.prospectRun.deduped_count,
      filters_json: state.prospectRun.filters,
      note: state.prospectRun.note,
      last_run_at: state.prospectRun.last_run_at,
      updated_at: nowIso(),
    }, { onConflict: 'workspace_id' })

    await supabase.from('webhook_subscriptions').upsert({
      workspace_id: workspaceId,
      provider: 'instantly',
      configured: state.webhook.configured,
      webhook_id: state.webhook.webhook_id ?? null,
      target_url: state.webhook.target_url ?? null,
      event_type: state.webhook.event_type,
      secret_configured: state.webhook.secret_configured,
      updated_at: nowIso(),
    }, { onConflict: 'workspace_id,provider' })

    await supabase.from('contacts').delete().eq('workspace_id', workspaceId)
    if (state.contacts.length > 0) {
      await supabase.from('contacts').insert(
        state.contacts.map((contact) => {
          const parts = contact.full_name.split(' ')
          return {
            id: contact.id,
            workspace_id: workspaceId,
            email: contact.email,
            first_name: parts[0] ?? null,
            last_name: parts.slice(1).join(' ') || null,
            title: contact.title,
            company: contact.company,
            linkedin_url: contact.linkedin_url ?? null,
            apollo_id: contact.apollo_id ?? null,
            status: contact.status,
            enriched_at: contact.verification_checked_at ?? null,
            never_contact: false,
            signal_type: contact.signal_type,
            signal_detail: contact.signal_detail,
            quality_score: contact.quality_score,
            email_verification_status: contact.email_verification_status,
            email_verification_score: contact.email_verification_score ?? null,
            email_verification_note: contact.email_verification_note ?? null,
            verification_checked_at: contact.verification_checked_at ?? null,
            created_at: nowIso(),
          }
        }),
      )
    }

    await supabase.from('email_drafts').delete().eq('workspace_id', workspaceId)
    if (state.drafts.length > 0) {
      await supabase.from('email_drafts').insert(state.drafts)
    }

    await supabase.from('approval_queue').delete().eq('workspace_id', workspaceId)
    if (state.approvals.length > 0) {
      await supabase.from('approval_queue').insert(
        state.approvals.map((approval) => ({
          id: approval.id,
          workspace_id: workspaceId,
          type: approval.type,
          payload_json: {
            title: approval.title,
            summary: approval.summary,
            sample_size: approval.sample_size,
            samples: approval.samples,
          },
          status: approval.status,
          priority: approval.priority,
          created_at: approval.created_at,
          resolved_at: approval.status === 'pending' ? null : nowIso(),
          resolved_by: null,
        })),
      )
    }

    await supabase.from('replies').delete().eq('workspace_id', workspaceId)
    if (state.replies.length > 0) {
      await supabase.from('replies').insert(
        state.replies.map((reply) => ({
          id: reply.id,
          contact_id: state.contacts.find((item) => item.id === reply.contact_id)?.id ?? null,
          workspace_id: workspaceId,
          reply_text: reply.summary,
          classification: reply.classification,
          confidence: reply.confidence,
          draft_response: reply.draft_reply,
          approved_at: reply.status === 'approved' ? nowIso() : null,
          sent_at: reply.status === 'sent' ? nowIso() : null,
          instantly_email_id: reply.thread_id ?? reply.id,
          resume_at: null,
          created_at: reply.received_at,
        })),
      )
    }

    await supabase.from('meetings').delete().eq('workspace_id', workspaceId)
    if (state.meetings.length > 0) {
      await supabase.from('meetings').insert(
        state.meetings.map((meeting) => ({
          id: meeting.id,
          contact_id: state.contacts.find((item) => item.id === meeting.contact_id)?.id ?? null,
          workspace_id: workspaceId,
          scheduled_at: meeting.scheduled_for,
          calendar_event_id: meeting.calendar_event_id ?? null,
          prep_brief_json: {
            items: meeting.prep_brief,
            owner_note: meeting.owner_note,
          },
          outcome: null,
          outcome_notes: null,
          created_at: nowIso(),
        })),
      )
    }

    await supabase.from('campaigns').delete().eq('workspace_id', workspaceId)
    if (state.campaign.status !== 'idle' || state.campaign.contacts_launched > 0) {
      await supabase.from('campaigns').insert({
        id: state.campaign.campaign_id ?? `campaign_${workspaceId}`,
        workspace_id: workspaceId,
        instantly_campaign_id: state.campaign.campaign_id ?? null,
        week_start: new Date().toISOString().slice(0, 10),
        contact_count: state.campaign.contacts_launched,
        status: state.campaign.status,
        template_json: {
          campaign_name: state.campaign.campaign_name,
          provider: state.campaign.provider,
          mode: state.campaign.mode,
          reply_rate: state.campaign.reply_rate,
          positive_replies: state.campaign.positive_replies,
          meetings_booked: state.campaign.meetings_booked,
          last_sync_at: state.campaign.last_sync_at,
        },
        created_at: state.campaign.last_sync_at,
      })
    }
  }

  saveApiKeyConnection(
    workspaceId: string,
    toolkit: string,
    label: string,
    note?: string,
  ): ConnectionStatus {
    const state = this.ensure(workspaceId)
    const resolvedNote = note ?? `Stored encrypted API key for ${label}.`
    const connectionId = `api_key_${workspaceId}_${toolkit}`
    state.connections.set(toolkit, {
      toolkit,
      connectionId,
      sessionId: '',
      mode: 'api_key',
      status: 'connected',
      externalUserId: workspaceId,
      note: resolvedNote,
    })
    this.connections.set(connectionId, { workspaceId, toolkit })
    return {
      toolkit,
      connection_id: connectionId,
      status: 'connected',
      mode: 'api_key',
      note: resolvedNote,
    }
  }

  integrationCheck(workspaceId: string, toolkit: string): IntegrationCheckResult {
    const state = this.ensure(workspaceId)
    const record = state.connections.get(toolkit)
    const connectionStatus = record?.status ?? 'not_connected'
    return {
      workspace_id: workspaceId,
      toolkit,
      connection_status:
        connectionStatus === 'connected'
          ? 'connected'
          : connectionStatus === 'pending'
            ? 'pending'
            : 'not_connected',
      source: record?.mode === 'api_key' ? 'api_key' : 'composio',
      summary:
        connectionStatus === 'connected'
          ? record?.mode === 'api_key'
            ? `${toolkit} API key is saved and marked connected.`
            : `${toolkit} connection is active through Composio.`
          : connectionStatus === 'pending'
            ? `${toolkit} connection is still pending.`
            : record?.mode === 'api_key'
              ? `No API key has been saved for ${toolkit} yet.`
              : `No Composio connection exists for ${toolkit} yet.`,
      details:
        record?.connectedAccountId ? [`connected_account_id: ${record.connectedAccountId}`] : [],
      checked_at: nowIso(),
    }
  }

  private prospectFilters(workspaceId: string): string[] {
    const onboarding = this.ensure(workspaceId).onboarding
    const filters: string[] = []
    if (onboarding.titles.length > 0) {
      filters.push(`Titles: ${onboarding.titles.join(', ')}`)
    }
    if (onboarding.industries.length > 0) {
      filters.push(`Industries: ${onboarding.industries.join(', ')}`)
    }
    if (onboarding.company_sizes.length > 0) {
      filters.push(`Company sizes: ${onboarding.company_sizes.join(', ')}`)
    }
    if (onboarding.geos.length > 0) {
      filters.push(`Geos: ${onboarding.geos.join(', ')}`)
    }
    return filters
  }
}

const runtimeStore = new RuntimeStore()

export function getRuntimeStore(): RuntimeStore {
  return runtimeStore
}
