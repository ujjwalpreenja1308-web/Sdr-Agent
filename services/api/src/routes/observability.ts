import { Hono } from 'hono'

import type { JsonObject, ObservabilityRun } from '@pipeiq/shared'

import { listExecutionRuns } from '../lib/execution-runs.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const observabilityRoutes = new Hono<AppEnv>()

// GET /api/observability/:workspaceId/runs
// Query params:
//   limit  — max rows to return (default 50)
//   scope  — filter by execution scope (e.g. "agent.prospector")
observabilityRoutes.get('/api/observability/:workspaceId/runs', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const limitParam = c.req.query('limit')
  const scopeFilter = c.req.query('scope') ?? null
  const limit = limitParam ? Math.min(Number.parseInt(limitParam, 10) || 50, 200) : 50

  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  const runs = await listExecutionRuns(workspaceId, limit)

  const filtered = scopeFilter
    ? runs.filter((run) => run.scope === scopeFilter || run.scope.startsWith(scopeFilter))
    : runs

  function asJsonObject(value: unknown): JsonObject | null {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as JsonObject
    }
    return null
  }

  // Promote input/output snapshots from metadata_json to top-level fields
  const enriched: ObservabilityRun[] = filtered.map((run) => ({
    ...run,
    input_snapshot: asJsonObject(run.metadata_json?.input_snapshot),
    output_snapshot: asJsonObject(run.metadata_json?.output_snapshot),
  }))

  return c.json({
    workspace_id: workspaceId,
    total: enriched.length,
    runs: enriched,
  })
})
