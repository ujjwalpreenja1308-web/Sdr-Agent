import type { ErrorHandler } from 'hono'

import type { AppEnv } from '../types.js'

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  console.error(error)
  return c.json(
    {
      error: error.message || 'Internal server error',
    },
    500,
  )
}
