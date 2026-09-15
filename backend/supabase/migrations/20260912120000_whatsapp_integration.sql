-- =============================================================================
-- Task 46.12 — the WhatsApp integration schema (spec §6)
-- =============================================================================
--
-- Adds, in one logical change:
-- * events provenance: source/source_ref + unique (user_id, source, source_ref)
--   and a security-invoker trigger that forces manual provenance for every
--   caller that is not the service role (spec §6.1);
-- * the four owner-only integration tables (connections, runs, messages,
--   candidates) with indexes, updated_at triggers and SELECT-only client RLS
--   (spec §6.2–6.5);
-- * google_calendar_credentials (encrypted refresh token only) with zero
--   table grants for any API role and definer RPCs taking the server-only key
--   (spec §6.6);
-- * the live-QR definer RPCs with a hard TTL (spec §6.2);
-- * touch_job, the additive 29.1 lease-extension helper used by long scans
--   (spec §6.8, D8).
--
-- pgcrypto: enabled in the extensions schema; every encrypted call is
-- schema-qualified because the definer functions run with search_path = ''.
-- If P0.2 found log_statement <> 'none', use Supabase Vault instead and record
-- the alternative in DATABASE.md before applying this file.
--
-- Rollback (reference; forward-only):
--   drop function public.touch_job(uuid, text);
--   drop function public.clear_whatsapp_qr(uuid);
--   drop function public.get_whatsapp_qr(uuid, text);
--   drop function public.set_whatsapp_qr(uuid, text, text, integer);
--   drop function public.rotate_google_token_key(text, text);
--   drop function public.delete_google_credentials(uuid);
--   drop function public.get_google_credentials(uuid, text);
--   drop function public.upsert_google_credentials(uuid, text, text, text, text);
--   drop table public.google_calendar_credentials;
--   drop table public.integration_candidates;
--   drop table public.integration_messages;
--   drop table public.integration_runs;
--   drop table public.integration_connections;
--   drop trigger lock_event_provenance on public.events;
--   drop function public.lock_event_provenance();
--   drop index public.events_user_source_ref_key;
--   alter table public.events drop column source_ref, drop column source;
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. events provenance (spec §6.1)
-- -----------------------------------------------------------------------------

alter table public.events
  add column source text not null default 'manual'
    constraint events_source_check check (source in ('manual', 'whatsapp')),
  add column source_ref text;

comment on column public.events.source is
  'Provenance: manual | whatsapp. Server-only; a trigger forces manual for non-service-role callers.';
comment on column public.events.source_ref is
  'Detector fingerprint for whatsapp rows (32 hex chars); NULL for manual rows.';

create unique index events_user_source_ref_key
  on public.events (user_id, source, source_ref);

create or replace function public.lock_event_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_event_provenance() is
  'Task 46.12: forces manual provenance for every non-service-role caller (spec §6.1).';

create trigger lock_event_provenance
  before insert or update of source, source_ref on public.events
  for each row execute function public.lock_event_provenance();

-- -----------------------------------------------------------------------------
-- 2. integration_connections (spec §6.2)
-- -----------------------------------------------------------------------------

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    constraint integration_connections_provider_check
    check (provider in ('whatsapp', 'google')),
  mode text
    constraint integration_connections_mode_check
    check (mode is null or mode in ('export', 'live')),
  status text not null default 'pending'
    constraint integration_connections_status_check
    check (status in ('pending', 'connected', 'disconnected', 'error')),
  profile_ref text,
  qr_data_enc bytea,
  qr_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_user_provider_key unique (user_id, provider),
  constraint integration_connections_provider_mode_check
    check ((provider = 'whatsapp') = (mode is not null))
);

comment on table public.integration_connections is
  'Task 46.12: per-user integration state. Owner SELECT only; every write is service-side (spec D5).';
comment on column public.integration_connections.qr_data_enc is
  'pgcrypto-encrypted login QR data-URL; short TTL; never plain, never logged (spec §6.2).';

create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. integration_runs (spec §6.3)
-- -----------------------------------------------------------------------------

create table public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  mode text not null
    constraint integration_runs_mode_check check (mode in ('export', 'live')),
  status text not null default 'queued'
    constraint integration_runs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  storage_path text,
  chat_name text,
  message_count integer not null default 0
    constraint integration_runs_message_count_check check (message_count >= 0),
  candidate_count integer not null default 0
    constraint integration_runs_candidate_count_check check (candidate_count >= 0),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_runs_input_check check (
    (mode = 'export' and storage_path is not null and chat_name is null)
    or (mode = 'live' and chat_name is not null and storage_path is null)
  )
);

