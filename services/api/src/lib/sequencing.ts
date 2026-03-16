/**
 * sequencing.ts
 *
 * Self-owned multi-step email sequencing engine.
 *
 * Architecture:
 * - Sequences hold ordered steps (ice breaker → follow-ups → breakup)
 * - Contacts are enrolled; each enrollment tracks which step is next + when
 * - A periodic tick (cron) advances due enrollments: renders the template,
 *   picks an inbox from the SMTP pool, sends, logs, then schedules the next step
 * - Enrollments are automatically paused when a reply is detected
 *
 * Template variables supported in subject_template / body_template:
 *   {{firstName}}    contact.first_name
 *   {{lastName}}     contact.last_name
 *   {{fullName}}     first_name + last_name
 *   {{company}}      contact.company
 *   {{title}}        contact.title
 *   {{email}}        contact.email
 *   {{senderName}}   inbox.display_name or inbox.email
 *   {{senderEmail}}  inbox.email
 */

import { getSupabaseAdmin } from './supabase.js'
import { OutreachSmtpPool } from './smtp-pool.js'
import type {
  Sequence,
  SequenceStep,
  SequenceSummary,
  SequenceEnrollmentWithContact,
  SequenceStats,
  SequenceTickResult,
} from '@pipeiq/shared'

// ─── Template interpolation ───────────────────────────────────────────────────

type TemplateVars = Record<string, string>

export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

function buildVars(
  contact: {
    first_name: string | null
    last_name: string | null
    email: string | null
    company: string | null
    title: string | null
  },
  inbox: { email: string; display_name: string | null },
): TemplateVars {
  const firstName = contact.first_name ?? ''
  const lastName = contact.last_name ?? ''
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    company: contact.company ?? '',
    title: contact.title ?? '',
    email: contact.email ?? '',
    senderName: inbox.display_name ?? inbox.email,
    senderEmail: inbox.email,
  }
}

// ─── Default step templates ───────────────────────────────────────────────────

export const DEFAULT_STEP_TEMPLATES = {
  icebreaker: {
    subject: 'Quick question for {{firstName}} at {{company}}',
    body: `Hi {{firstName}},

I came across {{company}} and had a quick question — are you the right person to chat with about [your use case]?

We help [type of company] achieve [specific outcome] without [common pain point].

Worth a 15-minute call this week?

{{senderName}}`,
  },
  follow_up: {
    subject: 'Re: Quick question for {{firstName}} at {{company}}',
    body: `Hi {{firstName}},

Just wanted to bump this in case it got lost — did you get a chance to see my last note?

Happy to keep it brief. Would love to share how we've helped similar [title]s at companies like {{company}}.

{{senderName}}`,
  },
  breakup: {
    subject: 'Should I close this out?',
    body: `Hi {{firstName}},

I've reached out a couple of times without hearing back, so I'll assume the timing isn't right.

If anything changes and [your use case] becomes a priority, feel free to ping me — happy to pick this back up.

{{senderName}}`,
  },
}

// ─── Core tick ────────────────────────────────────────────────────────────────
// Finds all active enrollments that are due and sends their next step.

