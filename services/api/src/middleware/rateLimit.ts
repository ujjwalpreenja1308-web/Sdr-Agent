import { createMiddleware } from 'hono/factory'

import type { AppEnv } from '../types.js'

type Bucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 120

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.get('userId') ?? c.req.header('x-forwarded-for') ?? 'anonymous'
  const now = Date.now()
  const bucket = buckets.get(userId)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS })
    await next()
    return
  }

  if (bucket.count >= MAX_REQUESTS) {
    return c.json({ error: 'Rate limit exceeded.' }, 429)
  }

  bucket.count += 1
  await next()
})
