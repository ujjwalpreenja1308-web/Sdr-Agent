begin;

-- ─── RAG pipeline improvements ────────────────────────────────────────────────
-- 1. Add content_hash for deduplication — prevents the same text being embedded
--    and stored twice when the same document is re-uploaded.
-- 2. Add source column — tracks where each chunk came from (filename, URL, label).
-- 3. Update match_knowledge_chunks() — accept a match_threshold so we can reject
--    low-confidence results rather than stuffing irrelevant chunks into the prompt.

alter table if exists knowledge_chunks
  add column if not exists content_hash text,
  add column if not exists source       text;

-- Partial unique index: skip duplicates within a (workspace, pipeline) pair
create unique index if not exists knowledge_chunks_dedup_idx
  on knowledge_chunks (workspace_id, pipeline, content_hash)
  where content_hash is not null;

-- Lookup index used by the dedup check before insert
create index if not exists knowledge_chunks_source_idx
  on knowledge_chunks (workspace_id, pipeline, source)
  where source is not null;

-- ─── Updated RPC ─────────────────────────────────────────────────────────────
-- Now accepts match_threshold (default 0.65) so callers can filter out
-- semantically weak results.  Also returns source so the caller can log it.

create or replace function match_knowledge_chunks(
  query_embedding     vector(1536),
  workspace_id_filter text,
  pipeline_filter     text,
  match_count         int     default 6,
  match_threshold     float   default 0.65
)
returns table (
  id            uuid,
  content       text,
  source        text,
  metadata_json jsonb,
  similarity    float
)
language sql stable
as $$
  select
    kc.id,
    kc.content,
    kc.source,
    kc.metadata_json,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where
    kc.workspace_id = workspace_id_filter
    and kc.pipeline  = pipeline_filter
    and 1 - (kc.embedding <=> query_embedding) >= match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

commit;
