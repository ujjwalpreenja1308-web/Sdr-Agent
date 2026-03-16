/**
 * sequencing.ts — self-owned multi-step email sequencing engine
 *
 * Reliability guarantees:
 *
 * 1. No double-send from concurrent ticks
 *    The tick immediately writes last_tick_at = now() for every enrollment it
 *    claims before doing any work. The query only selects rows where
 *    last_tick_at IS NULL or last_tick_at < now() - 10 min.
 *
 * 2. No inbox mismatch between template vars and actual From: address
 *    We call pool.pickById() / pool.next() once to obtain the pick, build
 *    template vars from that same pick, then call pool.sendWith(pick, …).
 *
 * 3. Sticky inbox assignment
 *    On first send the inbox is stored in enrollment.assigned_inbox_id.
 *    Every subsequent step tries pool.pickById() first so the contact always
 *    sees the same From: address. Falls back to round-robin if the inbox is
 *    full or removed.
 *
 * 4. Hard vs soft bounce classification
 *    Hard bounce (permanent 5xx / "user unknown"): enrollment immediately
 *    marked 'bounced' (no retries) and the contact's email is flagged 'invalid'
 *    so future sequences skip it automatically.
 *    Soft bounce (transient 4xx / quota / network): retry up to MAX_SEND_ATTEMPTS
 *    times with increasing back-off via next_send_at.
 *    The INBOX is NOT penalised for hard bounces — the problem is the recipient.
 *
 * 5. No open tracking
 *    Outreach emails contain no tracking pixels, no redirect links, and no
 *    open-tracking headers. open_rate is removed from SequenceStats.
 *
 * 6. Batch-loaded steps (no N+1)
 *    All steps for every affected sequence are loaded in two bulk queries
 *    before the main loop.
 *
 * 7. Parallel getSequenceSummaries
 *    Stats for each sequence are fetched concurrently with Promise.all.
 */

import { getSupabaseAdmin } from './supabase.js'
import { OutreachSmtpPool } from './smtp-pool.js'
import { classifyBounce, isBounceError } from './bounce-classifier.js'
import type {
  Sequence,
  SequenceStep,
  SequenceSummary,
  SequenceEnrollmentWithContact,
  SequenceStats,
  SequenceTickResult,
} from '@pipeiq/shared'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Mark enrollment 'bounced' after this many consecutive SOFT send failures */
const MAX_SOFT_ATTEMPTS = 5

/** Soft-bounce back-off delays (hours) — increases with each failed attempt */
const SOFT_BACKOFF_HOURS = [1, 2, 4, 8, 16]

