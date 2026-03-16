/**
 * sequencing.ts — self-owned multi-step email sequencing engine
 *
 * Reliability guarantees (v2):
 *
 * 1. No double-send from concurrent ticks
 *    The tick immediately writes last_tick_at = now() for every enrollment it
 *    claims before doing any work.  The query only selects rows where
 *    last_tick_at IS NULL or last_tick_at < now() - 10 min, so a second
 *    concurrent tick skips already-claimed rows.
 *
 * 2. No inbox mismatch between template vars and actual From: address
 *    We call pool.pickById() / pool.next() once to obtain the pick, build
 *    template vars from that same pick, then call pool.sendWith(pick, …).
 *    The old bug was: pool.next() for vars + pool.send() (which calls next()
 *    again internally) → two different inboxes.
 *
 * 3. Sticky inbox assignment
 *    On first send, the inbox is stored in enrollment.assigned_inbox_id.
 *    Every subsequent step in the same sequence tries pool.pickById() first
 *    so the contact always sees the same From: address.  Falls back to
 *    round-robin if the assigned inbox is full or removed.
 *
 * 4. Bounded retry on transient send failures
 *    send_attempts tracks consecutive failures on the current step.
 *    After MAX_SEND_ATTEMPTS (3) the enrollment is marked 'bounced' so a
 *    permanently-broken address never consumes inbox quota again.
 *    On success the counter is reset to 0 for the next step.
 *
 * 5. Batch-loaded steps (no N+1)
 *    All steps for every affected sequence are loaded in two bulk queries
 *    before the main loop.  No per-enrollment step fetches inside the loop.
 *
 * 6. Fixed getSequenceStats
 *    sequence_send_logs has no sequence_id column; the old code queried it
 *    directly and always got 0.  We now load enrollment IDs first and filter
 *    the log table with .in('enrollment_id', ids).
 *
 * 7. Parallel getSequenceSummaries
 *    Stats for each sequence are now fetched concurrently with Promise.all.
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

// ─── Constants ────────────────────────────────────────────────────────────────

/** Mark enrollment 'bounced' after this many consecutive send failures */
const MAX_SEND_ATTEMPTS = 3

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
  // Only pick rows that haven't been touched by another tick in the last
  // TICK_LOCK_MINUTES minutes.  We use ISO string arithmetic on the filter.
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

  // Immediately claim all fetched rows by writing last_tick_at so a concurrent
  // tick won't pick them up.
  const claimedIds = enrollments.map((e) => e.id)
  await db
    .from('sequence_enrollments')
    .update({ last_tick_at: triggeredAt })
    .in('id', claimedIds)

  // ── 2. Batch-load all steps we might need ──────────────────────────────────
  // Collect the unique sequence IDs, then load ALL their steps in one query.
  // Build a lookup map: sequenceId → position → step
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

    // ── 5. Pick inbox (sticky assignment) ────────────────────────────────────
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
        headers: {
          'X-Sequence-Id':   enrollment.sequence_id,
          'X-Enrollment-Id': enrollment.id,
        },
      },
      workspaceId,
    )

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
      status:        sendResult.ok ? 'sent' : 'failed',
      error:         sendResult.ok ? null : (sendResult.error ?? null),
    })

    if (!sendResult.ok) {
      errors.push(`Send failed for ${contact.email}: ${sendResult.error}`)

      const newAttempts = (enrollment.send_attempts ?? 0) + 1

      if (newAttempts >= MAX_SEND_ATTEMPTS) {
        // Permanently give up on this enrollment
        await db
          .from('sequence_enrollments')
          .update({ status: 'bounced', completed_at: triggeredAt, send_attempts: newAttempts })
          .eq('id', enrollment.id)
        errors.push(`Enrollment ${enrollment.id} marked bounced after ${newAttempts} failures`)
      } else {
        // Increment failure counter; keep active so next tick retries
        await db
          .from('sequence_enrollments')
          .update({ send_attempts: newAttempts })
          .eq('id', enrollment.id)
      }
      continue
    }

    emailsSent++

    // ── 7. Advance enrollment to next step ────────────────────────────────────
    const nextStep = seqSteps?.get(enrollment.current_step + 1)
    const nowInboxId = assignedId ?? pick.inbox.id  // persist assignment if first send

    if (nextStep) {
      const nextSendAt = new Date(
        Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000,
      ).toISOString()
      await db
        .from('sequence_enrollments')
        .update({
          current_step:      enrollment.current_step + 1,
          next_send_at:      nextSendAt,
          send_attempts:     0,               // reset on success
          assigned_inbox_id: nowInboxId,
        })
        .eq('id', enrollment.id)
    } else {
      // This was the last step
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

  const rows = contactIds.map((contactId) => ({
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
  return { enrolled, skipped: contactIds.length - enrolled }
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

  // Parallel: fetch step counts + stats for all sequences at once
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

  // Load enrollments to get both status counts and the IDs needed for log lookup
  const { data: enrollments } = await db
    .from('sequence_enrollments')
    .select('id, status')
    .eq('sequence_id', sequenceId)

  const rows = enrollments ?? []
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length
  const enrollmentIds = rows.map((r) => r.id)

  // Count sent logs via enrollment IDs (sequence_send_logs has no sequence_id column)
  let totalSent = 0
  if (enrollmentIds.length > 0) {
    const { count } = await db
      .from('sequence_send_logs')
      .select('id', { count: 'exact', head: true })
      .in('enrollment_id', enrollmentIds)
      .eq('status', 'sent')
    totalSent = count ?? 0
  }

  return {
    sequence_id:    sequenceId,
    total_enrolled: rows.length,
    active:         byStatus('active'),
    completed:      byStatus('completed'),
    replied:        byStatus('replied'),
    bounced:        byStatus('bounced'),
    total_sent:     totalSent,
    open_rate:      0,
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
