import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'

const currentDir = dirname(fileURLToPath(import.meta.url))
config({
  path: resolve(currentDir, '../../.env'),
})

type EnvKey =
  | 'SUPABASE_URL'
  | 'SUPABASE_SERVICE_KEY'
  | 'SUPABASE_ANON_KEY'
  | 'OPENAI_API_KEY'
  | 'COMPOSIO_API_KEY'
  | 'ENCRYPTION_KEY'
  | 'TRIGGER_SECRET_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'PORT'
  | 'PIPEIQ_FRONTEND_URL'
  | 'PIPEIQ_DEFAULT_CALLBACK_URL'
  | 'PIPEIQ_ALLOWED_ORIGINS'
  | 'PIPEIQ_OPENAI_MODEL'
  | 'PIPEIQ_GMAIL_AUTH_CONFIG_ID'
  | 'PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID'
  | 'PIPEIQ_CALENDLY_AUTH_CONFIG_ID'
  | 'PIPEIQ_HUBSPOT_AUTH_CONFIG_ID'
  | 'PIPEIQ_DEV_BEARER_TOKEN'
  | 'PIPEIQ_DEV_USER_ID'
  | 'PIPEIQ_DEV_ORG_ID'
  | 'PIPEIQ_WARMING_CRON_SECRET'

type OptionalEnvKey =
  | 'SUPABASE_URL'
  | 'SUPABASE_SERVICE_KEY'
  | 'SUPABASE_ANON_KEY'
  | 'OPENAI_API_KEY'
  | 'COMPOSIO_API_KEY'
  | 'ENCRYPTION_KEY'
  | 'TRIGGER_SECRET_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'PIPEIQ_GMAIL_AUTH_CONFIG_ID'
  | 'PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID'
  | 'PIPEIQ_CALENDLY_AUTH_CONFIG_ID'
  | 'PIPEIQ_HUBSPOT_AUTH_CONFIG_ID'
  | 'PIPEIQ_DEV_BEARER_TOKEN'
  | 'PIPEIQ_DEV_USER_ID'
  | 'PIPEIQ_DEV_ORG_ID'
  | 'PIPEIQ_WARMING_CRON_SECRET'

const OPTIONAL_KEYS = new Set<OptionalEnvKey>([
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',
  'OPENAI_API_KEY',
  'COMPOSIO_API_KEY',
  'ENCRYPTION_KEY',
  'TRIGGER_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'PIPEIQ_GMAIL_AUTH_CONFIG_ID',
  'PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID',
  'PIPEIQ_CALENDLY_AUTH_CONFIG_ID',
  'PIPEIQ_HUBSPOT_AUTH_CONFIG_ID',
  'PIPEIQ_DEV_BEARER_TOKEN',
  'PIPEIQ_DEV_USER_ID',
  'PIPEIQ_DEV_ORG_ID',
  'PIPEIQ_WARMING_CRON_SECRET',
])

function getEnvValue(name: EnvKey): string {
  const value = process.env[name]
  if (!value && !OPTIONAL_KEYS.has(name as OptionalEnvKey)) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value ?? ''
}

export const env = {
  supabaseUrl: getEnvValue('SUPABASE_URL') || 'http://127.0.0.1:54321',
  supabaseServiceKey: getEnvValue('SUPABASE_SERVICE_KEY') || 'dev-service-key',
  supabaseAnonKey: getEnvValue('SUPABASE_ANON_KEY') || 'dev-anon-key',
  openAiApiKey: getEnvValue('OPENAI_API_KEY'),
  composioApiKey: getEnvValue('COMPOSIO_API_KEY'),
  encryptionKey:
    getEnvValue('ENCRYPTION_KEY') ||
    '0000000000000000000000000000000000000000000000000000000000000000',
  triggerSecretKey: getEnvValue('TRIGGER_SECRET_KEY'),
  stripeSecretKey: getEnvValue('STRIPE_SECRET_KEY'),
  port: Number.parseInt(getEnvValue('PORT') || '8000', 10),
  frontendUrl: getEnvValue('PIPEIQ_FRONTEND_URL') || 'http://localhost:5173',
  defaultCallbackUrl:
    getEnvValue('PIPEIQ_DEFAULT_CALLBACK_URL') || 'http://localhost:5173',
  allowedOrigins:
    getEnvValue('PIPEIQ_ALLOWED_ORIGINS') ||
    'http://localhost:5173,http://127.0.0.1:5173',
  openAiModel: getEnvValue('PIPEIQ_OPENAI_MODEL') || 'gpt-4o',
  authConfigIds: {
    gmail: getEnvValue('PIPEIQ_GMAIL_AUTH_CONFIG_ID'),
    googlecalendar: getEnvValue('PIPEIQ_GOOGLECALENDAR_AUTH_CONFIG_ID'),
    calendly: getEnvValue('PIPEIQ_CALENDLY_AUTH_CONFIG_ID'),
    hubspot: getEnvValue('PIPEIQ_HUBSPOT_AUTH_CONFIG_ID'),
  },
  devAuth: {
    bearerToken: getEnvValue('PIPEIQ_DEV_BEARER_TOKEN') || 'dev-local-token',
    userId: getEnvValue('PIPEIQ_DEV_USER_ID') || 'local-user',
    orgId: getEnvValue('PIPEIQ_DEV_ORG_ID') || 'local-org',
  },
  warmingCronSecret: getEnvValue('PIPEIQ_WARMING_CRON_SECRET') || 'dev-warming-secret',
}

export function allowedOrigins(): string[] {
  return env.allowedOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
}
