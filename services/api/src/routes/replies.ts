import { Hono } from 'hono'

import type { ReplyDecisionRequest } from '@pipeiq/shared'

import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const repliesRoutes = new Hono<AppEnv>()

repliesRoutes.get('/api/replies/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().listReplies(workspaceId))
})

repliesRoutes.post('/api/replies/:replyId/decision', async (c) => {
  const replyId = c.req.param('replyId')
  const payload = await c.req.json<ReplyDecisionRequest>()
  const workspaceId = c.req.query('workspace_id') ?? 'default'
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  try {
    return c.json(getRuntimeStore().decideReply(workspaceId, replyId, payload.decision))
  } catch (error) {
    return c.json({ detail: error instanceof Error ? error.message : 'Reply not found.' }, 404)
  }
})

repliesRoutes.get('/api/meetings/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().listMeetings(workspaceId))
})
