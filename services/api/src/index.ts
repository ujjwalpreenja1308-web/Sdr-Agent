import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { allowedOrigins, env } from './lib/env.js'
import { authMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { analyticsRoutes } from './routes/analytics.js'
import { authRoutes } from './routes/auth.js'
import { bandwidthRoutes } from './routes/bandwidth.js'
import { campaignsRoutes } from './routes/campaigns.js'
import { chatRoutes } from './routes/chat.js'
import { connectionsRoutes } from './routes/connections.js'
import { knowledgeRoutes } from './routes/knowledge.js'
import { leadsRoutes } from './routes/leads.js'
import { observabilityRoutes } from './routes/observability.js'
import { repliesRoutes } from './routes/replies.js'
import { warmingRoutes } from './routes/warming.js'
import { sequenceRoutes } from './routes/sequences.js'
import { webhooksRoutes } from './routes/webhooks.js'
import { workspacesRoutes } from './routes/workspaces.js'
import type { AppEnv } from './types.js'

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.onError(errorHandler)
  app.use(
    '*',
    cors({
      origin: allowedOrigins(),
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.route('/', webhooksRoutes)

  // Internal cron: DigitalOcean calls this hourly to advance email sequences
  app.post('/internal/sequences/tick-all', async (c) => {
    const secret = c.req.header('x-cron-secret')
    if (!secret || secret !== env.warmingCronSecret) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const { runSequenceTick } = await import('./lib/sequencing.js')
    const { getSupabaseAdmin } = await import('./lib/supabase.js')
    const db = getSupabaseAdmin()
    const { data: workspaces } = await db.from('workspaces').select('id')
    if (!workspaces) return c.json({ ok: true, processed: 0 })
    const results = await Promise.allSettled(
      workspaces.map((w: { id: string }) => runSequenceTick(w.id)),
    )
    const summaries = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { error: String(r.reason) },
    )
    return c.json({ ok: true, processed: workspaces.length, summaries })
  })

  // Internal cron: DigitalOcean calls this daily at 08:00 UTC
  // Authenticated by shared secret header (no JWT required)
  app.post('/internal/warming/run-all', async (c) => {
    const secret = c.req.header('x-cron-secret')
    if (!secret || secret !== env.warmingCronSecret) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const { runWarmingCycle } = await import('./lib/warming.js')
    const { getSupabaseAdmin } = await import('./lib/supabase.js')
    const db = getSupabaseAdmin()
    const { data: workspaces } = await db.from('workspaces').select('id')
    if (!workspaces) return c.json({ ok: true, processed: 0 })
    const results = await Promise.allSettled(
      workspaces.map((w: { id: string }) => runWarmingCycle(w.id)),
    )
    const summaries = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { error: String(r.reason) },
    )
    return c.json({ ok: true, processed: workspaces.length, summaries })
  })

  app.use('*', authMiddleware)
  app.use('*', rateLimitMiddleware)

  app.route('/', authRoutes)
  app.route('/', workspacesRoutes)
  app.route('/', leadsRoutes)
  app.route('/', campaignsRoutes)
  app.route('/', repliesRoutes)
  app.route('/', connectionsRoutes)
  app.route('/', chatRoutes)
  app.route('/', analyticsRoutes)
  app.route('/', knowledgeRoutes)
  app.route('/', bandwidthRoutes)
  app.route('/', observabilityRoutes)
  app.route('/', warmingRoutes)
  app.route('/', sequenceRoutes)

  return app
}

export const app = createApp()

const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]

if (isEntryPoint) {
  serve(
    {
      fetch: app.fetch,
      port: env.port,
    },
    (info) => {
      console.log(`PipeIQ API listening on http://localhost:${info.port}`)
    },
  )
}
