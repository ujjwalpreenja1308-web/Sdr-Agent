import { Hono } from 'hono'

import type { OnboardingProfile } from '@pipeiq/shared'

import { logWorkspaceEvent } from '../lib/activity.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const workspacesRoutes = new Hono<AppEnv>()

workspacesRoutes.get('/api/workspaces/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getWorkspaceSummary(workspaceId))
})

workspacesRoutes.get('/api/onboarding/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getOnboarding(workspaceId))
})

workspacesRoutes.put('/api/onboarding/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const payload = (await c.req.json()) as OnboardingProfile
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  const result = store.updateOnboarding(workspaceId, payload)
  await store.persistWorkspace(workspaceId, c.get('orgId'))
  await logWorkspaceEvent({
    workspaceId,
    action: 'onboarding.updated',
    entityType: 'workspace',
    entityId: workspaceId,
    actorType: 'user',
    actorId: c.get('userId'),
    summary: 'Updated workspace onboarding and targeting inputs.',
    metadata: {
      industries: result.industries,
      titles: result.titles,
      company_sizes: result.company_sizes,
      geos: result.geos,
    },
  })
  return c.json(result)
})
