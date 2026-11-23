-- Ask AI retrieval: subject-scoped hybrid search.
-- =============================================================================
--
-- The study chat can scope a question to one subject. The original retrieval
-- function only filtered by document/page, so a subject scope would have had to
-- fetch every hit and discard most of them in the app. This migration adds a
-- trailing optional `p_subject_id` filter to BOTH branches (keyword and
-- vector), preserving every other guarantee:
--
--   * SECURITY INVOKER — the chunk-parent and documents RLS policies remain the
--     authority; no user id is passed;
--   * the same RRF fuse, snippet markers and limit clamp;
--   * `p_subject_id` only narrows; null keeps the previous all-materials path.
--
-- The argument list changes, so the old signature is dropped and recreated.
-- All callers use named RPC arguments (frontend/lib/data/search.ts and the
-- benchmark harness), so the trailing default is backward-compatible.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.search_document_chunks(
--     text, integer, uuid, integer, extensions.vector, uuid);
--   recreate the 20260912095011 definition (without p_subject_id).
-- =============================================================================

drop function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector
);

create function public.search_document_chunks(
  p_query text,
  p_limit integer default 10,
  p_document_id uuid default null,
  p_page integer default null,
  p_embedding extensions.vector(1536) default null,
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
    select least(greatest(coalesce(p_limit, 10), 1), 50) as take
  ),
  has_query as (
    select p_query is not null and length(trim(p_query)) > 0 as present
  ),
  keyword as (
    select c.id,
           c.document_id,
           c.chunk_index,
           c.page,
           c.content,
           row_number() over (order by ts_rank(
             to_tsvector('english', c.content),
             websearch_to_tsquery('english', p_query)
           ) desc, c.chunk_index) as position
      from public.document_chunks c
     where (select present from has_query)
       and to_tsvector('english', c.content)
           @@ websearch_to_tsquery('english', p_query)
       and (p_document_id is null or c.document_id = p_document_id)
       and (p_page is null or c.page = p_page)
       and (
         p_subject_id is null
         or exists (
           select 1
             from public.documents sd
            where sd.id = c.document_id
              and sd.subject_id = p_subject_id
         )
       )
     order by position
     limit (select take from bounds)
  ),
  vector_hits as (
    select c.id,
           c.document_id,
           c.chunk_index,
           c.page,
           c.content,
           -- `<=>` lives in the extensions schema; with search_path = '' the
           -- operator must be named explicitly.
           row_number() over (
             order by c.embedding OPERATOR(extensions.<=>) p_embedding
           ) as position
      from public.document_chunks c
     where p_embedding is not null
       and c.embedding is not null
       and (p_document_id is null or c.document_id = p_document_id)
       and (p_page is null or c.page = p_page)
       and (
         p_subject_id is null
         or exists (
           select 1
             from public.documents sd
            where sd.id = c.document_id
              and sd.subject_id = p_subject_id
         )
       )
     order by position
     limit (select take from bounds)
  ),
  fused as (
    select coalesce(k.id, v.id) as id,
           coalesce(k.document_id, v.document_id) as document_id,
           coalesce(k.chunk_index, v.chunk_index) as chunk_index,
           coalesce(k.page, v.page) as page,
           coalesce(k.content, v.content) as content,
           coalesce(1.0 / (60 + k.position), 0)
             + coalesce(1.0 / (60 + v.position), 0) as score,
           case
             when k.id is not null and v.id is not null then 'hybrid'
             when k.id is not null then 'keyword'
             else 'vector'
           end as match_kind
      from keyword k
      full outer join vector_hits v on v.id = k.id
  )
  select f.document_id,
         d.name as document_name,
         f.chunk_index,
         f.page,
         f.content,
         case
           when (select present from has_query) then ts_headline(
             'english',
             f.content,
             websearch_to_tsquery('english', p_query),
             'StartSel=[[, StopSel=]], MaxWords=28, MinWords=8, ShortWord=2, MaxFragments=1'
           )
           else left(f.content, 240)
         end as snippet,
         f.score::real as score,
         f.match_kind
    from fused f
    join public.documents d on d.id = f.document_id
   order by f.score desc, f.chunk_index
   limit (select take from bounds);
$$;

comment on function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector, uuid
) is
  'Task 25.x retrieval: keyword (full-text) + optional vector branch fused by
   reciprocal rank; document/page/subject filters; every hit carries document
   id, name and page (25.9). Security invoker — RLS decides visibility.';

revoke all on function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector, uuid
) from public, anon;
grant execute on function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector, uuid
) to authenticated, service_role;
