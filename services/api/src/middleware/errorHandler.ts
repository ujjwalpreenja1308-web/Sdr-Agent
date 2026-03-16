import { HTTPException } from 'hono/http-exception'
import type { ErrorHandler } from 'hono'

import type { AppEnv } from '../types.js'

// ─── Typed API error ─────────────────────────────────────────────────────────
// Throw this anywhere in a route or library to surface a specific HTTP status
// and a client-safe message. The error handler will NOT expose the internal
// `cause` to the client — only the `message`.

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ApiError'
  }
}

// ─── Global error handler ────────────────────────────────────────────────────
// Maps known error types to appropriate HTTP responses.
// Unknown errors return 500 with a generic message — never leaks stack traces
// or internal details to the client.

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  // Hono's own HTTPException (e.g. from middleware)
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }

  // Our typed API errors
  if (error instanceof ApiError) {
    // Log server-side for debugging (includes cause if present)
    if (error.status >= 500) {
      console.error(`[ApiError ${error.status}]`, error.message, error.cause ?? '')
    }
    return c.json({ error: error.message }, error.status)
  }

  // JSON parse errors from malformed request bodies
  if (error instanceof SyntaxError && 'status' in error) {
    return c.json({ error: 'Invalid JSON in request body' }, 400)
  }

  // Everything else — never expose internals
  console.error('[Unhandled]', error)
  return c.json({ error: 'Internal server error' }, 500)
}
