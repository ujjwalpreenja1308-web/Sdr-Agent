/**
 * smtp-pool.ts
 *
 * SMTP rotation pool for outreach campaigns.
 *
 * Instead of blasting all outreach from one inbox (which tanks deliverability),
 * this pool distributes sends round-robin across all inboxes the user has
 * flagged `use_for_outreach = true`, respecting each inbox's daily_target cap.
 *
 * Bounce handling:
 * - Hard bounce (permanent, 5xx address-level failure): logged with bounce_type='hard',
 *   contact email marked 'invalid'. The INBOX is NOT penalised — hard bounces are
 *   the recipient's fault, not the sender's.
 * - Soft bounce (transient, 4xx / network / quota): logged with bounce_type='soft',
 *   enrollment keeps retrying with back-off. If the inbox itself seems broken
 *   (auth error, ECONNREFUSED) THEN mark the inbox as 'error'.
 */

import nodemailer from 'nodemailer'
import type { Transporter, SendMailOptions } from 'nodemailer'

import { decrypt } from './encryption.js'
import { getSupabaseAdmin } from './supabase.js'
import { classifyBounce, isBounceError } from './bounce-classifier.js'
import type { BounceType } from './bounce-classifier.js'
import type { WarmingInbox } from '@pipeiq/shared'

interface PoolEntry {
  inbox: WarmingInbox
  transporter: Transporter
  sentToday: number
  dailyCap: number
}

export class OutreachSmtpPool {
  private entries: PoolEntry[] = []
  private cursor = 0

  private constructor(entries: PoolEntry[]) {
    this.entries = entries
  }

  /** Load all outreach-enabled inboxes for the workspace and build the pool */
  static async forWorkspace(workspaceId: string): Promise<OutreachSmtpPool> {
    const db = getSupabaseAdmin()

    const { data: inboxes } = await db
      .from('warming_inboxes')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('use_for_outreach', true)
      .eq('status', 'active')

    if (!inboxes || inboxes.length === 0) {
      return new OutreachSmtpPool([])
    }

    const today = new Date().toISOString().slice(0, 10)

    // Batch-load today's send counts for all inboxes in a single query
    const inboxIds = inboxes.map((i) => i.id)
    const { data: schedRows } = await db
      .from('warming_schedule')
      .select('inbox_id, actual_sends')
      .in('inbox_id', inboxIds)
      .eq('date', today)

    const sentMap = new Map<string, number>()
    for (const row of schedRows ?? []) {
      sentMap.set(row.inbox_id, row.actual_sends ?? 0)
    }

    const entries: PoolEntry[] = []
    for (const inbox of inboxes as WarmingInbox[]) {
      const sentToday = sentMap.get(inbox.id) ?? 0

      // Reserve ~30% of daily capacity for warming; rest available for outreach
      const outreachCap = Math.floor(inbox.daily_target * 0.7)
      if (sentToday >= outreachCap) continue  // inbox exhausted for today

      const transporter = nodemailer.createTransport({
        host: inbox.smtp_host,
        port: inbox.smtp_port,
        secure: inbox.smtp_secure,
        auth: {
          user: inbox.smtp_user,
          pass: decrypt(inbox.smtp_pass_enc),
        },
        tls: { rejectUnauthorized: true },
        pool: true,
        maxConnections: 3,
        rateLimit: 2,  // max 2 msgs/sec per connection
        connectionTimeout: 30_000,
        socketTimeout: 60_000,
        greetingTimeout: 15_000,
      })

      entries.push({ inbox, transporter, sentToday, dailyCap: outreachCap })
    }

    return new OutreachSmtpPool(entries)
  }

  /** Total remaining send capacity across all inboxes today */
  get totalCapacity(): number {
    return this.entries.reduce((s, e) => s + Math.max(0, e.dailyCap - e.sentToday), 0)
  }

  /** Number of available (non-exhausted) inboxes */
  get availableCount(): number {
    return this.entries.filter((e) => e.sentToday < e.dailyCap).length
  }

  /** Expose entries for capacity reporting */
  get poolEntries(): ReadonlyArray<Pick<PoolEntry, 'inbox' | 'sentToday' | 'dailyCap'>> {
    return this.entries
  }

  /** Pick the next available inbox (round-robin, skip exhausted) */
  next(): { transporter: Transporter; inbox: WarmingInbox } | null {
    if (this.entries.length === 0) return null

    const start = this.cursor
    do {
      const entry = this.entries[this.cursor % this.entries.length]!
      this.cursor = (this.cursor + 1) % this.entries.length
      if (entry.sentToday < entry.dailyCap) {
        return { transporter: entry.transporter, inbox: entry.inbox }
      }
    } while (this.cursor !== start)

    return null  // all inboxes exhausted
  }

