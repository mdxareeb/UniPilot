-- Google Calendar integration: per-connection sync state and export prefs.
-- =============================================================================
--
-- Adds the sync bookkeeping the google connection row carries:
--
--   * last_synced_at - when `gcal.sync` last completed a full pass (the
--     screen's relative timestamp; per-calendar freshness also exists on
--     google_calendars);
--   * auto_export_to_gcal - the opt-in flag. Outbound export pushes
--     confirmed/auto-approved UniPilot tasks and events to the user's
--     dedicated "UniPilot" Google calendar; it NEVER pushes rows that came
--     FROM Google (source = 'google_calendar') - the loop guard.
--   * export_calendar_id - the id of the "UniPilot" secondary calendar the
--     worker finds-or-creates on first export.
--
-- Service-side writes only (the owner has SELECT on integration_connections
-- already); the app sets the flag through the Bearer route.
--
-- Rollback (reference; the workflow is forward-only):
--   alter table public.integration_connections
--     drop column export_calendar_id,
--     drop column auto_export_to_gcal,
--     drop column last_synced_at;
-- =============================================================================

alter table public.integration_connections
  add column last_synced_at timestamptz,
  add column auto_export_to_gcal boolean not null default false,
  add column export_calendar_id text;

comment on column public.integration_connections.last_synced_at is
  'Google Calendar sync: when gcal.sync last completed for this user (NULL = never).';
comment on column public.integration_connections.auto_export_to_gcal is
  'Opt-in: push UniPilot deadlines to the dedicated UniPilot Google calendar. Never exports rows imported from Google.';
comment on column public.integration_connections.export_calendar_id is
  'Google id of the dedicated "UniPilot" calendar the worker finds-or-creates on first export.';
