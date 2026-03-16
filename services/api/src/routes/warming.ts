import { Hono } from 'hono'

import {
  runWarmingCycle,
  testSmtpConnection,
  testImapConnection,
  getWarmingOverview,
  getInboxStats,
  stripCredentials,
} from '../lib/warming.js'
import { encrypt } from '../lib/encryption.js'
import { getSupabaseAdmin } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const warmingRoutes = new Hono<AppEnv>()

// ─── GET /api/warming/:workspaceId ─────────────────────────────────────────────
// Overview: all inboxes + aggregate stats

warmingRoutes.get('/api/warming/:workspaceId', async (c) => {
  const { workspaceId } = c.req.param()
  const overview = await getWarmingOverview(workspaceId)
  if (!overview) return c.json({ error: 'Workspace not found' }, 404)
  return c.json(overview)
})

// ─── POST /api/warming/:workspaceId/inboxes ────────────────────────────────────
// Add a new inbox to the warming pool

warmingRoutes.post('/api/warming/:workspaceId/inboxes', async (c) => {
  const { workspaceId } = c.req.param()
  const body = await c.req.json()

  const {
    email,
    display_name,
    smtp_host,
    smtp_port = 587,
    smtp_user,
    smtp_pass,
    smtp_secure = false,
    imap_host,
    imap_port = 993,
    imap_user,
    imap_pass,
    daily_target = 30,
    use_for_outreach = false,
  } = body

  if (!email || !smtp_host || !smtp_user || !smtp_pass || !imap_host || !imap_user || !imap_pass) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  // Test connections before saving
  const smtpTest = await testSmtpConnection(smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure)
  if (!smtpTest.ok) {
    return c.json({ error: `SMTP connection failed: ${smtpTest.error}` }, 422)
  }

  const imapTest = await testImapConnection(imap_host, imap_port, imap_user, imap_pass)
  if (!imapTest.ok) {
    return c.json({ error: `IMAP connection failed: ${imapTest.error}` }, 422)
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('warming_inboxes')
    .insert({
      workspace_id: workspaceId,
      email,
      display_name: display_name ?? null,
      smtp_host,
      smtp_port,
      smtp_user,
      smtp_pass_enc: encrypt(smtp_pass),
      smtp_secure,
      imap_host,
      imap_port,
      imap_user,
      imap_pass_enc: encrypt(imap_pass),
      daily_target: Math.min(40, Math.max(1, daily_target)),
      use_for_outreach,
      status: 'active',
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: 'This inbox is already connected to this workspace' }, 409)
    }
    return c.json({ error: error.message }, 500)
  }

  return c.json(stripCredentials(data), 201)
})

// ─── PATCH /api/warming/:workspaceId/inboxes/:inboxId ─────────────────────────
// Update inbox settings (daily target, warmup toggle, outreach flag, credentials)

warmingRoutes.patch('/api/warming/:workspaceId/inboxes/:inboxId', async (c) => {
  const { workspaceId, inboxId } = c.req.param()
  const body = await c.req.json()

  const db = getSupabaseAdmin()

  // Verify ownership
  const { data: existing } = await db
    .from('warming_inboxes')
    .select('id')
    .eq('id', inboxId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!existing) return c.json({ error: 'Inbox not found' }, 404)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body.display_name !== undefined) updates.display_name = body.display_name
  if (body.daily_target !== undefined) updates.daily_target = Math.min(40, Math.max(1, body.daily_target))
  if (body.warmup_enabled !== undefined) updates.warmup_enabled = body.warmup_enabled
  if (body.use_for_outreach !== undefined) updates.use_for_outreach = body.use_for_outreach
  if (body.status !== undefined) updates.status = body.status

  // Credential updates (optional)
  if (body.smtp_pass) {
    const { data: row } = await db
      .from('warming_inboxes')
      .select('smtp_host, smtp_port, smtp_user, smtp_secure')
      .eq('id', inboxId)
      .single()
    if (row) {
      const test = await testSmtpConnection(
        row.smtp_host, row.smtp_port, row.smtp_user, body.smtp_pass, row.smtp_secure,
      )
      if (!test.ok) return c.json({ error: `SMTP test failed: ${test.error}` }, 422)
      updates.smtp_pass_enc = encrypt(body.smtp_pass)
    }
  }

  if (body.imap_pass) {
    const { data: row } = await db
      .from('warming_inboxes')
      .select('imap_host, imap_port, imap_user')
      .eq('id', inboxId)
      .single()
    if (row) {
      const test = await testImapConnection(row.imap_host, row.imap_port, row.imap_user, body.imap_pass)
      if (!test.ok) return c.json({ error: `IMAP test failed: ${test.error}` }, 422)
      updates.imap_pass_enc = encrypt(body.imap_pass)
    }
  }

  const { data, error } = await db
    .from('warming_inboxes')
    .update(updates)
    .eq('id', inboxId)
    .select('*')
    .single()

  if (error) return c.json({ error: error.message }, 500)

  return c.json(stripCredentials(data))
})

