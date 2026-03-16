import { logger, schedules, task, tasks, wait } from '@trigger.dev/sdk/v3'

import type {
  ContactPreview,
  EmailDraft,
  InstantlyWebhookEvent,
  ReplyQueueItem,
} from '@pipeiq/shared'

import { searchApolloProspects } from '../lib/apollo.js'
import { createGoogleCalendarEvent } from '../lib/calendar.js'
import { logWorkspaceEvent } from '../lib/activity.js'
import { env } from '../lib/env.js'
import { beginExecution, executionKey, finishExecution } from '../lib/execution-runs.js'
import { addInstantlyLeadsBulk, getInstantlyCampaignSendingStatus } from '../lib/instantly.js'
import { getOpenAiClient } from '../lib/openai.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { findWorkspaceOrgId, listConnectedWorkspaceScopes } from '../lib/supabase.js'

type WorkspaceScopedPayload = {
  workspaceId: string
  orgId: string
}

type PersonalizationPayload = WorkspaceScopedPayload & {
  contactIds?: string[]
}

type ProcessInstantlyReplyPayload = {
  workspaceId: string
  event: InstantlyWebhookEvent
  executionRunId: string
  dedupeKey: string
}

type SendEmailBatchPayload = WorkspaceScopedPayload & {
  campaignId: string
}

type ReengageContactPayload = WorkspaceScopedPayload & {
  contactId: string
  scheduledFor: string
}

type DraftSequence = {
  subject_1: string
  subject_2: string
  subject_3: string
  subject_4: string
  body_1: string
  body_2: string
  body_3: string
  body_4: string
}

type ReplyClassification =
  | 'INTERESTED'
  | 'OBJECTION'
  | 'NOT_NOW'
  | 'REFERRAL'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE'

function connected(workspaceId: string, toolkit: string): boolean {
  return getRuntimeStore()
    .getWorkspaceSummary(workspaceId)
    .connections.some(
      (connection) => connection.toolkit === toolkit && connection.status === 'connected',
    )
}

function contactDraftId(contactId: string): string {
  return `draft_${contactId}`
}

function fallbackDraftSequence(contact: ContactPreview, productName: string): DraftSequence {
  const firstName = contact.full_name.split(' ')[0] ?? 'there'
  return {
    subject_1: `${productName} for ${contact.title}s at ${contact.company}`,
    subject_2: `${firstName}, quick idea for ${contact.company}`,
    subject_3: `A cleaner outbound loop for ${contact.company}`,
    subject_4: `Worth a quick look, ${firstName}?`,
    body_1: `Hi ${firstName}, I noticed ${contact.signal_detail}. ${productName} replaces the manual SDR operator layer so teams can source, personalize, launch, and handle replies without adding headcount.`,
    body_2: `Most teams we see hit the same wall: good leads, inconsistent follow-through. ${productName} keeps the outbound system moving from sourcing through meetings.`,
    body_3: `If ${contact.company} is still handling outbound manually, I can show how PipeIQ compresses prospecting, copy, and reply handling into one workflow.`,
    body_4: `Open to a short breakdown next week?`,
  }
}

function parseDraftSequence(content: string): DraftSequence | null {
  try {
    const parsed = JSON.parse(content) as Partial<DraftSequence>
    const values = [
      parsed.subject_1,
      parsed.subject_2,
      parsed.subject_3,
      parsed.subject_4,
      parsed.body_1,
      parsed.body_2,
      parsed.body_3,
      parsed.body_4,
    ]
    if (values.every((value) => typeof value === 'string' && value.trim().length > 0)) {
      return parsed as DraftSequence
    }
  } catch {
    return null
  }

  return null
}

