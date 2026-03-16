/**
 * send-capacity.ts
 *
 * Per-inbox send capacity reporting with warmup-stage awareness.
 *
 * Gives the user a clear, actionable answer to:
 * "How many emails can I send today?"
 * "How much will I be able to send in 7 / 14 / 30 days?"
 *
 * Warmup stages and their outreach-safe caps:
 *   Day 0–6   (Week 1): 5 warm/day   → 3 outreach/day (70% of 5  → rounded)
 *   Day 7–13  (Week 2): 10 warm/day  → 7 outreach/day
 *   Day 14–20 (Week 3): 20 warm/day  → 14 outreach/day
 *   Day 21+   (Week 4+): daily_target → floor(daily_target × 0.7) outreach/day
 */

import { getSupabaseAdmin } from './supabase.js'
import { computeDailyTarget } from './warming.js'
import type { WarmingInbox } from '@pipeiq/shared'

export type WarmupStage = 'week_1' | 'week_2' | 'week_3' | 'week_4_plus'

function getWarmupStage(inbox: WarmingInbox): WarmupStage {
  let daysSinceCreated = Math.floor(
    (Date.now() - new Date(inbox.created_at).getTime()) / (1000 * 60 * 60 * 24),
  )
  // Apply the same step-back logic as computeDailyTarget for consistency
  if (inbox.last_warmed_at) {
    const gap = Math.floor(
      (Date.now() - new Date(inbox.last_warmed_at).getTime()) / (1000 * 60 * 60 * 24),
    )
    if (gap >= 3) daysSinceCreated = Math.max(0, daysSinceCreated - gap * 7)
  }
  if (daysSinceCreated < 7)  return 'week_1'
  if (daysSinceCreated < 14) return 'week_2'
  if (daysSinceCreated < 21) return 'week_3'
  return 'week_4_plus'
}

/**
 * Project how many outreach emails an inbox will be able to send per day
 * in N days from now, assuming daily warming continues.
 */
function projectOutreachCap(inbox: WarmingInbox, inDays: number): number {
  const future = { ...inbox, created_at: inbox.created_at }
  // Simulate N days of continuous warming
  const simulatedCreatedAt = new Date(
    new Date(inbox.created_at).getTime() - inDays * 24 * 60 * 60 * 1000,
  ).toISOString()
  const futureInbox: WarmingInbox = {
    ...inbox,
    created_at: simulatedCreatedAt,
    last_warmed_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),  // ~warmed yesterday
  }
  void future  // suppress unused-var lint
  const warmTarget = computeDailyTarget(futureInbox)
  return Math.floor(warmTarget * 0.7)
}

export interface InboxCapacityDetail {
  id: string
  email: string
  warmup_stage: WarmupStage
  warmup_day: number
  health_score: number
  daily_warmup_target: number
  daily_outreach_cap: number
  sent_today: number
  remaining_today: number
  status: string
  use_for_outreach: boolean
}

export interface SendCapacityReport {
  workspace_id: string
  generated_at: string
  summary: {
    total_inboxes: number
    active_outreach_inboxes: number
    total_outreach_cap_today: number
    total_sent_today: number
    total_remaining_today: number
  }
  inboxes: InboxCapacityDetail[]
  projections: {
    in_7_days: number
    in_14_days: number
    in_30_days: number
  }
  recommendation: string
}

export async function getSendCapacityReport(workspaceId: string): Promise<SendCapacityReport> {
  const db    = getSupabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)

  // Load all active inboxes (not just outreach-enabled — show full picture)
  const { data: inboxes } = await db
    .from('warming_inboxes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  const allInboxes = (inboxes ?? []) as WarmingInbox[]

  // Batch-load today's send counts
  const inboxIds = allInboxes.map((i) => i.id)
  const { data: schedRows } = inboxIds.length > 0
    ? await db
        .from('warming_schedule')
        .select('inbox_id, actual_sends')
        .in('inbox_id', inboxIds)
        .eq('date', today)
    : { data: [] }

  const sentMap = new Map<string, number>()
  for (const row of schedRows ?? []) {
    sentMap.set(row.inbox_id, row.actual_sends ?? 0)
  }

  const details: InboxCapacityDetail[] = []

  for (const inbox of allInboxes) {
    const warmTarget  = computeDailyTarget(inbox)
    const outreachCap = Math.floor(warmTarget * 0.7)
    const sentToday   = sentMap.get(inbox.id) ?? 0
    const remaining   = Math.max(0, outreachCap - sentToday)

    const daysSinceCreated = Math.floor(
      (Date.now() - new Date(inbox.created_at).getTime()) / (1000 * 60 * 60 * 24),
    )

    details.push({
      id:                  inbox.id,
      email:               inbox.email,
      warmup_stage:        getWarmupStage(inbox),
      warmup_day:          daysSinceCreated,
      health_score:        inbox.health_score ?? 100,
      daily_warmup_target: warmTarget,
      daily_outreach_cap:  outreachCap,
      sent_today:          sentToday,
      remaining_today:     remaining,
      status:              inbox.status,
      use_for_outreach:    inbox.use_for_outreach,
    })
  }

  // Only outreach-enabled, active inboxes contribute to send totals
  const outreachInboxes = details.filter(
    (d) => d.use_for_outreach && d.status === 'active',
  )

  const totalCap       = outreachInboxes.reduce((s, d) => s + d.daily_outreach_cap, 0)
  const totalSent      = outreachInboxes.reduce((s, d) => s + d.sent_today, 0)
  const totalRemaining = outreachInboxes.reduce((s, d) => s + d.remaining_today, 0)

  // Projections: assume continued daily warming on all active inboxes
  const projectTotal = (inDays: number) =>
    allInboxes
      .filter((i) => i.use_for_outreach && i.status === 'active')
      .reduce((s, i) => s + projectOutreachCap(i, inDays), 0)

  const proj7  = projectTotal(7)
  const proj14 = projectTotal(14)
  const proj30 = projectTotal(30)

  // Build recommendation
  let recommendation: string
  if (outreachInboxes.length === 0) {
    recommendation = 'No outreach-enabled inboxes found. Enable "Use for outreach" on at least one inbox to start sending.'
  } else if (totalCap === 0) {
    recommendation = 'All outreach inboxes have reached their daily cap. Capacity resets at midnight UTC.'
  } else if (outreachInboxes.some((d) => d.health_score < 50)) {
    recommendation = `Some inboxes have low health scores. Focus sending on healthy inboxes to protect deliverability. You can send ${totalRemaining} more emails today.`
  } else if (proj30 > totalCap * 2) {
    recommendation = `Good trajectory! Capacity is growing fast — you'll be able to send ~${proj30} emails/day in 30 days as inboxes warm up. Today's cap: ${totalCap} emails.`
  } else {
    recommendation = `You can send up to ${totalRemaining} more emails today across ${outreachInboxes.length} inbox${outreachInboxes.length === 1 ? '' : 'es'}. Daily cap: ${totalCap}.`
  }

  return {
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    summary: {
      total_inboxes:            allInboxes.length,
      active_outreach_inboxes:  outreachInboxes.length,
      total_outreach_cap_today: totalCap,
      total_sent_today:         totalSent,
      total_remaining_today:    totalRemaining,
    },
    inboxes: details,
    projections: {
      in_7_days:  proj7,
      in_14_days: proj14,
      in_30_days: proj30,
    },
    recommendation,
  }
}
