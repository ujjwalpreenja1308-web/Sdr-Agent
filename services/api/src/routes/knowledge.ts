import { Hono } from 'hono'

import type { KnowledgePipeline, KnowledgeUploadRequest } from '@pipeiq/shared'

import {
  deleteKnowledgePipeline,
  getKnowledgeStatus,
  ingestDocument,
} from '../lib/rag.js'
import { ensureWorkspaceRecord } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const knowledgeRoutes = new Hono<AppEnv>()

const VALID_PIPELINES: KnowledgePipeline[] = ['playbooks', 'company']

function isPipeline(value: string): value is KnowledgePipeline {
  return VALID_PIPELINES.includes(value as KnowledgePipeline)
}

// GET /api/knowledge/:workspaceId/status
knowledgeRoutes.get('/api/knowledge/:workspaceId/status', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  const status = await getKnowledgeStatus(workspaceId)
  return c.json({ workspace_id: workspaceId, pipelines: status })
})

// POST /api/knowledge/:workspaceId/:pipeline  (playbooks | company)
knowledgeRoutes.post('/api/knowledge/:workspaceId/:pipeline', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const pipeline = c.req.param('pipeline')

  if (!isPipeline(pipeline)) {
    return c.json(
      { detail: `Invalid pipeline "${pipeline}". Must be one of: ${VALID_PIPELINES.join(', ')}` },
      400,
    )
  }

  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))

  let body: KnowledgeUploadRequest
  try {
    body = await c.req.json<KnowledgeUploadRequest>()
  } catch {
    return c.json(
      { detail: 'Request body must be JSON with a "text" string or "chunks" array.' },
      400,
    )
  }

  const texts: string[] = []
  if (typeof body.text === 'string' && body.text.trim().length > 0) {
    texts.push(body.text)
  } else if (Array.isArray(body.chunks)) {
    for (const chunk of body.chunks) {
      if (typeof chunk === 'string' && chunk.trim().length > 0) {
        texts.push(chunk)
      }
    }
  }

  if (texts.length === 0) {
    return c.json(
      { detail: 'No content to ingest. Provide "text" (string) or "chunks" (string[]).' },
      400,
    )
  }

  await ingestDocument(workspaceId, pipeline, texts.join('\n\n'), { source: 'api_upload' })

  const status = await getKnowledgeStatus(workspaceId)
  const pipelineStatus = status.find((s) => s.pipeline === pipeline)

  return c.json({
    workspace_id: workspaceId,
    pipeline,
    ingested: true,
    chunk_count: pipelineStatus?.chunk_count ?? 0,
  })
})

// DELETE /api/knowledge/:workspaceId/:pipeline
knowledgeRoutes.delete('/api/knowledge/:workspaceId/:pipeline', async (c) => {
  const workspaceId = c.req.param('workspaceId')
  const pipeline = c.req.param('pipeline')

  if (!isPipeline(pipeline)) {
    return c.json(
      { detail: `Invalid pipeline "${pipeline}". Must be one of: ${VALID_PIPELINES.join(', ')}` },
      400,
    )
  }

  await ensureWorkspaceRecord(workspaceId, c.get('orgId'))
  await deleteKnowledgePipeline(workspaceId, pipeline)
  return c.json({ workspace_id: workspaceId, pipeline, deleted: true })
})
