/**
 * validation.ts — Zod-based request validation helpers.
 *
 * Provides a Hono middleware-compatible helper that validates JSON request
 * bodies against a Zod schema and returns a 400 with structured errors on
 * failure. Also exports reusable schema fragments.
 */

import { z } from 'zod'
import type { Context } from 'hono'

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns the parsed data or throws an ApiError(400) with details.
 */
export async function validateBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    const { ApiError } = await import('../middleware/errorHandler.js')
    throw new ApiError(400, 'Invalid JSON in request body')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const { ApiError } = await import('../middleware/errorHandler.js')
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new ApiError(400, `Validation failed: ${details.join('; ')}`)
  }

  return result.data
}

// ─── Reusable schemas ──────────────────────────────────────────────────────

export const sequenceCreateSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  description: z.string().max(1000).optional(),
  steps: z
    .array(
      z.object({
        step_type: z.enum(['icebreaker', 'follow_up', 'breakup']),
        delay_days: z.number().int().min(0).max(90).default(3),
        subject_template: z.string().min(1).max(500),
        body_template: z.string().min(1).max(5000),
      }),
    )
    .optional(),
})

export const sequenceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
})

export const stepCreateSchema = z.object({
  step_type: z.enum(['icebreaker', 'follow_up', 'breakup']).optional(),
  delay_days: z.number().int().min(0).max(90).optional(),
  subject_template: z.string().min(1).max(500).optional(),
  body_template: z.string().min(1).max(5000).optional(),
})

export const stepUpdateSchema = z.object({
  step_type: z.enum(['icebreaker', 'follow_up', 'breakup']).optional(),
  delay_days: z.number().int().min(0).max(90).optional(),
  subject_template: z.string().min(1).max(500).optional(),
  body_template: z.string().min(1).max(5000).optional(),
})

export const enrollRequestSchema = z.object({
  contact_ids: z.array(z.string().min(1)).min(1, 'contact_ids array is required').max(1000),
})

export const inboxCreateSchema = z.object({
  email: z.string().email('Invalid email address'),
  display_name: z.string().max(200).optional(),
  smtp_host: z.string().min(1, 'smtp_host is required'),
  smtp_port: z.number().int().min(1).max(65535).default(587),
  smtp_user: z.string().min(1, 'smtp_user is required'),
  smtp_pass: z.string().min(1, 'smtp_pass is required'),
  smtp_secure: z.boolean().default(false),
  imap_host: z.string().min(1, 'imap_host is required'),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_user: z.string().min(1, 'imap_user is required'),
  imap_pass: z.string().min(1, 'imap_pass is required'),
  daily_target: z.number().int().min(1).max(40).default(30),
  use_for_outreach: z.boolean().default(false),
})

export const inboxUpdateSchema = z.object({
  display_name: z.string().max(200).optional(),
  daily_target: z.number().int().min(1).max(40).optional(),
  warmup_enabled: z.boolean().optional(),
  use_for_outreach: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
  smtp_pass: z.string().min(1).optional(),
  imap_pass: z.string().min(1).optional(),
})

export const testCredentialsSchema = z.object({
  smtp_host: z.string().min(1),
  smtp_port: z.number().int().min(1).max(65535).default(587),
  smtp_user: z.string().min(1),
  smtp_pass: z.string().min(1),
  smtp_secure: z.boolean().default(false),
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_user: z.string().min(1),
  imap_pass: z.string().min(1),
})

export const webhookRegisterSchema = z.object({
  workspace_id: z.string().min(1, 'workspace_id is required'),
  target_url: z.string().url('target_url must be a valid URL'),
})

export const apiKeyConnectionSchema = z.object({
  workspace_id: z.string().min(1),
  toolkit: z.string().min(1),
  api_key: z.string().min(1, 'api_key is required'),
  label: z.string().min(1).max(200),
})

export const oauthConnectionSchema = z.object({
  workspace_id: z.string().min(1),
  toolkit: z.string().min(1),
  callback_url: z.string().url().optional(),
  external_user_id: z.string().optional(),
})
