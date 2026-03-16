/**
 * warming.ts
 *
 * Self-owned email warming engine.
 *
 * Architecture:
 * - Each workspace can connect N inboxes (Gmail, Outlook, custom SMTP/IMAP)
 * - Every 24 hours a warming job runs: inboxes in the pool send warmth emails
 *   to each other, then the recipients mark them as read + move to inbox
 * - Volume ramps up gradually (5 → 10 → 20 → 30-40/day over ~4 weeks)
 * - Health score is tracked per inbox (spam rate, bounce rate, inbox placement)
 */

import { getSupabaseAdmin } from './supabase.js'
import { decrypt, encrypt } from './encryption.js'
import type { WarmingInbox } from '@pipeiq/shared'

// ─── Nodemailer (SMTP send) ───────────────────────────────────────────────────
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

// ─── ImapFlow (IMAP read/engage) ─────────────────────────────────────────────
import { ImapFlow } from 'imapflow'

// ─── Warming email templates ──────────────────────────────────────────────────

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
]

const WARMING_BODIES = [
  `Hi,\n\nHope you're having a great week. I came across something that might be useful and wanted to share it with you.\n\nLet me know if you'd like to discuss further.\n\nBest regards`,
  `Hello,\n\nJust a quick note to stay in touch. Things have been busy on my end but I've been thinking about our previous exchange.\n\nHope all is well with you.\n\nWarm regards`,
  `Hi there,\n\nI wanted to follow up on something we discussed earlier. Do you have a few minutes this week to reconnect?\n\nLooking forward to hearing from you.\n\nBest`,
  `Hello,\n\nI've been meaning to reach out. I think there's a real opportunity here worth exploring together.\n\nWould love to get your thoughts when you have a moment.\n\nThanks`,
  `Hi,\n\nHope everything is going well. I have a few ideas I'd love to run by you when you have bandwidth.\n\nLet me know what works for you.\n\nCheers`,
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

// ─── Ramp schedule ────────────────────────────────────────────────────────────
// Returns how many emails to send today based on how old the inbox is (days since creation)

export function computeDailyTarget(daysSinceStart: number, maxTarget: number): number {
  // Week 1: 5/day, Week 2: 10/day, Week 3: 20/day, Week 4+: maxTarget
  if (daysSinceStart < 7) return Math.min(5, maxTarget)
  if (daysSinceStart < 14) return Math.min(10, maxTarget)
  if (daysSinceStart < 21) return Math.min(20, maxTarget)
  return maxTarget
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
// Connects via IMAP, searches for warming emails, marks them read + moves to inbox

const IMAP_TIMEOUT_MS = 45_000

async function engageReceivedEmail(
  inbox: WarmingInbox,
  fromEmail: string,
  messageId: string,
): Promise<{ movedToInbox: boolean; landedInSpam: boolean }> {
  const client = new ImapFlow({
    host: inbox.imap_host,
    port: inbox.imap_port,
    secure: inbox.imap_port === 993,
    auth: {
      user: inbox.imap_user,
      pass: decrypt(inbox.imap_pass_enc),
    },
    logger: false,
  })

  let movedToInbox = false
  let landedInSpam = false

  try {
    await withTimeout(client.connect(), IMAP_TIMEOUT_MS, `IMAP connect ${inbox.email}`)

    // Check spam folder first
    const spamFolders = ['[Gmail]/Spam', 'Junk', 'Spam', 'Junk Email', 'Bulk Mail']
    for (const folder of spamFolders) {
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
            // Move from spam to inbox
            await client.messageMove(msg.seq, 'INBOX')
            landedInSpam = true
            movedToInbox = true
          }
        } finally {
          lock.release()
        }
        if (landedInSpam) break
      } catch {
        // folder doesn't exist, continue
      }
    }

    // If not in spam, find in inbox and mark as important
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
    console.warn(`[warming] IMAP engage failed for ${inbox.email}:`, err)
  } finally {
    await client.logout().catch(() => {})
  }

  return { movedToInbox, landedInSpam }
}

