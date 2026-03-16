import { Hono } from 'hono'

import { estimateBandwidth } from '../lib/bandwidth.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const bandwidthRoutes = new Hono<AppEnv>()

// GET /api/bandwidth/:workspaceId
// Returns an outbound capacity estimate based on all connected tools.
bandwidthRoutes.get('/api/bandwidth/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  try {
    const estimate = await estimateBandwidth(workspaceId, c.get('orgId'))
    return c.json(estimate)
  } catch (error) {
    return c.json(
      { detail: error instanceof Error ? error.message : 'Bandwidth estimation failed.' },
      500,
    )
  }
})
