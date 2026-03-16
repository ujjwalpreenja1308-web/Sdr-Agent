import {
  Document,
  Settings,
  SimpleNodeParser,
  VectorStoreIndex,
} from 'llamaindex'
import { OpenAIEmbedding } from '@llamaindex/openai'
import { createClient } from '@supabase/supabase-js'

import type { KnowledgePipeline, KnowledgeStatus } from '@pipeiq/shared'

import { env } from './env.js'

// ─── LlamaIndex settings ──────────────────────────────────────────────────────

Settings.embedModel = new OpenAIEmbedding({
  model: 'text-embedding-3-small',
  apiKey: env.openAiApiKey,
})

// ─── Supabase client (service role for vector ops) ───────────────────────────

function getVectorClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey)
}

// ─── Chunk text using LlamaIndex node parser ─────────────────────────────────

function chunkText(text: string): string[] {
  const parser = new SimpleNodeParser({ chunkSize: 512, chunkOverlap: 64 })
  const doc = new Document({ text })
  const nodes = parser.getNodesFromDocuments([doc])
  return nodes.map((node) => node.getContent())
}

// ─── Embed a single string ───────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  return Settings.embedModel.getTextEmbedding(text)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk and embed a document, then upsert all chunks into knowledge_chunks.
 * Call deleteKnowledgePipeline first if you want a full replacement.
 */
export async function ingestDocument(
  workspaceId: string,
  pipeline: KnowledgePipeline,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!env.openAiApiKey) {
    // Offline / dev mode — skip silently
    return
  }

  const supabase = getVectorClient()
  const chunks = chunkText(text)

  const rows = await Promise.all(
    chunks.map(async (content) => {
      const embedding = await embedText(content)
      return {
        workspace_id: workspaceId,
        pipeline,
        content,
        metadata_json: { ...metadata, pipeline, workspace_id: workspaceId },
        embedding: JSON.stringify(embedding),
      }
    }),
  )

  const { error } = await supabase.from('knowledge_chunks').insert(rows)
  if (error) {
    throw new Error(`RAG ingest failed: ${error.message}`)
  }
}

/**
 * Semantic similarity search within a specific pipeline for a workspace.
 * Returns the top-K content strings.
 */
export async function queryKnowledge(
  workspaceId: string,
  pipeline: KnowledgePipeline,
  query: string,
  topK = 5,
): Promise<string[]> {
  if (!env.openAiApiKey) {
    return []
  }

  const supabase = getVectorClient()
  const queryEmbedding = await embedText(query)

  // Use Supabase RPC for pgvector cosine similarity search
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: queryEmbedding,
    workspace_id_filter: workspaceId,
    pipeline_filter: pipeline,
    match_count: topK,
  })

  if (error) {
    // Graceful degradation — if the function doesn't exist yet (dev), return empty
    console.warn(`RAG query warn: ${error.message}`)
    return []
  }

  return (data as Array<{ content: string }> ?? []).map((row) => row.content)
}

/**
 * Delete all chunks for a pipeline in a workspace.
 */
export async function deleteKnowledgePipeline(
  workspaceId: string,
  pipeline: KnowledgePipeline,
): Promise<void> {
  const supabase = getVectorClient()
  const { error } = await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('pipeline', pipeline)

  if (error) {
    throw new Error(`RAG delete failed: ${error.message}`)
  }
}

/**
 * Returns chunk counts per pipeline for a workspace.
 */
export async function getKnowledgeStatus(workspaceId: string): Promise<KnowledgeStatus[]> {
  const supabase = getVectorClient()
  const pipelines: KnowledgePipeline[] = ['playbooks', 'company']

  const results = await Promise.all(
    pipelines.map(async (pipeline) => {
      const { count, error, data } = await supabase
        .from('knowledge_chunks')
        .select('created_at', { count: 'exact', head: false })
        .eq('workspace_id', workspaceId)
        .eq('pipeline', pipeline)
        .order('created_at', { ascending: false })
        .limit(1)

      const lastUpdated = !error && data && data.length > 0
        ? (data[0] as { created_at: string }).created_at
        : null

      return {
        pipeline,
        chunk_count: error ? 0 : (count ?? 0),
        last_updated: lastUpdated,
      }
    }),
  )

  return results
}
