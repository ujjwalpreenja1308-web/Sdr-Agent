import { Hono } from 'hono'

import type { AuditLog, InstantlyWebhookEvent, JsonObject } from '@pipeiq/shared'

import { getRuntimeStore } from '../lib/runtime-store.js'
import { getSupabaseAdmin } from '../lib/supabase.js'
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

webhooksRoutes.post('/webhooks/instantly', async (c) => {
  const payload = await c.req.json<InstantlyWebhookEvent>()

  if (!looksLikeInstantly(c.req.raw.headers)) {
    return c.json({ error: 'Webhook headers failed verification.' }, 401)
  }

  const workspaceId = payload.workspace || 'default'
  await logAuditEvent(workspaceId, payload)
  const receipt = getRuntimeStore().ingestInstantlyEvent(workspaceId, payload)
  console.info('Queued Instantly webhook for background processing stub.', receipt)
  return c.json(receipt, 200)
})

webhooksRoutes.post('/api/webhooks/instantly', async (c) => {
  const payload = await c.req.json<InstantlyWebhookEvent>()

  if (!looksLikeInstantly(c.req.raw.headers)) {
    return c.json({ error: 'Webhook headers failed verification.' }, 401)
  }

  const workspaceId = payload.workspace || 'default'
  await logAuditEvent(workspaceId, payload)
  const receipt = getRuntimeStore().ingestInstantlyEvent(workspaceId, payload)
  console.info('Queued Instantly webhook for background processing stub.', receipt)
  return c.json(receipt, 200)
})
