import { Hono } from 'hono'

import type { AppEnv } from '../types.js'

export const analyticsRoutes = new Hono<AppEnv>()

analyticsRoutes.get('/api/analytics/:workspaceId', (c) =>
  c.json({
    detail: 'Analytics is not implemented yet in the Hono migration.',
  }),
)
