import { Hono } from 'hono'

import type { AppEnv } from '../types.js'

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/auth/me', (c) =>
  c.json({
    user_id: c.get('userId'),
    org_id: c.get('orgId'),
    claims: c.get('claims'),
  }),
)
