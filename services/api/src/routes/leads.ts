import { Hono } from 'hono'

import type {
  ApprovalDecisionRequest,
  ProspectVerificationRequest,
} from '@pipeiq/shared'

import { searchApolloProspects } from '../lib/apollo.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const leadsRoutes = new Hono<AppEnv>()

leadsRoutes.get('/api/pipeline/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getPipeline(workspaceId))
})

leadsRoutes.get('/api/prospects/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().getProspectRun(workspaceId))
})

leadsRoutes.post('/api/prospects/:workspaceId/run', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  const workspace = store.getWorkspaceSummary(workspaceId)
  const apolloConnected = workspace.connections.some(
    (connection) => connection.toolkit === 'apollo' && connection.status === 'connected',
  )

  if (!apolloConnected) {
    return c.json(store.runProspectSearch(workspaceId))
  }

  try {
    const onboarding = store.getOnboarding(workspaceId)
    const prospects = await searchApolloProspects({
      workspaceId,
      orgId: c.get('orgId'),
      onboarding,
      limit: 10,
    })

    if (prospects.length === 0) {
      return c.json(
        store.applyProspectSearch(
          workspaceId,
          [],
          'live',
          'Apollo live search returned no prospects for the current filters.',
        ),
      )
    }

    return c.json(
      store.applyProspectSearch(
        workspaceId,
        prospects,
        'live',
        'Apollo prospecting ran through the Composio connection.',
      ),
    )
  } catch (error) {
    return c.json(
      store.applyProspectSearch(
        workspaceId,
        [],
        'live',
        error instanceof Error
          ? `Apollo live search failed: ${error.message}`
          : 'Apollo live search failed.',
      ),
      502,
    )
  }
})

leadsRoutes.post('/api/prospects/:workspaceId/verify-emails', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  await c.req.json<ProspectVerificationRequest>()
  return c.json(getRuntimeStore().verifyProspects(workspaceId))
})

leadsRoutes.post('/api/pipeline/:workspaceId/generate', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  try {
    return c.json(getRuntimeStore().generatePipeline(workspaceId))
  } catch (error) {
    return c.json(
      {
        detail: error instanceof Error ? error.message : 'Unable to generate pipeline.',
      },
      400,
    )
  }
})

leadsRoutes.get('/api/approvals/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  return c.json(getRuntimeStore().listApprovals(workspaceId))
})

leadsRoutes.post('/api/approvals/:approvalId/decision', async (c) => {
  const approvalId = c.req.param('approvalId')
  const payload = await c.req.json<ApprovalDecisionRequest>()
  const workspaceId = c.req.query('workspace_id') ?? 'default'
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  try {
    return c.json(getRuntimeStore().decideApproval(workspaceId, approvalId, payload.decision))
  } catch (error) {
    return c.json(
      { detail: error instanceof Error ? error.message : 'Approval not found.' },
      404,
    )
  }
})
