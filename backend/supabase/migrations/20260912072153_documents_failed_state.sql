-- =============================================================================
-- Task 24.10 — the documents status machine gains its terminal failed state
-- =============================================================================
--
-- The 24.x pipeline needs to say "this document could not be processed" in a
-- state the UI can render, not only in `error_message`. The init vocabulary
-- was `uploaded | indexing | indexed`; 24.10/24.12 extend it with `failed`:
--
--     uploaded → indexing → indexed
--                        ↘ failed   (error_message carries sanitized copy)
--
-- `failed` is terminal for a permanent failure and the resting state while a
-- retryable failure waits out its backoff — the worker sets `indexing` again
-- when the retry actually runs, so a failed-then-succeeding document never
-- looks stuck. `error_message` stays the only place a reason lives, and it is
-- always sanitized copy (24.12); no Postgres/provider text reaches it.
--
-- Rollback (reference; the workflow is forward-only):
--   update public.documents set status = 'uploaded', error_message = null
--     where status = 'failed';
--   alter table public.documents drop constraint documents_status_check;
--   alter table public.documents add constraint documents_status_check
--     check (status in ('uploaded', 'indexing', 'indexed'));
-- =============================================================================

alter table public.documents
  drop constraint documents_status_check;

alter table public.documents
  add constraint documents_status_check
  check (status in ('uploaded', 'indexing', 'indexed', 'failed'));

comment on column public.documents.status is
  'uploaded → indexing → indexed; failed records the sanitized error_message
   (24.10); a retryable failure rests here until the next processing attempt
   flips it back to indexing.';