async function generateDraftSequence(
  contact: ContactPreview,
  workspaceId: string,
): Promise<DraftSequence> {
  const store = getRuntimeStore()
  const onboarding = store.getOnboarding(workspaceId)
  const productName = onboarding.product_name || 'PipeIQ'

  if (!env.openAiApiKey) {
    return fallbackDraftSequence(contact, productName)
  }

  const openai = getOpenAiClient()
  const response = await openai.chat.completions.create({
    model: env.openAiModel,
    messages: [
      {
        role: 'system',
        content:
          'Write outbound email sequences as compact JSON only. Return keys subject_1, subject_2, subject_3, subject_4, body_1, body_2, body_3, body_4.',
      },
      {
        role: 'user',
        content: [
          `Product: ${productName}`,
          `Product description: ${onboarding.product_description || 'AI outbound operator layer'}`,
          `Target customer: ${onboarding.target_customer || 'B2B revenue team'}`,
          `Value proposition: ${onboarding.value_proposition || 'Replace manual SDR operations with an autonomous system.'}`,
          `Pain points: ${onboarding.pain_points || 'Manual outbound and slow reply handling.'}`,
          `CTA: ${onboarding.call_to_action || '15-minute walkthrough'}`,
          `Voice: ${onboarding.voice_guidelines || 'Direct, concise, credible.'}`,
          `Prospect: ${contact.full_name}, ${contact.title} at ${contact.company}`,
          `Signal: ${contact.signal_type} - ${contact.signal_detail}`,
          'Write 4 short outbound emails for this prospect. Keep each body under 110 words.',
        ].join('\n'),
      },
    ],
  })

  const content = response.choices[0]?.message?.content ?? ''
  return parseDraftSequence(content) ?? fallbackDraftSequence(contact, productName)
}

function classifyReplyHeuristically(text: string): ReplyClassification {
  const normalized = text.toLowerCase()
  if (normalized.includes('unsubscribe') || normalized.includes('remove me')) {
    return 'UNSUBSCRIBE'
  }
  if (normalized.includes('out of office') || normalized.includes('ooo')) {
    return 'OUT_OF_OFFICE'
  }
  if (normalized.includes('not now') || normalized.includes('later') || normalized.includes('next quarter')) {
    return 'NOT_NOW'
  }
  if (normalized.includes('forward') || normalized.includes('speak with') || normalized.includes('loop in')) {
    return 'REFERRAL'
  }
  if (normalized.includes('interested') || normalized.includes('sounds good') || normalized.includes('let’s chat') || normalized.includes("let's chat")) {
    return 'INTERESTED'
  }
  return 'OBJECTION'
}

async function classifyReply(text: string): Promise<ReplyClassification> {
  if (!env.openAiApiKey) {
    return classifyReplyHeuristically(text)
  }

  const openai = getOpenAiClient()
  const response = await openai.chat.completions.create({
    model: env.openAiModel,
    messages: [
      {
        role: 'system',
        content:
          'Classify the reply into exactly one label: INTERESTED, OBJECTION, NOT_NOW, REFERRAL, OUT_OF_OFFICE, UNSUBSCRIBE. Return only the label.',
      },
      {
        role: 'user',
        content: text,
      },
    ],
  })

  const classification = response.choices[0]?.message?.content?.trim().toUpperCase()
  const allowed: ReplyClassification[] = [
    'INTERESTED',
    'OBJECTION',
    'NOT_NOW',
    'REFERRAL',
    'OUT_OF_OFFICE',
    'UNSUBSCRIBE',
  ]

  return allowed.includes(classification as ReplyClassification)
    ? (classification as ReplyClassification)
    : classifyReplyHeuristically(text)
}

function replyDraft(classification: ReplyClassification, company: string): string {
  switch (classification) {
    case 'INTERESTED':
      return `Thanks for the interest. I can send two time options next week and keep the discussion focused on ${company}'s outbound pipeline.`
    case 'NOT_NOW':
      return 'Makes sense. I will circle back with a lighter touch at a better time.'
    case 'REFERRAL':
      return 'Appreciate it. Happy to continue with the right owner if you point me there.'
    case 'OUT_OF_OFFICE':
      return 'Thanks, I will follow up when you are back.'
    case 'UNSUBSCRIBE':
      return 'Acknowledged. You will not hear from us again.'
    default:
      return `Happy to clarify. PipeIQ sits on top of the existing stack and handles sourcing, personalization, replies, and meeting progression.`
  }
}

