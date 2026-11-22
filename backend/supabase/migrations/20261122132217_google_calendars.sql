-- Google Calendar integration: the user's calendars with per-calendar import.
-- =============================================================================
--
-- `gcal.sync` mirrors Google's calendarList into one row per calendar:
--
--   * `is_active` - whether events are imported from this calendar. The
--     worker upserts names/cursors and NEVER touches is_active; the owner
--     toggles it from the app (column grant below, the monitored_groups
--     pattern). The primary calendar starts ON; every other calendar
--     (secondary, holiday, birthdays) starts OFF so personal noise is not
--     auto-imported.
--   * `sync_cursor` - Google's per-calendar syncToken so later runs are
--     incremental; a 410 resets it and forces one bounded full window.
--   * `last_synced_at` - per-calendar freshness for the screen.
--
-- The "UniPilot" export calendar is never offered as an import source; the
-- worker excludes it from discovery upserts (loop prevention lives there).
--
-- Rollback (reference; the workflow is forward-only):
--   drop table public.google_calendars;
-- =============================================================================

create table public.google_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_calendar_id text not null
    constraint google_calendars_google_id_check
    check (length(trim(google_calendar_id)) > 0),
  summary text not null default ''
    constraint google_calendars_summary_check
    check (length(summary) <= 200),
  timezone text,
  -- false by default (worker upserts never set it); 'primary' rows are
  -- seeded ON by the worker on first discovery.
  is_active boolean not null default false,
  activated_at timestamptz,
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendars_user_google_key unique (user_id, google_calendar_id)
);

comment on table public.google_calendars is
  'Google Calendar integration: the user''s calendars. Owner SELECT + is_active toggle only; the worker owns every other column.';

create trigger set_google_calendars_updated_at
  before update on public.google_calendars
  for each row execute function public.set_updated_at();

create index google_calendars_user_active_idx
  on public.google_calendars (user_id, is_active);

alter table public.google_calendars enable row level security;

create policy "google_calendars_select_own"
  on public.google_calendars for select to authenticated
  using (auth.uid() = user_id);

-- The owner may flip is_active and nothing else (column grant below).
create policy "google_calendars_update_own"
  on public.google_calendars for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.google_calendars from anon, authenticated;

grant select on public.google_calendars to authenticated;
grant update (is_active) on public.google_calendars to authenticated;

grant all on public.google_calendars to service_role;
