import type { BandwidthEstimate, ToolCapacity } from '@pipeiq/shared'

import { getApolloConnectionHealth } from './apollo.js'
import { executeConnectedTool } from './composio.js'
import { getRuntimeStore } from './runtime-store.js'
import { getApolloTierAllowance } from './subscription.js'

const INSTANTLY_DAILY_PER_ACCOUNT = 50

async function checkInstantlyCapacity(workspaceId: string, orgId: string): Promise<ToolCapacity> {
  try {
    const result = await executeConnectedTool({
      workspaceId,
      orgId,
      toolSlug: 'INSTANTLY_LIST_ACCOUNTS',
      arguments: {},
    })

    const raw = result as unknown as Record<string, unknown>
    const accounts = Array.isArray(raw?.data)
      ? (raw.data as Array<{ status?: number; email?: string }>)
      : []

    const activeCount = accounts.filter((account) => account.status === 1).length
    const capacity = activeCount * INSTANTLY_DAILY_PER_ACCOUNT

    return {
      toolkit: 'instantly',
      metric: 'daily_emails',
      value: capacity,
      unit: 'emails/day',
      note: `${activeCount} active sending account(s) x ${INSTANTLY_DAILY_PER_ACCOUNT} emails/day`,
    }
  } catch (error) {
    return {
      toolkit: 'instantly',
      metric: 'daily_emails',
      value: null,
      unit: 'emails/day',
      note: `Could not fetch accounts: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
}

async function checkApolloCapacity(workspaceId: string, orgId: string): Promise<ToolCapacity> {
  try {
    const [health, allowance] = await Promise.all([
      getApolloConnectionHealth({
        workspaceId,
        orgId,
      }),
      getApolloTierAllowance(orgId),
    ])

    return {
      toolkit: 'apollo',
      metric: 'monthly_leads',
      value: allowance.remainingThisMonth,
      unit: 'leads/month',
      note: health.ok
        ? `${allowance.effectiveTier} tier allows ${allowance.monthlyContactLimit}/month; ${allowance.remainingThisMonth} enrichments remain this month`
        : health.summary,
    }
  } catch (error) {
    return {
      toolkit: 'apollo',
      metric: 'monthly_leads',
      value: null,
      unit: 'leads/month',
      note: `Could not query Apollo: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
}

async function checkHunterCapacity(workspaceId: string, orgId: string): Promise<ToolCapacity> {
  try {
    const result = await executeConnectedTool({
      workspaceId,
      orgId,
      toolSlug: 'HUNTER_EMAIL_VERIFIER',
      arguments: { email: 'test@example.com' },
    })

    const raw = result as unknown as Record<string, unknown>
    const requestsLeft =
      typeof raw?.requests_left === 'number'
        ? raw.requests_left
        : typeof (raw?.meta as Record<string, unknown>)?.requests_left === 'number'
          ? ((raw.meta as Record<string, unknown>).requests_left as number)
          : null

    return {
      toolkit: 'hunter',
      metric: 'verifications',
      value: requestsLeft,
      unit: 'verifications/month',
      note: requestsLeft !== null
        ? `${requestsLeft} verification requests remaining`
        : 'Hunter connected - credit count not available in API response',
    }
  } catch (error) {
    return {
      toolkit: 'hunter',
      metric: 'verifications',
      value: null,
      unit: 'verifications/month',
      note: `Could not query Hunter: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }
}

export async function estimateBandwidth(
  workspaceId: string,
  orgId: string,
): Promise<BandwidthEstimate> {
  const store = getRuntimeStore()
  const summary = store.getWorkspaceSummary(workspaceId)
  const connected = summary.connections.filter((connection) => connection.status === 'connected')

  const toolCapacities: ToolCapacity[] = []
  const knownCheckers: Record<string, (w: string, o: string) => Promise<ToolCapacity>> = {
    instantly: checkInstantlyCapacity,
    apollo: checkApolloCapacity,
    hunter: checkHunterCapacity,
  }

  const resolved = await Promise.allSettled(
    connected.map(async (connection) => {
      const checker = knownCheckers[connection.toolkit]
      if (checker) {
        return checker(workspaceId, orgId)
      }

      return {
        toolkit: connection.toolkit,
        metric: 'unknown',
        value: null,
        unit: '',
        note: 'Connected - capacity estimation not yet supported for this tool',
      } satisfies ToolCapacity
    }),
  )

  for (const result of resolved) {
    if (result.status === 'fulfilled') {
      toolCapacities.push(result.value)
    }
  }

  const instantlyCap = toolCapacities.find((tool) => tool.toolkit === 'instantly')
  const apolloCap = toolCapacities.find((tool) => tool.toolkit === 'apollo')

  const dailySendCapacity = instantlyCap?.value ?? 0
  const monthlyLeadCapacity = apolloCap?.value ?? 0

  let bottleneck = 'none'
  if (connected.length === 0) {
    bottleneck = 'no tools connected'
  } else if (dailySendCapacity === 0 && !instantlyCap) {
    bottleneck = 'instantly not connected'
  } else if (dailySendCapacity === 0) {
    bottleneck = 'instantly - no active sending accounts'
  } else if (monthlyLeadCapacity !== null && monthlyLeadCapacity < 500) {
    bottleneck = 'apollo - low monthly export credits'
  }

  let recommendation = ''
  if (connected.length === 0) {
    recommendation = 'Connect at least Apollo and Instantly to get a bandwidth estimate.'
  } else if (dailySendCapacity === 0) {
    recommendation = 'Add and activate sending accounts in Instantly to increase daily send capacity.'
  } else if (monthlyLeadCapacity !== null && monthlyLeadCapacity > 0) {
    const daysToExhaust = Math.floor(monthlyLeadCapacity / Math.max(dailySendCapacity, 1))
    recommendation = `At ${dailySendCapacity} emails/day you can run for ~${daysToExhaust} days before exhausting Apollo export credits.`
  } else {
    recommendation = `You can send up to ${dailySendCapacity} emails/day with the current Instantly setup.`
  }

  return {
    workspace_id: workspaceId,
    daily_send_capacity: dailySendCapacity,
    monthly_lead_capacity: monthlyLeadCapacity,
    tool_capacities: toolCapacities,
    bottleneck,
    recommendation,
    estimated_at: new Date().toISOString(),
  }
}
