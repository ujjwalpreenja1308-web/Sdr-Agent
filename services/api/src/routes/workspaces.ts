import { Hono } from 'hono'

import type { OnboardingProfile } from '@pipeiq/shared'

import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const workspacesRoutes = new Hono<AppEnv>()

workspacesRoutes.get('/api/workspaces/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getWorkspaceSummary(workspaceId))
})

workspacesRoutes.get('/api/onboarding/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getOnboarding(workspaceId))
})

workspacesRoutes.put('/api/onboarding/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const payload = (await c.req.json()) as OnboardingProfile
  return c.json(getRuntimeStore().updateOnboarding(workspaceId, payload))
})