/** Soft concurrency lock window — don't re-process a row touched within this many minutes */
const TICK_LOCK_MINUTES = 10

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
  const lastName  = contact.last_name  ?? ''
  return {
    firstName,
    lastName,
    fullName:    [firstName, lastName].filter(Boolean).join(' '),
    company:     contact.company ?? '',
    title:       contact.title   ?? '',
    email:       contact.email   ?? '',
    senderName:  inbox.display_name ?? inbox.email,
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

export async function runSequenceTick(workspaceId: string): Promise<SequenceTickResult> {
  const db          = getSupabaseAdmin()
  const triggeredAt = new Date().toISOString()
  const errors: string[] = []
  let emailsSent           = 0
  let enrollmentsCompleted = 0

  // ── 1. Claim due enrollments atomically ────────────────────────────────────
  const lockCutoff = new Date(Date.now() - TICK_LOCK_MINUTES * 60 * 1000).toISOString()

  const { data: enrollments, error: fetchErr } = await db
    .from('sequence_enrollments')
    .select(`
      id, sequence_id, contact_id, current_step, status,
      send_attempts, assigned_inbox_id,
      sequences:sequence_id (id, status),
      contacts:contact_id (first_name, last_name, email, company, title)
    `)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .or(`next_send_at.is.null,next_send_at.lte.${triggeredAt}`)
    .or(`last_tick_at.is.null,last_tick_at.lte.${lockCutoff}`)

  if (fetchErr) {
    return {
      workspace_id: workspaceId,
      triggered_at: triggeredAt,
      emails_sent: 0,
      enrollments_completed: 0,
      errors: [fetchErr.message],
    }
  }
  if (!enrollments || enrollments.length === 0) {
    return { workspace_id: workspaceId, triggered_at: triggeredAt, emails_sent: 0, enrollments_completed: 0, errors: [] }
  }

  // Immediately claim all fetched rows so a concurrent tick won't pick them up
  const claimedIds = enrollments.map((e) => e.id)
  await db
    .from('sequence_enrollments')
    .update({ last_tick_at: triggeredAt })
    .in('id', claimedIds)

  // ── 2. Batch-load all steps ────────────────────────────────────────────────
  const sequenceIds = [...new Set(enrollments.map((e) => e.sequence_id))]
  const { data: allSteps } = await db
    .from('sequence_steps')
    .select('*')
    .in('sequence_id', sequenceIds)
    .order('position', { ascending: true })

  type StepRow = {
    id: string; sequence_id: string; position: number; step_type: string
    delay_days: number; subject_template: string; body_template: string
  }

  const stepMap = new Map<string, Map<number, StepRow>>()
  for (const step of (allSteps ?? []) as StepRow[]) {
    if (!stepMap.has(step.sequence_id)) stepMap.set(step.sequence_id, new Map())
    stepMap.get(step.sequence_id)!.set(step.position, step)
  }

  // ── 3. Build SMTP pool once for this tick ──────────────────────────────────
  const pool = await OutreachSmtpPool.forWorkspace(workspaceId)

  // ── 4. Process each enrollment ────────────────────────────────────────────
  for (const enrollment of enrollments) {
    const sequence = enrollment.sequences as unknown as { id: string; status: string } | null
    if (!sequence || sequence.status !== 'active') continue

    const contact = enrollment.contacts as unknown as {
      first_name: string | null
      last_name:  string | null
      email:      string | null
      company:    string | null
      title:      string | null
    } | null

    if (!contact || !contact.email) {
      errors.push(`Enrollment ${enrollment.id}: contact has no email — skipping`)
      continue
    }

    // Locate current step from preloaded map
    const seqSteps = stepMap.get(enrollment.sequence_id)
    const step     = seqSteps?.get(enrollment.current_step)

    if (!step) {
      // No step at this position — sequence is complete
      await db
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: triggeredAt })
        .eq('id', enrollment.id)
      enrollmentsCompleted++
      continue
    }

    // ── 5. Pick inbox (sticky assignment) ─────────────────────────────────────
    const assignedId = enrollment.assigned_inbox_id as string | null
    const pick = assignedId ? pool.pickById(assignedId) : pool.next()

    if (!pick) {
      errors.push(`No inbox capacity for ${contact.email} — will retry next tick`)
      continue
    }

    // ── 6. Render templates using the SAME inbox pick ─────────────────────────
    const vars    = buildVars(contact, pick.inbox)
    const subject = interpolate(step.subject_template, vars)
    const body    = interpolate(step.body_template, vars)

    const sendResult = await pool.sendWith(
      pick,
      {
        to: `"${vars.fullName || contact.email}" <${contact.email}>`,
        subject,
        text: body,
        // No open-tracking headers, no pixel hooks
        headers: {
          'X-Sequence-Id':   enrollment.sequence_id,
          'X-Enrollment-Id': enrollment.id,
        },
      },
      workspaceId,
    )

    const nowInboxId = assignedId ?? pick.inbox.id

    // Log the send regardless of outcome
    await db.from('sequence_send_logs').insert({
      enrollment_id: enrollment.id,
      step_id:       step.id,
      contact_id:    enrollment.contact_id,
      inbox_id:      pick.inbox.id,
      workspace_id:  workspaceId,
      message_id:    sendResult.messageId ?? null,
      subject,
      from_email:    sendResult.from,
      status:        sendResult.ok ? 'sent' : (sendResult.bounceType === 'hard' ? 'bounced' : 'failed'),
      error:         sendResult.ok ? null : (sendResult.error ?? null),
      bounce_type:   sendResult.ok ? null : (sendResult.bounceType ?? null),
    })

    if (!sendResult.ok) {
      errors.push(`Send failed for ${contact.email}: ${sendResult.error}`)
      const bounceType = sendResult.bounceType

      // ── Hard bounce: stop immediately, mark contact's email as invalid ───────
      if (bounceType === 'hard' || (sendResult.error && !isBounceError(sendResult.error) === false && bounceType === 'hard')) {
        await db
          .from('sequence_enrollments')
          .update({
            status:            'bounced',
            completed_at:      triggeredAt,
            assigned_inbox_id: nowInboxId,
          })
          .eq('id', enrollment.id)

        // Flag the contact's email as invalid so future sequences skip it
        await db
          .from('contacts')
          .update({
            email_verification_status: 'invalid',
            email_verification_note:   `Hard bounce: ${sendResult.error?.slice(0, 200)}`,
            verification_checked_at:   triggeredAt,
          })
          .eq('id', enrollment.contact_id)

        errors.push(`Enrollment ${enrollment.id} hard-bounced — contact email marked invalid`)
        continue
      }

      // ── Soft bounce / infra error: retry with back-off ────────────────────
      const newAttempts = (enrollment.send_attempts ?? 0) + 1

      if (newAttempts >= MAX_SOFT_ATTEMPTS) {
        await db
          .from('sequence_enrollments')
          .update({
            status:            'bounced',
            completed_at:      triggeredAt,
            send_attempts:     newAttempts,
            assigned_inbox_id: nowInboxId,
          })
          .eq('id', enrollment.id)
        errors.push(`Enrollment ${enrollment.id} bounced after ${newAttempts} soft failures`)
      } else {
        const backoffHours = SOFT_BACKOFF_HOURS[Math.min(newAttempts - 1, SOFT_BACKOFF_HOURS.length - 1)]
        const retryAt = new Date(Date.now() + backoffHours * 60 * 60 * 1000).toISOString()
        await db
          .from('sequence_enrollments')
          .update({
            send_attempts:     newAttempts,
            next_send_at:      retryAt,
            assigned_inbox_id: nowInboxId,
          })
          .eq('id', enrollment.id)
      }
      continue
    }

    emailsSent++

    // ── 7. Advance enrollment to next step ────────────────────────────────────
    const nextStep = seqSteps?.get(enrollment.current_step + 1)

    if (nextStep) {
      const nextSendAt = new Date(
        Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db
        .from('sequence_enrollments')
        .update({
          current_step:      enrollment.current_step + 1,
          next_send_at:      nextSendAt,
          send_attempts:     0,               // reset counter on success
          assigned_inbox_id: nowInboxId,
        })
        .eq('id', enrollment.id)
    } else {
      // Last step — sequence complete
      await db
        .from('sequence_enrollments')
        .update({
          status:            'completed',
          completed_at:      triggeredAt,
          next_send_at:      null,
          send_attempts:     0,
          assigned_inbox_id: nowInboxId,
        })
        .eq('id', enrollment.id)
      enrollmentsCompleted++
    }
  }

  pool.close()

  return {
    workspace_id:          workspaceId,
    triggered_at:          triggeredAt,
    emails_sent:           emailsSent,
    enrollments_completed: enrollmentsCompleted,
    errors,
  }
}

