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
import { campaignsRoutes } from './routes/campaigns.js'
import { chatRoutes } from './routes/chat.js'
import { connectionsRoutes } from './routes/connections.js'
import { leadsRoutes } from './routes/leads.js'
import { repliesRoutes } from './routes/replies.js'
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
