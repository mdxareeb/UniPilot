-- =============================================================================
-- Task C1 (native presentation, Phase C): the export mirror.
--
-- `presentation.export` re-exports a deck through the engine and replaces the
-- deck's existing documents row and bucket object in place (spec §7.7). These
-- three columns are the UI's view of that job: the editor polls the row with
-- the existing `router.refresh()` pattern and disables Export while it runs.
-- Worker-written only; the table grants owners SELECT.
-- =============================================================================

alter table public.presentations
  add column if not exists export_status text
    check (export_status is null or export_status in
      ('queued','running','succeeded','failed')),
  add column if not exists export_error_message text,
  add column if not exists exported_at timestamptz;

comment on column public.presentations.export_status is
  'Task C1: the re-export job''s mirror (queued | running | succeeded |
   failed); null until an export has ever been requested.';
comment on column public.presentations.export_error_message is
  'Task C1: sanitized export failure copy (worker-written); null while not failed.';
comment on column public.presentations.exported_at is
  'Task C1: when the last successful export replaced the deck''s document.';
