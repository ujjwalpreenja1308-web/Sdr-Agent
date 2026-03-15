import { Hono } from 'hono'
import { tasks } from '@trigger.dev/sdk/v3'

import type { AuditLog, InstantlyWebhookEvent, JsonObject } from '@pipeiq/shared'

import type { processInstantlyReplyTask } from '../trigger/outbound-jobs.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { getSupabaseAdmin } from '../lib/supabase.js'
import { env } from '../lib/env.js'
import type { AppEnv } from '../types.js'

export const webhooksRoutes = new Hono<AppEnv>()

function looksLikeInstantly(headers: Headers): boolean {
  return (
    headers.has('x-instantly-signature') ||
    headers.has('x-pipeiq-webhook-secret') ||
    headers.has('x-instantly-event') ||
    (headers.get('user-agent') ?? '').toLowerCase().includes('instantly')
  )
}

async function logAuditEvent(workspaceId: string, event: InstantlyWebhookEvent): Promise<void> {
  const rawEvent = JSON.parse(JSON.stringify(event)) as JsonObject
  const payload: Omit<AuditLog, 'id'> = {
    workspace_id: workspaceId,
    action: `instantly.${event.event_type}`,
    entity_type: 'webhook_event',
    entity_id: null,
    actor_type: 'system',
    actor_id: null,
    metadata_json: {
      raw_event: rawEvent,
    },
    created_at: new Date().toISOString(),
  }
  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase.from('audit_log').insert(payload)
    if (result.error) {
      throw new Error(result.error.message)
    }
  } catch {
    console.warn('Supabase audit_log insert failed, keeping webhook log in process only.', payload)
  }
}

async function enqueueReplyProcessing(
  workspaceId: string,
  event: InstantlyWebhookEvent,
): Promise<void> {
  if (!env.triggerSecretKey) {
    getRuntimeStore().ingestInstantlyEvent(workspaceId, event)
    return
  }

  await tasks.trigger<typeof processInstantlyReplyTask>('process-instantly-reply', {
    workspaceId,
    event,
  })
}

webhooksRoutes.post('/webhooks/instantly', async (c) => {
  const payload = await c.req.json<InstantlyWebhookEvent>()

  if (!looksLikeInstantly(c.req.raw.headers)) {
    return c.json({ error: 'Webhook headers failed verification.' }, 401)
  }

  const workspaceId = payload.workspace || 'default'
  await logAuditEvent(workspaceId, payload)
  await enqueueReplyProcessing(workspaceId, payload)
  console.info('Queued Instantly webhook for background processing.', {
    workspaceId,
    eventType: payload.event_type,
  })
  return c.json({ accepted: true }, 200)
})

webhooksRoutes.post('/api/webhooks/instantly', async (c) => {
  const payload = await c.req.json<InstantlyWebhookEvent>()

  if (!looksLikeInstantly(c.req.raw.headers)) {
    return c.json({ error: 'Webhook headers failed verification.' }, 401)
  }

  const workspaceId = payload.workspace || 'default'
  await logAuditEvent(workspaceId, payload)
  await enqueueReplyProcessing(workspaceId, payload)
  console.info('Queued Instantly webhook for background processing.', {
    workspaceId,
    eventType: payload.event_type,
  })
  return c.json({ accepted: true }, 200)
})
