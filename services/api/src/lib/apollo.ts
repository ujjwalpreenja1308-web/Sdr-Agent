import type { OnboardingProfile } from '@pipeiq/shared'

import { executeConnectedTool } from './composio.js'

const APOLLO_PEOPLE_SEARCH = 'APOLLO_PEOPLE_SEARCH'

export type ApolloProspect = {
  fullName: string
  email: string
  title: string
  company: string
  signalType: string
  signalDetail: string
  score: number
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

function deriveSearchArguments(
  onboarding: OnboardingProfile,
  limit: number,
  page: number,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    page,
    per_page: Math.min(Math.max(limit, 1), 25),
  }

  if (onboarding.target_customer.trim().length > 0) {
    args.q_keywords = onboarding.target_customer
  }
  if (onboarding.titles.length > 0) {
    args.person_titles = onboarding.titles
  }
  if (onboarding.geos.length > 0) {
    args.person_locations = onboarding.geos
  }
  if (onboarding.industries.length > 0) {
    args.q_organization_domains = onboarding.industries
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
    for (const nestedKey of ['people', 'contacts', 'results', 'records']) {
      if (Array.isArray(record[nestedKey])) {
        return asArray(record[nestedKey])
      }
    }
  }

  return []
}

function mapProspect(person: unknown, fallbackSignal: string): ApolloProspect | null {
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
  const email =
    asString(record.email) ??
    asString(record.email_address) ??
    asString(record.primary_email)
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

  if (!fullName || !email) {
    return null
  }

  return {
    fullName,
    email,
    title,
    company,
    signalType: 'Apollo search match',
    signalDetail: fallbackSignal,
    score,
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
      .map((person) => mapProspect(person, fallbackSignal))
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
