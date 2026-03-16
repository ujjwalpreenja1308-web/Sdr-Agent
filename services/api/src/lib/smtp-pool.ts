/**
 * smtp-pool.ts
 *
 * SMTP rotation pool for outreach campaigns.
 *
 * Instead of blasting all outreach from one inbox (which tanks deliverability),
 * this pool distributes sends round-robin across all inboxes that the user has
 * flagged `use_for_outreach = true`, respecting their daily_target cap.
 *
 * Usage:
 *   const pool = await OutreachSmtpPool.forWorkspace(workspaceId)
 *   const transporter = pool.next()   // pick next available inbox
 *   await transporter.sendMail(...)
 */

import nodemailer from 'nodemailer'
import type { Transporter, SendMailOptions } from 'nodemailer'

import { decrypt } from './encryption.js'
import { getSupabaseAdmin } from './supabase.js'
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

    const entries: PoolEntry[] = []
    for (const inbox of inboxes as WarmingInbox[]) {
      const { data: sched } = await db
        .from('warming_schedule')
        .select('actual_sends')
        .eq('inbox_id', inbox.id)
        .eq('date', today)
        .single()

      const sentToday = sched?.actual_sends ?? 0

      // Leave ~30% of daily capacity for warming, rest available for outreach
      const outreachCap = Math.floor(inbox.daily_target * 0.7)
      if (sentToday >= outreachCap) continue  // inbox is full today

      const transporter = nodemailer.createTransport({
        host: inbox.smtp_host,
        port: inbox.smtp_port,
        secure: inbox.smtp_secure,
        auth: {
          user: inbox.smtp_user,
          pass: decrypt(inbox.smtp_pass_enc),
        },
        tls: { rejectUnauthorized: false },
        pool: true,
        maxConnections: 3,
        rateLimit: 2,  // max 2 msgs/sec per connection
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

  /** Pick the next available inbox (round-robin, skip exhausted) */
  next(): { transporter: Transporter; inbox: WarmingInbox } | null {
    if (this.entries.length === 0) return null

    const start = this.cursor
    do {
      const entry = this.entries[this.cursor % this.entries.length]
      this.cursor = (this.cursor + 1) % this.entries.length
      if (entry.sentToday < entry.dailyCap) {
        return { transporter: entry.transporter, inbox: entry.inbox }
      }
    } while (this.cursor !== start)

    return null  // all inboxes exhausted
  }

  /**
   * Pick a specific inbox by ID (for sticky inbox assignment).
   * Falls back to round-robin if the requested inbox is full or not in the pool.
   */
  pickById(inboxId: string): { transporter: Transporter; inbox: WarmingInbox } | null {
    const entry = this.entries.find((e) => e.inbox.id === inboxId && e.sentToday < e.dailyCap)
    if (entry) return { transporter: entry.transporter, inbox: entry.inbox }
    return this.next()  // fall back to round-robin
  }

  /**
   * Send using a pick already obtained from next() or pickById().
   * This avoids the double-pick bug where next() + send() each advance the cursor.
   */
  async sendWith(
    pick: { transporter: Transporter; inbox: WarmingInbox },
    options: Omit<SendMailOptions, 'from'>,
    workspaceId: string,
  ): Promise<{ ok: boolean; from: string; messageId?: string; error?: string }> {
    const { transporter, inbox } = pick
    const fromName = inbox.display_name ?? inbox.email

    try {
      const info = await transporter.sendMail({
        ...options,
        from: `"${fromName}" <${inbox.email}>`,
      })

      // Record the outreach send so it counts toward daily cap
      const db = getSupabaseAdmin()
      const today = new Date().toISOString().slice(0, 10)
      await db.from('warming_schedule').upsert(
        {
          inbox_id: inbox.id,
          date: today,
          target_sends: inbox.daily_target,
          actual_sends: (
            (
              await db
                .from('warming_schedule')
                .select('actual_sends')
                .eq('inbox_id', inbox.id)
                .eq('date', today)
                .single()
            ).data?.actual_sends ?? 0
          ) + 1,
        },
        { onConflict: 'inbox_id,date' },
      )

      // Increment sentToday in memory
      const entry = this.entries.find((e) => e.inbox.id === inbox.id)
      if (entry) entry.sentToday++

      return { ok: true, from: inbox.email, messageId: info.messageId }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)

      // Mark inbox as error in DB
      const db = getSupabaseAdmin()
      await db
        .from('warming_inboxes')
        .update({ status: 'error', error_note: msg, updated_at: new Date().toISOString() })
        .eq('id', inbox.id)

      return { ok: false, from: inbox.email, error: msg }
    }
  }

  /** Send an email via the next available inbox, recording the send */
  async send(
    options: Omit<SendMailOptions, 'from'>,
    workspaceId: string,
  ): Promise<{ ok: boolean; from: string; messageId?: string; error?: string }> {
    const pick = this.next()
    if (!pick) {
      return { ok: false, from: '', error: 'No available inboxes — daily capacity reached' }
    }
    return this.sendWith(pick, options, workspaceId)
  }

  /** Release all transporter connections */
  close() {
    for (const entry of this.entries) {
      entry.transporter.close?.()
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
    inboxes: (pool as unknown as { entries: PoolEntry[] }).entries.map((e) => ({
      email: e.inbox.email,
      sent_today: e.sentToday,
      cap: e.dailyCap,
      remaining: Math.max(0, e.dailyCap - e.sentToday),
    })),
  }
}
