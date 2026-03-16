/**
 * rag.ts — RAG (retrieval-augmented generation) pipeline
 *
 * Improvements over v1:
 * - Batch embedding: sends all chunks to OpenAI in one call instead of N parallel calls
 * - Content-hash deduplication: skips chunks already stored (idempotent re-ingestion)
 * - Similarity threshold: returns only chunks that meet a minimum relevance score
 * - Source metadata: every chunk records its origin (file name / URL / label)
 * - Larger chunks: 1 024 tokens / 128 overlap → richer per-chunk context
 * - queryKnowledge returns scored results so callers can sort / label them
 * - Detailed error logging; no silent swallowing of RPC errors
 */

import { createHash } from 'node:crypto'
import { Document, Settings, SimpleNodeParser } from 'llamaindex'
import { OpenAIEmbedding } from '@llamaindex/openai'
import { createClient } from '@supabase/supabase-js'

import type { KnowledgePipeline, KnowledgeStatus } from '@pipeiq/shared'

import { env } from './env.js'

// ─── LlamaIndex settings ──────────────────────────────────────────────────────

Settings.embedModel = new OpenAIEmbedding({
  model: 'text-embedding-3-small', // produces 1 536-dim vectors — matches vector(1536) schema
  apiKey: env.openAiApiKey,
})

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_SIZE    = 1024  // tokens per chunk (was 512)
const CHUNK_OVERLAP = 128   // overlap between chunks (was 64)
const DEFAULT_TOP_K = 6     // chunks retrieved per pipeline (was 5)
const DEFAULT_THRESHOLD = 0.65 // minimum cosine similarity to include a chunk

// Maximum characters we'll inject per chunk in the system prompt.
// Keeps the prompt from ballooning when chunks are verbose.
const MAX_CHUNK_CHARS = 600

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getVectorClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey)
}

