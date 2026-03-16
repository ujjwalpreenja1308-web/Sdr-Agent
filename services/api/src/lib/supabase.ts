import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Organization, Workspace } from '@pipeiq/shared'

import { env } from './env.js'
import { decrypt, encrypt } from './encryption.js'

let adminClient: SupabaseClient | null = null
const fallbackWorkspaces = new Map<string, Workspace>()
const fallbackOrganizations = new Map<string, Organization>()

function nowIso(): string {
  return new Date().toISOString()
}

function fallbackWorkspaceKey(workspaceId: string, orgId: string): string {
  return `${orgId}:${workspaceId}`
}

function usingDevSupabaseFallback(): boolean {
  return env.supabaseServiceKey === 'dev-service-key' && env.supabaseAnonKey === 'dev-anon-key'
}

export function isSupabasePersistenceEnabled(): boolean {
  return !usingDevSupabaseFallback()
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

function getFallbackOrganization(orgId: string): Organization {
  const existing = fallbackOrganizations.get(orgId)
  if (existing) {
    return existing
  }

  const created: Organization = {
    id: orgId,
    name: 'PipeIQ Organization',
    plan_tier: 'starter',
    stripe_customer_id: null,
    trial_ends_at: null,
    created_at: nowIso(),
  }
  fallbackOrganizations.set(orgId, created)
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

export async function findWorkspaceOrgId(workspaceId: string): Promise<string | null> {
  if (usingDevSupabaseFallback()) {
    for (const [key, workspace] of fallbackWorkspaces.entries()) {
      const [, cachedWorkspaceId] = key.split(':')
      if (cachedWorkspaceId === workspaceId) {
        return workspace.org_id
      }
    }
    return null
  }

  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .limit(1)
    .maybeSingle<{ org_id: string }>()

  if (result.error || !result.data) {
    return null
  }

  return result.data.org_id
}

export async function getOrganizationRecord(orgId: string): Promise<Organization> {
  if (usingDevSupabaseFallback()) {
    return getFallbackOrganization(orgId)
  }

  const supabase = getSupabaseAdmin()
  try {
    const selectResult = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle<Organization>()

    if (selectResult.error) {
      throw new Error(selectResult.error.message)
    }

    if (selectResult.data) {
      return selectResult.data
    }

    const insertResult = await supabase
      .from('organizations')
      .insert({
        id: orgId,
        name: 'PipeIQ Organization',
        plan_tier: 'starter',
        stripe_customer_id: null,
        trial_ends_at: null,
        created_at: nowIso(),
      })
      .select('*')
      .single<Organization>()

    if (insertResult.error || !insertResult.data) {
      throw new Error(insertResult.error?.message ?? 'Unable to create organization record.')
    }

    return insertResult.data
  } catch {
    return getFallbackOrganization(orgId)
  }
}

type MonthlyUsageMetric = 'apollo_enrichment_contacts'

type OrgMonthlyUsageRow = {
  org_id: string
  metric: MonthlyUsageMetric
  period_start: string
  used_count: number
}

function usagePeriodStart(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
}

const fallbackUsage = new Map<string, OrgMonthlyUsageRow>()

function fallbackUsageKey(orgId: string, metric: MonthlyUsageMetric, periodStart: string): string {
  return `${orgId}:${metric}:${periodStart}`
}

export async function getOrgMonthlyUsage(
  orgId: string,
  metric: MonthlyUsageMetric,
): Promise<OrgMonthlyUsageRow> {
  const periodStart = usagePeriodStart()
  if (usingDevSupabaseFallback()) {
    const key = fallbackUsageKey(orgId, metric, periodStart)
    const existing = fallbackUsage.get(key)
    if (existing) {
      return existing
    }
    const created: OrgMonthlyUsageRow = {
      org_id: orgId,
      metric,
      period_start: periodStart,
      used_count: 0,
    }
    fallbackUsage.set(key, created)
    return created
  }

  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('org_monthly_usage')
    .select('org_id, metric, period_start, used_count')
    .eq('org_id', orgId)
    .eq('metric', metric)
    .eq('period_start', periodStart)
    .maybeSingle<OrgMonthlyUsageRow>()

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.data ?? {
    org_id: orgId,
    metric,
    period_start: periodStart,
    used_count: 0,
  }
}

export async function incrementOrgMonthlyUsage(
  orgId: string,
  metric: MonthlyUsageMetric,
  amount: number,
): Promise<OrgMonthlyUsageRow> {
  const periodStart = usagePeriodStart()
  if (usingDevSupabaseFallback()) {
    const key = fallbackUsageKey(orgId, metric, periodStart)
    const current = await getOrgMonthlyUsage(orgId, metric)
    const next: OrgMonthlyUsageRow = {
      ...current,
      used_count: current.used_count + amount,
    }
    fallbackUsage.set(key, next)
    return next
  }

  const current = await getOrgMonthlyUsage(orgId, metric)
  const nextUsedCount = current.used_count + amount
  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('org_monthly_usage')
    .upsert({
      org_id: orgId,
      metric,
      period_start: periodStart,
      used_count: nextUsedCount,
      updated_at: nowIso(),
    }, { onConflict: 'org_id,metric,period_start' })
    .select('org_id, metric, period_start, used_count')
    .single<OrgMonthlyUsageRow>()

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? 'Unable to update monthly usage.')
  }

  return result.data
}

