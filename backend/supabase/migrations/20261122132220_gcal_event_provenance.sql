-- Google Calendar integration: row provenance for imported/exported items.
-- =============================================================================
--
-- Inbound: `gcal.sync` upserts Google events into `events` with
-- `source = 'google_calendar'` and `source_ref = <google event id>`; the
-- existing unique (user_id, source, source_ref) index is the dedupe key, so a
-- re-sync never duplicates a row. A `cancelled` Google event deletes the
-- local row (approved deletion semantics).
--
-- Outbound: `events.google_event_id` / `tasks.google_event_id` hold the id of
-- the event exported to the user's "UniPilot" Google calendar, so a deadline
-- edit PATCHes that event instead of creating a second one, and re-runs are
-- idempotent. Both columns are server-only: the provenance locks below reset
-- them for every non-service caller (mirror of source/source_ref).
--
-- The inbound and outbound directions can never meet: export filters out
-- source = 'google_calendar', and inbound skips the UniPilot calendar.
--
-- Rollback (reference; the workflow is forward-only):
--   -- restore lock_event_provenance() / lock_task_provenance() from
--   -- 20261118154602 / 20261118154558 (without google_event_id), then:
--   drop index public.events_user_google_event_key;
--   drop index public.tasks_user_google_event_key;
--   alter table public.events
--     drop constraint events_source_check;
--   alter table public.events
--     add constraint events_source_check
--       check (source in ('manual', 'whatsapp', 'whatsapp_group'));
--   alter table public.events drop column google_event_id;
--   alter table public.tasks drop column google_event_id;
-- =============================================================================

alter table public.events drop constraint events_source_check;
alter table public.events
  add constraint events_source_check
  check (source in ('manual', 'whatsapp', 'whatsapp_group', 'google_calendar'));

alter table public.events
  add column google_event_id text
    constraint events_google_event_id_check
    check (google_event_id is null or length(trim(google_event_id)) > 0);

comment on column public.events.google_event_id is
  'Google Calendar export: the event id in the user''s UniPilot calendar. Service-only; NULL when this row was never exported.';

create unique index events_user_google_event_key
  on public.events (user_id, google_event_id)
  where google_event_id is not null;

alter table public.tasks
  add column google_event_id text
    constraint tasks_google_event_id_check
    check (google_event_id is null or length(trim(google_event_id)) > 0);

comment on column public.tasks.google_event_id is
  'Google Calendar export: the event id in the user''s UniPilot calendar. Service-only; NULL when this row was never exported.';

create unique index tasks_user_google_event_key
  on public.tasks (user_id, google_event_id)
  where google_event_id is not null;

-- lock_event_provenance: extend with google_event_id (create or replace, the
-- same trigger re-attached so the UPDATE OF column list covers the new column).
create or replace function public.lock_event_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
    new.source_message_id := null;
    new.confidence_score := null;
    new.google_event_id := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_event_provenance() is
  'Task 46.12 + group sync + Google sync: forces manual provenance and clears export ids for every non-service caller.';

drop trigger lock_event_provenance on public.events;
create trigger lock_event_provenance
  before insert or update of source, source_ref, source_message_id, confidence_score, google_event_id
  on public.events
  for each row execute function public.lock_event_provenance();

-- lock_task_provenance: extend with google_event_id (same shape as events).
create or replace function public.lock_task_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
    new.source_message_id := null;
    new.confidence_score := null;
    new.task_type := null;
    new.google_event_id := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_task_provenance() is
  'Group sync + Google sync: forces manual provenance and clears export ids for every non-service caller.';

drop trigger lock_task_provenance on public.tasks;
create trigger lock_task_provenance
  before insert or update of source, source_ref, source_message_id, confidence_score, task_type, google_event_id
  on public.tasks
  for each row execute function public.lock_task_provenance();

revoke all on function public.lock_event_provenance() from public, anon, authenticated;
revoke all on function public.lock_task_provenance() from public, anon, authenticated;
