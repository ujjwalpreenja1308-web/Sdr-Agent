import { Hono } from 'hono'

import type { ReplyDecisionRequestExtended } from '@pipeiq/shared'

import { recordAdaptiveSignal } from '../lib/adaptive.js'
import { findGoogleCalendarFreeSlots } from '../lib/calendar.js'
import { sendGmailResponse } from '../lib/gmail.js'
import { logWorkspaceEvent } from '../lib/activity.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const repliesRoutes = new Hono<AppEnv>()

function hasConnection(
  connections: Array<{ toolkit: string; status: string }>,
  toolkit: string,
): boolean {
  return connections.some(
    (connection) => connection.toolkit === toolkit && connection.status === 'connected',
  )
}

function formatSlot(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

repliesRoutes.get('/api/replies/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.listReplies(workspaceId))
})

repliesRoutes.post('/api/replies/:replyId/decision', async (c) => {
  const replyId = c.req.param('replyId')
  const payload = await c.req.json<ReplyDecisionRequestExtended>()
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) {
    return c.json({ detail: 'workspace_id query parameter is required.' }, 400)
  }
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))

  try {
    const reply = store.listReplies(workspaceId).find((item) => item.id === replyId)
    if (!reply) {
      throw new Error(`Unknown reply id: ${replyId}`)
    }

    const workspace = store.getWorkspaceSummary(workspaceId)
    const contacts = store.listContacts(workspaceId)
    const contact = contacts.find((item) => item.id === reply.contact_id)
    const recipientEmail = reply.recipient_email ?? contact?.email ?? null
    const gmailConnected = hasConnection(workspace.connections, 'gmail')
    const calendarConnected = hasConnection(workspace.connections, 'googlecalendar')

    let decisionToApply = payload.decision
    let gmailSummary: string | null = null
    let slotCount = 0

    if (payload.decision === 'approved') {
      if (reply.classification === 'UNSUBSCRIBE') {
        decisionToApply = 'dismissed'
      } else if (reply.classification === 'OUT_OF_OFFICE' || reply.classification === 'NOT_NOW') {
        if (contact) {
          store.createReengagementDraft(
            workspaceId,
            contact.id,
            reply.classification === 'OUT_OF_OFFICE'
              ? `Following up after you are back`
              : `Revisiting this later`,
            reply.classification === 'OUT_OF_OFFICE'
              ? `Hope things are calmer once you are back. I will follow up then with a shorter note on how PipeIQ handles outbound operations.`
              : `Makes sense to revisit this later. I will circle back with a shorter note once timing is better.`,
          )
        }
        decisionToApply = 'dismissed'
      } else {
        if (!gmailConnected || !recipientEmail) {
          return c.json(
            {
              detail:
                'Gmail must be connected and the contact must have a recipient email before PipeIQ can send a live reply.',
            },
            400,
          )
        }

        let replyBody = reply.draft_reply
        if (reply.classification === 'INTERESTED') {
          const defaultScheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          if (calendarConnected) {
            const slots = await findGoogleCalendarFreeSlots({
              workspaceId,
              orgId: c.get('orgId'),
              timezone: 'UTC',
              daysAhead: 7,
            })
            const suggested = slots.slice(0, 3)
            slotCount = suggested.length
            if (suggested.length > 0) {
              replyBody = [
                reply.draft_reply,
                '',
                'Here are a few 30-minute options that work on my side (UTC):',
                ...suggested.map((slot) => `- ${formatSlot(slot.start)}`),
              ].join('\n')
              store.upsertMeetingHandoff(workspaceId, {
                id: `meeting_${reply.contact_id}`,
                workspace_id: workspaceId,
                contact_id: reply.contact_id,
                contact_name: reply.contact_name,
                company: reply.company,
                scheduled_for: suggested[0]?.start ?? defaultScheduledFor,
                status: 'prep_ready',
                calendar_event_id: null,
                prep_brief: suggested.map((slot) => `Suggested slot: ${formatSlot(slot.start)} UTC`),
                owner_note: 'Availability options were generated from the connected Google Calendar and shared in the reply.',
              })
            } else {
              store.upsertMeetingHandoff(workspaceId, {
                id: `meeting_${reply.contact_id}`,
                workspace_id: workspaceId,
                contact_id: reply.contact_id,
                contact_name: reply.contact_name,
                company: reply.company,
                scheduled_for: defaultScheduledFor,
                status: 'prep_ready',
                calendar_event_id: null,
                prep_brief: ['No free slots were returned by Google Calendar in the next 7 days.'],
                owner_note: 'Calendar is connected but no free slots were found automatically.',
              })
            }
          }
        }

        const gmailResult = await sendGmailResponse({
          workspaceId,
          orgId: c.get('orgId'),
          recipientEmail,
          body: replyBody,
          subject:
            reply.classification === 'INTERESTED'
              ? 'Scheduling next steps'
              : 'Quick follow-up from PipeIQ',
          threadId: reply.thread_id ?? null,
        })
        gmailSummary = gmailResult.summary
      }
    }

    const result = store.decideReply(workspaceId, replyId, decisionToApply)
    await store.persistWorkspace(workspaceId, c.get('orgId'))

    // Emit adaptive signal when a human corrects the AI's classification
    if (
      payload.corrected_classification &&
      payload.corrected_classification !== reply.classification
    ) {
      await recordAdaptiveSignal({
        workspaceId,
        signalType: 'reply_correction',
        originalValue: reply.classification,
        correctedValue: payload.corrected_classification,
        context: {
          reply_id: replyId,
          contact_name: reply.contact_name,
          company: reply.company,
          summary: reply.summary,
        },
      }).catch(() => {/* non-blocking */})
    }

    // Emit adaptive signal when an approval is rejected with a note
    if (decisionToApply === 'dismissed' && payload.rejection_note) {
      await recordAdaptiveSignal({
        workspaceId,
        signalType: 'approval_rejection',
        originalValue: reply.draft_reply ?? undefined,
        context: {
          reply_id: replyId,
          rejection_note: payload.rejection_note,
          classification: reply.classification,
        },
      }).catch(() => {/* non-blocking */})
    }

    await logWorkspaceEvent({
      workspaceId,
      action: 'reply.decided',
      entityType: 'reply',
      entityId: replyId,
      actorType: 'user',
      actorId: c.get('userId'),
      summary:
        gmailSummary ??
        `Marked reply ${decisionToApply}.`,
      metadata: {
        decision: decisionToApply,
        classification: result.classification,
        gmail_sent: Boolean(gmailSummary),
        slot_count: slotCount,
      },
    })
    return c.json(result)
  } catch (error) {
    return c.json({ detail: error instanceof Error ? error.message : 'Reply not found.' }, 404)
  }
})

repliesRoutes.get('/api/meetings/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.listMeetings(workspaceId))
})
