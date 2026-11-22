-- =============================================================================
-- WhatsApp group live sync (Stage 1) — the four new tables
-- =============================================================================
--
-- Adds the storage for the Baileys bridge (`whatsapp-bridge/`) and its
-- ingestion pipeline. Everything the product already has (subjects, tasks,
-- events, documents, integration_candidates) is EXTENDED by the migrations that
-- follow this one; this file only creates tables nothing else covers:
--
--   * whatsapp_sessions        owner-readable link status + the web→bridge
--                              command channel (`desired_state`). Realtime is
--                              disabled in the local stack, so the bridge polls
--                              this row; the UI polls `status`.
--   * whatsapp_session_secrets deny-by-default. The pgcrypto-encrypted Baileys
--                              credentials and the live QR (60 s style TTL).
--                              Reachable only through service-role RPCs added
--                              in the next migration set (same pattern as
--                              google_calendar_credentials).
--   * whatsapp_auth_keys       deny-by-default. One encrypted row per Baileys
--                              signal key (pre-keys, sessions, sender keys …).
--                              Key-per-row, not one JSON blob: Baileys writes
--                              many small keys on every message, and rewriting
--                              a single large blob each time would be slow and
--                              race-prone.
--   * monitored_groups         the student's WhatsApp groups. `is_active`
--                              defaults to false: nothing is ingested from a
--                              group until the owner turns it on.
--   * raw_messages             messages captured from ACTIVE groups only.
--                              Idempotent by a per-user fingerprint. Raw text is
--                              purged after 30 days (see the retention
--                              migration); extracted tasks/events/documents
--                              reference it with ON DELETE SET NULL so the
--                              purge never deletes a deadline or a file.
--
-- Privacy rules baked into the schema:
--   * the bridge is read-only toward WhatsApp (enforced in code, tested);
--   * secrets are never readable by `anon`/`authenticated`;
--   * the owner can change `monitored_groups.is_active` and nothing else.
--
-- Rollback (reference; the workflow is forward-only):
--   drop table public.raw_messages;
--   drop table public.monitored_groups;
--   drop function public.stamp_group_activation();
--   drop table public.whatsapp_auth_keys;
--   drop table public.whatsapp_session_secrets;
--   drop table public.whatsapp_sessions;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. whatsapp_sessions — status + command channel (owner SELECT only)
-- -----------------------------------------------------------------------------

create table public.whatsapp_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'disconnected'
    constraint whatsapp_sessions_status_check
    check (status in ('disconnected', 'qr_ready', 'connected')),
  -- What the user asked for. The web app (service role, via a Server Action)
  -- writes this; the bridge reconciles `status` toward it.
  desired_state text not null default 'disconnected'
    constraint whatsapp_sessions_desired_state_check
    check (desired_state in ('connected', 'disconnected')),
  requested_at timestamptz,
  connected_at timestamptz,
  -- Sanitized, human-safe copy only. Never a stack trace, token or QR.
  last_error text,
  -- Bumped by the bridge while it manages this session; lets the UI say
  -- "bridge not running" honestly instead of showing a stale status.
  bridge_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_sessions is
  'WhatsApp group sync: per-user link status and the web→bridge command channel. Owner SELECT only; every write is service-side.';
comment on column public.whatsapp_sessions.desired_state is
  'connected | disconnected — what the user asked for; the bridge polls it (Realtime is disabled locally).';
comment on column public.whatsapp_sessions.bridge_heartbeat_at is
  'Last time a running bridge reconciled this session; NULL/stale means "bridge not running".';

create trigger set_whatsapp_sessions_updated_at
  before update on public.whatsapp_sessions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. whatsapp_session_secrets — encrypted credentials + QR (deny by default)
-- -----------------------------------------------------------------------------

create table public.whatsapp_session_secrets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- pgcrypto-encrypted JSON (Baileys `creds`, serialised with BufferJSON).
  creds_enc bytea,
  -- pgcrypto-encrypted QR string; expires quickly and is cleared on connect.
  qr_enc bytea,
  qr_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_session_secrets is
  'WhatsApp group sync: encrypted Baileys credentials and live QR. No API-role grants and no policies; reachable only through service-role RPCs.';

create trigger set_whatsapp_session_secrets_updated_at
  before update on public.whatsapp_session_secrets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. whatsapp_auth_keys — one encrypted row per Baileys signal key
-- -----------------------------------------------------------------------------

create table public.whatsapp_auth_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  key_type text not null
    constraint whatsapp_auth_keys_key_type_check
    check (length(trim(key_type)) > 0),
  key_id text not null
    constraint whatsapp_auth_keys_key_id_check
    check (length(trim(key_id)) > 0),
  value_enc bytea not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key_type, key_id)
);

comment on table public.whatsapp_auth_keys is
  'WhatsApp group sync: Baileys signal keys, one pgcrypto-encrypted row each. No API-role grants and no policies; reachable only through service-role RPCs.';

create trigger set_whatsapp_auth_keys_updated_at
  before update on public.whatsapp_auth_keys
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. monitored_groups — which groups the owner allows UniPilot to read
-- -----------------------------------------------------------------------------

