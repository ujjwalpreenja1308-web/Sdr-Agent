import { Composio } from '@composio/core'

import { env } from './env.js'

let composio: Composio | null = null

export function getComposioClient(): Composio {
  if (!env.composioApiKey) {
    throw new Error('COMPOSIO_API_KEY is not configured.')
  }
  if (!composio) {
    composio = new Composio({
      apiKey: env.composioApiKey,
    })
  }
  return composio
}

export function authConfigIdForToolkit(toolkit: string): string | undefined {
  const mapping: Record<string, string> = {
    gmail: env.authConfigIds.gmail,
    googlecalendar: env.authConfigIds.googlecalendar,
    calendly: env.authConfigIds.calendly,
    hubspot: env.authConfigIds.hubspot,
  }
  const authConfigId = mapping[toolkit]
  return authConfigId || undefined
}
