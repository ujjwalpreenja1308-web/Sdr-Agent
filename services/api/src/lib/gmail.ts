import { executeConnectedTool } from './composio.js'

const GMAIL_SEND_EMAIL = 'GMAIL_SEND_EMAIL'
const GMAIL_REPLY_TO_THREAD = 'GMAIL_REPLY_TO_THREAD'

export type GmailSendResult = {
  mode: 'reply_to_thread' | 'send_email'
  summary: string
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizedThreadId(threadId: string | null | undefined): string | null {
  if (!threadId) {
    return null
  }
  return threadId.replace(/^msg-f:/i, '').replace(/^thread-f:/i, '').trim() || null
}

export async function sendGmailResponse(params: {
  workspaceId: string
  orgId: string
  recipientEmail: string
  body: string
  subject?: string
  threadId?: string | null
}): Promise<GmailSendResult> {
  const threadId = normalizedThreadId(params.threadId)

  if (threadId) {
    const response = await executeConnectedTool({
      workspaceId: params.workspaceId,
      orgId: params.orgId,
      toolSlug: GMAIL_REPLY_TO_THREAD,
      arguments: {
        thread_id: threadId,
        recipient_email: params.recipientEmail,
        message_body: params.body,
        is_html: false,
      },
    })

    if (!response.successful) {
      throw new Error(response.error ?? 'Gmail thread reply failed.')
    }

    return {
      mode: 'reply_to_thread',
      summary: `Replied to Gmail thread ${threadId}.`,
      raw: asRecord(response.data) ?? {},
    }
  }

  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: GMAIL_SEND_EMAIL,
    arguments: {
      recipient_email: params.recipientEmail,
      subject: params.subject ?? 'Quick follow-up from PipeIQ',
      body: params.body,
      is_html: false,
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Gmail send failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const sentSubject =
    asString(raw.subject) ??
    asString(asRecord(raw.data)?.subject) ??
    params.subject ??
    'Quick follow-up from PipeIQ'

  return {
    mode: 'send_email',
    summary: `Sent Gmail reply to ${params.recipientEmail} with subject "${sentSubject}".`,
    raw,
  }
}