create table public.monitored_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_jid text not null
    constraint monitored_groups_group_jid_check
    check (group_jid like '%@g.us'),
  group_name text not null default ''
    constraint monitored_groups_group_name_check
    check (length(group_name) <= 200),
  -- Default false: personal and unmonitored groups are never ingested.
  is_active boolean not null default false,
  -- When the owner last turned the group ON. Capture starts from this moment;
  -- the UI says so next to the toggle.
  activated_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitored_groups_user_group_key unique (user_id, group_jid)
);

comment on table public.monitored_groups is
  'WhatsApp group sync: discovered groups. The bridge upserts names (never is_active); the owner toggles is_active.';
comment on column public.monitored_groups.is_active is
  'false by default. Only active groups are ingested. Turning one on captures messages from that moment forward.';
comment on column public.monitored_groups.activated_at is
  'Stamped by trigger each time is_active flips to true.';

create index monitored_groups_user_active_idx
  on public.monitored_groups (user_id, is_active);

create trigger set_monitored_groups_updated_at
  before update on public.monitored_groups
  for each row execute function public.set_updated_at();

create or replace function public.stamp_group_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    new.activated_at := now();
  end if;
  return new;
end;
$$;

comment on function public.stamp_group_activation() is
  'Stamps monitored_groups.activated_at whenever a group is switched on.';

create trigger stamp_group_activation
  before insert or update of is_active on public.monitored_groups
  for each row execute function public.stamp_group_activation();

-- -----------------------------------------------------------------------------
-- 5. raw_messages — captured messages from ACTIVE groups only
-- -----------------------------------------------------------------------------

create table public.raw_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_jid text not null,
  whatsapp_msg_id text not null,
  -- sha256(user_id | group_jid | sender | floor_to_minute(sent_at) |
  -- normalized_text_or_file_sha256). Unique PER USER, never globally.
  fingerprint text not null
    constraint raw_messages_fingerprint_check
    check (length(fingerprint) = 64),
  sender_name text not null default '',
  sent_at timestamptz not null,
  raw_text text not null default '',
  media_type text not null default 'none'
    constraint raw_messages_media_type_check
    check (media_type in ('none', 'pdf', 'pptx', 'docx', 'image')),
  -- sha256 of the attachment bytes when there is one.
  file_sha256 text
    constraint raw_messages_file_sha256_check
    check (file_sha256 is null or length(file_sha256) = 64),
  status text not null default 'queued'
    constraint raw_messages_status_check
    check (status in ('queued', 'processed', 'ignored_noise', 'failed')),
  -- Sanitized failure reason only; never message text or provider bodies.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_messages_user_fingerprint_key unique (user_id, fingerprint),
  constraint raw_messages_user_group_msg_key
    unique (user_id, group_jid, whatsapp_msg_id)
);

comment on table public.raw_messages is
  'WhatsApp group sync: captured messages from active groups. Owner SELECT only; 30-day purge. Extracted rows reference it ON DELETE SET NULL.';
comment on column public.raw_messages.fingerprint is
  'Per-user idempotency hash; a duplicate insert is dropped so a re-sync never duplicates tasks or files.';

create index raw_messages_user_created_idx
  on public.raw_messages (user_id, created_at desc);
create index raw_messages_user_status_idx
  on public.raw_messages (user_id, status);
create index raw_messages_user_group_sent_idx
  on public.raw_messages (user_id, group_jid, sent_at desc);

create trigger set_raw_messages_updated_at
  before update on public.raw_messages
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. RLS + grants
--    The bootstrap grants ALL on new tables to anon/authenticated/service_role,
--    so every grant is revoked first and re-granted explicitly (the 29.1 trap).
-- -----------------------------------------------------------------------------

alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_session_secrets enable row level security;
alter table public.whatsapp_auth_keys enable row level security;
alter table public.monitored_groups enable row level security;
alter table public.raw_messages enable row level security;

create policy "whatsapp_sessions_select_own"
  on public.whatsapp_sessions for select to authenticated
  using (auth.uid() = user_id);

create policy "monitored_groups_select_own"
  on public.monitored_groups for select to authenticated
  using (auth.uid() = user_id);

-- The owner may flip is_active and nothing else (column grant below).
create policy "monitored_groups_update_own"
  on public.monitored_groups for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "raw_messages_select_own"
  on public.raw_messages for select to authenticated
  using (auth.uid() = user_id);

-- whatsapp_session_secrets / whatsapp_auth_keys: no policies = deny by default.

revoke all on public.whatsapp_sessions from anon, authenticated;
revoke all on public.whatsapp_session_secrets from anon, authenticated, service_role;
revoke all on public.whatsapp_auth_keys from anon, authenticated, service_role;
revoke all on public.monitored_groups from anon, authenticated;
revoke all on public.raw_messages from anon, authenticated;

grant select on public.whatsapp_sessions to authenticated;
grant select on public.monitored_groups to authenticated;
grant update (is_active) on public.monitored_groups to authenticated;
grant select on public.raw_messages to authenticated;

grant all on public.whatsapp_sessions to service_role;
grant all on public.monitored_groups to service_role;
grant all on public.raw_messages to service_role;

revoke all on function public.stamp_group_activation() from public, anon, authenticated;