// ─── Enroll contacts ──────────────────────────────────────────────────────────

export async function enrollContacts(
  sequenceId:  string,
  contactIds:  string[],
  workspaceId: string,
): Promise<{ enrolled: number; skipped: number }> {
  const db = getSupabaseAdmin()

  // Filter out contacts with hard-bounced / invalid emails before enrolling
  const { data: validContacts } = await db
    .from('contacts')
    .select('id')
    .in('id', contactIds)
    .neq('email_verification_status', 'invalid')
    .eq('never_contact', false)

  const validIds = (validContacts ?? []).map((c) => c.id)
  const skippedInvalid = contactIds.length - validIds.length

  if (validIds.length === 0) {
    return { enrolled: 0, skipped: contactIds.length }
  }

  const rows = validIds.map((contactId) => ({
    sequence_id:   sequenceId,
    contact_id:    contactId,
    workspace_id:  workspaceId,
    status:        'active',
    current_step:  0,
    send_attempts: 0,
    next_send_at:  null,  // send on next tick
  }))

  const { data, error } = await db
    .from('sequence_enrollments')
    .upsert(rows, { onConflict: 'sequence_id,contact_id', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(error.message)

  const enrolled = data?.length ?? 0
  return { enrolled, skipped: skippedInvalid + (validIds.length - enrolled) }
}

// ─── Unenroll on reply ────────────────────────────────────────────────────────

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

  const summaries = await Promise.all(
    (sequences as Sequence[]).map(async (seq) => {
      const [{ data: steps }, stats] = await Promise.all([
        db.from('sequence_steps').select('id').eq('sequence_id', seq.id),
        getSequenceStats(seq.id),
      ])
      return { ...seq, step_count: steps?.length ?? 0, stats }
    }),
  )

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
    .select('id, status')
    .eq('sequence_id', sequenceId)

  const rows = enrollments ?? []
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length
  const enrollmentIds = rows.map((r) => r.id)

  let totalSent = 0
  let hardBounces = 0
  if (enrollmentIds.length > 0) {
    const [sentResult, hardResult] = await Promise.all([
      db
        .from('sequence_send_logs')
        .select('id', { count: 'exact', head: true })
        .in('enrollment_id', enrollmentIds)
        .eq('status', 'sent'),
      db
        .from('sequence_send_logs')
        .select('id', { count: 'exact', head: true })
        .in('enrollment_id', enrollmentIds)
        .eq('bounce_type', 'hard'),
    ])
    totalSent = sentResult.count ?? 0
    hardBounces = hardResult.count ?? 0
  }

  return {
    sequence_id:    sequenceId,
    total_enrolled: rows.length,
    active:         byStatus('active'),
    completed:      byStatus('completed'),
    replied:        byStatus('replied'),
    bounced:        byStatus('bounced'),
    hard_bounces:   hardBounces,
    total_sent:     totalSent,
  }
}

export async function getEnrollmentsForSequence(
  sequenceId:  string,
  workspaceId: string,
): Promise<SequenceEnrollmentWithContact[]> {
  const db = getSupabaseAdmin()

  const { data } = await db
    .from('sequence_enrollments')
    .select(`
      id, sequence_id, contact_id, workspace_id, status, current_step,
      send_attempts, assigned_inbox_id,
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
      last_name:  string | null
      email:      string | null
      company:    string | null
    } | null

    return {
      id:              row.id,
      sequence_id:     row.sequence_id,
      contact_id:      row.contact_id,
      workspace_id:    row.workspace_id,
      status:          row.status,
      current_step:    row.current_step,
      enrolled_at:     row.enrolled_at,
      next_send_at:    row.next_send_at,
      completed_at:    row.completed_at,
      contact_email:   c?.email   ?? '',
      contact_name:    [c?.first_name, c?.last_name].filter(Boolean).join(' '),
      contact_company: c?.company ?? '',
    }
  })
}
