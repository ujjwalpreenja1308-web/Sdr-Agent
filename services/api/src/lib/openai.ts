import OpenAI from 'openai'

import { env } from './env.js'

let client: OpenAI | null = null

export function getOpenAiClient(): OpenAI {
  if (!env.openAiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.openAiApiKey })
  }
  return client
}
