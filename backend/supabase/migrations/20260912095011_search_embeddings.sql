-- =============================================================================
-- Task 25.x — pgvector, chunk metadata and the retrieval function
-- =============================================================================
--
-- Resolves the 20.6 deferral: `document_chunks.embedding` was deliberately not
-- created with the schema because its dimension is a model choice. This
-- migration makes that choice and records it:
--
--   * Model family: OpenAI `text-embedding-3-small`, dimension **1536**.
--     It is the cheapest of the maintained general-purpose embedding models,
--     trivially swappable at the same dimension (`text-embedding-ada-002` is
--     also 1536), and 1536 keeps the HNSW index small enough for the free
--     tier. Changing the model later is a new migration + a re-embed run
--     (25.12's backfill job), never an in-place column edit.
--
--   * The embedding column is NULLABLE: rows are chunked and searchable
--     (keyword) before any provider exists, and stay honest — no vectors are
--     fabricated for them. `search_document_chunks` fuses a vector branch
--     only when a query embedding is supplied, so a deployment without a
--     provider is keyword-only by construction.
--
--   * `page` is the chunk's source page (NULL for formats without pages,
--     e.g. DOCX). 25.9's page references read it; 24.8's page-unit chunks set
--     it going forward, and a re-index backfills the rest.
--
-- Indexes: HNSW (`vector_cosine_ops`) for the ANN query 25.6 will use, and a
-- GIN full-text index over `to_tsvector('english', content)` for 25.7's
-- keyword branch. Both are built empty; neither blocks chunk writes.
--
-- RLS is unchanged: `document_chunks` still inherits ownership through its
-- parent document, and the search function is `security invoker`, so the
-- caller's session is the authority for every row it returns.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.search_document_chunks(text, integer, uuid, integer,
--     extensions.vector);
--   drop index public.document_chunks_content_fts_idx;
--   drop index public.document_chunks_embedding_idx;
--   alter table public.document_chunks drop column page;
--   alter table public.document_chunks drop column embedding;
--   -- the extension stays; other work may depend on it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The extension (Supabase's convention: a shared `extensions` schema).
-- -----------------------------------------------------------------------------

create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- 2. Chunk metadata + the deferred vector column.
-- -----------------------------------------------------------------------------

alter table public.document_chunks
  add column embedding extensions.vector(1536);

comment on column public.document_chunks.embedding is
  'Task 25.x: OpenAI text-embedding-3-small (1536 dims), nullable. NULL = not
   embedded yet (keyword-searchable only); re-embed via the document.reindex
   job. Never fabricated.';

alter table public.document_chunks
  add column page integer
    constraint document_chunks_page_check
    check (page is null or page > 0);

comment on column public.document_chunks.page is
  'Source page of the chunk (1-based). NULL for formats without pages (DOCX),
   and for legacy chunks written before Task 25.x; a document.reindex job
   backfills it.';

-- -----------------------------------------------------------------------------
-- 3. Indexes: ANN (cosine) + full-text.
-- -----------------------------------------------------------------------------

create index document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create index document_chunks_content_fts_idx
  on public.document_chunks
  using gin (to_tsvector('english', content));

-- -----------------------------------------------------------------------------
-- 4. search_document_chunks — the retrieval function (25.6/25.7/25.8/25.9).
--
--    * keyword branch: websearch_to_tsquery over content, ts_rank ordering;
--    * vector branch: cosine (`<=>`) nearest neighbours when both the query
--      embedding and row embeddings exist;
--    * fusion: reciprocal-rank fusion (k = 60) when both branches return rows,
--      otherwise whatever branch has rows — so no provider = keyword-only;
--    * filters: owning document and page, applied to both branches;
--    * every row carries document id + name + page + chunk index (25.9).
--
--    SECURITY INVOKER: the chunk-parent RLS policies and the documents policy
--    are the enforcement layer; the caller's session decides what exists.
-- -----------------------------------------------------------------------------

create or replace function public.search_document_chunks(
  p_query text,
  p_limit integer default 10,
  p_document_id uuid default null,
  p_page integer default null,
  p_embedding extensions.vector(1536) default null
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
  text, integer, uuid, integer, extensions.vector
) is
  'Task 25.x retrieval: keyword (full-text) + optional vector branch fused by
   reciprocal rank; document/page filters; every hit carries document id, name
   and page (25.9). Security invoker — RLS decides visibility.';

-- -----------------------------------------------------------------------------
-- 5. Grants — authenticated searches; the worker/harness may replay too.
--    (Explicit revokes: the bootstrap grants EXECUTE directly to anon.)
-- -----------------------------------------------------------------------------

revoke all on function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector
) from public, anon;
grant execute on function public.search_document_chunks(
  text, integer, uuid, integer, extensions.vector
) to authenticated, service_role;
