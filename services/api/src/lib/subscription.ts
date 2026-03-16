import type { PlanTier } from '@pipeiq/shared'

import { getOrgMonthlyUsage, getOrganizationRecord } from './supabase.js'

type EffectiveTier = 'trial' | 'starter' | 'growth' | 'scale'

type ApolloTierAllowance = {
  effectiveTier: EffectiveTier
  monthlyContactLimit: number
  usedThisMonth: number
  remainingThisMonth: number
  trialEndsAt: string | null
  periodStart: string
}

const APOLLO_CONTACT_LIMITS: Record<EffectiveTier, number> = {
  trial: 100,
  starter: 1000,
  growth: 5000,
  scale: 20000,
}

function normalizePlanTier(planTier: PlanTier): EffectiveTier {
  const normalized = planTier.toLowerCase()
  if (normalized === 'scale') {
    return 'scale'
  }
  if (normalized === 'growth') {
    return 'growth'
  }
  return 'starter'
}

function isTrialActive(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) {
    return false
  }

  const parsed = Date.parse(trialEndsAt)
  return !Number.isNaN(parsed) && parsed >= Date.now()
}

export async function getApolloTierAllowance(orgId: string): Promise<ApolloTierAllowance> {
  const organization = await getOrganizationRecord(orgId)
  const usage = await getOrgMonthlyUsage(orgId, 'apollo_enrichment_contacts')
  const effectiveTier = isTrialActive(organization.trial_ends_at)
    ? 'trial'
    : normalizePlanTier(organization.plan_tier)
  const monthlyContactLimit = APOLLO_CONTACT_LIMITS[effectiveTier]
  const remainingThisMonth = Math.max(monthlyContactLimit - usage.used_count, 0)

  return {
    effectiveTier,
    monthlyContactLimit,
    usedThisMonth: usage.used_count,
    remainingThisMonth,
    trialEndsAt: organization.trial_ends_at,
    periodStart: usage.period_start,
  }
}
