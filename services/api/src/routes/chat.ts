import { Hono } from 'hono'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

import type {
  AgentActionRequest,
  AgentActionResult,
  AgentActionRun,
  AgentCatalog,
  AgentChatRequest,
  AgentChatResponse,
  AgentPlan,
  AgentPlanRequest,
  AgentRunState,
  ChatMessage,
  StreamingChatRequest,
} from '@pipeiq/shared'

import { executeAgentAction } from '../agents/actions.js'
import {
  buildAgentPlan,
  createAgentStream,
  getAgentCatalog,
  runAgentChat,
} from '../agents/service.js'
import { env } from '../lib/env.js'
import { ensureWorkspaceRecord, getSupabaseAdmin } from '../lib/supabase.js'
import { enqueueAgentRun, getAgentRunState } from '../lib/trigger.js'
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

function toOpenAiMessages(history: ChatMessage[]): ChatCompletionMessageParam[] {
  return history.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
  }))
}

chatRoutes.get('/api/agents/:workspaceId/catalog', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const catalog: AgentCatalog = getAgentCatalog(workspaceId)
  return c.json(catalog)
})

chatRoutes.post('/api/agents/plan', async (c) => {
  const payload = await c.req.json<AgentPlanRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const plan: AgentPlan = buildAgentPlan(
    payload.workspace_id,
    payload.prompt,
    payload.agent_id,
  )
  return c.json(plan)
})

chatRoutes.post('/api/agents/act', async (c) => {
  const payload = await c.req.json<AgentActionRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const result: AgentActionResult = await executeAgentAction({
    workspaceId: payload.workspace_id,
    orgId: c.get('orgId'),
    ...(payload.prompt ? { prompt: payload.prompt } : {}),
    ...(payload.agent_id ? { preferredAgentId: payload.agent_id } : {}),
  })
  return c.json(result)
})

chatRoutes.post('/api/agents/act/async', async (c) => {
  const payload = await c.req.json<AgentActionRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))

  try {
    const result: AgentActionRun = await enqueueAgentRun(payload, c.get('orgId'))
    return c.json(result, 202)
  } catch (error) {
    return c.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : 'Unable to enqueue the agent action.',
      },
      503,
    )
  }
})

chatRoutes.get('/api/agents/runs/:runId', async (c) => {
  const runId = c.req.param('runId')

  try {
    const result: AgentRunState = await getAgentRunState(runId)
    await ensureWorkspaceRecord(result.workspace_id, c.get('orgId'))
    return c.json(result)
  } catch (error) {
    return c.json(
      {
        detail:
          error instanceof Error
            ? error.message
            : 'Unable to load the agent run status.',
      },
      404,
    )
  }
})

chatRoutes.post('/chat', async (c) => {
  const payload = await c.req.json<StreamingChatRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))

  const history = await loadRecentChatMessages(payload.workspace_id)
  await saveChatMessage(payload.workspace_id, 'user', payload.message)
  const { agent, stream } = await createAgentStream({
    workspaceId: payload.workspace_id,
    prompt: payload.message,
    history: toOpenAiMessages(history),
    ...(payload.agent_id ? { preferredAgentId: payload.agent_id } : {}),
  })

  const encoder = new TextEncoder()
  let fullText = ''

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({
            model: env.openAiModel,
            selected_agent_id: agent.id,
            selected_agent_label: agent.label,
            suggested_prompts: agent.defaultPrompts,
          })}\n\n`,
        ),
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
  const payload = await c.req.json<AgentChatRequest>()
  await ensureWorkspaceRecord(payload.workspace_id, c.get('orgId'))
  const history = await loadRecentChatMessages(payload.workspace_id)
  await saveChatMessage(payload.workspace_id, 'user', payload.prompt)
  const { content, result } = await runAgentChat({
    workspaceId: payload.workspace_id,
    prompt: payload.prompt,
    history: toOpenAiMessages(history),
    ...(payload.agent_id ? { preferredAgentId: payload.agent_id } : {}),
  })
  await saveChatMessage(payload.workspace_id, 'assistant', content)

  const typedResult: AgentChatResponse = result
  return c.json(typedResult)
})
