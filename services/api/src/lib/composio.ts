import { Composio } from '@composio/core'
import type { ToolExecuteResponse } from '@composio/core'

import { env } from './env.js'
import { ensureWorkspaceRecord } from './supabase.js'

let composio: Composio | null = null

export function getComposioClient(): Composio {
  if (!env.composioApiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured.')
  }
  if (!composio) {
    composio = new Composio({
      apiKey: env.composioApiKey,
    })
  }
  return composio
}

export function buildComposioUserId(workspaceId: string, orgId: string): string {
  return `org_${orgId}:workspace_${workspaceId}`
}

export async function resolveComposioUserId(
  workspaceId: string,
  orgId: string,
): Promise<string> {
  const workspace = await ensureWorkspaceRecord(workspaceId, orgId)
  return workspace.composio_entity_id ?? buildComposioUserId(workspaceId, orgId)
}

export async function executeConnectedTool(params: {
  workspaceId: string
  orgId: string
  toolSlug: string
  arguments?: Record<string, unknown>
}): Promise<ToolExecuteResponse> {
  const composio = getComposioClient()
  const userId = await resolveComposioUserId(params.workspaceId, params.orgId)
  return composio.tools.execute(params.toolSlug, {
    userId,
    arguments: params.arguments ?? {},
    dangerouslySkipVersionCheck: true,
  })
}

export function authConfigIdForToolkit(toolkit: string): string | undefined {
  const mapping: Record<string, string> = {
    gmail: env.authConfigIds.gmail,
    googlecalendar: env.authConfigIds.googlecalendar,
    calendly: env.authConfigIds.calendly,
    hubspot: env.authConfigIds.hubspot,
  }
  const authConfigId = mapping[toolkit]
  return authConfigId || undefined
}