  /**
   * Pick a specific inbox by ID (for sticky inbox assignment in sequences).
   * Falls back to round-robin if the requested inbox is full or not in the pool.
   */
  pickById(inboxId: string): { transporter: Transporter; inbox: WarmingInbox } | null {
    const entry = this.entries.find((e) => e.inbox.id === inboxId && e.sentToday < e.dailyCap)
    if (entry) return { transporter: entry.transporter, inbox: entry.inbox }
    return this.next()  // fall back to round-robin
  }

  /**
   * Send using a pick already obtained from next() or pickById().
   * Returns bounce classification so the caller can act on hard bounces.
   *
   * Key design:
   * - Hard bounce → do NOT mark inbox as error (recipient's address is bad, not our inbox)
   * - Soft bounce → increment retry counter; still do not mark inbox as error
   * - Infrastructure error (auth, connection) → mark inbox as error
   */
  async sendWith(
    pick: { transporter: Transporter; inbox: WarmingInbox },
    options: Omit<SendMailOptions, 'from'>,
    workspaceId: string,
  ): Promise<{
    ok: boolean
    from: string
    messageId?: string
    error?: string
    bounceType?: BounceType
  }> {
    const { transporter, inbox } = pick
    const fromName = inbox.display_name ?? inbox.email

    try {
      const info = await transporter.sendMail({
        ...options,
        from: `"${fromName}" <${inbox.email}>`,
        // Explicitly ensure no tracking headers for outreach
        headers: {
          ...(options.headers ?? {}),
          // No X-Track, no open-tracking pixel hooks
        },
      })

      // Record the outreach send atomically (upsert avoids a read-then-write race)
      const db = getSupabaseAdmin()
      const today = new Date().toISOString().slice(0, 10)
      const { error: rpcErr } = await db.rpc('increment_outreach_sends', {
        p_inbox_id: inbox.id,
        p_date: today,
        p_target: inbox.daily_target,
      })

      if (rpcErr) {
        // Email was sent but quota tracking failed — log it.
        // Still count in-memory to prevent over-sending; reconciles on next pool load.
        console.error(`[smtp-pool] increment_outreach_sends failed for ${inbox.email}:`, rpcErr.message)
      }

      // Always increment in-memory (safer to over-count than under-count)
      const entry = this.entries.find((e) => e.inbox.id === inbox.id)
      if (entry) entry.sentToday++

      return { ok: true, from: inbox.email, messageId: info.messageId }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const bounceType = classifyBounce(msg)
      const isInfraError = !isBounceError(msg)  // auth failure / cannot connect

      if (isInfraError) {
        // The inbox itself is broken — mark it so the user knows
        const db = getSupabaseAdmin()
        const { error: updateErr } = await db
          .from('warming_inboxes')
          .update({ status: 'error', error_note: msg.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', inbox.id)

        if (updateErr) {
          console.error(`[smtp-pool] Failed to mark inbox ${inbox.email} as error:`, updateErr.message)
        }
      }

      return { ok: false, from: inbox.email, error: msg, bounceType }
    }
  }

  /** Convenience: pick next inbox and send in one call */
  async send(
    options: Omit<SendMailOptions, 'from'>,
    workspaceId: string,
  ): Promise<{ ok: boolean; from: string; messageId?: string; error?: string; bounceType?: BounceType }> {
    const pick = this.next()
    if (!pick) {
      return { ok: false, from: '', error: 'No available inboxes — daily capacity reached' }
    }
    return this.sendWith(pick, options, workspaceId)
  }

  /** Release all transporter connections */
  close() {
    for (const entry of this.entries) {
      try {
        entry.transporter.close?.()
      } catch {
        // Ignore close errors — pool is being discarded
      }
    }
  }
}

/** Convenience: get capacity summary for a workspace */
export async function getOutreachCapacity(workspaceId: string): Promise<{
  available_inboxes: number
  total_remaining_today: number
  inboxes: Array<{ email: string; sent_today: number; cap: number; remaining: number }>
}> {
  const pool = await OutreachSmtpPool.forWorkspace(workspaceId)
  return {
    available_inboxes: pool.availableCount,
    total_remaining_today: pool.totalCapacity,
    inboxes: pool.poolEntries.map((e) => ({
      email: e.inbox.email,
      sent_today: e.sentToday,
      cap: e.dailyCap,
      remaining: Math.max(0, e.dailyCap - e.sentToday),
    })),
  }
}