export async function listWorkspacesForOrg(orgId: string): Promise<Workspace[]> {
  if (usingDevSupabaseFallback()) {
    const workspaces = Array.from(fallbackWorkspaces.values()).filter(
      (workspace) => workspace.org_id === orgId,
    )
    return workspaces
  }

  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('workspaces')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .returns<Workspace[]>()

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.data ?? []
}

function sanitizedWorkspaceId(orgId: string): string {
  return `workspace_${orgId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export async function resolvePrimaryWorkspaceForOrg(orgId: string): Promise<Workspace> {
  const existing = await listWorkspacesForOrg(orgId)
  const firstWorkspace = existing[0]
  if (firstWorkspace) {
    return firstWorkspace
  }

  return ensureWorkspaceRecord(sanitizedWorkspaceId(orgId), orgId)
}

export async function listConnectedWorkspaceScopes(toolkit: string): Promise<Array<{ workspaceId: string; orgId: string }>> {
  if (usingDevSupabaseFallback()) {
    return Array.from(fallbackWorkspaces.values()).map((workspace) => ({
      workspaceId: workspace.id,
      orgId: workspace.org_id,
    }))
  }

  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('workspace_connections')
    .select('workspace_id, workspaces!inner(org_id)')
    .eq('toolkit', toolkit)
    .eq('status', 'connected')

  if (result.error) {
    throw new Error(result.error.message)
  }

  return (result.data ?? [])
    .map((row) => {
      const workspaceId =
        typeof row.workspace_id === 'string' ? row.workspace_id : null
      const workspaceRef =
        typeof row.workspaces === 'object' && row.workspaces !== null
          ? (row.workspaces as { org_id?: string })
          : null
      const orgId = workspaceRef?.org_id ?? null
      if (!workspaceId || !orgId) {
        return null
      }
      return { workspaceId, orgId }
    })
    .filter((row): row is { workspaceId: string; orgId: string } => row !== null)
}

export async function findWorkspaceByCampaignId(campaignId: string): Promise<{ workspaceId: string; orgId: string } | null> {
  const supabase = getSupabaseAdmin()
  const result = await supabase
    .from('campaigns')
    .select('workspace_id, workspaces!inner(org_id)')
    .eq('instantly_campaign_id', campaignId)
    .limit(1)
    .maybeSingle()

  if (result.error || !result.data) {
    return null
  }

  const workspaceRef =
    typeof result.data.workspaces === 'object' && result.data.workspaces !== null
      ? (result.data.workspaces as { org_id?: string })
      : null

  if (typeof result.data.workspace_id !== 'string' || !workspaceRef?.org_id) {
    return null
  }

  return {
    workspaceId: result.data.workspace_id,
    orgId: workspaceRef.org_id,
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
  const encryptedValue = encrypt(rawValue.trim())
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

export async function getWorkspaceApiKey(
  workspaceId: string,
  orgId: string,
  toolkit: 'apollo' | 'instantly',
): Promise<string | null> {
  const workspace = await ensureWorkspaceRecord(workspaceId, orgId)
  const encryptedValue =
    toolkit === 'apollo' ? workspace.apollo_key_enc : workspace.instantly_key_enc

  if (!encryptedValue) {
    return null
  }

  return decrypt(encryptedValue)
}