// ─── DELETE /api/warming/:workspaceId/inboxes/:inboxId ────────────────────────

warmingRoutes.delete('/api/warming/:workspaceId/inboxes/:inboxId', async (c) => {
  const { workspaceId, inboxId } = c.req.param()
  const db = getSupabaseAdmin()

  const { error } = await db
    .from('warming_inboxes')
    .delete()
    .eq('id', inboxId)
    .eq('workspace_id', workspaceId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})

// ─── GET /api/warming/:workspaceId/inboxes/:inboxId/stats ─────────────────────
// 14-day stats for a specific inbox

warmingRoutes.get('/api/warming/:workspaceId/inboxes/:inboxId/stats', async (c) => {
  const { workspaceId, inboxId } = c.req.param()
  const stats = await getInboxStats(inboxId, workspaceId)
  if (!stats) return c.json({ error: 'Inbox not found' }, 404)
  return c.json(stats)
})

// ─── POST /api/warming/:workspaceId/run ───────────────────────────────────────
// Manually trigger a warming cycle (also called by the cron job)

warmingRoutes.post('/api/warming/:workspaceId/run', async (c) => {
  const { workspaceId } = c.req.param()
  const result = await runWarmingCycle(workspaceId)
  return c.json(result)
})

// ─── POST /api/warming/:workspaceId/test-credentials ─────────────────────────
// Test SMTP + IMAP credentials without saving

warmingRoutes.post('/api/warming/:workspaceId/test-credentials', async (c) => {
  const body = await c.req.json()
  const {
    smtp_host, smtp_port = 587, smtp_user, smtp_pass, smtp_secure = false,
    imap_host, imap_port = 993, imap_user, imap_pass,
  } = body

  const [smtpResult, imapResult] = await Promise.all([
    testSmtpConnection(smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure),
    testImapConnection(imap_host, imap_port, imap_user, imap_pass),
  ])

  return c.json({
    smtp: smtpResult,
    imap: imapResult,
    ok: smtpResult.ok && imapResult.ok,
  })
})

// ─── GET /api/warming/:workspaceId/capacity ───────────────────────────────────
// Legacy: simple remaining-today count across outreach-enabled inboxes

warmingRoutes.get('/api/warming/:workspaceId/capacity', async (c) => {
  const { workspaceId } = c.req.param()
  const { getOutreachCapacity } = await import('../lib/smtp-pool.js')
  const capacity = await getOutreachCapacity(workspaceId)
  return c.json(capacity)
})

// ─── GET /api/warming/:workspaceId/send-capacity ──────────────────────────────
// Full send capacity report: per-inbox warmup stage, daily cap, today's usage,
// and projected capacity growth over the next 7 / 14 / 30 days.

warmingRoutes.get('/api/warming/:workspaceId/send-capacity', async (c) => {
  const { workspaceId } = c.req.param()
  const { getSendCapacityReport } = await import('../lib/send-capacity.js')
  const report = await getSendCapacityReport(workspaceId)
  return c.json(report)
})
