-- =============================================================================
-- Task 31.x (native presentation, Phase A): request fields Presenton's
-- generate/async accepts, and multi-document sources.
-- =============================================================================

alter table public.presentations
  add column if not exists language text,
  add column if not exists instructions text,
  add column if not exists tone text
    check (tone is null or tone in
      ('default','casual','professional','funny','educational','sales_pitch')),
  add column if not exists verbosity text
    check (verbosity is null or verbosity in
      ('concise','standard','text-heavy')),
  add column if not exists include_table_of_contents boolean not null default false,
  add column if not exists include_title_slide boolean not null default true,
  add column if not exists web_search boolean not null default false,
  add column if not exists source_document_ids uuid[] not null default '{}';

update public.presentations
  set source_document_ids = array[source_document_id]
  where source_document_id is not null;

alter table public.presentations drop column if exists source_document_id;

comment on column public.presentations.source_document_ids is
  'Up to 8 owned PDF/DOCX document ids; re-validated by the Server Action and the worker (no array FK exists).';
comment on column public.presentations.web_search is
  'Reserved for a later phase; the UI never sets it in A-F.';
comment on column public.presentations.include_title_slide is
  'Default true preserves current behavior: the service default is true and UniPilot sends the boolean explicitly from Phase A on.';