comment on table public.integration_runs is
  'Task 46.12: one scan/sync. Owner SELECT only; Python writes with the service role.';
comment on column public.integration_runs.storage_path is
  'Export runs: object key in whatsapp-exports (no bucket prefix). Live runs use chat_name.';

create index integration_runs_user_created_idx
  on public.integration_runs (user_id, created_at desc);
create index integration_runs_status_idx on public.integration_runs (status);

create trigger set_integration_runs_updated_at
  before update on public.integration_runs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. integration_messages (spec §6.4)
-- -----------------------------------------------------------------------------

create table public.integration_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.integration_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null
    constraint integration_messages_position_check check (position >= 0),
  sender text not null,
  sent_at timestamptz not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint integration_messages_run_position_key unique (run_id, position)
);

comment on table public.integration_messages is
  'Task 46.12: raw imported messages. Owner SELECT only; 30-day best-effort purge (spec §6.10).';

create index integration_messages_user_sent_idx
  on public.integration_messages (user_id, sent_at);

-- -----------------------------------------------------------------------------
-- 5. integration_candidates (spec §6.5)
-- -----------------------------------------------------------------------------

create table public.integration_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.integration_runs (id) on delete cascade,
  fingerprint text not null
    constraint integration_candidates_fingerprint_check check (length(fingerprint) > 0),
  title text not null
    constraint integration_candidates_title_check check (length(trim(title)) > 0),
  start_at timestamptz not null,
  end_at timestamptz
    constraint integration_candidates_end_at_check
    check (end_at is null or end_at >= start_at),
  all_day boolean not null default false,
  message_id uuid references public.integration_messages (id) on delete set null,
  message_sender text not null,
  message_text text not null,
  status text not null default 'pending'
    constraint integration_candidates_status_check
    check (status in ('pending', 'confirmed', 'rejected')),
  event_id uuid references public.events (id) on delete set null,
  pushed_at timestamptz,
  provider_event_id text,
  push_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_candidates_user_fingerprint_key unique (user_id, fingerprint)
);

comment on table public.integration_candidates is
  'Task 46.12: detected events awaiting review. Owner SELECT only; rejection is terminal (fingerprint unique).';

create index integration_candidates_user_status_idx
  on public.integration_candidates (user_id, status);
create index integration_candidates_run_idx on public.integration_candidates (run_id);

create trigger set_integration_candidates_updated_at
  before update on public.integration_candidates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. google_calendar_credentials (spec §6.6) — encrypted, no API-role grants
-- -----------------------------------------------------------------------------

create table public.google_calendar_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token_enc bytea not null,
  scope text,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_calendar_credentials is
  'Task 46.12: pgcrypto-encrypted refresh token only; access tokens are never persisted. Reachable only through definer RPCs (spec §6.6).';

create trigger set_google_calendar_credentials_updated_at
  before update on public.google_calendar_credentials
  for each row execute function public.set_updated_at();

alter table public.google_calendar_credentials enable row level security;
-- no policies: deny by default.

-- -----------------------------------------------------------------------------
-- 7. RLS + grants for the four owner-readable tables (spec D5)
-- -----------------------------------------------------------------------------

alter table public.integration_connections enable row level security;
alter table public.integration_runs enable row level security;
alter table public.integration_messages enable row level security;
alter table public.integration_candidates enable row level security;

create policy "integration_connections_select_own"
  on public.integration_connections for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_runs_select_own"
  on public.integration_runs for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_messages_select_own"
  on public.integration_messages for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_candidates_select_own"
  on public.integration_candidates for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_runs from anon, authenticated;
revoke all on public.integration_messages from anon, authenticated;
revoke all on public.integration_candidates from anon, authenticated;
revoke all on public.google_calendar_credentials from anon, authenticated, service_role;

grant select on public.integration_connections to authenticated;
grant select on public.integration_runs to authenticated;
grant select on public.integration_messages to authenticated;
grant select on public.integration_candidates to authenticated;
grant all on public.integration_connections to service_role;
grant all on public.integration_runs to service_role;
grant all on public.integration_messages to service_role;
grant all on public.integration_candidates to service_role;

-- -----------------------------------------------------------------------------
-- 8. Credential RPCs (spec §6.6)
-- -----------------------------------------------------------------------------

