/**
 * warming.ts
 *
 * Self-owned email warming engine.
 *
 * Architecture:
 * - Each workspace can connect N inboxes (Gmail, Outlook, custom SMTP/IMAP)
 * - Every 24 hours a warming job runs: inboxes in the pool send warming emails
 *   to each other, then the recipients mark them as read + moved to inbox
 * - Volume ramps up gradually (5 → 10 → 20 → 30-40/day over ~4 weeks)
 * - ~20% of warming emails receive an auto-reply, which strongly signals
 *   genuine engagement to receiving mail servers
 * - Health score is tracked per inbox (spam rate, reply rate, inbox placement)
 * - Inboxes with health_score < 20 are auto-paused to prevent reputation damage
 * - Smart ramp: if an inbox hasn't been warmed in 3+ days, step back in volume
 *
 * No open-tracking pixels are used — engagement is measured via IMAP.
 */

import { getSupabaseAdmin } from './supabase.js'
import { decrypt } from './encryption.js'
import type { WarmingInbox } from '@pipeiq/shared'

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

import { ImapFlow } from 'imapflow'

// ─── Warming email templates ──────────────────────────────────────────────────
// Varied enough that receiving servers don't flag them as template-spam.

const WARMING_SUBJECTS = [
  'Quick question',
  'Following up',
  'Checking in',
  'Thought you might find this interesting',
  'Re: our last conversation',
  'Any thoughts on this?',
  'Worth a look',
  'Just wanted to share',
  'Brief update',
  'Can we connect?',
  'Ideas worth exploring',
  'Your perspective on this',
  'Have you seen this?',
  'Reaching out',
  'Something I noticed',
  'A quick thought',
  'Circling back',
  'One more thing',
  'On my radar',
  'Wanted to loop you in',
  'Heads up',
  'Before I forget',
  'Touching base',
  'Still on your mind?',
  'A few thoughts',
]

const WARMING_BODIES = [
  `Hi,\n\nHope you're having a great week. I came across something that might be useful and wanted to share it with you.\n\nLet me know if you'd like to discuss further.\n\nBest regards`,
  `Hello,\n\nJust a quick note to stay in touch. Things have been busy on my end but I've been thinking about our previous exchange.\n\nHope all is well with you.\n\nWarm regards`,
  `Hi there,\n\nI wanted to follow up on something we discussed earlier. Do you have a few minutes this week to reconnect?\n\nLooking forward to hearing from you.\n\nBest`,
  `Hello,\n\nI've been meaning to reach out. I think there's a real opportunity here worth exploring together.\n\nWould love to get your thoughts when you have a moment.\n\nThanks`,
  `Hi,\n\nHope everything is going well. I have a few ideas I'd love to run by you when you have bandwidth.\n\nLet me know what works for you.\n\nCheers`,
  `Hey,\n\nI was reviewing some notes from our last conversation and had a follow-up thought that might be relevant.\n\nWould you have 10 minutes sometime this week?\n\nAll the best`,
  `Hello,\n\nJust wanted to drop a quick line — I came across an article that immediately made me think of you and what we've been discussing.\n\nHappy to forward it over if you're interested.\n\nTake care`,
  `Hi,\n\nI hope your week is off to a good start. I wanted to share a quick update on something we touched on previously.\n\nLet me know if this is still relevant on your end.\n\nBest wishes`,
  `Hello,\n\nI've been doing some thinking and wanted to get your perspective on something before moving forward.\n\nWould you be open to a quick call this week?\n\nThanks so much`,
  `Hi there,\n\nI don't want to let too much time pass — I genuinely think there's something worth discussing when it's convenient for you.\n\nLooking forward to connecting.\n\nKind regards`,
]

// Short, natural-sounding replies for reply simulation (~20% of warming emails)
const WARMING_REPLIES = [
  `Thanks for reaching out! Happy to connect — what time works for you this week?`,
  `Got your message. Let me take a look and circle back soon.`,
  `Good timing on this. I was actually thinking about the same thing. Let's chat.`,
  `Appreciate you following up. I've been meaning to respond — let's find a time.`,
  `Thanks! This is relevant. I'll review and get back to you shortly.`,
  `Perfect timing. I'm available Thursday or Friday if that works?`,
  `Noted, thanks. I'll loop in my team and we can connect next week.`,
  `Yes, let's reconnect. I'll send over some available times.`,
]

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms),
  )
  return Promise.race([promise, timeout])
}

// ─── Smart ramp schedule ──────────────────────────────────────────────────────
// Volume based on effective warmup age.
// If an inbox hasn't been warmed in 3+ days, step back by one stage per gap-day
// to avoid suddenly blasting high volume from a cold-ish inbox.

