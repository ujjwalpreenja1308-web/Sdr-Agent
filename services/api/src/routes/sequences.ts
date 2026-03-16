import { Hono } from 'hono'

import {
  runSequenceTick,
  enrollContacts,
  getSequenceSummaries,
  getSequenceWithSteps,
  getEnrollmentsForSequence,
  DEFAULT_STEP_TEMPLATES,
} from '../lib/sequencing.js'
import { getSupabaseAdmin } from '../lib/supabase.js'
import {
  validateBody,
  sequenceCreateSchema,
  sequenceUpdateSchema,
  stepCreateSchema,
  stepUpdateSchema,
  enrollRequestSchema,
} from '../lib/validation.js'
import type { AppEnv } from '../types.js'

export const sequenceRoutes = new Hono<AppEnv>()

// ─── GET /api/sequences/:workspaceId ─────────────────────────────────────────
// List all sequences with stats

sequenceRoutes.get('/api/sequences/:workspaceId', async (c) => {
  const { workspaceId } = c.req.param()
  const summaries = await getSequenceSummaries(workspaceId)
  return c.json(summaries)
})

// ─── POST /api/sequences/:workspaceId ────────────────────────────────────────
// Create a sequence (name + optional steps array)

sequenceRoutes.post('/api/sequences/:workspaceId', async (c) => {
  const { workspaceId } = c.req.param()
  const body = await validateBody(c, sequenceCreateSchema)

  const db = getSupabaseAdmin()
  const { data: seq, error: seqErr } = await db
    .from('sequences')
    .insert({
      workspace_id: workspaceId,
      name: body.name.trim(),
      description: body.description ?? null,
      status: 'draft',
    })
    .select('*')
    .single()

  if (seqErr || !seq) return c.json({ error: seqErr?.message ?? 'Insert failed' }, 500)

  // Insert steps if provided — rollback the sequence if steps fail
  if (body.steps && body.steps.length > 0) {
    const stepRows = body.steps.map((s, i) => ({
      sequence_id: seq.id,
      position: i,
      step_type: s.step_type,
      delay_days: i === 0 ? 0 : s.delay_days,
      subject_template: s.subject_template,
      body_template: s.body_template,
    }))
    const { error: stepsErr } = await db.from('sequence_steps').insert(stepRows)
    if (stepsErr) {
      // Rollback: delete the orphaned sequence
      await db.from('sequences').delete().eq('id', seq.id)
      return c.json({ error: `Failed to create steps: ${stepsErr.message}` }, 500)
    }
  }

  const result = await getSequenceWithSteps(seq.id, workspaceId)
  return c.json(result, 201)
})

// ─── GET /api/sequences/:workspaceId/:sequenceId ──────────────────────────────
// Get a single sequence with its steps

sequenceRoutes.get('/api/sequences/:workspaceId/:sequenceId', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const result = await getSequenceWithSteps(sequenceId, workspaceId)
  if (!result) return c.json({ error: 'Sequence not found' }, 404)
  return c.json(result)
})

// ─── PATCH /api/sequences/:workspaceId/:sequenceId ────────────────────────────
// Update sequence name / description / status

sequenceRoutes.patch('/api/sequences/:workspaceId/:sequenceId', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const body = await validateBody(c, sequenceUpdateSchema)

  const db = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) updates.status = body.status

  const { data, error } = await db
    .from('sequences')
    .update(updates)
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()

  if (error || !data) return c.json({ error: error?.message ?? 'Not found' }, error ? 500 : 404)
  return c.json(data)
})

// ─── DELETE /api/sequences/:workspaceId/:sequenceId ───────────────────────────

sequenceRoutes.delete('/api/sequences/:workspaceId/:sequenceId', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('sequences')
    .delete()
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ok: true })
})

// ─── POST /api/sequences/:workspaceId/:sequenceId/steps ───────────────────────
// Append a new step to a sequence

sequenceRoutes.post('/api/sequences/:workspaceId/:sequenceId/steps', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const body = await validateBody(c, stepCreateSchema)

  // Verify ownership
  const db = getSupabaseAdmin()
  const { data: seq } = await db
    .from('sequences')
    .select('id')
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!seq) return c.json({ error: 'Sequence not found' }, 404)

  // Determine next position
  const { data: last } = await db
    .from('sequence_steps')
    .select('position')
    .eq('sequence_id', sequenceId)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const position = (last?.position ?? -1) + 1
  const stepType = body.step_type ?? (position === 0 ? 'icebreaker' : 'follow_up')
  const defaults = DEFAULT_STEP_TEMPLATES[stepType as keyof typeof DEFAULT_STEP_TEMPLATES]
    ?? DEFAULT_STEP_TEMPLATES.follow_up

  const { data: step, error } = await db
    .from('sequence_steps')
    .insert({
      sequence_id: sequenceId,
      position,
      step_type: stepType,
      delay_days: position === 0 ? 0 : (body.delay_days ?? 3),
      subject_template: body.subject_template ?? defaults.subject,
      body_template: body.body_template ?? defaults.body,
    })
    .select('*')
    .single()

  if (error || !step) return c.json({ error: error?.message ?? 'Insert failed' }, 500)
  return c.json(step, 201)
})

