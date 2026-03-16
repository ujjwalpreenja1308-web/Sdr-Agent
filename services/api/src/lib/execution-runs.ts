import { createHash, randomUUID } from 'node:crypto'

import type { ExecutionRun, JsonObject } from '@pipeiq/shared'

import { logWorkspaceEvent } from './activity.js'
import { getSupabaseAdmin, isSupabasePersistenceEnabled } from './supabase.js'

type BeginExecutionInput = {
  workspaceId: string
  scope: string
  executionKey: string
  actorType: string
  actorId?: string | null
  summary: string
  metadata?: JsonObject
  dedupeWindowMs?: number
  runningWindowMs?: number
  /** Optional snapshot of inputs — stored in metadata_json for observability */
  inputSnapshot?: JsonObject
}

type StartedExecution = {
  kind: 'started'
  runId: string
  startedAt: string
}

type ExistingExecution = {
  kind: 'duplicate' | 'in_progress'
  run: ExecutionRun
}

type BeginExecutionResult = StartedExecution | ExistingExecution

type FinishExecutionInput = {
  workspaceId: string
  scope: string
  runId: string
  executionKey: string
  actorType: string
  actorId?: string | null
  summary: string
  status: 'completed' | 'failed' | 'skipped'
  metadata?: JsonObject
  /** Optional snapshot of outputs — stored in metadata_json for observability */
  outputSnapshot?: JsonObject
}

const DEFAULT_DEDUPE_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_RUNNING_WINDOW_MS = 10 * 60 * 1000
const inFlightExecutions = new Map<string, { runId: string; startedAt: string }>()
const fallbackExecutionRuns = new Map<string, ExecutionRun[]>()

function nowIso(): string {
  return new Date().toISOString()
}

function inFlightKey(workspaceId: string, scope: string, executionKey: string): string {
  return `${workspaceId}:${scope}:${executionKey}`
}

function parseExecutionRun(row: {
  id: string
  workspace_id: string
  actor_type: string
  actor_id: string | null
  metadata_json: unknown
  created_at: string
}): ExecutionRun | null {
  const metadata =
    typeof row.metadata_json === 'object' && row.metadata_json !== null
      ? (row.metadata_json as JsonObject)
      : null
  if (!metadata) {
    return null
  }

  const scope = typeof metadata.scope === 'string' ? metadata.scope : null
  const executionKey =
    typeof metadata.execution_key === 'string' ? metadata.execution_key : null
  const status =
    metadata.run_status === 'started' ||
    metadata.run_status === 'completed' ||
    metadata.run_status === 'failed' ||
    metadata.run_status === 'skipped'
      ? metadata.run_status
      : null
  const summary = typeof metadata.summary === 'string' ? metadata.summary : row.id
  const startedAt = typeof metadata.started_at === 'string' ? metadata.started_at : row.created_at
  const completedAt =
    typeof metadata.completed_at === 'string' ? metadata.completed_at : null

  if (!scope || !executionKey || !status) {
    return null
  }

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    scope,
    execution_key: executionKey,
    status,
    summary,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    started_at: startedAt,
    completed_at: completedAt,
    metadata_json: metadata,
  }
}

function cacheExecutionRun(run: ExecutionRun): void {
  const existing = fallbackExecutionRuns.get(run.workspace_id) ?? []
  const next = [
    run,
    ...existing.filter((item) => item.id !== run.id),
  ].slice(0, 100)
  fallbackExecutionRuns.set(run.workspace_id, next)
}

async function loadExecutionRuns(workspaceId: string, limit = 100): Promise<ExecutionRun[]> {
  const fallback = fallbackExecutionRuns.get(workspaceId) ?? []
  if (!isSupabasePersistenceEnabled()) {
    return fallback.slice(0, limit)
  }

  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase
      .from('audit_log')
      .select('entity_id, workspace_id, actor_type, actor_id, metadata_json, created_at')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'execution_run')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (result.error) {
      throw new Error(result.error.message)
    }

    return (result.data ?? [])
      .map((row) =>
        parseExecutionRun({
          id: String(row.entity_id ?? ''),
          workspace_id: String(row.workspace_id),
          actor_type: String(row.actor_type),
          actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
          metadata_json: row.metadata_json,
          created_at: String(row.created_at),
        }),
      )
      .filter((run): run is ExecutionRun => run !== null)
  } catch {
    return fallback.slice(0, limit)
  }
}

export function executionKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)
}