function toReplyQueueItem(
  workspaceId: string,
  event: InstantlyWebhookEvent,
  classification: ReplyClassification,
): ReplyQueueItem {
  const store = getRuntimeStore()
  const email = event.lead_email ?? 'unknown@example.com'
  const contact =
    store.listContacts(workspaceId).find((item) => item.email.toLowerCase() === email.toLowerCase()) ??
    null

  return {
    id: event.email_id ?? `reply_${Date.now()}`,
    workspace_id: workspaceId,
    contact_id: contact?.id ?? `contact_unknown_${Date.now()}`,
    recipient_email: contact?.email ?? email,
    thread_id:
      (typeof event.gmail_thread_id === 'string' && event.gmail_thread_id) ||
      (typeof event.thread_id === 'string' && event.thread_id) ||
      event.email_id ||
      null,
    contact_name: contact?.full_name ?? email.split('@')[0] ?? 'Unknown contact',
    company: contact?.company ?? 'Unknown company',
    classification,
    confidence: classification === 'OBJECTION' ? 0.82 : 0.91,
    summary: event.reply_text_snippet ?? event.reply_text ?? 'Instantly reply received.',
    draft_reply: replyDraft(classification, contact?.company ?? 'the team'),
    status: 'pending',
    requires_human: true,
    received_at: event.timestamp ?? new Date().toISOString(),
  }
}

function possibleMeetingStart(event: InstantlyWebhookEvent): string | null {
  const candidates = [
    event.scheduled_at,
    event.start_time,
    event.meeting_start,
    event.meeting_time,
    event.booked_at,
    event.calendar_start,
    event.timestamp,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue
    }
    const parsed = Date.parse(candidate)
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString()
    }
  }

  return null
}

export const weeklyProspectRun = schedules.task({
  id: 'weekly-prospect-run',
  cron: {
    pattern: '0 6 * * 1',
    timezone: 'Asia/Calcutta',
  },
  run: async () => {
    const scopes = await listConnectedWorkspaceScopes('apollo')
    const store = getRuntimeStore()
    const runs: Array<{ workspaceId: string; sourcedCount: number; personalizationRunId: string }> = []

    for (const scope of scopes) {
      await store.hydrateWorkspace(scope.workspaceId, scope.orgId)
      if (!connected(scope.workspaceId, 'apollo')) {
        continue
      }

      const prospects = await searchApolloProspects({
        workspaceId: scope.workspaceId,
        orgId: scope.orgId,
        onboarding: store.getOnboarding(scope.workspaceId),
        limit: 500,
      })
      store.applyProspectSearch(
        scope.workspaceId,
        prospects,
        'live',
        `Weekly scheduled Apollo run sourced ${prospects.length} prospects.`,
      )
      store.verifyProspects(scope.workspaceId)
      await store.persistWorkspace(scope.workspaceId, scope.orgId)
      await logWorkspaceEvent({
        workspaceId: scope.workspaceId,
        action: 'job.weekly_prospect_run.completed',
        entityType: 'job',
        entityId: 'weekly-prospect-run',
        actorType: 'agent',
        actorId: 'prospector',
        summary: `Weekly prospect run sourced ${prospects.length} prospects.`,
        metadata: {
          sourced_count: prospects.length,
        },
      })

      const personalizationRun = await tasks.trigger<typeof personalizationRunTask>(
        'personalization-run',
        {
          workspaceId: scope.workspaceId,
          orgId: scope.orgId,
        },
      )

      runs.push({
        workspaceId: scope.workspaceId,
        sourcedCount: prospects.length,
        personalizationRunId: personalizationRun.id,
      })
    }

    logger.info('Weekly prospect run completed', {
      workspaceCount: runs.length,
    })

    return {
      executed: true,
      workspaceCount: runs.length,
      runs,
    }
  },
})

