import { Hono } from 'hono'

import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const campaignsRoutes = new Hono<AppEnv>()

campaignsRoutes.get('/api/launch/:workspaceId/readiness', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getLaunchReadiness(workspaceId))
})

campaignsRoutes.post('/api/launch/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().stageLaunch(workspaceId))
})

campaignsRoutes.get('/api/campaigns/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getCampaign(workspaceId))
})

campaignsRoutes.get('/api/webhooks/instantly/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getWebhook(workspaceId))
})

campaignsRoutes.post('/api/webhooks/instantly/register', async (c) => {
  const payload = await c.req.json<{ workspace_id: string; target_url: string }>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  return c.json(
    getRuntimeStore().setWebhook(
      payload.workspace_id,
      `webhook_${payload.workspace_id}`,
      payload.target_url,
    ),
  )
})
