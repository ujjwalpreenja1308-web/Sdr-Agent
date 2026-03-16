import { Hono } from 'hono'

import type {
  ApiKeyConnectionRequest,
  IntegrationCheckResult,
  OAuthConnectionRequest,
} from '@pipeiq/shared'

import { getApolloConnectionHealth, validateApolloApiKey } from '../lib/apollo.js'
import { authConfigIdForToolkit, getComposioClient } from '../lib/composio.js'
import { logWorkspaceEvent } from '../lib/activity.js'
import { env } from '../lib/env.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import {
  ensureWorkspaceRecord,
  storeWorkspaceApiKey,
  updateWorkspaceComposioEntity,
} from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const connectionsRoutes = new Hono<AppEnv>()

function composioUserId(workspaceId: string, orgId: string): string {
  return `org_${orgId}:workspace_${workspaceId}`
}

connectionsRoutes.post('/connections/initiate', async (c) => {
  const payload = await c.req.json<OAuthConnectionRequest>()
  const orgId = c.get('orgId')
  const workspace = await ensureWorkspaceRecord(payload.workspace_id, orgId)
  const store = getRuntimeStore()
  await store.hydrateWorkspace(payload.workspace_id, orgId)
  const userId = workspace.composio_entity_id ?? composioUserId(payload.workspace_id, orgId)
  const authConfigId = authConfigIdForToolkit(payload.toolkit)

  if (workspace.composio_entity_id !== userId) {
    await updateWorkspaceComposioEntity(payload.workspace_id, orgId, userId)
  }

  const composio = getComposioClient()
  const session = await composio.create(userId, {
    manageConnections: false,
    ...(authConfigId
      ? {
          authConfigs: {
            [payload.toolkit]: authConfigId,
          },
        }
      : {}),
  })
  const connectionRequest = await session.authorize(payload.toolkit, {
    callbackUrl: payload.callback_url || env.defaultCallbackUrl,
  })

  const launch = store.recordConnectionLaunch(
    payload.workspace_id,
    payload.toolkit,
    payload.external_user_id || userId,
    session.sessionId,
    connectionRequest.id,
    'Connection launched. Poll the status endpoint until the account becomes ACTIVE.',
  )
  await store.persistWorkspace(payload.workspace_id, orgId)
  await logWorkspaceEvent({
    workspaceId: payload.workspace_id,
    action: 'connection.initiated',
    entityType: 'connection',
    entityId: launch.connection_id,
    actorType: 'user',
    actorId: c.get('userId'),
    summary: `Started the ${payload.toolkit} Composio connection flow.`,
    metadata: {
      toolkit: payload.toolkit,
      session_id: launch.session_id,
      mode: launch.mode,
    },
  })

  return c.json({
    ...launch,
    redirect_url: connectionRequest.redirectUrl,
  })
})

connectionsRoutes.get('/connections/status/:connectionId', async (c) => {
  const connectionId = c.req.param('connectionId')
  const store = getRuntimeStore()
  const lookup = await store.resolveConnectionLookup(connectionId, c.get('orgId'))
  if (!lookup) {
    return c.json({ detail: 'Unknown connection id.' }, 404)
  }
  await store.hydrateWorkspace(lookup.workspaceId, c.get('orgId'))

  try {
    const composio = getComposioClient()
    const connectedAccount = await composio.connectedAccounts.waitForConnection(connectionId, 1000)
    let result
    try {
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      )
    } catch {
      // toolkit not yet in in-memory map (e.g. server restarted); seed it and retry
      store.recordConnectionLaunch(
        lookup.workspaceId,
        lookup.toolkit,
        'unknown',
        'recovered',
        connectionId,
        'Recovered after server restart.',
      )
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      )
    }
    await store.persistWorkspace(lookup.workspaceId, c.get('orgId'))
    await logWorkspaceEvent({
      workspaceId: lookup.workspaceId,
      action: 'connection.connected',
      entityType: 'connection',
      entityId: connectedAccount.id,
      actorType: 'system',
      summary: `Connected ${lookup.toolkit} through Composio.`,
      metadata: {
        toolkit: lookup.toolkit,
      },
    })
    return c.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Connection is still pending in Composio.'
    let result
    try {
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'pending',
        message,
      )
    } catch {
      // toolkit not in map — return a synthetic pending response
      result = {
        toolkit: lookup.toolkit,
        connection_id: connectionId,
        status: 'pending' as const,
        mode: 'oauth' as const,
        note: message,
      }
    }
    await store.persistWorkspace(lookup.workspaceId, c.get('orgId'))
    return c.json(result)
  }
})