export function computeDailyTarget(inbox: WarmingInbox): number {
  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(inbox.created_at).getTime()) / (1000 * 60 * 60 * 24),
  )

  let effectiveDays = daysSinceCreated

  if (inbox.last_warmed_at) {
    const daysSinceWarmed = Math.floor(
      (Date.now() - new Date(inbox.last_warmed_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    // Step back 1 week per gap-day when the inbox has been idle 3+ days
    if (daysSinceWarmed >= 3) {
      effectiveDays = Math.max(0, daysSinceCreated - daysSinceWarmed * 7)
    }
  }

  const max = inbox.daily_target
  if (effectiveDays < 7)  return Math.min(5, max)
  if (effectiveDays < 14) return Math.min(10, max)
  if (effectiveDays < 21) return Math.min(20, max)
  return max
}

// ─── SMTP transport factory ───────────────────────────────────────────────────

function buildTransporter(inbox: WarmingInbox): Transporter {
  return nodemailer.createTransport({
    host: inbox.smtp_host,
    port: inbox.smtp_port,
    secure: inbox.smtp_secure,
    auth: {
      user: inbox.smtp_user,
      pass: decrypt(inbox.smtp_pass_enc),
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30_000,
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
  })
}

// ─── IMAP engagement ──────────────────────────────────────────────────────────
// Connects via IMAP, finds the warming email, marks it read and flagged.
// Checks spam folders first; moves to inbox if found in spam.
// Optionally sends a reply (~20% of interactions) to boost engagement signals.

const IMAP_TIMEOUT_MS = 45_000

// All known spam folder names across major providers
const SPAM_FOLDERS = [
  '[Gmail]/Spam',
  'Junk',
  'Spam',
  'Junk Email',
  'Bulk Mail',
  'Junk Mail',
  '[Junk]',
  'INBOX.Junk',
  'INBOX.Spam',
]

async function engageReceivedEmail(
  recipientInbox: WarmingInbox,
  senderEmail: string,
  messageId: string,
  originalSubject: string,
  shouldReply: boolean,
): Promise<{ movedToInbox: boolean; landedInSpam: boolean; replied: boolean }> {
  const client = new ImapFlow({
    host: recipientInbox.imap_host,
    port: recipientInbox.imap_port,
    secure: recipientInbox.imap_port === 993,
    auth: {
      user: recipientInbox.imap_user,
      pass: decrypt(recipientInbox.imap_pass_enc),
    },
    logger: false,
  })

  let movedToInbox = false
  let landedInSpam = false
  let replied = false

  try {
    await withTimeout(client.connect(), IMAP_TIMEOUT_MS, `IMAP connect ${recipientInbox.email}`)

    // ── Check spam folders first ──────────────────────────────────────────────
    for (const folder of SPAM_FOLDERS) {
      try {
        const lock = await withTimeout(
          client.getMailboxLock(folder),
          IMAP_TIMEOUT_MS,
          `IMAP lock ${folder}`,
        )
        try {
          const messages = client.fetch({ header: { 'message-id': messageId } }, {
            flags: true,
            envelope: true,
          })
          for await (const msg of messages) {
            await client.messageMove(msg.seq, 'INBOX')
            landedInSpam = true
            movedToInbox = true
          }
        } finally {
          lock.release()
        }
        if (landedInSpam) break
      } catch {
        // Folder doesn't exist on this provider — continue
      }
    }

    // ── Find in INBOX and mark as read + important ────────────────────────────
    if (!landedInSpam) {
      const lock = await withTimeout(
        client.getMailboxLock('INBOX'),
        IMAP_TIMEOUT_MS,
        `IMAP lock INBOX`,
      )
      try {
        const messages = client.fetch({ header: { 'message-id': messageId } }, {
          flags: true,
          envelope: true,
        })
        for await (const msg of messages) {
          await client.messageFlagsAdd(msg.seq, ['\\Seen', '\\Flagged'])
          movedToInbox = true
        }
      } finally {
        lock.release()
      }
    }
  } catch (err) {
    console.warn(`[warming] IMAP engage failed for ${recipientInbox.email}:`, err)
  } finally {
    await client.logout().catch(() => {})
  }

  // ── Send reply if this interaction is selected for reply simulation ─────────
  // Only reply if we confirmed the email was in the inbox (not spam)
  if (shouldReply && movedToInbox && !landedInSpam) {
    try {
      const replyTransporter = buildTransporter(recipientInbox)
      const replySubject = originalSubject.startsWith('Re:')
        ? originalSubject
        : `Re: ${originalSubject}`
      const replyBody = randomItem(WARMING_REPLIES)

      await replyTransporter.sendMail({
        from: `"${recipientInbox.display_name ?? recipientInbox.email}" <${recipientInbox.email}>`,
        to: senderEmail,
        subject: replySubject,
        text: replyBody,
        headers: {
          'X-Warming': 'true',
          'In-Reply-To': messageId,
          'References': messageId,
        },
      })
      replied = true
    } catch (err) {
      console.warn(`[warming] Reply simulation failed for ${recipientInbox.email}:`, err)
    }
  }

  return { movedToInbox, landedInSpam, replied }
}

// ─── Send one warming email (with 1 retry on transient failure) ───────────────

async function sendWarmingEmail(
  sender: WarmingInbox,
  recipient: WarmingInbox,
): Promise<{ messageId: string; subject: string } | null> {
  const subject = randomItem(WARMING_SUBJECTS)
  const body    = randomItem(WARMING_BODIES)
  const fromName = sender.display_name ?? sender.email
  const toName   = recipient.display_name ?? recipient.email

  for (let attempt = 1; attempt <= 2; attempt++) {
    const transporter = buildTransporter(sender)
    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${sender.email}>`,
        to:   `"${toName}" <${recipient.email}>`,
        subject,
        text: body,
        headers: {
          'X-Warming': 'true',
          'X-Mailer':  'PipeIQ',
        },
      })
      return { messageId: info.messageId, subject }
    } catch (err) {
      if (attempt === 2) {
        console.error(`[warming] SMTP send failed ${sender.email} → ${recipient.email}:`, err)
      } else {
        console.warn(`[warming] SMTP attempt ${attempt} failed, retrying…`, err)
        // Jittered delay: 1.5-3.5 s
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000))
      }
    }
  }
  return null
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Auto-pause inbox when health score drops below this threshold */
const HEALTH_AUTOPAUSE_THRESHOLD = 20

/** Fraction of warming emails that will trigger a reply back */
const REPLY_SIMULATION_RATE = 0.2

// ─── Core warming run for a workspace ────────────────────────────────────────

export interface WarmingRunSummary {
  workspace_id: string
  triggered_at: string
  inboxes_processed: number
  emails_sent: number
  errors: string[]
}

export async function runWarmingCycle(workspaceId: string): Promise<WarmingRunSummary> {
  const db = getSupabaseAdmin()
  const triggeredAt = new Date().toISOString()
  const errors: string[] = []
  let emailsSent = 0

  // Load all active inboxes for this workspace
  const { data: inboxes, error: fetchErr } = await db
    .from('warming_inboxes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .eq('warmup_enabled', true)

  if (fetchErr || !inboxes || inboxes.length === 0) {
    return {
      workspace_id: workspaceId,
      triggered_at: triggeredAt,
      inboxes_processed: 0,
      emails_sent: 0,
      errors: fetchErr ? [fetchErr.message] : ['No active warming inboxes found'],
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const engagementTasks: Promise<void>[] = []

  for (const sender of inboxes) {
    const dailyTarget = computeDailyTarget(sender as WarmingInbox)

    // How many warming emails has this inbox already sent today?
    const { data: schedRow } = await db
      .from('warming_schedule')
      .select('actual_sends')
      .eq('inbox_id', sender.id)
      .eq('date', today)
      .single()

    const alreadySent = schedRow?.actual_sends ?? 0
    const remaining   = dailyTarget - alreadySent
    if (remaining <= 0) continue

    // Shuffle recipients so we don't always send to the same inbox first
    const recipients = shuffled(inboxes.filter((r) => r.id !== sender.id))
    if (recipients.length === 0) continue

    const toSend = Math.min(remaining, recipients.length)
    let sentThisRun = 0

    for (let i = 0; i < toSend; i++) {
      const recipient = recipients[i]

      const result = await sendWarmingEmail(sender as WarmingInbox, recipient as WarmingInbox)
      if (!result) {
        errors.push(`Send failed: ${sender.email} → ${recipient.email}`)
        continue
      }

      emailsSent++
      sentThisRun++

      // Log the send
      await db.from('warming_logs').insert({
        workspace_id:       workspaceId,
        sender_inbox_id:    sender.id,
        recipient_inbox_id: recipient.id,
        direction:          'sent',
        message_id:         result.messageId,
        subject:            result.subject,
      })

      // Jittered delay between sends: 1–4 seconds (more human-like than fixed 1.5 s)
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 3000))

      // Queue engagement with a human-like delay (5-35 s)
      const engageDelay   = 5000 + Math.random() * 30000
      const shouldReply   = Math.random() < REPLY_SIMULATION_RATE
      const capturedResult    = result
      const capturedRecipient = recipient

      engagementTasks.push(
        new Promise<void>((resolve) => setTimeout(resolve, engageDelay)).then(async () => {
          try {
            const engagement = await engageReceivedEmail(
              capturedRecipient as WarmingInbox,
              sender.email,
              capturedResult.messageId,
              capturedResult.subject,
              shouldReply,
            )

            await db.from('warming_logs').insert({
              workspace_id:       workspaceId,
              sender_inbox_id:    capturedRecipient.id,
              recipient_inbox_id: sender.id,
              direction:          'received',
              message_id:         capturedResult.messageId,
              subject:            capturedResult.subject,
              opened:             true,
              replied:            engagement.replied,
              moved_to_inbox:     engagement.movedToInbox,
              landed_in_spam:     engagement.landedInSpam,
            })

            if (engagement.landedInSpam) {
              await db.rpc('increment_spam_hits', { p_inbox_id: sender.id, p_date: today })
            }
            if (engagement.replied) {
              await db.rpc('increment_actual_replies', { p_inbox_id: capturedRecipient.id, p_date: today })
            }
          } catch (err) {
            console.warn(`[warming] Engagement task failed for ${capturedRecipient.email}:`, err)
          }
        }),
      )
    }

    if (sentThisRun === 0 && toSend > 0) {
      // All sends failed — mark inbox as errored
      await db
        .from('warming_inboxes')
        .update({
          status:     'error',
          error_note: 'All SMTP sends failed during warming cycle',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sender.id)
      continue
    }

    // Upsert schedule row with actual sends
    await db.from('warming_schedule').upsert(
      {
        inbox_id:     sender.id,
        date:         today,
        target_sends: dailyTarget,
        actual_sends: alreadySent + sentThisRun,
      },
      { onConflict: 'inbox_id,date' },
    )

    // Update inbox stats
    await db
      .from('warming_inboxes')
      .update({
        last_warmed_at:    new Date().toISOString(),
        current_daily_sent: alreadySent + sentThisRun,
        error_note:        null,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', sender.id)
  }

  // Wait for all engagement tasks (IMAP + reply sends)
  await Promise.allSettled(engagementTasks)

  // Recalculate health scores, then auto-pause inboxes below threshold
  await refreshHealthScores(workspaceId, db)
  await autoPauseUnhealthyInboxes(workspaceId, db)

  return {
    workspace_id:      workspaceId,
    triggered_at:      triggeredAt,
    inboxes_processed: inboxes.length,
    emails_sent:       emailsSent,
    errors,
  }
}

// ─── Health score calculation ─────────────────────────────────────────────────
// Score is 0-100.
// Penalties: spam rate (up to -50), no-reply rate (-10 max)
// Bonuses: inbox placement rate above 80% (+20 max), reply rate (+10 max)

async function refreshHealthScores(workspaceId: string, db: ReturnType<typeof getSupabaseAdmin>) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: inboxes } = await db
    .from('warming_inboxes')
    .select('id')
    .eq('workspace_id', workspaceId)

  if (!inboxes) return

  for (const { id } of inboxes) {
    const { data: logs } = await db
      .from('warming_logs')
      .select('direction, landed_in_spam, opened, moved_to_inbox, replied')
      .eq('sender_inbox_id', id)
      .gte('created_at', sevenDaysAgo)

    if (!logs || logs.length === 0) continue

    const sent           = logs.filter((l) => l.direction === 'sent').length
    const received       = logs.filter((l) => l.direction === 'received').length
    const spamHits       = logs.filter((l) => l.landed_in_spam).length
    const inboxPlacement = logs.filter((l) => l.moved_to_inbox && !l.landed_in_spam).length
    const replies        = logs.filter((l) => l.replied).length

    const spamRate            = sent > 0 ? (spamHits / sent) * 100 : 0
    const inboxPlacementRate  = sent > 0 ? (inboxPlacement / sent) * 100 : 100
    const replyRate           = received > 0 ? (replies / received) * 100 : 0

    // Health formula:
    // Base 100, penalise spam heavily, bonus for inbox placement and replies
    const healthScore = Math.max(
      0,
      Math.min(
        100,
        100
          - spamRate * 2.5                      // -2.5 pts per % spam (max -50 at 20% spam)
          + (inboxPlacementRate - 80) * 0.5     // bonus if above 80% inbox placement
          + Math.min(replyRate * 0.5, 10),      // bonus for replies (max +10)
      ),
    )

    await db
      .from('warming_inboxes')
      .update({
        spam_rate:            Math.round(spamRate * 100) / 100,
        inbox_placement_rate: Math.round(inboxPlacementRate * 100) / 100,
        health_score:         Math.round(healthScore * 100) / 100,
        updated_at:           new Date().toISOString(),
      })
      .eq('id', id)
  }
}

// ─── Auto-pause unhealthy inboxes ─────────────────────────────────────────────

async function autoPauseUnhealthyInboxes(workspaceId: string, db: ReturnType<typeof getSupabaseAdmin>) {
  const { data: unhealthy } = await db
    .from('warming_inboxes')
    .select('id, email, health_score')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .lt('health_score', HEALTH_AUTOPAUSE_THRESHOLD)

  if (!unhealthy || unhealthy.length === 0) return

  for (const inbox of unhealthy) {
    await db
      .from('warming_inboxes')
      .update({
        status:     'paused',
        error_note: `Auto-paused: health score dropped to ${inbox.health_score} (threshold: ${HEALTH_AUTOPAUSE_THRESHOLD}). Review spam rate before resuming.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inbox.id)

    console.warn(`[warming] Auto-paused inbox ${inbox.email} (health: ${inbox.health_score})`)
  }
}

// ─── SMTP/IMAP credential test ────────────────────────────────────────────────

export async function testSmtpConnection(
  host: string,
  port: number,
  user: string,
  pass: string,
  secure: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30_000,
    socketTimeout: 60_000,
    greetingTimeout: 15_000,
  })
  try {
    await withTimeout(transporter.verify(), 35_000, `SMTP verify ${host}`)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function testImapConnection(
  host: string,
  port: number,
  user: string,
  pass: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
  })
  try {
    await withTimeout(client.connect(), IMAP_TIMEOUT_MS, `IMAP connect ${host}`)
    await client.logout()
    return { ok: true }
  } catch (err: unknown) {
    await client.logout().catch(() => {})
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

export function stripCredentials(inbox: WarmingInbox) {
  const { smtp_pass_enc: _s, imap_pass_enc: _i, ...safe } = inbox
  return safe
}

export async function getWarmingOverview(workspaceId: string) {
  const db    = getSupabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)

  const { data: inboxes } = await db
    .from('warming_inboxes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (!inboxes) return null

  const safeInboxes = inboxes.map(stripCredentials)

  const active  = inboxes.filter((i) => i.status === 'active').length
  const paused  = inboxes.filter((i) => i.status === 'paused').length
  const errored = inboxes.filter((i) => i.status === 'error').length

  const { data: schedToday } = await db
    .from('warming_schedule')
    .select('actual_sends, target_sends')
    .eq('date', today)
    .in('inbox_id', inboxes.map((i) => i.id))

  const totalSentToday     = schedToday?.reduce((s, r) => s + (r.actual_sends ?? 0), 0) ?? 0
  const totalCapacityToday = schedToday?.reduce((s, r) => s + (r.target_sends ?? 0), 0) ?? 0

  const avgHealth =
    inboxes.length > 0
      ? Math.round(
          (inboxes.reduce((s, i) => s + (i.health_score ?? 100), 0) / inboxes.length) * 100,
        ) / 100
      : 100

  return {
    workspace_id:         workspaceId,
    total_inboxes:        inboxes.length,
    active_inboxes:       active,
    paused_inboxes:       paused,
    error_inboxes:        errored,
    total_sent_today:     totalSentToday,
    total_capacity_today: totalCapacityToday,
    average_health_score: avgHealth,
    inboxes:              safeInboxes,
  }
}

export async function getInboxStats(inboxId: string, workspaceId: string) {
  const db = getSupabaseAdmin()

  const { data: inbox } = await db
    .from('warming_inboxes')
    .select('id, email, health_score, workspace_id')
    .eq('id', inboxId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!inbox) return null

  const { data: days } = await db
    .from('warming_schedule')
    .select('date, target_sends, actual_sends, actual_opens, actual_replies, spam_hits')
    .eq('inbox_id', inboxId)
    .order('date', { ascending: false })
    .limit(14)

  const last7 = (days ?? []).slice(0, 7)

  return {
    inbox_id:         inboxId,
    email:            inbox.email,
    health_score:     inbox.health_score,
    days:             days ?? [],
    total_sent_7d:    last7.reduce((s, d) => s + d.actual_sends, 0),
    total_opens_7d:   last7.reduce((s, d) => s + d.actual_opens, 0),
    total_replies_7d: last7.reduce((s, d) => s + d.actual_replies, 0),
    spam_hits_7d:     last7.reduce((s, d) => s + d.spam_hits, 0),
  }
}
