-- =============================================================================
-- Google Calendar integration - schema contract check
-- =============================================================================
--
-- A self-contained, rolled-back SQL proof of the new schema:
--   * google_oauth_states is unreachable for client roles (service-only)
--   * google_calendars rows are owner-SELECT only; the owner may flip
--     is_active and nothing else; the service role owns every other column
--   * RLS isolation between two users on google_calendars
--   * events / tasks provenance: a client cannot forge source='google_calendar'
--     and a client write clears google_event_id (export ids are server-only)
--   * integration_runs accepts mode='sync' with neither object nor chat
--   * enqueue_gcal_sync is idempotent while a live job exists and refuses
--     a user with no connected google row
--
-- Run against the LOCAL database only (it never commits):
--
--   Get-Content backend\supabase\qa\google-calendar-schema-check.sql |
--     wsl -d kali-linux -u root -e docker exec -i supabase_db_unipilot `
--       psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Output ends with "ALL CHECKS PASSED" or fails loudly. The whole script runs
-- inside one transaction that is rolled back, so no row survives.
-- =============================================================================

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  g1 uuid;
  g2 uuid;
  e1 uuid;
  n integer;
  ok boolean;
begin
  -- ---- fixtures (as the table owner) ----------------------------------------
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into public.google_calendars (user_id, google_calendar_id, summary, timezone, is_active)
  values (u1, 'primary', 'Primary', 'UTC', true)
  returning id into g1;

  insert into public.google_calendars (user_id, google_calendar_id, summary, is_active)
  values (u1, 'holiday@group.v.calendar.google.com', 'Holidays', false)
  returning id into g2;

  -- 1. service writes every column; a sync cursor round-trips ----------------
  update public.google_calendars
     set sync_cursor = 'cursor-1', last_synced_at = now()
   where id = g1;
  select count(*) into n from public.google_calendars
   where id = g1 and sync_cursor = 'cursor-1';
  if n <> 1 then raise exception 'service cursor write failed'; end if;

  -- 2. integration_connections: the google row and export fields ------------
  insert into public.integration_connections (user_id, provider, mode, status)
  values (u1, 'google', null, 'connected');

  update public.integration_connections
     set auto_export_to_gcal = true, export_calendar_id = 'unipilot-cal', last_synced_at = now()
   where user_id = u1 and provider = 'google';
  select count(*) into n from public.integration_connections
   where user_id = u1 and provider = 'google'
     and auto_export_to_gcal and export_calendar_id = 'unipilot-cal';
  if n <> 1 then raise exception 'connection export fields not writable'; end if;

  -- 3. events provenance: the service role writes google_calendar rows -------
  insert into public.events (user_id, title, start_at, source, source_ref)
  values (u1, 'Exam', now() + interval '1 day', 'google_calendar', 'gevent-1')
  returning id into e1;

  -- dedupe: the same google event id can never create a second row
  begin
    insert into public.events (user_id, title, start_at, source, source_ref)
    values (u1, 'Exam copy', now() + interval '1 day', 'google_calendar', 'gevent-1');
    raise exception 'duplicate google event id was accepted';
  exception
    when unique_violation then null;
  end;

  -- export id: one per user on the exported side
  update public.events set google_event_id = 'gexport-1' where id = e1;
  begin
    insert into public.events (user_id, title, start_at, google_event_id)
    values (u1, 'Other', now() + interval '2 day', 'gexport-1');
    raise exception 'a second exported event id was accepted';
  exception
    when unique_violation then null;
  end;

  -- 4. client roles cannot forge provenance or keep an export id -----------
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u1::text)::text, true);
  set local role authenticated;

  insert into public.events (user_id, title, start_at, source, source_ref, google_event_id)
  values (u1, 'Forged', now(), 'google_calendar', 'forged-ref', 'forged-export');
  select count(*) into n from public.events
   where user_id = u1 and title = 'Forged'
     and source = 'manual' and source_ref is null and google_event_id is null;
  if n <> 1 then raise exception 'client forged google provenance or kept an export id'; end if;

  -- the owner toggles is_active and nothing else on google_calendars
  update public.google_calendars set is_active = true where id = g2;
  select count(*) into n from public.google_calendars where id = g2 and is_active;
  if n <> 1 then raise exception 'owner is_active toggle failed'; end if;

  begin
    update public.google_calendars set sync_cursor = 'client-cursor' where id = g1;
    raise exception 'client wrote a sync cursor';
  exception
    when insufficient_privilege then null;
  end;

  -- cross-user isolation: as u2 the reader sees none of u1's calendars
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u2::text)::text, true);
  select count(*) into n from public.google_calendars where user_id = u1;
  if n <> 0 then raise exception 'cross-user calendar read leaked'; end if;
  select count(*) into n from public.google_calendars where user_id = u2;
  if n <> 0 then raise exception 'u2''s empty calendar list is not empty'; end if;

  -- back as u1: the owner sees exactly their own two rows
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',u1::text)::text, true);
  select count(*) into n from public.google_calendars where user_id = u1;
  if n <> 2 then raise exception 'owner calendar read is not exactly their own'; end if;

  -- oauth states are unreachable for client roles
  begin
    insert into public.google_oauth_states (state_hash, user_id, return_scheme, expires_at)
    values (repeat('c', 64), u1, 'unipilot', now() + interval '10 minutes');
    raise exception 'client wrote an oauth state row';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;

  -- 5. integration_runs: mode sync with neither object nor chat --------------
  insert into public.integration_runs (user_id, mode, status)
  values (u1, 'sync', 'succeeded');

  begin
    insert into public.integration_runs (user_id, mode, status, storage_path)
    values (u1, 'sync', 'succeeded', 'some/object.txt');
    raise exception 'a sync run with a storage object was accepted';
  exception
    when check_violation then null;
  end;

  -- 6. enqueue_gcal_sync: connected once, live-job idempotence --------------
  select public.enqueue_gcal_sync(u1) into ok;
  if ok is distinct from true then raise exception 'enqueue refused a connected user'; end if;

  select public.enqueue_gcal_sync(u1) into ok;
  if ok is distinct from false then raise exception 'double enqueue was accepted'; end if;

  select public.enqueue_gcal_sync(u2) into ok;
  if ok is distinct from false then raise exception 'enqueue accepted a user with no connection'; end if;

  -- cleanup: delete the calendar rows so the user cascade is clean ----------
  delete from public.google_calendars where user_id = u1;
  delete from public.google_calendars where user_id = u2;
  delete from public.integration_connections where user_id = u1;
  delete from public.events where user_id = u1;
  delete from public.jobs where user_id = u1 and kind = 'gcal.sync';

  set local role postgres;
  raise notice 'ALL CHECKS PASSED';
end;
$$;

rollback;