// ─── Send one warming email (with 1 retry on transient failure) ───────────────

async function sendWarmingEmail(
  sender: WarmingInbox,
  recipient: WarmingInbox,
): Promise<{ messageId: string; subject: string } | null> {
  const subject = randomItem(WARMING_SUBJECTS)
  const body = randomItem(WARMING_BODIES)
  const fromName = sender.display_name ?? sender.email
  const toName = recipient.display_name ?? recipient.email

  for (let attempt = 1; attempt <= 2; attempt++) {
    const transporter = buildTransporter(sender)
    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${sender.email}>`,
        to: `"${toName}" <${recipient.email}>`,
        subject,
        text: body,
        headers: {
          'X-Warming': 'true',
          'X-Mailer': 'PipeIQ',
        },
      })
      return { messageId: info.messageId, subject }
    } catch (err) {
      if (attempt === 2) {
        console.error(`[warming] SMTP send failed ${sender.email} → ${recipient.email}:`, err)
      } else {
        console.warn(`[warming] SMTP send attempt ${attempt} failed, retrying…`, err)
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }
  return null
}

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

  // Engagement tasks are collected and awaited after all sends complete,
  // preserving the human-like delay while ensuring nothing is lost.
  const engagementTasks: Promise<void>[] = []

  for (const sender of inboxes) {
    // Use created_at as the ramp base — last_warmed_at resets daily and would
    // keep every inbox stuck in week 1 of the ramp forever.
    const daysSinceStart = Math.floor(
      (Date.now() - new Date(sender.created_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    const dailyTarget = computeDailyTarget(daysSinceStart, sender.daily_target)

    // Check how many already sent today via schedule table
    const { data: schedRow } = await db
      .from('warming_schedule')
      .select('actual_sends')
      .eq('inbox_id', sender.id)
      .eq('date', today)
      .single()

    const alreadySent = schedRow?.actual_sends ?? 0
    const remaining = dailyTarget - alreadySent
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
        workspace_id: workspaceId,
        sender_inbox_id: sender.id,
        recipient_inbox_id: recipient.id,
        direction: 'sent',
        message_id: result.messageId,
        subject: result.subject,
      })

      // Small delay to avoid SMTP rate limits
      await new Promise((r) => setTimeout(r, 1500))

      // Queue engagement with a human-like delay (5-30s), awaited after send loop
      const engageDelay = 5000 + Math.random() * 25000
      const capturedResult = result
      const capturedRecipient = recipient
      engagementTasks.push(
        new Promise<void>((resolve) => setTimeout(resolve, engageDelay)).then(async () => {
          try {
            const engagement = await engageReceivedEmail(
              capturedRecipient as WarmingInbox,
              sender.email,
              capturedResult.messageId,
            )
            await db.from('warming_logs').insert({
              workspace_id: workspaceId,
              sender_inbox_id: capturedRecipient.id,
              recipient_inbox_id: sender.id,
              direction: 'received',
              message_id: capturedResult.messageId,
              subject: capturedResult.subject,
              opened: true,
              moved_to_inbox: engagement.movedToInbox,
              landed_in_spam: engagement.landedInSpam,
            })
            if (engagement.landedInSpam) {
              await db.rpc('increment_spam_hits', { p_inbox_id: sender.id, p_date: today })
            }
          } catch (err) {
            console.warn(`[warming] Engagement task failed for ${capturedRecipient.email}:`, err)
          }
        }),
      )
    }

    if (sentThisRun === 0 && toSend > 0) {
      // All sends failed — mark inbox as errored so it is skipped next cycle
      await db
        .from('warming_inboxes')
        .update({
          status: 'error',
          error_note: 'All SMTP sends failed during warming cycle',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sender.id)
      continue
    }

    // Upsert schedule row with actual successful sends (not the attempted target)
    await db.from('warming_schedule').upsert(
      {
        inbox_id: sender.id,
        date: today,
        target_sends: dailyTarget,
        actual_sends: alreadySent + sentThisRun,
      },
      { onConflict: 'inbox_id,date' },
    )

    // Update inbox stats
    await db
      .from('warming_inboxes')
      .update({
        last_warmed_at: new Date().toISOString(),
        current_daily_sent: alreadySent + sentThisRun,
        error_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sender.id)
  }

  // Await all engagement tasks before returning so nothing is silently dropped
  await Promise.allSettled(engagementTasks)

  // Recalculate health scores
  await refreshHealthScores(workspaceId, db)

  return {
    workspace_id: workspaceId,
    triggered_at: triggeredAt,
    inboxes_processed: inboxes.length,
    emails_sent: emailsSent,
    errors,
  }
}

// ─── Health score calculation ─────────────────────────────────────────────────
// Score is 0-100. Factors: spam rate (-40 max), bounce rate (-30 max), inbox placement (+30 max)

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
      .select('direction, landed_in_spam, opened, moved_to_inbox')
      .eq('sender_inbox_id', id)
      .gte('created_at', sevenDaysAgo)

    if (!logs || logs.length === 0) continue

    const sent = logs.filter((l) => l.direction === 'sent').length
    const spamHits = logs.filter((l) => l.landed_in_spam).length
    const inboxPlacements = logs.filter((l) => l.moved_to_inbox && !l.landed_in_spam).length

    const spamRate = sent > 0 ? (spamHits / sent) * 100 : 0
    const inboxPlacementRate = sent > 0 ? (inboxPlacements / sent) * 100 : 100

    // Health score: start at 100, penalise spam, reward inbox placement
    const healthScore = Math.max(
      0,
      Math.min(100, 100 - spamRate * 2 + (inboxPlacementRate - 80) * 0.5),
    )

    await db
      .from('warming_inboxes')
      .update({
        spam_rate: Math.round(spamRate * 100) / 100,
        inbox_placement_rate: Math.round(inboxPlacementRate * 100) / 100,
        health_score: Math.round(healthScore * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
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
  // Never send encrypted credentials to the frontend
  const { smtp_pass_enc: _s, imap_pass_enc: _i, ...safe } = inbox
  return safe
}

export async function getWarmingOverview(workspaceId: string) {
  const db = getSupabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)

  const { data: inboxes } = await db
    .from('warming_inboxes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (!inboxes) return null

  const safeInboxes = inboxes.map(stripCredentials)

  const active = inboxes.filter((i) => i.status === 'active').length
  const paused = inboxes.filter((i) => i.status === 'paused').length
  const errored = inboxes.filter((i) => i.status === 'error').length

  // Today's total sends across all inboxes
  const { data: schedToday } = await db
    .from('warming_schedule')
    .select('actual_sends, target_sends')
    .eq('date', today)
    .in('inbox_id', inboxes.map((i) => i.id))

  const totalSentToday = schedToday?.reduce((s, r) => s + (r.actual_sends ?? 0), 0) ?? 0
  const totalCapacityToday = schedToday?.reduce((s, r) => s + (r.target_sends ?? 0), 0) ?? 0

  const avgHealth =
    inboxes.length > 0
      ? Math.round(
          (inboxes.reduce((s, i) => s + (i.health_score ?? 100), 0) / inboxes.length) * 100,
        ) / 100
      : 100

  return {
    workspace_id: workspaceId,
    total_inboxes: inboxes.length,
    active_inboxes: active,
    paused_inboxes: paused,
    error_inboxes: errored,
    total_sent_today: totalSentToday,
    total_capacity_today: totalCapacityToday,
    average_health_score: avgHealth,
    inboxes: safeInboxes,
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
    inbox_id: inboxId,
    email: inbox.email,
    health_score: inbox.health_score,
    days: days ?? [],
    total_sent_7d: last7.reduce((s, d) => s + d.actual_sends, 0),
    total_opens_7d: last7.reduce((s, d) => s + d.actual_opens, 0),
    total_replies_7d: last7.reduce((s, d) => s + d.actual_replies, 0),
    spam_hits_7d: last7.reduce((s, d) => s + d.spam_hits, 0),
  }
}
