import { Hono } from 'hono'
import { tasks } from '@trigger.dev/sdk/v3'

import type { InstantlyWebhookEvent, JsonObject } from '@pipeiq/shared'

import type { processInstantlyReplyTask } from '../trigger/outbound-jobs.js'
import { logWorkspaceEvent } from '../lib/activity.js'
import { beginExecution, executionKey, finishExecution } from '../lib/execution-runs.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { findWorkspaceByCampaignId, findWorkspaceOrgId } from '../lib/supabase.js'
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
  await logWorkspaceEvent({
    workspaceId,
    action: `instantly.${event.event_type}`,
    entityType: 'webhook_event',
    actorType: 'system',
    summary: `Received Instantly webhook event ${event.event_type}.`,
    metadata: {
      raw_event: rawEvent,
    },
  })
}

async function enqueueReplyProcessing(
  workspaceId: string,
  orgId: string,
  event: InstantlyWebhookEvent,
  executionRunId: string,
  dedupeKey: string,
): Promise<void> {
  if (!env.triggerSecretKey) {
    const store = getRuntimeStore()
    await store.hydrateWorkspace(workspaceId, orgId)
    store.ingestInstantlyEvent(workspaceId, event)
    await store.persistWorkspace(workspaceId, orgId)
    await finishExecution({
      workspaceId,
      scope: 'webhook.instantly.process',
      runId: executionRunId,
      executionKey: dedupeKey,
      actorType: 'system',
      summary: `Processed Instantly webhook event ${event.event_type}.`,
      status: 'completed',
      metadata: {
        event_type: event.event_type,
      },
    })
    return
  }

  await tasks.trigger<typeof processInstantlyReplyTask>('process-instantly-reply', {
    workspaceId,
    event,
    executionRunId,
    dedupeKey,
  })
}

async function resolveWorkspaceId(event: InstantlyWebhookEvent): Promise<string | null> {
  if (typeof event.workspace === 'string' && event.workspace.trim().length > 0) {
    return event.workspace
  }

  if (typeof event.campaign_id === 'string' && event.campaign_id.trim().length > 0) {
    const workspace = await findWorkspaceByCampaignId(event.campaign_id)
    if (workspace) {
      return workspace.workspaceId
    }
  }

  return null
}

webhooksRoutes.post('/webhooks/instantly', async (c) => {
  const payload = await c.req.json<InstantlyWebhookEvent>()

  if (!looksLikeInstantly(c.req.raw.headers)) {
    return c.json({ error: 'Webhook headers failed verification.' }, 401)
  }

  const workspaceId = await resolveWorkspaceId(payload)
  if (!workspaceId) {
    return c.json({ error: 'Could not resolve workspace for webhook payload.' }, 400)
  }
  const orgId = await findWorkspaceOrgId(workspaceId)
  if (!orgId) {
    return c.json({ error: 'Could not resolve org for webhook payload.' }, 400)
  }
  const dedupeKey = executionKey([
    payload.event_type,
    payload.email_id ?? null,
    payload.campaign_id ?? null,
    payload.lead_email ?? null,
    payload.timestamp ?? null,
  ])
  const execution = await beginExecution({
    workspaceId,
    scope: 'webhook.instantly.process',
    executionKey: dedupeKey,
    actorType: 'system',
    summary: `Processing Instantly webhook event ${payload.event_type}.`,
    metadata: {
      event_type: payload.event_type,
    },
    dedupeWindowMs: 60 * 60 * 1000,
  })
  if (execution.kind !== 'started') {
    return c.json({ accepted: true, duplicate: true }, 200)
  }
  await logAuditEvent(workspaceId, payload)
  await enqueueReplyProcessing(workspaceId, orgId, payload, execution.runId, dedupeKey)
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

  const workspaceId = await resolveWorkspaceId(payload)
  if (!workspaceId) {
    return c.json({ error: 'Could not resolve workspace for webhook payload.' }, 400)
  }
  const orgId = await findWorkspaceOrgId(workspaceId)
  if (!orgId) {
    return c.json({ error: 'Could not resolve org for webhook payload.' }, 400)
  }
  const dedupeKey = executionKey([
    payload.event_type,
    payload.email_id ?? null,
    payload.campaign_id ?? null,
    payload.lead_email ?? null,
    payload.timestamp ?? null,
  ])
  const execution = await beginExecution({
    workspaceId,
    scope: 'webhook.instantly.process',
    executionKey: dedupeKey,
    actorType: 'system',
    summary: `Processing Instantly webhook event ${payload.event_type}.`,
    metadata: {
      event_type: payload.event_type,
    },
    dedupeWindowMs: 60 * 60 * 1000,
  })
  if (execution.kind !== 'started') {
    return c.json({ accepted: true, duplicate: true }, 200)
  }
  await logAuditEvent(workspaceId, payload)
  await enqueueReplyProcessing(workspaceId, orgId, payload, execution.runId, dedupeKey)
  console.info('Queued Instantly webhook for background processing.', {
    workspaceId,
    eventType: payload.event_type,
  })
  return c.json({ accepted: true }, 200)
})
