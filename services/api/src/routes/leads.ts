import { Hono } from 'hono'

import type {
  ApprovalDecisionRequest,
  ProspectVerificationRequest,
} from '@pipeiq/shared'

import { searchApolloProspects } from '../lib/apollo.js'
import { logWorkspaceEvent } from '../lib/activity.js'
import { beginExecution, executionKey, finishExecution } from '../lib/execution-runs.js'
import { verifyHunterEmail } from '../lib/hunter.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const leadsRoutes = new Hono<AppEnv>()

leadsRoutes.get('/api/pipeline/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getPipeline(workspaceId))
})

leadsRoutes.get('/api/prospects/:workspaceId', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.getProspectRun(workspaceId))
})

leadsRoutes.post('/api/prospects/:workspaceId/run', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  const workspace = store.getWorkspaceSummary(workspaceId)
  const onboarding = store.getOnboarding(workspaceId)
  const prospectExecution = await beginExecution({
    workspaceId,
    scope: 'prospects.run',
    executionKey: executionKey([
      onboarding,
      workspace.connections
        .filter((connection) => connection.toolkit === 'apollo')
        .map((connection) => connection.status),
    ]),
    actorType: 'agent',
    actorId: 'prospector',
    summary: 'Starting a prospect sourcing run.',
  })
  if (prospectExecution.kind !== 'started') {
    return c.json(store.getProspectRun(workspaceId))
  }
  const apolloConnected = workspace.connections.some(
    (connection) => connection.toolkit === 'apollo' && connection.status === 'connected',
  )

  if (!apolloConnected) {
    const result = store.runProspectSearch(workspaceId)
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await finishExecution({
      workspaceId,
      scope: 'prospects.run',
      runId: prospectExecution.runId,
      executionKey: executionKey([
        onboarding,
        workspace.connections
          .filter((connection) => connection.toolkit === 'apollo')
          .map((connection) => connection.status),
      ]),
      actorType: 'agent',
      actorId: 'prospector',
      status: 'completed',
      summary: 'Completed prospect sourcing using the local fallback flow.',
      metadata: {
        mode: result.mode,
        sourced_count: result.sourced_count,
      },
    })
    await logWorkspaceEvent({
      workspaceId,
      action: 'prospects.run.completed',
      entityType: 'prospect_run',
      actorType: 'agent',
      actorId: 'prospector',
      summary: 'Completed prospect sourcing using the local fallback flow.',
      metadata: {
        mode: result.mode,
        sourced_count: result.sourced_count,
        deduped_count: result.deduped_count,
      },
    })
    return c.json(result)
  }

  try {
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

    const result = store.applyProspectSearch(
      workspaceId,
      prospects,
      'live',
      'Apollo prospecting ran through the saved Apollo API key.',
    )
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await finishExecution({
      workspaceId,
      scope: 'prospects.run',
      runId: prospectExecution.runId,
      executionKey: executionKey([
        onboarding,
        workspace.connections
          .filter((connection) => connection.toolkit === 'apollo')
          .map((connection) => connection.status),
      ]),
      actorType: 'agent',
      actorId: 'prospector',
      status: 'completed',
      summary: `Completed prospect sourcing and found ${result.deduped_count} prospects.`,
      metadata: {
        mode: result.mode,
        sourced_count: result.sourced_count,
        deduped_count: result.deduped_count,
      },
    })
    await logWorkspaceEvent({
      workspaceId,
      action: 'prospects.run.completed',
      entityType: 'prospect_run',
      actorType: 'agent',
      actorId: 'prospector',
      summary: `Completed Apollo prospect sourcing and found ${result.deduped_count} prospects.`,
      metadata: {
        mode: result.mode,
        sourced_count: result.sourced_count,
        deduped_count: result.deduped_count,
      },
    })
    return c.json(result)
  } catch (error) {
    const result = store.applyProspectSearch(
      workspaceId,
      [],
      'live',
      error instanceof Error
        ? `Apollo live search failed: ${error.message}`
        : 'Apollo live search failed.',
    )
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await finishExecution({
      workspaceId,
      scope: 'prospects.run',
      runId: prospectExecution.runId,
      executionKey: executionKey([
        onboarding,
        workspace.connections
          .filter((connection) => connection.toolkit === 'apollo')
          .map((connection) => connection.status),
      ]),
      actorType: 'agent',
      actorId: 'prospector',
      status: 'failed',
      summary: result.note,
      metadata: {
        mode: result.mode,
      },
    })
    await logWorkspaceEvent({
      workspaceId,
      action: 'prospects.run.failed',
      entityType: 'prospect_run',
      actorType: 'agent',
      actorId: 'prospector',
      summary: result.note,
      metadata: {
        mode: result.mode,
      },
    })
    return c.json(result, 502)
  }
})

