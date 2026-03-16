import type { OnboardingProfile } from '@pipeiq/shared'

import { executeConnectedTool } from './composio.js'
import { incrementOrgMonthlyUsage, getWorkspaceApiKey } from './supabase.js'
import { getApolloTierAllowance } from './subscription.js'

const APOLLO_BASE_URL = 'https://api.apollo.io'
const APOLLO_PEOPLE_SEARCH = 'APOLLO_PEOPLE_SEARCH'
const APOLLO_BULK_MATCH_MAX_BATCH = 10

export type ApolloProspect = {
  fullName: string
  email: string
  title: string
  company: string
  apolloId?: string | null
  linkedinUrl?: string | null
  signalType: string
  signalDetail: string
  score: number
}

type ApolloSearchCandidate = {
  id: string | null
  fullName: string
  title: string
  company: string
  linkedinUrl: string | null
  score: number
}

type ApolloHealthCheck = {
  status: 'connected' | 'not_connected' | 'error'
  ok: boolean
  summary: string
  details: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

function chunk<T>(items: T[], size: number): T[][]
{
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function apolloHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  }
}

async function apolloRequest(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${APOLLO_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...apolloHeaders(apiKey),
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  const payload = text.length > 0 ? safeJsonParse(text) : {}
  const data = asRecord(payload) ?? {}

  if (!response.ok) {
    const message =
      asString(data.error) ??
      asString(data.message) ??
      asString(data.detail) ??
      `Apollo request failed with ${response.status}.`
    throw new Error(message)
  }

  return data
}

function deriveSearchArguments(
  onboarding: OnboardingProfile,
  limit: number,
  page: number,
): Record<string, unknown> {
  const keywordParts = [
    onboarding.target_customer,
    onboarding.value_proposition,
    onboarding.pain_points,
    onboarding.industries.join(', '),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const args: Record<string, unknown> = {
    page,
    per_page: Math.min(Math.max(limit, 1), 100),
  }

  if (keywordParts.length > 0) {
    args.q_keywords = keywordParts.join(' | ')
  }
  if (onboarding.titles.length > 0) {
    args.person_titles = onboarding.titles
  }
  if (onboarding.geos.length > 0) {
    args.person_locations = onboarding.geos
  }
  if (onboarding.company_sizes.length > 0) {
    args.organization_num_employees_ranges = onboarding.company_sizes
  }

  return args
}

function pickPeoplePayload(data: Record<string, unknown>): unknown[] {
  const directMatches = [
    data.people,
    data.contacts,
    data.results,
    data.records,
    data.matches,
  ]

  for (const candidate of directMatches) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  for (const value of Object.values(data)) {
    const record = asRecord(value)
    if (!record) {
      continue
    }
    for (const nestedKey of ['people', 'contacts', 'results', 'records', 'matches']) {
      if (Array.isArray(record[nestedKey])) {
        return asArray(record[nestedKey])
      }
    }
  }

  return []
}

function mapApolloCandidate(person: unknown): ApolloSearchCandidate | null {
  const record = asRecord(person)
  if (!record) {
    return null
  }

  const firstName =
    asString(record.first_name) ??
    asString(record.firstName) ??
    asString(record.firstname) ??
    ''
  const lastName =
    asString(record.last_name) ??
    asString(record.lastName) ??
    asString(record.lastname) ??
    ''
  const fullName =
    asString(record.name) ??
    `${firstName} ${lastName}`.trim()
  const title =
    asString(record.title) ??
    asString(record.job_title) ??
    asString(record.headline) ??
    'Unknown title'
  const organization =
    asRecord(record.organization) ??
    asRecord(record.account) ??
    asRecord(record.company)
  const company =
    asString(record.organization_name) ??
    asString(record.company_name) ??
    asString(organization?.name) ??
    'Unknown company'
  const score =
    asNumber(record.score) ??
    asNumber(record.intent_strength) ??
    80

  if (!fullName) {
    return null
  }

  return {
    id: asString(record.id),
    fullName,
    title,
    company,
    linkedinUrl:
      asString(record.linkedin_url) ??
      asString(record.linkedin_url_cleaned) ??
      asString(record.linkedin_url_raw) ??
      asString(record.linkedin_url_current),
    score,
  }
}

function mapApolloProspect(person: unknown, fallbackSignal: string): ApolloProspect | null {
  const record = asRecord(person)
  if (!record) {
    return null
  }

  const candidate = mapApolloCandidate(record)
  if (!candidate) {
    return null
  }

  const email =
    asString(record.email) ??
    asString(record.email_address) ??
    asString(record.primary_email)

  if (!email) {
    return null
  }

  return {
    fullName: candidate.fullName,
    email,
    title: candidate.title,
    company: candidate.company,
    apolloId: candidate.id,
    linkedinUrl: candidate.linkedinUrl,
    signalType: 'Apollo search match',
    signalDetail: fallbackSignal,
    score: candidate.score,
  }
}

async function validateApolloApiKeyDirect(apiKey: string): Promise<ApolloHealthCheck> {
  try {
    const payload = await apolloRequest(apiKey, '/v1/auth/health', {
      method: 'GET',
    })
    const details: string[] = []
    const email = asString(payload.email)
    const userName =
      asString(payload.name) ??
      asString(payload.user_name)
    const organization =
      asString(payload.organization_name) ??
      asString(payload.account_name)

    if (userName) {
      details.push(`User: ${userName}`)
    }
    if (email) {
      details.push(`Email: ${email}`)
    }
    if (organization) {
      details.push(`Workspace: ${organization}`)
    }
    details.push('Apollo auth health endpoint succeeded.')

    return {
      status: 'connected',
      ok: true,
      summary: 'Apollo API key is valid and ready for live people search.',
      details,
    }
  } catch (error) {
    return {
      status: 'error',
      ok: false,
      summary:
        error instanceof Error ? error.message : 'Apollo API key validation failed.',
      details: [
        'Apollo auth health endpoint rejected the supplied API key.',
      ],
    }
  }
}

async function searchApolloPeopleDirect(params: {
  apiKey: string
  onboarding: OnboardingProfile
  limit: number
}): Promise<ApolloSearchCandidate[]> {
  const requestedLimit = Math.min(Math.max(params.limit, 1), 500)
  const pageSize = Math.min(requestedLimit, 100)
  const maxPages = Math.ceil(requestedLimit / pageSize)
  const people: ApolloSearchCandidate[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await apolloRequest(params.apiKey, '/api/v1/mixed_people/api_search', {
      method: 'POST',
      body: JSON.stringify(deriveSearchArguments(params.onboarding, pageSize, page)),
    })

    const pagePeople = pickPeoplePayload(payload)
      .map((person) => mapApolloCandidate(person))
      .filter((person): person is ApolloSearchCandidate => person !== null)

    if (pagePeople.length === 0) {
      break
    }

    for (const person of pagePeople) {
      const idKey = person.id?.toLowerCase() ?? ''
      const nameKey = `${person.fullName}|${person.company}`.toLowerCase()
      if ((idKey && seenIds.has(idKey)) || seenNames.has(nameKey)) {
        continue
      }
      if (idKey) {
        seenIds.add(idKey)
      }
      seenNames.add(nameKey)
      people.push(person)
      if (people.length >= requestedLimit) {
        return people
      }
    }
  }

  return people
}

async function enrichApolloPeopleDirect(params: {
  orgId: string
  apiKey: string
  candidates: ApolloSearchCandidate[]
  fallbackSignal: string
  enrichmentBudget: number
}): Promise<ApolloProspect[]> {
  const prospects: ApolloProspect[] = []
  const seenEmails = new Set<string>()
  let remainingBudget = params.enrichmentBudget

  for (const group of chunk(params.candidates, APOLLO_BULK_MATCH_MAX_BATCH)) {
    if (remainingBudget <= 0) {
      break
    }

    const details = group
      .filter((candidate) => candidate.id)
      .slice(0, remainingBudget)
      .map((candidate) => ({ id: candidate.id }))

    if (details.length === 0) {
      continue
    }

    const payload = await apolloRequest(params.apiKey, '/api/v1/people/bulk_match', {
      method: 'POST',
      body: JSON.stringify({
        details,
        reveal_personal_emails: false,
      }),
    })
    await incrementOrgMonthlyUsage(
      params.orgId,
      'apollo_enrichment_contacts',
      details.length,
    )
    remainingBudget -= details.length

    const matches = pickPeoplePayload(payload)
      .map((person) => mapApolloProspect(person, params.fallbackSignal))
      .filter((person): person is ApolloProspect => person !== null)

    for (const prospect of matches) {
      const emailKey = prospect.email.toLowerCase()
      if (seenEmails.has(emailKey)) {
        continue
      }
      seenEmails.add(emailKey)
      prospects.push(prospect)
    }
  }

  return prospects
}

async function searchApolloProspectsViaComposio(params: {
  workspaceId: string
  orgId: string
  onboarding: OnboardingProfile
  limit?: number
}): Promise<ApolloProspect[]> {
  const fallbackSignal =
    params.onboarding.value_proposition ||
    params.onboarding.pain_points ||
    params.onboarding.target_customer ||
    'Matched the current Apollo search filters.'
  const requestedLimit = Math.min(Math.max(params.limit ?? 10, 1), 500)
  const pageSize = Math.min(requestedLimit, 25)
  const maxPages = Math.ceil(requestedLimit / pageSize)
  const prospects: ApolloProspect[] = []
  const seenEmails = new Set<string>()

  for (let page = 1; page <= maxPages; page += 1) {
    const searchResponse = await executeConnectedTool({
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      toolSlug: APOLLO_PEOPLE_SEARCH,
      arguments: deriveSearchArguments(params.onboarding, pageSize, page),
    })

    if (!searchResponse.successful) {
      throw new Error(searchResponse.error ?? 'Apollo people search failed.')
    }

    const data = asRecord(searchResponse.data)
    if (!data) {
      break
    }

    const pageProspects = pickPeoplePayload(data)
      .map((person) => mapApolloProspect(person, fallbackSignal))
      .filter((person): person is ApolloProspect => person !== null)

    if (pageProspects.length === 0) {
      break
    }

    for (const prospect of pageProspects) {
      const emailKey = prospect.email.toLowerCase()
      if (seenEmails.has(emailKey)) {
        continue
      }
      seenEmails.add(emailKey)
      prospects.push(prospect)
      if (prospects.length >= requestedLimit) {
        return prospects
      }
    }
  }

  return prospects
}

export async function validateApolloApiKey(apiKey: string): Promise<ApolloHealthCheck> {
  return validateApolloApiKeyDirect(apiKey.trim())
}

export async function getApolloConnectionHealth(params: {
  workspaceId: string
  orgId: string
}): Promise<ApolloHealthCheck> {
  const apiKey = await getWorkspaceApiKey(params.workspaceId, params.orgId, 'apollo')
  if (!apiKey) {
    return {
      status: 'not_connected',
      ok: false,
      summary: 'Apollo API key has not been saved for this workspace.',
      details: ['Save an Apollo API key before running live prospect searches.'],
    }
  }

  const validation = await validateApolloApiKeyDirect(apiKey)
  if (!validation.ok) {
    return validation
  }

  const allowance = await getApolloTierAllowance(params.orgId)
  return {
    ...validation,
    details: [
      ...validation.details,
      `PipeIQ tier: ${allowance.effectiveTier}`,
      `Monthly Apollo enrichments: ${allowance.usedThisMonth}/${allowance.monthlyContactLimit}`,
      `Remaining this month: ${allowance.remainingThisMonth}`,
    ],
  }
}

export async function searchApolloProspects(params: {
  workspaceId: string
  orgId: string
  onboarding: OnboardingProfile
  limit?: number
}): Promise<ApolloProspect[]> {
  const fallbackSignal =
    params.onboarding.value_proposition ||
    params.onboarding.pain_points ||
    params.onboarding.target_customer ||
    'Matched the current Apollo search filters.'
  const requestedLimit = Math.min(Math.max(params.limit ?? 10, 1), 500)
  const apiKey = await getWorkspaceApiKey(params.workspaceId, params.orgId, 'apollo')

  if (!apiKey) {
    return searchApolloProspectsViaComposio(params)
  }

  const allowance = await getApolloTierAllowance(params.orgId)
  if (allowance.remainingThisMonth <= 0) {
    throw new Error(
      `Apollo enrichment limit reached for this month on the ${allowance.effectiveTier} tier (${allowance.monthlyContactLimit} contacts/month).`,
    )
  }
  const enrichmentBudget = Math.min(requestedLimit, allowance.remainingThisMonth)

  const candidates = await searchApolloPeopleDirect({
    apiKey,
    onboarding: params.onboarding,
    limit: enrichmentBudget,
  })

  if (candidates.length === 0) {
    return []
  }

  const enriched = await enrichApolloPeopleDirect({
    orgId: params.orgId,
    apiKey,
    candidates,
    fallbackSignal,
    enrichmentBudget,
  })

  return enriched.slice(0, enrichmentBudget)
}
