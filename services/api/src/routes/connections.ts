import { Hono } from 'hono'

import type {
  ApiKeyConnectionRequest,
  IntegrationCheckResult,
  OAuthConnectionRequest,
} from '@pipeiq/shared'

import { authConfigIdForToolkit, getComposioClient } from '../lib/composio.js'
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

  const launch = getRuntimeStore().recordConnectionLaunch(
    payload.workspace_id,
    payload.toolkit,
    payload.external_user_id || userId,
    session.sessionId,
    connectionRequest.id,
    'Connection launched. Poll the status endpoint until the account becomes ACTIVE.',
  )

  return c.json({
    ...launch,
    redirect_url: connectionRequest.redirectUrl,
  })
})

connectionsRoutes.get('/connections/status/:connectionId', async (c) => {
  const connectionId = c.req.param('connectionId')
  const lookup = getRuntimeStore().getConnectionByRequestId(connectionId)
  if (!lookup) {
    return c.json({ detail: 'Unknown connection id.' }, 404)
  }

  try {
    const composio = getComposioClient()
    const connectedAccount = await composio.connectedAccounts.waitForConnection(connectionId, 1000)
    return c.json(
      getRuntimeStore().setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      ),
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Connection is still pending in Composio.'
    return c.json(
      getRuntimeStore().setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'pending',
        message,
      ),
    )
  }
})

connectionsRoutes.post('/api/connections/authorize', async (c) => {
  const payload = await c.req.json<OAuthConnectionRequest>()
  const orgId = c.get('orgId')
  const workspace = await ensureWorkspaceRecord(payload.workspace_id, orgId)
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

  const launch = getRuntimeStore().recordConnectionLaunch(
    payload.workspace_id,
    payload.toolkit,
    payload.external_user_id || userId,
    session.sessionId,
    connectionRequest.id,
    'Connection launched. Poll the connection endpoint until the account becomes ACTIVE.',
  )

  return c.json({
    ...launch,
    redirect_url: connectionRequest.redirectUrl,
    note: 'manage_connections is disabled. Users complete the Composio Connect flow through the returned redirect URL.',
  })
})

connectionsRoutes.get('/api/connections/:connectionId', async (c) => {
  const connectionId = c.req.param('connectionId')
  const lookup = getRuntimeStore().getConnectionByRequestId(connectionId)
  if (!lookup) {
    return c.json({ detail: 'Unknown connection id.' }, 404)
  }

  try {
    const composio = getComposioClient()
    const connectedAccount = await composio.connectedAccounts.waitForConnection(connectionId, 1000)
    return c.json(
      getRuntimeStore().setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'connected',
        'Connected through Composio.',
        connectedAccount.id,
      ),
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Connection is still pending in Composio.'
    return c.json(
      getRuntimeStore().setConnectionStatus(
        lookup.workspaceId,
        lookup.toolkit,
        'pending',
        message,
      ),
    )
  }
})

connectionsRoutes.post('/api/connections/api-key', async (c) => {
  const payload = await c.req.json<ApiKeyConnectionRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  if (payload.toolkit === 'apollo' || payload.toolkit === 'instantly') {
    await storeWorkspaceApiKey(
      payload.workspace_id,
      c.get('orgId'),
      payload.toolkit,
      payload.secret_hint,
    )
  }
  return c.json(
    getRuntimeStore().saveApiKeyConnection(
      payload.workspace_id,
      payload.toolkit,
      payload.label,
    ),
  )
})

connectionsRoutes.post('/api/integrations/:workspaceId/:toolkit/check', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const toolkit = c.req.param('toolkit')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const result: IntegrationCheckResult = getRuntimeStore().integrationCheck(workspaceId, toolkit)
  return c.json(result)
})