connectionsRoutes.post('/api/connections/authorize', async (c) => {
  const payload = await c.req.json<OAuthConnectionRequest>()
  const orgId = c.get('orgId')
  const workspace = await ensureWorkspaceRecord(payload.workspace_id, orgId)
  const store = getRuntimeStore()
  await store.hydrateWorkspace(payload.workspace_id, orgId)
  const userId = workspace.composio_entity_id ?? composioUserId(payload.workspace_id, orgId)
  const authConfigId = authConfigIdForToolkit(payload.toolkit)

  if (workspace.composio_entity_id !== userId) {
    await updateWorkspaceComposioEntity(payload.workspace_id, orgId, userId)
  }

  const composio = getComposioClient()
  const session = await composio.create(userId, {
    manageConnections: false,
    ...(authConfigId
      ? {
          authConfigs: {
            [payload.toolkit]: authConfigId,
          },
        }
      : {}),
  })
  const connectionRequest = await session.authorize(payload.toolkit, {
    callbackUrl: payload.callback_url || env.defaultCallbackUrl,
  })

  const launch = store.recordConnectionLaunch(
    payload.workspace_id,
    payload.toolkit,
    payload.external_user_id || userId,
    session.sessionId,
    connectionRequest.id,
    'Connection launched. Poll the connection endpoint until the account becomes ACTIVE.',
  )
  await store.persistWorkspace(payload.workspace_id, orgId)
  await logWorkspaceEvent({
    workspaceId: payload.workspace_id,
    action: 'connection.initiated',
    entityType: 'connection',
    entityId: launch.connection_id,
    actorType: 'user',
    actorId: c.get('userId'),
    summary: `Started the ${payload.toolkit} Composio connection flow.`,
    metadata: {
      toolkit: payload.toolkit,
      session_id: launch.session_id,
      mode: launch.mode,
    },
  })

  return c.json({
    ...launch,
    redirect_url: connectionRequest.redirectUrl,
    note: 'manage_connections is disabled. Users complete the Composio Connect flow through the returned redirect URL.',
  })
})

connectionsRoutes.get('/api/connections/:connectionId', async (c) => {
  const connectionId = c.req.param('connectionId')
  const store = getRuntimeStore()
  const lookup = await store.resolveConnectionLookup(connectionId, c.get('orgId'))
  if (!lookup) {
    return c.json({ detail: 'Unknown connection id.' }, 404)
  }
  await store.hydrateWorkspace(lookup.workspaceId, c.get('orgId'))

  try {
    const composio = getComposioClient()
    const connectedAccount = await composio.connectedAccounts.waitForConnection(connectionId, 1000)
    let result
    try {
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      )
    } catch {
      store.recordConnectionLaunch(
        lookup.workspaceId,
        lookup.toolkit,
        'unknown',
        'recovered',
        connectionId,
        'Recovered after server restart.',
      )
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      )
    }
    await store.persistWorkspace(lookup.workspaceId, c.get('orgId'))
    await logWorkspaceEvent({
      workspaceId: lookup.workspaceId,
      action: 'connection.connected',
      entityType: 'connection',
      entityId: connectedAccount.id,
      actorType: 'system',
      summary: `Connected ${lookup.toolkit} through Composio.`,
      metadata: {
        toolkit: lookup.toolkit,
      },
    })
    return c.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Connection is still pending in Composio.'
    let result
    try {
      result = store.setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'pending',
        message,
      )
    } catch {
      result = {
        toolkit: lookup.toolkit,
        connection_id: connectionId,
        status: 'pending' as const,
        mode: 'oauth' as const,
        note: message,
      }
    }
    await store.persistWorkspace(lookup.workspaceId, c.get('orgId'))
    return c.json(result)
  }
})

connectionsRoutes.post('/api/connections/api-key', async (c) => {
  const payload = await c.req.json<ApiKeyConnectionRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(payload.workspace_id, c.get('orgId'))
  let note = `Stored encrypted API key for ${payload.label}.`

  if (payload.toolkit === 'apollo') {
    const validation = await validateApolloApiKey(payload.api_key)
    if (!validation.ok) {
      return c.json(
        {
          detail: validation.summary,
          errors: validation.details,
        },
        400,
      )
    }
    note = validation.summary
  }

  if (payload.toolkit === 'apollo' || payload.toolkit === 'instantly') {
    await storeWorkspaceApiKey(
      payload.workspace_id,
      c.get('orgId'),
      payload.toolkit,
      payload.api_key,
    )
  }
  const result = store.saveApiKeyConnection(
    payload.workspace_id,
    payload.toolkit,
    payload.label,
    note,
  )
  await store.persistWorkspace(payload.workspace_id, c.get('orgId'))
  await logWorkspaceEvent({
    workspaceId: payload.workspace_id,
    action: 'connection.api_key_saved',
    entityType: 'connection',
    entityId: payload.toolkit,
    actorType: 'user',
    actorId: c.get('userId'),
    summary: `Stored an encrypted API key for ${payload.label}.`,
    metadata: {
      toolkit: payload.toolkit,
      label: payload.label,
      mode: 'api_key',
    },
  })
  return c.json(result)
})

connectionsRoutes.post('/api/integrations/:workspaceId/:toolkit/check', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const toolkit = c.req.param('toolkit')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  if (toolkit === 'apollo') {
    const health = await getApolloConnectionHealth({
      workspaceId,
      orgId: c.get('orgId'),
    })

    return c.json<IntegrationCheckResult>({
      workspace_id: workspaceId,
      toolkit,
      connection_status: health.status,
      source: 'api_key',
      summary: health.summary,
      details: health.details,
      checked_at: new Date().toISOString(),
    })
  }
  const result: IntegrationCheckResult = store.integrationCheck(workspaceId, toolkit)
  return c.json(result)
})
