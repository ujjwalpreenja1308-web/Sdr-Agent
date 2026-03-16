import { Hono } from 'hono'

import { logWorkspaceEvent } from '../lib/activity.js'
import { beginExecution, executionKey, finishExecution } from '../lib/execution-runs.js'
import { launchInstantlyCampaign } from '../lib/instantly.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const campaignsRoutes = new Hono<AppEnv>()

campaignsRoutes.get('/api/launch/:workspaceId/readiness', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getLaunchReadiness(workspaceId))
})

campaignsRoutes.post('/api/launch/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  const workspace = store.getWorkspaceSummary(workspaceId)
  const approvedContacts = store
    .getPipeline(workspaceId)
    .contacts.filter((contact) => contact.status === 'approved_to_launch')
  const runKey = executionKey([
    approvedContacts.map((contact) => contact.id),
    workspace.connections
      .filter((connection) => connection.toolkit === 'instantly')
      .map((connection) => connection.status),
  ])
  const launchExecution = await beginExecution({
    workspaceId,
    scope: 'launch.stage',
    executionKey: runKey,
    actorType: 'agent',
    actorId: 'launcher',
    summary: 'Starting launch staging.',
  })
  if (launchExecution.kind !== 'started') {
    return c.json(store.currentLaunchResult(workspaceId))
  }
  try {
    const instantlyConnected = workspace.connections.some(
      (connection) => connection.toolkit === 'instantly' && connection.status === 'connected',
    )
    let result
    if (instantlyConnected) {
      const onboarding = store.getOnboarding(workspaceId)
      const launch = await launchInstantlyCampaign({
        workspaceId,
        orgId: c.get('orgId'),
        campaignName: `${workspace.name} - First Outbound Wave`,
        onboarding,
        contacts: approvedContacts,
      })
      result = store.recordInstantlyLaunch(
        workspaceId,
        launch.campaignId,
        launch.importedCount,
        launch.summary,
      )
    } else {
      result = store.stageLaunch(workspaceId)
    }
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await finishExecution({
      workspaceId,
      scope: 'launch.stage',
      runId: launchExecution.runId,
      executionKey: runKey,
      actorType: 'agent',
      actorId: 'launcher',
      status: result.status === 'staged' ? 'completed' : 'skipped',
      summary: result.message,
      metadata: {
        status: result.status,
        contacts_launched: result.contacts_launched,
        mode: result.mode ?? null,
      },
    })
    await logWorkspaceEvent({
      workspaceId,
      action: result.status === 'staged' ? 'campaign.staged' : 'campaign.blocked',
      entityType: 'campaign',
      entityId: result.campaign_id ?? null,
      actorType: 'agent',
      actorId: 'launcher',
      summary: result.message,
      metadata: {
        status: result.status,
        contacts_launched: result.contacts_launched,
        blockers: result.blockers,
        mode: result.mode ?? null,
      },
    })
    return c.json(result)
  } catch (error) {
    await finishExecution({
      workspaceId,
      scope: 'launch.stage',
      runId: launchExecution.runId,
      executionKey: runKey,
      actorType: 'agent',
      actorId: 'launcher',
      status: 'failed',
      summary: error instanceof Error ? error.message : 'Launch failed.',
      metadata: {},
    })
    return c.json(
      {
        workspace_id: workspaceId,
        status: 'blocked',
        contacts_launched: 0,
        message: error instanceof Error ? error.message : 'Launch failed.',
        blockers: [error instanceof Error ? error.message : 'Launch failed.'],
      },
      200,
    )
  }
})

campaignsRoutes.get('/api/campaigns/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getCampaign(workspaceId))
})

campaignsRoutes.get('/api/webhooks/instantly/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getWebhook(workspaceId))
})

campaignsRoutes.post('/api/webhooks/instantly/register', async (c) => {
  const payload = await c.req.json<{ workspace_id: string; target_url: string }>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(payload.workspace_id, c.get('orgId'))
  const result = store.setWebhook(
    payload.workspace_id,
    `webhook_${payload.workspace_id}`,
    payload.target_url,
  )
  await store.persistWorkspace(payload.workspace_id, c.get('orgId'))
  await logWorkspaceEvent({
    workspaceId: payload.workspace_id,
    action: 'webhook.registered',
    entityType: 'webhook_subscription',
    entityId: result.webhook_id ?? null,
    actorType: 'user',
    actorId: c.get('userId'),
    summary: 'Registered the Instantly webhook target for reply ingestion.',
    metadata: {
      target_url: result.target_url ?? null,
      event_type: result.event_type,
    },
  })
  return c.json(result)
})
