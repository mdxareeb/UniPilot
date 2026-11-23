-- Ask AI retrieval: the bounded recency fallback.
-- =============================================================================
--
-- Keyword search alone answers "what does week 3 say about recursion" but not
-- "summarise my latest notes": a summary question has no distinctive terms, so
-- full-text can return nothing even though the student's newest material is
-- indexed. This function supplies the honest fallback the study chat uses when
-- FTS is empty or the question is a broad summary request.
--
-- Contract:
--   * at most 8 chunks (clamped) — a bounded, predictable context;
--   * newest documents first (`documents.created_at desc`), in reading order
--     (`chunk_index asc`) so the newest upload reads top-to-bottom;
--   * the same optional document/subject filters as search_document_chunks;
--   * SECURITY INVOKER with `search_path = ''` — the existing chunk-parent and
--     documents RLS policies remain the authority for every row; no user id is
--     passed and no ownership is inferred here.
--
-- `match_kind = 'recent'` keeps the fallback distinguishable from keyword,
-- vector and hybrid hits, so the caller never presents it as a term match.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.recent_document_chunks(integer, uuid, uuid);
-- =============================================================================

create function public.recent_document_chunks(
  p_limit integer default 8,
  p_document_id uuid default null,
  p_subject_id uuid default null
)
returns table (
  document_id uuid,
  document_name text,
  chunk_index integer,
  page integer,
  content text,
  snippet text,
  score real,
  match_kind text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 8), 1), 8) as take
  ),
  recent as (
    select c.id,
           c.document_id,
           c.chunk_index,
           c.page,
           c.content,
           row_number() over (
             order by d.created_at desc, d.id, c.chunk_index
           ) as position
      from public.document_chunks c
      join public.documents d on d.id = c.document_id
     where (p_document_id is null or c.document_id = p_document_id)
       and (p_subject_id is null or d.subject_id = p_subject_id)
     order by d.created_at desc, d.id, c.chunk_index
     limit (select take from bounds)
  )
  select r.document_id,
         d.name as document_name,
         r.chunk_index,
         r.page,
         r.content,
         left(r.content, 240) as snippet,
         (1.0 / (60 + r.position))::real as score,
         'recent'::text as match_kind
    from recent r
    join public.documents d on d.id = r.document_id
   order by r.position;
$$;

comment on function public.recent_document_chunks(integer, uuid, uuid) is
  'Ask AI recency fallback: up to 8 newest chunks in reading order, filtered
   by document/subject. Security invoker — RLS decides visibility.';

revoke all on function public.recent_document_chunks(integer, uuid, uuid)
  from public, anon;
grant execute on function public.recent_document_chunks(integer, uuid, uuid)
  to authenticated, service_role;
