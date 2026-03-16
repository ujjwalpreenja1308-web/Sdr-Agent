import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'

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

  // ─── Cron helpers ──────────────────────────────────────────────────────────

  /** Constant-time comparison to prevent timing attacks on cron secret */
  function verifyCronSecret(provided: string | undefined): boolean {
    if (!provided || !env.warmingCronSecret) return false
    try {
      const a = Buffer.from(provided, 'utf8')
      const b = Buffer.from(env.warmingCronSecret, 'utf8')
      if (a.length !== b.length) return false
      return timingSafeEqual(a, b)
    } catch {
      return false
    }
  }

  /** Run an async fn per workspace with a hard timeout per workspace */
  async function forEachWorkspace<T>(
    fn: (workspaceId: string) => Promise<T>,
    timeoutMs = 120_000,
  ): Promise<{ workspace_id: string; result?: T; error?: string }[]> {
    const { getSupabaseAdmin } = await import('./lib/supabase.js')
    const db = getSupabaseAdmin()
    const { data: workspaces } = await db.from('workspaces').select('id')
    if (!workspaces || workspaces.length === 0) return []

    const results = await Promise.allSettled(
      workspaces.map(async (w: { id: string }) => {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs / 1000}s`)), timeoutMs),
        )
        const result = await Promise.race([fn(w.id), timeout])
        return { workspace_id: w.id, result }
      }),
    )

    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { workspace_id: workspaces[i]!.id, error: String(r.reason) },
    )
  }

  // Internal cron: DigitalOcean calls this hourly to advance email sequences
  app.post('/internal/sequences/tick-all', async (c) => {
    if (!verifyCronSecret(c.req.header('x-cron-secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const { runSequenceTick } = await import('./lib/sequencing.js')
    const summaries = await forEachWorkspace((id) => runSequenceTick(id), 120_000)
    return c.json({ ok: true, processed: summaries.length, summaries })
  })

  // Internal cron: DigitalOcean calls this daily at 08:00 UTC
  app.post('/internal/warming/run-all', async (c) => {
    if (!verifyCronSecret(c.req.header('x-cron-secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    const { runWarmingCycle } = await import('./lib/warming.js')
    const summaries = await forEachWorkspace((id) => runWarmingCycle(id), 300_000)
    return c.json({ ok: true, processed: summaries.length, summaries })
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
