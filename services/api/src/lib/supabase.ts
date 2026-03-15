import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Workspace } from '@pipeiq/shared'

import { env } from './env.js'
import { encrypt } from './encryption.js'

let adminClient: SupabaseClient | null = null
const fallbackWorkspaces = new Map<string, Workspace>()

function nowIso(): string {
  return new Date().toISOString()
}

function fallbackWorkspaceKey(workspaceId: string, orgId: string): string {
  return `${orgId}:${workspaceId}`
}

function usingDevSupabaseFallback(): boolean {
  return env.supabaseServiceKey === 'dev-service-key' && env.supabaseAnonKey === 'dev-anon-key'
}

function getFallbackWorkspace(workspaceId: string, orgId: string): Workspace {
  const key = fallbackWorkspaceKey(workspaceId, orgId)
  const existing = fallbackWorkspaces.get(key)
  if (existing) {
    return existing
  }

  const created: Workspace = {
    id: workspaceId,
    org_id: orgId,
    name: 'PipeIQ Workspace',
    composio_entity_id: null,
    apollo_key_enc: null,
    instantly_key_enc: null,
    created_at: nowIso(),
  }
  fallbackWorkspaces.set(key, created)
  return created
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return adminClient
}

export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

export async function ensureWorkspaceRecord(
  workspaceId: string,
  orgId: string,
): Promise<Workspace> {
  if (usingDevSupabaseFallback()) {
    return getFallbackWorkspace(workspaceId, orgId)
  }

  const supabase = getSupabaseAdmin()
  try {
    const selectResult = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .eq('org_id', orgId)
      .maybeSingle<Workspace>()

    if (selectResult.error) {
      throw new Error(selectResult.error.message)
    }
    if (selectResult.data) {
      return selectResult.data
    }

    const insertResult = await supabase
      .from('workspaces')
      .insert({
        id: workspaceId,
        org_id: orgId,
        name: 'PipeIQ Workspace',
        composio_entity_id: null,
        apollo_key_enc: null,
        instantly_key_enc: null,
        created_at: nowIso(),
      })
      .select('*')
      .single<Workspace>()

    if (insertResult.error || !insertResult.data) {
      throw new Error(insertResult.error?.message ?? 'Unable to create workspace record.')
    }

    return insertResult.data
  } catch {
    return getFallbackWorkspace(workspaceId, orgId)
  }
}

export async function updateWorkspaceComposioEntity(
  workspaceId: string,
  orgId: string,
  composioEntityId: string,
): Promise<void> {
  if (usingDevSupabaseFallback()) {
    const workspace = getFallbackWorkspace(workspaceId, orgId)
    fallbackWorkspaces.set(fallbackWorkspaceKey(workspaceId, orgId), {
      ...workspace,
      composio_entity_id: composioEntityId,
    })
    return
  }

  const supabase = getSupabaseAdmin()
  try {
    const result = await supabase
      .from('workspaces')
      .update({ composio_entity_id: composioEntityId })
      .eq('id', workspaceId)
      .eq('org_id', orgId)

    if (result.error) {
      throw new Error(result.error.message)
    }
  } catch {
    const workspace = getFallbackWorkspace(workspaceId, orgId)
    fallbackWorkspaces.set(fallbackWorkspaceKey(workspaceId, orgId), {
      ...workspace,
      composio_entity_id: composioEntityId,
    })
  }
}

export async function storeWorkspaceApiKey(
  workspaceId: string,
  orgId: string,
  toolkit: string,
  rawValue: string,
): Promise<void> {
  const encryptedValue = encrypt(rawValue)
  const payload: Partial<Workspace> =
    toolkit === 'apollo'
      ? { apollo_key_enc: encryptedValue }
      : toolkit === 'instantly'
        ? { instantly_key_enc: encryptedValue }
        : {}

  if (usingDevSupabaseFallback()) {
    const workspace = getFallbackWorkspace(workspaceId, orgId)
    fallbackWorkspaces.set(fallbackWorkspaceKey(workspaceId, orgId), {
      ...workspace,
      ...payload,
    })
    return
  }

  const supabase = getSupabaseAdmin()
  try {
    const result = await supabase
      .from('workspaces')
      .update(payload)
      .eq('id', workspaceId)
      .eq('org_id', orgId)

    if (result.error) {
      throw new Error(result.error.message)
    }
  } catch {
    const workspace = getFallbackWorkspace(workspaceId, orgId)
    fallbackWorkspaces.set(fallbackWorkspaceKey(workspaceId, orgId), {
      ...workspace,
      ...payload,
    })
  }
}