export async function runSequenceTick(workspaceId: string): Promise<SequenceTickResult> {
  const db = getSupabaseAdmin()
  const triggeredAt = new Date().toISOString()
  const errors: string[] = []
  let emailsSent = 0
  let enrollmentsCompleted = 0

  // Load due enrollments for this workspace
  const { data: enrollments, error: fetchErr } = await db
    .from('sequence_enrollments')
    .select(`
      id, sequence_id, contact_id, current_step, status,
      sequences:sequence_id (id, status),
      contacts:contact_id (first_name, last_name, email, company, title)
    `)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .or(`next_send_at.is.null,next_send_at.lte.${triggeredAt}`)

  if (fetchErr) {
    return { workspace_id: workspaceId, triggered_at: triggeredAt, emails_sent: 0, enrollments_completed: 0, errors: [fetchErr.message] }
  }
  if (!enrollments || enrollments.length === 0) {
    return { workspace_id: workspaceId, triggered_at: triggeredAt, emails_sent: 0, enrollments_completed: 0, errors: [] }
  }

  // Build SMTP pool once for this tick
  const pool = await OutreachSmtpPool.forWorkspace(workspaceId)

  for (const enrollment of enrollments) {
    const sequence = enrollment.sequences as unknown as { id: string; status: string } | null
    if (!sequence || sequence.status !== 'active') continue

    const contact = enrollment.contacts as unknown as {
      first_name: string | null
      last_name: string | null
      email: string | null
      company: string | null
      title: string | null
    } | null

    if (!contact || !contact.email) {
      errors.push(`Enrollment ${enrollment.id}: contact has no email`)
      continue
    }

    // Load the step at current_step
    const { data: step } = await db
      .from('sequence_steps')
      .select('*')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('position', enrollment.current_step)
      .single()

    if (!step) {
      // No more steps — mark completed
      await db
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', enrollment.id)
      enrollmentsCompleted++
      continue
    }

    // Pick the next inbox from the pool
    const pick = pool.next()
    if (!pick) {
      errors.push(`No inbox capacity — skipping ${contact.email}`)
      continue
    }

    const { inbox } = pick
    const vars = buildVars(contact, inbox)
    const subject = interpolate(step.subject_template, vars)
    const body = interpolate(step.body_template, vars)

    const sendResult = await pool.send(
      {
        to: `"${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}" <${contact.email}>`,
        subject,
        text: body,
        headers: { 'X-Sequence-Id': enrollment.sequence_id, 'X-Enrollment-Id': enrollment.id },
      },
      workspaceId,
    )

    // Log the send regardless of outcome
    await db.from('sequence_send_logs').insert({
      enrollment_id: enrollment.id,
      step_id: step.id,
      contact_id: enrollment.contact_id,
      inbox_id: inbox.id,
      workspace_id: workspaceId,
      message_id: sendResult.messageId ?? null,
      subject,
      from_email: sendResult.from,
      status: sendResult.ok ? 'sent' : 'failed',
      error: sendResult.ok ? null : (sendResult.error ?? null),
    })

    if (!sendResult.ok) {
      errors.push(`Send failed for ${contact.email}: ${sendResult.error}`)
      // Don't advance step — will retry on next tick
      continue
    }

    emailsSent++

    // Load the NEXT step to calculate next_send_at
    const { data: nextStep } = await db
      .from('sequence_steps')
      .select('position, delay_days')
      .eq('sequence_id', enrollment.sequence_id)
      .eq('position', enrollment.current_step + 1)
      .single()

    if (nextStep) {
      const nextSendAt = new Date(
        Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db
        .from('sequence_enrollments')
        .update({ current_step: enrollment.current_step + 1, next_send_at: nextSendAt })
        .eq('id', enrollment.id)
    } else {
      // This was the last step
      await db
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString(), next_send_at: null })
        .eq('id', enrollment.id)
      enrollmentsCompleted++
    }
  }

  pool.close()

  return {
    workspace_id: workspaceId,
    triggered_at: triggeredAt,
    emails_sent: emailsSent,
    enrollments_completed: enrollmentsCompleted,
    errors,
  }
}

// ─── Enroll contacts ──────────────────────────────────────────────────────────
// Adds contacts to a sequence. Already-enrolled contacts are skipped (upsert conflict).

