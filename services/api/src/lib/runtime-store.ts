import {
  type ApprovalItem,
  type ApprovalSample,
  type CampaignSummary,
  type ConnectionLaunch,
  type ConnectionState,
  type ConnectionStatus,
  type ConnectionTarget,
  type ContactPreview,
  type InstantlyWebhookEvent,
  type InstantlyWebhookSubscription,
  type IntegrationCheckResult,
  type LaunchChecklistItem,
  type LaunchReadiness,
  type LaunchResult,
  type MeetingPrepItem,
  type MetricCard,
  type OnboardingProfile,
  type PipelineMetric,
  type PipelineSnapshot,
  type ProspectRunSummary,
  type ReplyQueueItem,
  type WebhookReceipt,
  type WorkspaceSummary,
} from '@pipeiq/shared'

type ConnectionRecord = {
  connectionId: string
  sessionId: string
  toolkit: string
  status: ConnectionState
  externalUserId: string
  note: string
  connectedAccountId?: string
}

type WorkspaceState = {
  onboarding: OnboardingProfile
  prospectRun: ProspectRunSummary
  contacts: ContactPreview[]
  approvals: ApprovalItem[]
  campaign: CampaignSummary
  replies: ReplyQueueItem[]
  meetings: MeetingPrepItem[]
  webhook: InstantlyWebhookSubscription
  pipelineGenerated: boolean
  connections: Map<string, ConnectionRecord>
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
      mode: 'oauth',
      description: 'Lead search and enrichment through Composio.',
      status: 'not_connected',
      required_for_phase: 'Prospect agent',
      note: 'Connect through the Composio-hosted flow.',
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

    state.contacts = generated.map((item, index) => ({
      id: `contact_${workspaceId}_${index + 1}`,
      full_name: item.fullName,
      email: item.email,
      title: item.title,
      company: item.company,
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
    state.pipelineGenerated = false
    state.campaign = defaultCampaign(workspaceId)
    state.replies = []
    state.meetings = []
    state.prospectRun = {
      workspace_id: workspaceId,
      status: 'completed',
      mode: 'mock',
      sourced_count: generated.length,
      enriched_count: generated.length,
      deduped_count: generated.length,
      filters: this.prospectFilters(workspaceId),
      note: 'Apollo prospecting is scaffolded in this migration. Replace with live Composio tool execution next.',
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

  decideReply(workspaceId: string, replyId: string, decision: 'approved' | 'dismissed'): ReplyQueueItem {
    const state = this.ensure(workspaceId)
    const reply = state.replies.find((item) => item.id === replyId)
    if (!reply) {
      throw new Error(`Unknown reply id: ${replyId}`)
    }
    reply.status = decision === 'approved' ? 'sent' : 'dismissed'
    if (decision === 'approved' && reply.classification === 'INTERESTED') {
      state.meetings.push({
        id: `meeting_${reply.contact_id}`,
        workspace_id: workspaceId,
        contact_id: reply.contact_id,
        contact_name: reply.contact_name,
        company: reply.company,
        scheduled_for: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'booked',
        prep_brief: [
          `${reply.company} already replied positively to outbound.`,
          'Lead with the same pain pattern that triggered the conversation.',
          'Keep the meeting operational and anchored in pipeline outcomes.',
        ],
        owner_note: 'Generated from the reply workflow after positive intent.',
      })
      state.campaign.meetings_booked = state.meetings.length
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
      state.replies.push({
        id: event.email_id ?? `reply_${state.replies.length + 1}`,
        workspace_id: workspaceId,
        contact_id: contact?.id ?? `contact_unknown_${state.replies.length + 1}`,
        contact_name: contact?.full_name ?? email.split('@')[0] ?? 'Unknown contact',
        company: contact?.company ?? 'Unknown company',
        classification: event.event_type === 'lead_interested' ? 'INTERESTED' : 'OBJECTION',
        confidence: 0.91,
        summary: event.reply_text_snippet ?? event.reply_text ?? 'Instantly webhook reply received.',
        draft_reply:
          event.event_type === 'lead_interested'
            ? 'Thanks for the interest. I can send over two time options for next week.'
            : 'Fair question. PipeIQ sits on top of your existing stack and handles the operator layer.',
        status: 'pending',
        requires_human: true,
        received_at: event.timestamp ?? nowIso(),
      })
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
      mode: 'oauth',
      note,
    }
  }

  getConnectionByRequestId(connectionId: string): { workspaceId: string; toolkit: string } | null {
    return this.connections.get(connectionId) ?? null
  }

  saveApiKeyConnection(workspaceId: string, toolkit: string, label: string): ConnectionStatus {
    const state = this.ensure(workspaceId)
    state.connections.set(toolkit, {
      toolkit,
      connectionId: `api_key_${workspaceId}_${toolkit}`,
      sessionId: '',
      status: 'connected',
      externalUserId: workspaceId,
      note: `Stored encrypted API key for ${label}.`,
    })
    return {
      toolkit,
      connection_id: null,
      status: 'connected',
      mode: 'api_key',
      note: `Stored encrypted API key for ${label}.`,
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
      source: 'composio',
      summary:
        connectionStatus === 'connected'
          ? `${toolkit} connection is active through Composio.`
          : connectionStatus === 'pending'
            ? `${toolkit} connection is still pending.`
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