leadsRoutes.post('/api/prospects/:workspaceId/verify-emails', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  await c.req.json<ProspectVerificationRequest>()
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  const workspace = store.getWorkspaceSummary(workspaceId)
  const verificationExecutionKey = executionKey(
    store.listContacts(workspaceId).map((contact) => [
      contact.id,
      contact.email_verification_status,
      contact.email,
    ]),
  )
  const verificationExecution = await beginExecution({
    workspaceId,
    scope: 'prospects.verify',
    executionKey: verificationExecutionKey,
    actorType: 'agent',
    actorId: 'prospector',
    summary: 'Starting prospect email verification.',
  })
  if (verificationExecution.kind !== 'started') {
    return c.json(store.getPipeline(workspaceId))
  }
  let result
  const hunterConnected = workspace.connections.some(
    (connection) => connection.toolkit === 'hunter' && connection.status === 'connected',
  )
  if (hunterConnected) {
    try {
      const contacts = store.listContacts(workspaceId)
      const outcomes = await Promise.all(
        contacts.map(async (contact) => {
          const verification = await verifyHunterEmail({
            workspaceId,
            orgId: c.get('orgId'),
            email: contact.email,
          })
          return {
            contactId: contact.id,
            status: verification.status,
            score: verification.score,
            note: verification.note,
            checkedAt: verification.checkedAt,
          }
        }),
      )
      result = store.applyProspectVerificationResults(workspaceId, outcomes)
    } catch (error) {
      await finishExecution({
        workspaceId,
        scope: 'prospects.verify',
        runId: verificationExecution.runId,
        executionKey: verificationExecutionKey,
        actorType: 'agent',
        actorId: 'prospector',
        status: 'failed',
        summary:
          error instanceof Error ? error.message : 'Hunter verification failed.',
        metadata: {},
      })
      return c.json(
        {
          detail:
            error instanceof Error ? error.message : 'Hunter verification failed.',
        },
        502,
      )
    }
  } else {
    result = store.verifyProspects(workspaceId)
  }
  await store.persistWorkspace(workspaceId, c.get('orgId'))
  const verifiedCount = result.contacts.filter(
    (contact) =>
      contact.email_verification_status === 'valid' ||
      contact.email_verification_status === 'risky',
  ).length
  await finishExecution({
    workspaceId,
    scope: 'prospects.verify',
    runId: verificationExecution.runId,
    executionKey: verificationExecutionKey,
    actorType: 'agent',
    actorId: 'prospector',
    status: 'completed',
    summary: `Verified ${verifiedCount} prospect emails.`,
    metadata: {
      mode: hunterConnected ? 'live' : 'mock',
      verified_count: verifiedCount,
      total_contacts: result.contacts.length,
    },
  })
  await logWorkspaceEvent({
    workspaceId,
    action: 'prospects.verified',
    entityType: 'contact_batch',
    actorType: 'agent',
    actorId: 'prospector',
    summary: `Verified ${verifiedCount} prospect emails for launch eligibility.`,
    metadata: {
      mode: hunterConnected ? 'live' : 'mock',
      verified_count: verifiedCount,
      total_contacts: result.contacts.length,
    },
  })
  return c.json(result)
})

leadsRoutes.post('/api/pipeline/:workspaceId/generate', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  const generationExecutionKey = executionKey(
    store
      .getPipeline(workspaceId)
      .contacts.map((contact) => [
        contact.id,
        contact.email_verification_status,
        contact.status,
      ]),
  )
  const generationExecution = await beginExecution({
    workspaceId,
    scope: 'pipeline.generate',
    executionKey: generationExecutionKey,
    actorType: 'agent',
    actorId: 'copywriter',
    summary: 'Starting pipeline batch generation.',
  })
  if (generationExecution.kind !== 'started') {
    return c.json(store.getPipeline(workspaceId))
  }

  try {
    const result = store.generatePipeline(workspaceId)
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await finishExecution({
      workspaceId,
      scope: 'pipeline.generate',
      runId: generationExecution.runId,
      executionKey: generationExecutionKey,
      actorType: 'agent',
      actorId: 'copywriter',
      status: 'completed',
      summary: `Generated a personalized review batch for ${result.contacts.length} contacts.`,
      metadata: {
        contact_count: result.contacts.length,
      },
    })
    await logWorkspaceEvent({
      workspaceId,
      action: 'pipeline.generated',
      entityType: 'approval_queue',
      actorType: 'agent',
      actorId: 'copywriter',
      summary: `Generated the first review batch with ${result.contacts.length} personalized contacts.`,
      metadata: {
        contact_count: result.contacts.length,
      },
    })
    return c.json(result)
  } catch (error) {
    await finishExecution({
      workspaceId,
      scope: 'pipeline.generate',
      runId: generationExecution.runId,
      executionKey: generationExecutionKey,
      actorType: 'agent',
      actorId: 'copywriter',
      status: 'failed',
      summary:
        error instanceof Error ? error.message : 'Unable to generate pipeline.',
      metadata: {},
    })
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
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))
  return c.json(store.listApprovals(workspaceId))
})

leadsRoutes.post('/api/approvals/:approvalId/decision', async (c) => {
  const approvalId = c.req.param('approvalId')
  const payload = await c.req.json<ApprovalDecisionRequest>()
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) {
    return c.json({ detail: 'workspace_id query parameter is required.' }, 400)
  }
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const store = getRuntimeStore()
  await store.hydrateWorkspace(workspaceId, c.get('orgId'))

  try {
    const result = store.decideApproval(workspaceId, approvalId, payload.decision)
    await store.persistWorkspace(workspaceId, c.get('orgId'))
    await logWorkspaceEvent({
      workspaceId,
      action: 'approval.decided',
      entityType: 'approval_queue',
      entityId: approvalId,
      actorType: 'user',
      actorId: c.get('userId'),
      summary: `Marked approval ${payload.decision}.`,
      metadata: {
        decision: payload.decision,
        approval_type: result.type,
      },
    })
    return c.json(result)
  } catch (error) {
    return c.json(
      { detail: error instanceof Error ? error.message : 'Approval not found.' },
      404,
    )
  }
})