export async function enrollContacts(
  sequenceId: string,
  contactIds: string[],
  workspaceId: string,
): Promise<{ enrolled: number; skipped: number }> {
  const db = getSupabaseAdmin()

  const rows = contactIds.map((contactId) => ({
    sequence_id: sequenceId,
    contact_id: contactId,
    workspace_id: workspaceId,
    status: 'active',
    current_step: 0,
    next_send_at: null,   // send on next tick (immediately)
  }))

  // Insert, ignore duplicates
  const { data, error } = await db
    .from('sequence_enrollments')
    .upsert(rows, { onConflict: 'sequence_id,contact_id', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(error.message)

  const enrolled = data?.length ?? 0
  return { enrolled, skipped: contactIds.length - enrolled }
}

// ─── Unenroll on reply ────────────────────────────────────────────────────────
// Called from the reply/webhook handlers when an inbound reply is received.

export async function unenrollOnReply(contactId: string, workspaceId: string): Promise<void> {
  const db = getSupabaseAdmin()
  await db
    .from('sequence_enrollments')
    .update({ status: 'replied', completed_at: new Date().toISOString(), next_send_at: null })
    .eq('contact_id', contactId)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
}

// ─── Sequence CRUD helpers ────────────────────────────────────────────────────

export async function getSequenceSummaries(workspaceId: string): Promise<SequenceSummary[]> {
  const db = getSupabaseAdmin()

  const { data: sequences } = await db
    .from('sequences')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (!sequences || sequences.length === 0) return []

  const summaries: SequenceSummary[] = []

  for (const seq of sequences as Sequence[]) {
    const { data: steps } = await db
      .from('sequence_steps')
      .select('id')
      .eq('sequence_id', seq.id)

    const stats = await getSequenceStats(seq.id)
    summaries.push({ ...seq, step_count: steps?.length ?? 0, stats })
  }

  return summaries
}

export async function getSequenceWithSteps(sequenceId: string, workspaceId: string) {
  const db = getSupabaseAdmin()

  const { data: seq } = await db
    .from('sequences')
    .select('*')
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!seq) return null

  const { data: steps } = await db
    .from('sequence_steps')
    .select('*')
    .eq('sequence_id', sequenceId)
    .order('position', { ascending: true })

  return { ...seq, steps: steps ?? [] }
}

export async function getSequenceStats(sequenceId: string): Promise<SequenceStats> {
  const db = getSupabaseAdmin()

  const { data: enrollments } = await db
    .from('sequence_enrollments')
    .select('status')
    .eq('sequence_id', sequenceId)

  const rows = enrollments ?? []
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length

  const { data: logs } = await db
    .from('sequence_send_logs')
    .select('status')
    .eq('sequence_id', sequenceId)
    .eq('status', 'sent')

  return {
    sequence_id: sequenceId,
    total_enrolled: rows.length,
    active: byStatus('active'),
    completed: byStatus('completed'),
    replied: byStatus('replied'),
    bounced: byStatus('bounced'),
    total_sent: logs?.length ?? 0,
    open_rate: 0,
  }
}

export async function getEnrollmentsForSequence(
  sequenceId: string,
  workspaceId: string,
): Promise<SequenceEnrollmentWithContact[]> {
  const db = getSupabaseAdmin()

  const { data } = await db
    .from('sequence_enrollments')
    .select(`
      id, sequence_id, contact_id, workspace_id, status, current_step,
      enrolled_at, next_send_at, completed_at,
      contacts:contact_id (first_name, last_name, email, company)
    `)
    .eq('sequence_id', sequenceId)
    .eq('workspace_id', workspaceId)
    .order('enrolled_at', { ascending: false })

  if (!data) return []

  return data.map((row) => {
    const c = row.contacts as unknown as {
      first_name: string | null
      last_name: string | null
      email: string | null
      company: string | null
    } | null

    return {
      id: row.id,
      sequence_id: row.sequence_id,
      contact_id: row.contact_id,
      workspace_id: row.workspace_id,
      status: row.status,
      current_step: row.current_step,
      enrolled_at: row.enrolled_at,
      next_send_at: row.next_send_at,
      completed_at: row.completed_at,
      contact_email: c?.email ?? '',
      contact_name: [c?.first_name, c?.last_name].filter(Boolean).join(' '),
      contact_company: c?.company ?? '',
    }
  })
}
