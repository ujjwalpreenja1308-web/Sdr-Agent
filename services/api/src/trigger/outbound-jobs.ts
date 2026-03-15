import { logger, schedules, task, tasks, wait } from '@trigger.dev/sdk/v3'

import type {
  ContactPreview,
  EmailDraft,
  InstantlyWebhookEvent,
  ReplyQueueItem,
} from '@pipeiq/shared'

import { searchApolloProspects } from '../lib/apollo.js'
import { env } from '../lib/env.js'
import { addInstantlyLeadsBulk, getInstantlyCampaignSendingStatus } from '../lib/instantly.js'
import { getOpenAiClient } from '../lib/openai.js'
import { getRuntimeStore } from '../lib/runtime-store.js'

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

export const weeklyProspectRun = schedules.task({
  id: 'weekly-prospect-run',
  cron: {
    pattern: '0 6 * * 1',
    timezone: 'Asia/Calcutta',
  },
  run: async () => {
    const workspaceId = 'default'
    const orgId = 'dev-org'
    const store = getRuntimeStore()

    if (!connected(workspaceId, 'apollo')) {
      logger.warn('Weekly prospect run blocked because Apollo is not connected.', {
        workspaceId,
      })
      return {
        workspaceId,
        executed: false,
        summary: 'Apollo is not connected.',
      }
    }

    const prospects = await searchApolloProspects({
      workspaceId,
      orgId,
      onboarding: store.getOnboarding(workspaceId),
      limit: 500,
    })
    store.applyProspectSearch(
      workspaceId,
      prospects,
      'live',
      `Weekly scheduled Apollo run sourced ${prospects.length} prospects.`,
    )
    store.verifyProspects(workspaceId)

    const personalizationRun = await tasks.trigger<typeof personalizationRunTask>(
      'personalization-run',
      {
        workspaceId,
        orgId,
      },
    )

    return {
      workspaceId,
      executed: true,
      sourcedCount: prospects.length,
      personalizationRunId: personalizationRun.id,
    }
  },
})

export const personalizationRunTask = task({
  id: 'personalization-run',
  run: async (payload: PersonalizationPayload) => {
    const store = getRuntimeStore()
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
    const replyText =
      payload.event.reply_text ??
      payload.event.reply_text_snippet ??
      payload.event.email_text ??
      ''
    const classification = await classifyReply(replyText)
    const reply = toReplyQueueItem(payload.workspaceId, payload.event, classification)
    const store = getRuntimeStore()
    store.addProcessedReply(payload.workspaceId, reply, true)

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
  },
})

export const sendEmailBatchTask = task({
  id: 'send-email-batch',
  run: async (payload: SendEmailBatchPayload) => {
    const store = getRuntimeStore()
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

    return {
      workspaceId: payload.workspaceId,
      approvalId: approval.id,
      executed: true,
    }
  },
})
