-- Google Calendar integration: integration_runs gains the 'sync' mode.
-- =============================================================================
--
-- `gcal.sync` records one integration_runs row per pass (mode = 'sync'),
-- mirroring how the WhatsApp export/live runs are audited. The input check
-- gains a third arm: a sync run carries neither a storage object nor a chat
-- name.
--
-- Rollback (reference; the workflow is forward-only):
--   alter table public.integration_runs
--     drop constraint integration_runs_input_check;
--   alter table public.integration_runs
--     drop constraint integration_runs_mode_check;
--   alter table public.integration_runs
--     add constraint integration_runs_mode_check
--       check (mode in ('export', 'live'));
--   alter table public.integration_runs
--     add constraint integration_runs_input_check
--       check (
--         (mode = 'export' and storage_path is not null and chat_name is null)
--         or (mode = 'live' and chat_name is not null and storage_path is null)
--       );
-- =============================================================================

alter table public.integration_runs drop constraint integration_runs_mode_check;
alter table public.integration_runs
  add constraint integration_runs_mode_check
  check (mode in ('export', 'live', 'sync'));

alter table public.integration_runs drop constraint integration_runs_input_check;
alter table public.integration_runs
  add constraint integration_runs_input_check
  check (
    (mode = 'export' and storage_path is not null and chat_name is null)
    or (mode = 'live' and chat_name is not null and storage_path is null)
    or (mode = 'sync' and storage_path is null and chat_name is null)
  );

comment on constraint integration_runs_mode_check on public.integration_runs is
  'One of export (WhatsApp upload), live (WhatsApp chat) or sync (Google Calendar incremental pass).';
