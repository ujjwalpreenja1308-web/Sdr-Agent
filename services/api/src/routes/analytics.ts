import { Hono } from 'hono'

import { listWorkspaceActivity } from '../lib/activity.js'
import { listExecutionRuns } from '../lib/execution-runs.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.get('/api/activity/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const limit = Number.parseInt(c.req.query('limit') ?? '20', 10)
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const events = await listWorkspaceActivity(workspaceId, Number.isNaN(limit) ? 20 : limit)
  return c.json(events)
})

analyticsRoutes.get('/api/executions/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const limit = Number.parseInt(c.req.query('limit') ?? '20', 10)
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const executions = await listExecutionRuns(workspaceId, Number.isNaN(limit) ? 20 : limit)
  return c.json(executions)
})

analyticsRoutes.get('/api/analytics/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const events = await listWorkspaceActivity(workspaceId, 10)
  return c.json({
    detail: 'Analytics dashboards are not implemented yet in the Hono migration.',
    recent_activity_count: events.length,
  })
})