create or replace function public.upsert_google_credentials(
  p_user_id uuid,
  p_refresh_token text,
  p_scope text,
  p_calendar_id text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_refresh_token, '') = '' then
    raise exception 'upsert_google_credentials requires a user and a refresh token';
  end if;
  insert into public.google_calendar_credentials
    (user_id, refresh_token_enc, scope, calendar_id, connected_at, updated_at)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(p_refresh_token, p_key),
    p_scope,
    coalesce(nullif(p_calendar_id, ''), 'primary'),
    now(),
    now()
  )
  on conflict (user_id) do update set
    refresh_token_enc = excluded.refresh_token_enc,
    scope = excluded.scope,
    calendar_id = excluded.calendar_id,
    updated_at = now();
end;
$$;

create or replace function public.get_google_credentials(
  p_user_id uuid,
  p_key text
)
returns table (
  refresh_token text,
  scope text,
  calendar_id text,
  connected_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select
      extensions.pgp_sym_decrypt(c.refresh_token_enc, p_key)::text,
      c.scope,
      c.calendar_id,
      c.connected_at
    from public.google_calendar_credentials c
    where c.user_id = p_user_id;
end;
$$;

create or replace function public.delete_google_credentials(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.google_calendar_credentials where user_id = p_user_id;
end;
$$;

create or replace function public.rotate_google_token_key(
  p_old_key text,
  p_new_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_calendar_credentials
     set refresh_token_enc = extensions.pgp_sym_encrypt(
           extensions.pgp_sym_decrypt(refresh_token_enc, p_old_key)::text,
           p_new_key
         ),
         updated_at = now()
   where user_id is not null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. QR RPCs (spec §6.2)
-- -----------------------------------------------------------------------------

create or replace function public.set_whatsapp_qr(
  p_connection_id uuid,
  p_qr text,
  p_key text,
  p_ttl_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_qr, '') = '' then
    raise exception 'set_whatsapp_qr requires a payload';
  end if;
  update public.integration_connections
     set qr_data_enc = extensions.pgp_sym_encrypt(p_qr, p_key),
         qr_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 60), 5), 300))
   where id = p_connection_id;
  if not found then
    raise exception 'set_whatsapp_qr: unknown connection %', p_connection_id;
  end if;
end;
$$;

create or replace function public.get_whatsapp_qr(
  p_connection_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr text;
  v_expires timestamptz;
begin
  select extensions.pgp_sym_decrypt(c.qr_data_enc, p_key)::text, c.qr_expires_at
    into v_qr, v_expires
    from public.integration_connections c
   where c.id = p_connection_id
     and c.qr_data_enc is not null;

  if v_qr is null or v_expires is null or v_expires <= now() then
    update public.integration_connections
       set qr_data_enc = null, qr_expires_at = null
     where id = p_connection_id
       and (qr_expires_at is null or qr_expires_at <= now());
    return null;
  end if;
  return v_qr;
end;
$$;

create or replace function public.clear_whatsapp_qr(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integration_connections
     set qr_data_enc = null, qr_expires_at = null
   where id = p_connection_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. touch_job (spec §6.8, D8) — additive 29.1 lease extension
-- -----------------------------------------------------------------------------

create or replace function public.touch_job(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set locked_at = now()
   where id = p_job_id
     and status = 'running'
     and locked_by = p_worker_id;
  if not found then
    raise exception 'touch_job: job % is not held by worker %', p_job_id, p_worker_id;
  end if;
end;
$$;

comment on function public.touch_job(uuid, text) is
  'Task 46.13: extends the claim lease of a running job held by the worker; service-role only.';

-- -----------------------------------------------------------------------------
-- 11. Function grants — explicit revokes before every service_role grant
--     (the 29.1 default-grant trap; spec D5/§6.6).
-- -----------------------------------------------------------------------------

revoke all on function public.lock_event_provenance() from public, anon, authenticated;

revoke all on function public.upsert_google_credentials(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_google_credentials(uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_google_credentials(uuid)
  from public, anon, authenticated;
revoke all on function public.rotate_google_token_key(text, text)
  from public, anon, authenticated;
revoke all on function public.set_whatsapp_qr(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_qr(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_whatsapp_qr(uuid)
  from public, anon, authenticated;
revoke all on function public.touch_job(uuid, text)
  from public, anon, authenticated;

grant execute on function public.upsert_google_credentials(uuid, text, text, text, text) to service_role;
grant execute on function public.get_google_credentials(uuid, text) to service_role;
grant execute on function public.delete_google_credentials(uuid) to service_role;
grant execute on function public.rotate_google_token_key(text, text) to service_role;
grant execute on function public.set_whatsapp_qr(uuid, text, text, integer) to service_role;
grant execute on function public.get_whatsapp_qr(uuid, text) to service_role;
grant execute on function public.clear_whatsapp_qr(uuid) to service_role;
grant execute on function public.touch_job(uuid, text) to service_role;
