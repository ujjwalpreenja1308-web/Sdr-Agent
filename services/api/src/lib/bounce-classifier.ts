/**
 * bounce-classifier.ts
 *
 * Classifies SMTP send errors as hard or soft bounces.
 *
 * Hard bounce: permanent failure — the recipient address doesn't exist or is
 * permanently rejected. Do NOT retry; mark the contact as invalid immediately
 * and stop all sequence steps for that email.
 *
 * Soft bounce: transient failure — the remote server was temporarily unavailable,
 * mailbox was full, rate-limited, greylisted, etc. Retry with exponential back-off.
 *
 * When uncertain, defaults to 'soft' (prefer retrying over silently dropping).
 */

export type BounceType = 'hard' | 'soft'

// ─── SMTP codes that always mean "this address is gone for good" ──────────────
// 550: Mailbox unavailable / does not exist
// 551: User not local; forwarding not allowed
// 553: Mailbox name not allowed
// 554: Transaction failed / blacklisted (permanent)
// 556: Domain does not accept mail
// 557: Too many recipients (permanent policy)
const HARD_BOUNCE_CODES = new Set([550, 551, 553, 554, 556, 557])

// ─── Regex patterns that signal a hard bounce ────────────────────────────────
// Match common provider phrasing for "this address does not exist".
const HARD_BOUNCE_PATTERNS: RegExp[] = [
  /user\s+(unknown|not\s+found|does\s+not\s+exist)/i,
  /no\s+such\s+(user|address|mailbox|recipient)/i,
  /mailbox\s+(not\s+found|unavailable|doesn'?t?\s+exist|does\s+not\s+exist)/i,
  /invalid\s+(address|recipient|mailbox|email)/i,
  /address\s+(rejected|not\s+found|does\s+not\s+exist|unknown)/i,
  /recipient\s+(not\s+found|unknown|rejected|address\s+rejected)/i,
  /account\s+(does\s+not\s+exist|not\s+found|deleted|suspended|terminated)/i,
  /undeliverable/i,
  /permanent\s+(failure|error)/i,
  /address\s+has\s+been\s+disabled/i,
  /email\s+account\s+that\s+you\s+tried\s+to\s+reach\s+does\s+not\s+exist/i,
  // RFC 5321 enhanced codes that indicate permanent address failure
  /5\.\s*1\.\s*[012]/,   // X.1.0 = other address status, X.1.1 = bad destination, X.1.2 = bad sender
  /5\.\s*4\.\s*\d/,      // Routing/relay permanent failure
]

// ─── Patterns that force SOFT even when a 5xx code is present ────────────────
// Mailbox-full is technically a 5xx in some implementations but IS transient.
const SOFT_OVERRIDE_PATTERNS: RegExp[] = [
  /mailbox\s+(full|over\s+quota|storage\s+exceeded)/i,
  /quota\s+(exceeded|full)/i,
  /over\s+(quota|limit|capacity)/i,
  /storage\s+(full|exceeded|limit)/i,
  /temporarily\s+(unavailable|rejected|deferred|suspended)/i,
  /try\s+again\s+later/i,
  /please\s+try\s+again/i,
  /service\s+(unavailable|temporarily\s+unavailable)/i,
  /connection\s+(refused|timed?\s*out|reset|closed)/i,
  /timed?\s*out/i,
  /greyli?sting/i,
  /rate\s+limit(ed|ing)?/i,
  /too\s+many\s+(connections|messages|requests|recipients)/i,
  /busy/i,
  /deferred/i,
  /\b4[0-9]{2}\b/,  // any 4xx code in the message text
]

/**
 * Classify an SMTP send error as a hard or soft bounce.
 * Safe to call with any Error or string — never throws.
 */
export function classifyBounce(error: Error | string): BounceType {
  const msg = typeof error === 'string' ? error : (error.message ?? '')

  // Also check for nodemailer's numeric `responseCode` property on the error
  const responseCode = typeof error === 'object' && error !== null && 'responseCode' in error
    ? (error as { responseCode?: number }).responseCode
    : undefined

  // 1. Soft-override check: if ANY soft signal present, it's soft regardless of 5xx
  for (const pattern of SOFT_OVERRIDE_PATTERNS) {
    if (pattern.test(msg)) return 'soft'
  }

  // 2. Try to extract SMTP response code — from error property first, then message text
  let code: number | undefined = responseCode
  if (!code) {
    const codeMatch = msg.match(/\b([45]\d{2})\b/)
    if (codeMatch?.[1]) code = parseInt(codeMatch[1], 10)
  }

  if (code) {
    // 4xx = always soft
    if (code >= 400 && code < 500) return 'soft'

    // 5xx in our hard set = hard
    if (HARD_BOUNCE_CODES.has(code)) return 'hard'

    // Other 5xx (e.g. 552 storage exceeded at destination) — fall through to
    // keyword patterns before deciding
  }

  // 3. Keyword hard-bounce patterns
  for (const pattern of HARD_BOUNCE_PATTERNS) {
    if (pattern.test(msg)) return 'hard'
  }

  // 4. Default to soft — prefer retrying over silently losing a contact
  return 'soft'
}

/**
 * Returns true if the error looks like a genuine bounce (hard or soft)
 * vs a local infrastructure failure (SMTP auth error, network timeout, etc.)
 * that should not count against the contact.
 */
export function isBounceError(error: Error | string): boolean {
  const msg = typeof error === 'string' ? error : (error.message ?? '')

  // Also check responseCode on the error object
  const responseCode = typeof error === 'object' && error !== null && 'responseCode' in error
    ? (error as { responseCode?: number }).responseCode
    : undefined

  // Auth failures = not a bounce; they indicate inbox misconfiguration
  if (/auth(entication)?\s*(fail|error|invalid|required)/i.test(msg)) return false
  if (/invalid\s+(login|credentials|password)/i.test(msg)) return false
  if (/\b535\b/.test(msg) || responseCode === 535) return false  // 535 = authentication failed
  // Connection-level failures = not a bounce
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH/i.test(msg)) return false
  // Everything else may be a bounce
  return true
}