export const personalizationRunTask = task({
  id: 'personalization-run',
  run: async (payload: PersonalizationPayload) => {
    const store = getRuntimeStore()
    await store.hydrateWorkspace(payload.workspaceId, payload.orgId)
    const contacts = store
      .listContacts(payload.workspaceId)
      .filter((contact) =>
        payload.contactIds ? payload.contactIds.includes(contact.id) : true,
      )

    const drafts: EmailDraft[] = []
    for (const contact of contacts) {
      const sequence = await generateDraftSequence(contact, payload.workspaceId)
      drafts.push({
        id: contactDraftId(contact.id),
        contact_id: contact.id,
        workspace_id: payload.workspaceId,
        subject_1: sequence.subject_1,
        subject_2: sequence.subject_2,
        subject_3: sequence.subject_3,
        subject_4: sequence.subject_4,
        body_1: sequence.body_1,
        body_2: sequence.body_2,
        body_3: sequence.body_3,
        body_4: sequence.body_4,
        personalization_signal: contact.signal_detail,
        quality_score: contact.quality_score,
        approved_at: null,
        instantly_lead_id: null,
        created_at: new Date().toISOString(),
      })
    }

    store.saveEmailDrafts(payload.workspaceId, drafts)
    await store.persistWorkspace(payload.workspaceId, payload.orgId)
    await logWorkspaceEvent({
      workspaceId: payload.workspaceId,
      action: 'job.personalization_run.completed',
      entityType: 'job',
      entityId: 'personalization-run',
      actorType: 'agent',
      actorId: 'copywriter',
      summary: `Generated ${drafts.length} personalized email sequences.`,
      metadata: {
        draft_count: drafts.length,
      },
    })
    logger.info('Saved personalization drafts', {
      workspaceId: payload.workspaceId,
      draftCount: drafts.length,
    })

    return {
      workspaceId: payload.workspaceId,
      draftCount: drafts.length,
      executed: true,
    }
  },
})

export const processInstantlyReplyTask = task({
  id: 'process-instantly-reply',
  run: async (payload: ProcessInstantlyReplyPayload) => {
    if (payload.event.event_type === 'lead_meeting_booked') {
      const store = getRuntimeStore()
      const orgId = await findWorkspaceOrgId(payload.workspaceId)
      if (!orgId) {
        throw new Error(`Could not resolve org for workspace ${payload.workspaceId}.`)
      }
      await store.hydrateWorkspace(payload.workspaceId, orgId)
      const email = payload.event.lead_email ?? 'unknown@example.com'
      const contact =
        store.listContacts(payload.workspaceId).find(
          (item) => item.email.toLowerCase() === email.toLowerCase(),
        ) ?? null
      const scheduledFor =
        possibleMeetingStart(payload.event) ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      let calendarEventId: string | null = null
      const calendarConnected = connected(payload.workspaceId, 'googlecalendar')
      if (calendarConnected && contact?.email) {
        try {
          const end = new Date(new Date(scheduledFor).getTime() + 30 * 60 * 1000).toISOString()
          const calendarEvent = await createGoogleCalendarEvent({
            workspaceId: payload.workspaceId,
            orgId,
            summary: `PipeIQ intro with ${contact.full_name}`,
            description: 'Booked from the outbound reply workflow.',
            attendeeEmail: contact.email,
            startDatetime: scheduledFor,
            endDatetime: end,
            timezone: 'UTC',
          })
          calendarEventId = calendarEvent.id
        } catch (error) {
          logger.warn('Google Calendar event creation failed for booked meeting.', {
            workspaceId: payload.workspaceId,
            error: error instanceof Error ? error.message : 'unknown',
          })
        }
      }

      const meeting = store.upsertMeetingHandoff(payload.workspaceId, {
        id: `meeting_${contact?.id ?? payload.event.email_id ?? Date.now()}`,
        workspace_id: payload.workspaceId,
        contact_id: contact?.id ?? `contact_unknown_${Date.now()}`,
        contact_name: contact?.full_name ?? email.split('@')[0] ?? 'Unknown contact',
        company: contact?.company ?? 'Unknown company',
        scheduled_for: scheduledFor,
        status: 'booked',
        calendar_event_id: calendarEventId,
        prep_brief: [
          'Meeting was marked as booked from the outbound workflow.',
          'Review previous reply context before the call.',
        ],
        owner_note: calendarEventId
          ? 'Google Calendar event was created for this booked meeting.'
          : 'Meeting was booked, but no Google Calendar event id was created.',
      })
      await store.persistWorkspace(payload.workspaceId, orgId)
      await finishExecution({
        workspaceId: payload.workspaceId,
        scope: 'webhook.instantly.process',
        runId: payload.executionRunId,
        executionKey: payload.dedupeKey,
        actorType: 'system',
        status: 'completed',
        summary: 'Processed a booked-meeting webhook event.',
        metadata: {
          meeting_id: meeting.id,
          calendar_event_id: calendarEventId,
        },
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'job.process_instantly_reply.meeting_booked',
        entityType: 'meeting',
        entityId: meeting.id,
        actorType: 'agent',
        actorId: 'meetings',
        summary: 'Converted the booked-meeting webhook into a meeting record.',
        metadata: {
          calendar_event_id: calendarEventId,
        },
      })
      return {
        workspaceId: payload.workspaceId,
        meetingId: meeting.id,
        executed: true,
      }
    }

    try {
      const replyText =
        payload.event.reply_text ??
        payload.event.reply_text_snippet ??
        payload.event.email_text ??
        ''
      const classification = await classifyReply(replyText)
      const reply = toReplyQueueItem(payload.workspaceId, payload.event, classification)
      const store = getRuntimeStore()
      const orgId = await findWorkspaceOrgId(payload.workspaceId)
      if (!orgId) {
        throw new Error(`Could not resolve org for workspace ${payload.workspaceId}.`)
      }
      await store.hydrateWorkspace(payload.workspaceId, orgId)
      store.addProcessedReply(payload.workspaceId, reply, true)
      await store.persistWorkspace(payload.workspaceId, orgId)
      await finishExecution({
        workspaceId: payload.workspaceId,
        scope: 'webhook.instantly.process',
        runId: payload.executionRunId,
        executionKey: payload.dedupeKey,
        actorType: 'system',
        status: 'completed',
        summary: `Processed Instantly reply classified as ${classification}.`,
        metadata: {
          classification,
        },
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'job.process_instantly_reply.completed',
        entityType: 'reply',
        entityId: reply.id,
        actorType: 'agent',
        actorId: 'reply',
        summary: `Processed an Instantly reply classified as ${classification}.`,
        metadata: {
          classification,
        },
      })

      logger.info('Processed Instantly reply', {
        workspaceId: payload.workspaceId,
        replyId: reply.id,
        classification,
      })

      return {
        workspaceId: payload.workspaceId,
        replyId: reply.id,
        classification,
        executed: true,
      }
    } catch (error) {
      await finishExecution({
        workspaceId: payload.workspaceId,
        scope: 'webhook.instantly.process',
        runId: payload.executionRunId,
        executionKey: payload.dedupeKey,
        actorType: 'system',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Instantly reply processing failed.',
        metadata: {},
      })
      throw error
    }
  },
})

