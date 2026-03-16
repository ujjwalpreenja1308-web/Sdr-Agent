import type { AuditLog, JsonObject, OperatorEvent } from '@pipeiq/shared'

import { getSupabaseAdmin, isSupabasePersistenceEnabled } from './supabase.js'

type LogWorkspaceEventInput = {
  workspaceId: string
  action: string
  entityType: string
  entityId?: string | null
  actorType: string
  actorId?: string | null
  summary: string
  metadata?: JsonObject
}

const fallbackActivity = new Map<string, OperatorEvent[]>()

function nowIso(): string {
  return new Date().toISOString()
}

function fallbackEvent(input: LogWorkspaceEventInput): OperatorEvent {
  return {
    id: `${input.action}_${Date.now()}`,
    workspace_id: input.workspaceId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    summary: input.summary,
    metadata_json: input.metadata ?? {},
    created_at: nowIso(),
  }
}

export async function logWorkspaceEvent(input: LogWorkspaceEventInput): Promise<void> {
  const event = fallbackEvent(input)
  const fallbackEvents = fallbackActivity.get(input.workspaceId) ?? []
  fallbackEvents.unshift(event)
  fallbackActivity.set(input.workspaceId, fallbackEvents.slice(0, 100))

  if (!isSupabasePersistenceEnabled()) {
    return
  }

  const payload: Omit<AuditLog, 'id'> = {
    workspace_id: input.workspaceId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    metadata_json: {
      summary: input.summary,
      ...(input.metadata ?? {}),
    },
    created_at: event.created_at,
  }

  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase.from('audit_log').insert(payload)
    if (result.error) {
      throw new Error(result.error.message)
    }
  } catch (error) {
    console.warn('Unable to persist workspace activity event.', {
      workspaceId: input.workspaceId,
      action: input.action,
      error: error instanceof Error ? error.message : 'unknown',
    })
  }
}

export async function listWorkspaceActivity(
  workspaceId: string,
  limit = 25,
): Promise<OperatorEvent[]> {
  const fallbackEvents = fallbackActivity.get(workspaceId) ?? []

  if (!isSupabasePersistenceEnabled()) {
    return fallbackEvents.slice(0, limit)
  }

  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase
      .from('audit_log')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (result.error) {
      throw new Error(result.error.message)
    }

    return (result.data ?? []).map((row) => {
      const metadata =
        typeof row.metadata_json === 'object' && row.metadata_json !== null
          ? (row.metadata_json as JsonObject)
          : {}
      const summary = typeof metadata.summary === 'string' ? metadata.summary : row.action
      return {
        id: String(row.id),
        workspace_id: workspaceId,
        action: String(row.action),
        entity_type: String(row.entity_type),
        entity_id: typeof row.entity_id === 'string' ? row.entity_id : null,
        actor_type: String(row.actor_type),
        actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
        summary,
        metadata_json: metadata,
        created_at: String(row.created_at),
      }
    })
  } catch {
    return fallbackEvents.slice(0, limit)
  }
}
