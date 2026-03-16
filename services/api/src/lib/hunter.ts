import { executeConnectedTool } from './composio.js'

const HUNTER_EMAIL_VERIFIER = 'HUNTER_EMAIL_VERIFIER'

export type HunterVerificationResult = {
  status: 'valid' | 'risky' | 'invalid'
  score: number | null
  note: string
  checkedAt: string
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function mapHunterStatus(result: string | null, acceptAll: boolean | null): HunterVerificationResult['status'] {
  const normalized = result?.toLowerCase() ?? ''
  if (normalized === 'deliverable') {
    return acceptAll ? 'risky' : 'valid'
  }
  if (normalized === 'risky' || normalized === 'accept_all') {
    return 'risky'
  }
  return 'invalid'
}

export async function verifyHunterEmail(params: {
  workspaceId: string
  orgId: string
  email: string
}): Promise<HunterVerificationResult> {
  const checkedAt = new Date().toISOString()
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: HUNTER_EMAIL_VERIFIER,
    arguments: {
      email: params.email,
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? `Hunter verification failed for ${params.email}.`)
  }

  const raw = asRecord(response.data) ?? {}
  const nested = asRecord(raw.data)
  const verification = nested ? asRecord(nested.data) : null
  if (!verification) {
    return {
      status: 'invalid',
      score: null,
      note: 'Hunter verification returned an unexpected payload.',
      checkedAt,
      raw,
    }
  }

  const result = asString(verification.result)
  const acceptAll = asBoolean(verification.accept_all)
  const score = asNumber(verification.score)
  const mapped = mapHunterStatus(result, acceptAll)
  const noteParts = [
    result ? `Hunter result: ${result}` : null,
    acceptAll === true ? 'accept_all' : null,
    asBoolean(verification.disposable) ? 'disposable' : null,
    asBoolean(verification.webmail) ? 'webmail' : null,
    asBoolean(verification.block) ? 'blocked' : null,
  ].filter((part): part is string => typeof part === 'string')

  return {
    status: mapped,
    score,
    note: noteParts.join(', ') || 'Hunter verification completed.',
    checkedAt,
    raw,
  }
}