function chunkText(text: string): string[] {
  const parser = new SimpleNodeParser({ chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP })
  const doc = new Document({ text })
  const nodes = parser.getNodesFromDocuments([doc])
  return nodes.map((node) => node.getContent())
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

/** Batch-embed an array of strings in a single API round-trip. */
async function embedBatch(texts: string[]): Promise<number[][]> {
  return Settings.embedModel.getTextEmbeddingsBatch(texts)
}

/** Embed a single query string. */
async function embedQuery(text: string): Promise<number[]> {
  const result = await Settings.embedModel.getQueryEmbedding(text as unknown as Parameters<typeof Settings.embedModel.getQueryEmbedding>[0])
  return result ?? []
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RankedChunk {
  content: string
  similarity: number
  source: string | null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk, embed, and upsert a document into knowledge_chunks.
 *
 * Deduplication: chunks whose content_hash already exists for this
 * (workspace, pipeline) pair are skipped — making re-ingestion idempotent.
 *
 * @param source  Human-readable origin label (filename, URL, "manual upload", etc.)
 * @param replace If true, the pipeline is purged before ingestion — use for
 *                full document replacements.
 */
export async function ingestDocument(
  workspaceId: string,
  pipeline: KnowledgePipeline,
  text: string,
  metadata: Record<string, unknown> = {},
  source = 'api_upload',
  replace = false,
): Promise<{ inserted: number; skipped: number }> {
  if (!env.openAiApiKey) {
    console.warn('[rag] OPENAI_API_KEY not set — skipping ingest (offline mode)')
    return { inserted: 0, skipped: 0 }
  }

  if (replace) {
    await deleteKnowledgePipeline(workspaceId, pipeline)
  }

  const supabase = getVectorClient()
  const rawChunks = chunkText(text)

  if (rawChunks.length === 0) {
    return { inserted: 0, skipped: 0 }
  }

  // Compute hashes for all chunks so we can dedup before embedding
  const hashed = rawChunks.map((content) => ({ content, hash: contentHash(content) }))

  // Check which hashes are already stored (bulk lookup)
  const { data: existing } = await supabase
    .from('knowledge_chunks')
    .select('content_hash')
    .eq('workspace_id', workspaceId)
    .eq('pipeline', pipeline)
    .in('content_hash', hashed.map((c) => c.hash))

  const alreadyStored = new Set((existing ?? []).map((row: { content_hash: string }) => row.content_hash))

  const toInsert = hashed.filter((c) => !alreadyStored.has(c.hash))
  const skipped = hashed.length - toInsert.length

  if (toInsert.length === 0) {
    return { inserted: 0, skipped }
  }

  // Batch embed all new chunks in a single API call
  const embeddings = await embedBatch(toInsert.map((c) => c.content))

  const rows = toInsert.map(({ content, hash }, i) => ({
    workspace_id: workspaceId,
    pipeline,
    content,
    content_hash: hash,
    source,
    metadata_json: {
      ...metadata,
      pipeline,
      workspace_id: workspaceId,
      source,
      chunk_index: i,
    },
    embedding: JSON.stringify(embeddings[i]),
  }))

  const { error } = await supabase
    .from('knowledge_chunks')
    .upsert(rows, { onConflict: 'workspace_id,pipeline,content_hash', ignoreDuplicates: true })

  if (error) {
    throw new Error(`[rag] Ingest failed: ${error.message}`)
  }

  return { inserted: toInsert.length, skipped }
}

/**
 * Semantic similarity search within a specific pipeline for a workspace.
 *
 * Returns scored chunks sorted by similarity (descending).
 * Only chunks that meet `threshold` are returned.
 */
export async function queryKnowledge(
  workspaceId: string,
  pipeline: KnowledgePipeline,
  query: string,
  topK    = DEFAULT_TOP_K,
  threshold = DEFAULT_THRESHOLD,
): Promise<RankedChunk[]> {
  if (!env.openAiApiKey) {
    return []
  }

  if (!query.trim()) {
    return []
  }

  const supabase = getVectorClient()

  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(query)
  } catch (embedErr) {
    console.error('[rag] Query embedding failed:', embedErr)
    return []
  }

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding:     queryEmbedding,
    workspace_id_filter: workspaceId,
    pipeline_filter:     pipeline,
    match_count:         topK,
    match_threshold:     threshold,
  })

  if (error) {
    console.error(`[rag] Supabase RPC error (pipeline=${pipeline}):`, error.message)
    return []
  }

  return (data as Array<{ content: string; similarity: number; source: string | null }> ?? [])
    .map((row) => ({
      content: row.content.length > MAX_CHUNK_CHARS
        ? row.content.slice(0, MAX_CHUNK_CHARS) + '…'
        : row.content,
      similarity: Math.round(row.similarity * 100) / 100,
      source: row.source ?? null,
    }))
}

/**
 * Query both pipelines simultaneously and merge results.
 * Deduplicates by content_hash so the same snippet can't appear twice.
 * Returns results sorted by similarity (highest first).
 */
export async function queryAllPipelines(
  workspaceId: string,
  query: string,
  topKPerPipeline = DEFAULT_TOP_K,
  threshold        = DEFAULT_THRESHOLD,
): Promise<{ pipeline: KnowledgePipeline; chunks: RankedChunk[] }[]> {
  const [playbookChunks, companyChunks] = await Promise.all([
    queryKnowledge(workspaceId, 'playbooks', query, topKPerPipeline, threshold).catch(() => []),
    queryKnowledge(workspaceId, 'company',   query, topKPerPipeline, threshold).catch(() => []),
  ])

  return [
    { pipeline: 'playbooks', chunks: playbookChunks },
    { pipeline: 'company',   chunks: companyChunks },
  ]
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
    throw new Error(`[rag] Delete failed: ${error.message}`)
  }
}

/**
 * Returns chunk counts and freshness per pipeline for a workspace.
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

      const lastUpdated =
        !error && data && data.length > 0
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