// ─── PATCH /api/sequences/:workspaceId/:sequenceId/steps/:stepId ──────────────
// Update a step's content or timing

sequenceRoutes.patch('/api/sequences/:workspaceId/:sequenceId/steps/:stepId', async (c) => {
  const { workspaceId, sequenceId, stepId } = c.req.param()
  const body = await validateBody(c, stepUpdateSchema)

  const db = getSupabaseAdmin()

  // Verify ownership via sequence
  const { data: seq } = await db
    .from('sequences')
    .select('id')
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!seq) return c.json({ error: 'Sequence not found' }, 404)

  const updates: Record<string, unknown> = {}
  if (body.step_type !== undefined) updates.step_type = body.step_type
  if (body.delay_days !== undefined) updates.delay_days = body.delay_days
  if (body.subject_template !== undefined) updates.subject_template = body.subject_template
  if (body.body_template !== undefined) updates.body_template = body.body_template

  const { data, error } = await db
    .from('sequence_steps')
    .update(updates)
    .eq('id', stepId)
    .eq('sequence_id', sequenceId)
    .select('*')
    .single()

  if (error || !data) return c.json({ error: error?.message ?? 'Not found' }, error ? 500 : 404)
  return c.json(data)
})

// ─── DELETE /api/sequences/:workspaceId/:sequenceId/steps/:stepId ─────────────

sequenceRoutes.delete('/api/sequences/:workspaceId/:sequenceId/steps/:stepId', async (c) => {
  const { workspaceId, sequenceId, stepId } = c.req.param()
  const db = getSupabaseAdmin()

  const { data: seq } = await db
    .from('sequences')
    .select('id')
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!seq) return c.json({ error: 'Sequence not found' }, 404)

  const { error } = await db
    .from('sequence_steps')
    .delete()
    .eq('id', stepId)
    .eq('sequence_id', sequenceId)

  if (error) return c.json({ error: error.message }, 500)

  // Recompact positions so they stay contiguous
  const { data: remaining } = await db
    .from('sequence_steps')
    .select('id')
    .eq('sequence_id', sequenceId)
    .order('position', { ascending: true })

  if (remaining) {
    for (let i = 0; i < remaining.length; i++) {
      await db.from('sequence_steps').update({ position: i }).eq('id', remaining[i]!.id)
    }
  }

  return c.json({ ok: true })
})

// ─── POST /api/sequences/:workspaceId/:sequenceId/enroll ──────────────────────
// Enroll one or more contacts into the sequence

sequenceRoutes.post('/api/sequences/:workspaceId/:sequenceId/enroll', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const body = await validateBody(c, enrollRequestSchema)

  // Verify sequence belongs to workspace
  const db = getSupabaseAdmin()
  const { data: seq } = await db
    .from('sequences')
    .select('id, status')
    .eq('id', sequenceId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!seq) return c.json({ error: 'Sequence not found' }, 404)

  const result = await enrollContacts(sequenceId, body.contact_ids, workspaceId)
  return c.json(result)
})

// ─── GET /api/sequences/:workspaceId/:sequenceId/enrollments ──────────────────
// List enrollments for a sequence

sequenceRoutes.get('/api/sequences/:workspaceId/:sequenceId/enrollments', async (c) => {
  const { workspaceId, sequenceId } = c.req.param()
  const enrollments = await getEnrollmentsForSequence(sequenceId, workspaceId)
  return c.json(enrollments)
})

// ─── POST /api/sequences/:workspaceId/:sequenceId/enrollments/:id/pause ───────

sequenceRoutes.post(
  '/api/sequences/:workspaceId/:sequenceId/enrollments/:enrollmentId/pause',
  async (c) => {
    const { workspaceId, enrollmentId } = c.req.param()
    const db = getSupabaseAdmin()
    const { error } = await db
      .from('sequence_enrollments')
      .update({ status: 'paused' })
      .eq('id', enrollmentId)
      .eq('workspace_id', workspaceId)
    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true })
  },
)

// ─── POST /api/sequences/:workspaceId/:sequenceId/enrollments/:id/resume ──────

sequenceRoutes.post(
  '/api/sequences/:workspaceId/:sequenceId/enrollments/:enrollmentId/resume',
  async (c) => {
    const { workspaceId, enrollmentId } = c.req.param()
    const db = getSupabaseAdmin()

    // Resume with a minimum 1-hour delay to avoid sending immediately after un-pause
    // (preserves the intent of step spacing rather than firing instantly)
    const resumeSendAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const { data, error } = await db
      .from('sequence_enrollments')
      .update({ status: 'active', next_send_at: resumeSendAt })
      .eq('id', enrollmentId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'paused')
      .select('id')

    if (error) return c.json({ error: error.message }, 500)
    if (!data || data.length === 0) return c.json({ error: 'Enrollment not found or not paused' }, 404)
    return c.json({ ok: true, next_send_at: resumeSendAt })
  },
)

// ─── POST /api/sequences/:workspaceId/tick ────────────────────────────────────
// Manually trigger the sequence tick (for testing / on-demand)

sequenceRoutes.post('/api/sequences/:workspaceId/tick', async (c) => {
  const { workspaceId } = c.req.param()
  const result = await runSequenceTick(workspaceId)
  return c.json(result)
})
