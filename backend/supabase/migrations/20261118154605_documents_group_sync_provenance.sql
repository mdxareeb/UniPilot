-- =============================================================================
-- WhatsApp group sync — documents become the course-materials store
-- =============================================================================
--
-- Files captured from active WhatsApp groups are ordinary `documents` rows in
-- the existing private `documents` bucket (path `{user_id}/{document_id}/…`),
-- so the owner-folder RLS, the signed-download path, the processing job and
-- the Documents page all apply unchanged. No parallel "course_materials"
-- table or bucket is created. Added here:
--
--   * source / source_message_id  where the file came from. ON DELETE SET
--                    NULL on the message: provenance, not ownership — the
--                    30-day raw_messages purge must never delete a file.
--                    `source` and `source_message_id` are server-only (a
--                    trigger resets them for non-service-role callers).
--   * file_sha256    content hash. A partial unique index per user makes a
--                    second copy of the same file impossible, so a re-sync or
--                    a re-forwarded PDF never stores twice.
--   * subject_id     the course, with the same-user guard trigger used by
--                    events and tasks.
--   * ai_summary / topic_tags  the extractor's short summary and tags.
--
-- The bucket's MIME allow-list already includes PPTX (31.x), so no storage
-- change is needed. The web upload allow-list in
-- `frontend/lib/data/documentValues.ts` is a separate server-side gate and is
-- NOT widened by this migration.
--
-- Existing `source` column (31.x, 'upload' | 'presentation') is reused: its
-- CHECK gains `whatsapp_group` rather than adding a duplicate column.
--
-- Rollback (reference; the workflow is forward-only):
--   delete from public.documents where source = 'whatsapp_group';
--   alter table public.documents drop constraint documents_source_check;
--   alter table public.documents add constraint documents_source_check
--     check (source in ('upload', 'presentation'));
--   drop trigger lock_document_provenance on public.documents;
--   drop function public.lock_document_provenance();
--   drop trigger ensure_document_subject_owner on public.documents;
--   drop function public.ensure_document_subject_owner();
--   drop index public.documents_user_file_sha256_key;
--   drop index public.documents_subject_id_idx;
--   drop index public.documents_source_message_id_idx;
--   alter table public.documents
--     drop column topic_tags, drop column ai_summary, drop column subject_id,
--     drop column file_sha256, drop column source_message_id;
-- =============================================================================

-- `documents.source` already exists (31.x: 'upload' | 'presentation'); widen it.
alter table public.documents drop constraint documents_source_check;
alter table public.documents
  add constraint documents_source_check
  check (source in ('upload', 'presentation', 'whatsapp_group'));

alter table public.documents
  add column source_message_id uuid
    references public.raw_messages (id) on delete set null,
  add column file_sha256 text
    constraint documents_file_sha256_check
    check (file_sha256 is null or length(file_sha256) = 64),
  add column subject_id uuid references public.subjects (id) on delete set null,
  add column ai_summary text
    constraint documents_ai_summary_check
    check (ai_summary is null or length(ai_summary) <= 4000),
  add column topic_tags text[] not null default '{}'
    constraint documents_topic_tags_check
    check (cardinality(topic_tags) <= 20);

comment on column public.documents.source is
  'upload (web) | presentation (31.x worker) | whatsapp_group (live group sync). A trigger forces upload for non-service-role callers.';
comment on column public.documents.source_message_id is
  'The raw_messages row the file arrived on. SET NULL on purge: provenance, not ownership.';
comment on column public.documents.file_sha256 is
  'SHA-256 of the file bytes (group sync). Unique per user where set, so the same file is never stored twice.';
comment on column public.documents.subject_id is
  'Optional course; must belong to the same user (trigger). SET NULL on subject delete.';
comment on column public.documents.ai_summary is
  'Short extractor-written summary (group sync); NULL for plain uploads.';
comment on column public.documents.topic_tags is
  'Up to 20 extractor-written topic tags (group sync).';

create index documents_source_message_id_idx on public.documents (source_message_id);
create index documents_subject_id_idx on public.documents (subject_id);

create unique index documents_user_file_sha256_key
  on public.documents (user_id, file_sha256)
  where file_sha256 is not null;

create or replace function public.ensure_document_subject_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subject_id is not null then
    if not exists (
      select 1
        from public.subjects s
       where s.id = new.subject_id
         and s.user_id = new.user_id
    ) then
      raise exception 'documents.subject_id must reference a subject owned by the document user';
    end if;
  end if;
  return new;
end;
$$;

create trigger ensure_document_subject_owner
  before insert or update of subject_id, user_id on public.documents
  for each row execute function public.ensure_document_subject_owner();

create or replace function public.lock_document_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'upload';
    new.source_message_id := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_document_provenance() is
  'WhatsApp group sync: forces upload provenance for every non-service-role caller.';

create trigger lock_document_provenance
  before insert or update of source, source_message_id on public.documents
  for each row execute function public.lock_document_provenance();

revoke all on function public.ensure_document_subject_owner() from public, anon, authenticated;
revoke all on function public.lock_document_provenance() from public, anon, authenticated;