export const sendEmailBatchTask = task({
  id: 'send-email-batch',
  run: async (payload: SendEmailBatchPayload) => {
    const store = getRuntimeStore()
    await store.hydrateWorkspace(payload.workspaceId, payload.orgId)
    const leads = store
      .getPipeline(payload.workspaceId)
      .contacts.filter((contact) => contact.status === 'approved_to_launch')
      .map((contact) => {
        const [firstName = '', ...rest] = contact.full_name.split(' ')
        return {
          email: contact.email,
          firstName,
          lastName: rest.join(' '),
          companyName: contact.company,
          personalization: contact.signal_detail,
        }
      })

    if (leads.length === 0) {
      return {
        workspaceId: payload.workspaceId,
        executed: false,
        summary: 'No approved contacts are ready for launch.',
      }
    }

    const runKey = executionKey([
      payload.campaignId,
      leads.map((lead) => lead.email),
    ])
    const execution = await beginExecution({
      workspaceId: payload.workspaceId,
      scope: 'launch.send_batch',
      executionKey: runKey,
      actorType: 'agent',
      actorId: 'launcher',
      summary: `Starting Instantly lead import for campaign ${payload.campaignId}.`,
      dedupeWindowMs: 60 * 60 * 1000,
    })
    if (execution.kind !== 'started') {
      const current = store.currentLaunchResult(
        payload.workspaceId,
        'Skipped duplicate Instantly lead import for the same campaign and approved batch.',
      )
      return {
        workspaceId: payload.workspaceId,
        executed: false,
        contactsLaunched: current.contacts_launched,
        diagnostics: current.message,
      }
    }

    try {
      const importResult = await addInstantlyLeadsBulk({
        workspaceId: payload.workspaceId,
        orgId: payload.orgId,
        campaignId: payload.campaignId,
        leads,
      })
      const diagnostics = await getInstantlyCampaignSendingStatus({
        workspaceId: payload.workspaceId,
        orgId: payload.orgId,
        campaignId: payload.campaignId,
      })
      const launchResult = store.recordInstantlyLaunch(
        payload.workspaceId,
        payload.campaignId,
        importResult.importedCount,
        importResult.summary,
      )
      await store.persistWorkspace(payload.workspaceId, payload.orgId)
      await finishExecution({
        workspaceId: payload.workspaceId,
        scope: 'launch.send_batch',
        runId: execution.runId,
        executionKey: runKey,
        actorType: 'agent',
        actorId: 'launcher',
        status: 'completed',
        summary: importResult.summary,
        metadata: {
          contacts_launched: launchResult.contacts_launched,
          campaign_id: payload.campaignId,
        },
      })
      await logWorkspaceEvent({
        workspaceId: payload.workspaceId,
        action: 'job.send_email_batch.completed',
        entityType: 'campaign',
        entityId: payload.campaignId,
        actorType: 'agent',
        actorId: 'launcher',
        summary: importResult.summary,
        metadata: {
          contacts_launched: launchResult.contacts_launched,
          diagnostics: diagnostics.summary,
        },
      })

      const waitpoint = await wait.createToken({
        idempotencyKey: `campaign-monitor-${payload.workspaceId}-${payload.campaignId}`,
        timeout: '7d',
        tags: [`workspace:${payload.workspaceId}`, `campaign:${payload.campaignId}`],
      })

      return {
        workspaceId: payload.workspaceId,
        executed: true,
        contactsLaunched: launchResult.contacts_launched,
        diagnostics: diagnostics.summary,
        waitpointId: waitpoint.id,
        waitpointUrl: waitpoint.url,
      }
    } catch (error) {
      await finishExecution({
        workspaceId: payload.workspaceId,
        scope: 'launch.send_batch',
        runId: execution.runId,
        executionKey: runKey,
        actorType: 'agent',
        actorId: 'launcher',
        status: 'failed',
        summary: error instanceof Error ? error.message : 'Instantly lead import failed.',
        metadata: {
          campaign_id: payload.campaignId,
        },
      })
      throw error
    }
  },
})

