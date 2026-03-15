import { Hono } from 'hono'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import type { AgentChatResponse, ChatMessage, StreamingChatRequest } from '@pipeiq/shared'

import { env } from '../lib/env.js'
import { getOpenAiClient } from '../lib/openai.js'
import { getRuntimeStore } from '../lib/runtime-store.js'
import { ensureWorkspaceRecord, getSupabaseAdmin } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const chatRoutes = new Hono<AppEnv>()
const fallbackChats = new Map<string, ChatMessage[]>()

async function loadRecentChatMessages(workspaceId: string): Promise<ChatMessage[]> {
  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase
      .from('chat_messages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (result.error) {
      throw new Error(result.error.message)
    }

    return ((result.data ?? []) as ChatMessage[]).reverse()
  } catch {
    return [...(fallbackChats.get(workspaceId) ?? [])].slice(-20)
  }
}

async function saveChatMessage(workspaceId: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const fallback = fallbackChats.get(workspaceId) ?? []
  fallback.push({
    id: `${role}_${Date.now()}`,
    workspace_id: workspaceId,
    role,
    content,
    tool_calls_json: [],
    created_at: new Date().toISOString(),
  })
  fallbackChats.set(workspaceId, fallback)

  try {
    const supabase = getSupabaseAdmin()
    const result = await supabase.from('chat_messages').insert({
      workspace_id: workspaceId,
      role,
      content,
      tool_calls_json: [],
      created_at: new Date().toISOString(),
    })

    if (result.error) {
      throw new Error(result.error.message)
    }
  } catch {
    return
  }
}

function systemPrompt(workspaceName: string): string {
  return [
    'You are PipeIQ, an autonomous outbound operator for B2B teams.',
    'Be concise, operational, and bias toward concrete next actions.',
    'Only claim actions were completed if the request explicitly says they already happened.',
    `The active workspace is ${workspaceName}.`,
  ].join(' ')
}

function toOpenAiMessages(history: ChatMessage[]): ChatCompletionMessageParam[] {
  return history.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
  }))
}

chatRoutes.post('/chat', async (c) => {
  const payload = await c.req.json<StreamingChatRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))

  const workspace = getRuntimeStore().getWorkspaceSummary(payload.workspace_id)
  const history = await loadRecentChatMessages(payload.workspace_id)
  await saveChatMessage(payload.workspace_id, 'user', payload.message)

  const openai = getOpenAiClient()
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt(workspace.name),
    },
    ...toOpenAiMessages(history),
    {
      role: 'user',
      content: payload.message,
    },
  ]
  const stream = await openai.chat.completions.create({
    model: env.openAiModel,
    stream: true,
    messages,
  })

  const encoder = new TextEncoder()
  let fullText = ''

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(`event: meta\ndata: ${JSON.stringify({ model: env.openAiModel })}\n\n`),
      )

      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? ''
          if (!delta) {
            continue
          }
          fullText += delta
          controller.enqueue(
            encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`),
          )
        }

        await saveChatMessage(payload.workspace_id, 'assistant', fullText)
        controller.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ response: fullText })}\n\n`),
        )
        controller.close()
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Streaming failed.' })}\n\n`,
          ),
        )
        controller.close()
      }
    },
  })

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('Connection', 'keep-alive')
  return c.newResponse(responseStream)
})

chatRoutes.post('/api/agents/chat', async (c) => {
  const payload = await c.req.json<{ workspace_id: string; prompt: string }>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const workspace = getRuntimeStore().getWorkspaceSummary(payload.workspace_id)
  const history = await loadRecentChatMessages(payload.workspace_id)
  await saveChatMessage(payload.workspace_id, 'user', payload.prompt)

  const openai = getOpenAiClient()
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt(workspace.name),
    },
    ...toOpenAiMessages(history),
    {
      role: 'user',
      content: payload.prompt,
    },
  ]
  const response = await openai.chat.completions.create({
    model: env.openAiModel,
    messages,
  })

  const text = response.choices[0]?.message?.content ?? ''
  await saveChatMessage(payload.workspace_id, 'assistant', text)

  const result: AgentChatResponse = {
    response: text,
    connected_toolkits: workspace.connections
      .filter((connection) => connection.status === 'connected')
      .map((connection) => connection.toolkit),
    model_mode: env.openAiApiKey ? 'live' : 'offline',
  }

  return c.json(result)
})