export async function beginExecution(input: BeginExecutionInput): Promise<BeginExecutionResult> {
  const startedAt = nowIso()
  const dedupeWindowMs = input.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS
  const runningWindowMs = input.runningWindowMs ?? DEFAULT_RUNNING_WINDOW_MS
  const key = inFlightKey(input.workspaceId, input.scope, input.executionKey)
  const inFlight = inFlightExecutions.get(key)

  if (inFlight) {
    return {
      kind: 'in_progress',
      run: {
        id: inFlight.runId,
        workspace_id: input.workspaceId,
        scope: input.scope,
        execution_key: input.executionKey,
        status: 'in_progress',
        summary: input.summary,
        actor_type: input.actorType,
        actor_id: input.actorId ?? null,
        started_at: inFlight.startedAt,
        completed_at: null,
        metadata_json: input.metadata ?? {},
      },
    }
  }

  const existingRuns = await loadExecutionRuns(input.workspaceId, 150)
  const latest = existingRuns.find(
    (run) => run.scope === input.scope && run.execution_key === input.executionKey,
  )

  if (latest) {
    const latestTime = Date.parse(latest.completed_at ?? latest.started_at)
    const ageMs = Number.isNaN(latestTime) ? Number.POSITIVE_INFINITY : Date.now() - latestTime

    if (latest.status === 'started' && ageMs <= runningWindowMs) {
      return {
        kind: 'in_progress',
        run: {
          ...latest,
          status: 'in_progress',
        },
      }
    }

    if ((latest.status === 'completed' || latest.status === 'skipped') && ageMs <= dedupeWindowMs) {
      return {
        kind: 'duplicate',
        run: latest,
      }
    }
  }

  const runId = randomUUID()
  inFlightExecutions.set(key, { runId, startedAt })

  const metadata: JsonObject = {
    scope: input.scope,
    execution_key: input.executionKey,
    run_status: 'started',
    started_at: startedAt,
    summary: input.summary,
    ...(input.metadata ?? {}),
    ...(input.inputSnapshot ? { input_snapshot: input.inputSnapshot } : {}),
  }

  await logWorkspaceEvent({
    workspaceId: input.workspaceId,
    action: `${input.scope}.started`,
    entityType: 'execution_run',
    entityId: runId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    summary: input.summary,
    metadata,
  })

  cacheExecutionRun({
    id: runId,
    workspace_id: input.workspaceId,
    scope: input.scope,
    execution_key: input.executionKey,
    status: 'started',
    summary: input.summary,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    started_at: startedAt,
    completed_at: null,
    metadata_json: metadata,
  })

  return {
    kind: 'started',
    runId,
    startedAt,
  }
}

export async function finishExecution(input: FinishExecutionInput): Promise<void> {
  const finishedAt = nowIso()
  const cacheKey = inFlightKey(input.workspaceId, input.scope, input.executionKey)
  const inFlight = inFlightExecutions.get(cacheKey)
  inFlightExecutions.delete(cacheKey)

  const metadata: JsonObject = {
    scope: input.scope,
    execution_key: input.executionKey,
    run_status: input.status,
    completed_at: finishedAt,
    summary: input.summary,
    ...(input.metadata ?? {}),
    ...(input.outputSnapshot ? { output_snapshot: input.outputSnapshot } : {}),
  }

  await logWorkspaceEvent({
    workspaceId: input.workspaceId,
    action: `${input.scope}.${input.status}`,
    entityType: 'execution_run',
    entityId: input.runId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    summary: input.summary,
    metadata,
  })

  cacheExecutionRun({
    id: input.runId,
    workspace_id: input.workspaceId,
    scope: input.scope,
    execution_key: input.executionKey,
    status: input.status,
    summary: input.summary,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    started_at: inFlight?.startedAt ?? finishedAt,
    completed_at: finishedAt,
    metadata_json: metadata,
  })
}

export async function listExecutionRuns(
  workspaceId: string,
  limit = 25,
): Promise<ExecutionRun[]> {
  const rows = await loadExecutionRuns(workspaceId, limit * 6)
  const aggregated = new Map<string, ExecutionRun>()

  for (const row of rows) {
    const existing = aggregated.get(row.id)
    if (!existing) {
      aggregated.set(row.id, row)
      continue
    }

    const existingTime = Date.parse(existing.completed_at ?? existing.started_at)
    const rowTime = Date.parse(row.completed_at ?? row.started_at)
    if (rowTime > existingTime) {
      aggregated.set(row.id, row)
    }
  }

  return Array.from(aggregated.values())
    .sort((left, right) =>
      Date.parse(right.completed_at ?? right.started_at) -
      Date.parse(left.completed_at ?? left.started_at),
    )
    .slice(0, limit)
}
