-- =============================================================================
-- Task 31.x — the presentation generator's request store and its output marker
-- =============================================================================
--
-- The `presentation.generate` job (29.1 runner) works on one row here. The
-- Server Action creates the row (status `queued`) and enqueues the job with
-- ids only; the worker reads the request from the row, drives Presenton over
-- HTTP (docs/integrations/presenton.md), and stores the exported deck in the
-- existing private `documents` bucket as a `documents` row marked
-- `source = 'presentation'` so it appears in /documents unchanged.
--
-- Design decisions (recorded here per 0.15):
--
-- * Request + status mirror, not a job clone: `status` is the page-facing
--   vocabulary `queued | running | succeeded | failed`. The runner's full
--   attempt/backoff/dead-letter lifecycle stays in `public.jobs`; this row
--   carries only what the tool page renders (state, sanitized error, the
--   generated document). `presenton_task_id` / `presenton_presentation_id`
--   reference the separate service's async task and presentation (Phase-2
--   editor link); they are plain text — no FK into a database UniPilot does
--   not own.
-- * Server-only writes: RLS grants the owner `SELECT` on their own rows and
--   nothing else, exactly like `public.jobs` (29.1). The blanket revoke also
--   removes the Supabase bootstrap's default grants, so even a future RLS
--   mistake cannot open a client write path.
-- * Ownership: `user_id` is NOT NULL (a presentation is always a student's)
--   and cascades with the user. `document_id` (the generated artifact) and
--   `source_document_id` (an optional source doc) `SET NULL` on delete so
--   removing the file never rewrites history — the row records that a deck
--   was generated, even after its file is gone.
-- * Output marker: `documents.source` distinguishes generated decks from
--   uploads ('upload' default, 'presentation' written by the worker). The
--   bucket's MIME allowlist gains the PPTX type the worker stores; the 25 MiB
--   cap is unchanged — a larger export fails the job honestly.
--
-- Rollback (reference; the workflow is forward-only):
--   alter table public.documents drop column source;
--   drop table public.presentations;
--   (restore the bucket allowlist without the PPTX entry)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. documents.source — where a document came from ('upload' | 'presentation')
-- -----------------------------------------------------------------------------

alter table public.documents
  add column source text not null default 'upload'
  constraint documents_source_check
  check (source in ('upload', 'presentation'));

comment on column public.documents.source is
  'Task 31.x: where the document came from. ''upload'' = the student uploaded
   it; ''presentation'' = the presentation.generate worker stored it.';

-- -----------------------------------------------------------------------------
-- 2. The bucket gains the generated deck's MIME type. Same private bucket, same
--    25 MiB cap, same owner-folder RLS — only the allowlist widens.
-- -----------------------------------------------------------------------------

update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'image/png',
     'image/jpeg'
   ]
 where id = 'documents';

-- -----------------------------------------------------------------------------
-- 3. The presentations table
-- -----------------------------------------------------------------------------

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null
    constraint presentations_prompt_check
    check (length(trim(prompt)) > 0),
  template text not null default 'general'
    constraint presentations_template_check
    check (length(trim(template)) > 0),
  n_slides integer
    constraint presentations_n_slides_check
    check (n_slides between 1 and 50),
  format text not null default 'pptx'
    constraint presentations_format_check
    check (format in ('pptx', 'pdf')),
  source_document_id uuid
    references public.documents (id) on delete set null,
  document_id uuid
    references public.documents (id) on delete set null,
  presenton_task_id text,
  presenton_presentation_id text,
  -- Real progress mirrored from the async task's data on every poll:
  -- done/total slides. NULL until the service reports them.
  slides_done integer
    constraint presentations_slides_done_check
    check (slides_done >= 0),
  slides_total integer
    constraint presentations_slides_total_check
    check (slides_total >= 1),
  status text not null default 'queued'
    constraint presentations_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.presentations is
  'Task 31.x: one presentation-generation request and its status mirror.
   Writes are service-role only; owners may SELECT their own rows (RLS).';
comment on column public.presentations.document_id is
  'The generated deck, stored as a documents row (source = presentation).
   SET NULL on delete: the row keeps recording that a deck was generated.';
comment on column public.presentations.presenton_task_id is
  'The separate Presenton service''s async task id (poll target). Plain text —
   no FK into a database UniPilot does not own.';
comment on column public.presentations.presenton_presentation_id is
  'The separate Presenton service''s presentation id (Phase-2 editor link).';
comment on column public.presentations.slides_done is
  'Slides finished so far, mirrored from the async task during generation.';
comment on column public.presentations.slides_total is
  'Slides the request asked for, mirrored from the async task during generation.';

create trigger set_presentations_updated_at
  before update on public.presentations
  for each row execute function public.set_updated_at();

create index presentations_user_id_idx on public.presentations (user_id);

-- -----------------------------------------------------------------------------
-- 4. RLS — owner reads only; every write is server-side (29.1's pattern).
-- -----------------------------------------------------------------------------

alter table public.presentations enable row level security;

create policy "presentations_select_own"
  on public.presentations for select to authenticated
  using (auth.uid() = user_id);

-- The blanket revoke removes the Supabase bootstrap's default table grants
-- (ALL to authenticated), so no client role can INSERT/UPDATE/DELETE.
revoke all on public.presentations from anon, authenticated;
grant select on public.presentations to authenticated;
grant all on public.presentations to service_role;