export const reengageContactTask = task({
  id: 're-engage-contact',
  run: async (payload: ReengageContactPayload) => {
    await wait.until({
      date: new Date(payload.scheduledFor),
      throwIfInThePast: false,
      idempotencyKey: `reengage-${payload.workspaceId}-${payload.contactId}-${payload.scheduledFor}`,
    })

    const store = getRuntimeStore()
    await store.hydrateWorkspace(payload.workspaceId, payload.orgId)
    const contact = store
      .listContacts(payload.workspaceId)
      .find((item) => item.id === payload.contactId)

    if (!contact) {
      throw new Error(`Unknown contact id: ${payload.contactId}`)
    }

    const firstName = contact.full_name.split(' ')[0] ?? 'there'
    const subject = `Revisiting this, ${firstName}`
    const body = `Hi ${firstName}, circling back because teams like ${contact.company} usually revisit outbound ops once timing shifts. If this is more relevant now, I can share a short breakdown.`
    const approval = store.createReengagementDraft(
      payload.workspaceId,
      payload.contactId,
      subject,
      body,
    )
    await store.persistWorkspace(payload.workspaceId, payload.orgId)
    await logWorkspaceEvent({
      workspaceId: payload.workspaceId,
      action: 'job.reengage_contact.completed',
      entityType: 'approval_queue',
      entityId: approval.id,
      actorType: 'agent',
      actorId: 'reply',
      summary: 'Created a re-engagement draft for a deferred contact.',
      metadata: {
        contact_id: payload.contactId,
      },
    })

    return {
      workspaceId: payload.workspaceId,
      approvalId: approval.id,
      executed: true,
    }
  },
})
