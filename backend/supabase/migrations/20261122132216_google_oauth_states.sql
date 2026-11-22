-- Google Calendar integration: the mobile OAuth state store.
-- =============================================================================
--
-- One row per in-flight provider authorization started from the mobile app.
-- The native client has no cookies, so the state travels in the OAuth
-- `state` parameter and only its SHA-256 is stored:
--
--   * the Next.js Bearer route mints a random 32-byte token, stores its
--     SHA-256 with a 10-minute TTL and hands the raw token to Google;
--   * the callback hashes the incoming `state`, finds an unconsumed,
--     unexpired row and consumes it (single use: a replayed code is nothing);
--   * the row records `return_scheme` so a future provider screen (e.g.
--     Microsoft) cannot be redirected through the wrong app route;
--   * service-only: the web (cookie) OAuth flow keeps using its own
--     httpOnly cookie and never touches this table.
--
-- No OAuth code or token is ever stored here; those live only in the request
-- and in google_calendar_credentials (encrypted).
--
-- Rollback (reference; the workflow is forward-only):
--   drop table public.google_oauth_states;
-- =============================================================================

create table public.google_oauth_states (
  state_hash text primary key
    constraint google_oauth_states_state_hash_check
    check (length(state_hash) = 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    constraint google_oauth_states_provider_check
    check (provider in ('google')),
  return_scheme text not null
    constraint google_oauth_states_return_scheme_check
    check (return_scheme in ('unipilot')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint google_oauth_states_expires_check
    check (expires_at > created_at)
);

comment on table public.google_oauth_states is
  'Google Calendar integration: single-use OAuth state rows for the mobile link flow. Service-only; hashed, never the raw token.';

create index google_oauth_states_expires_idx
  on public.google_oauth_states (expires_at);

alter table public.google_oauth_states enable row level security;
-- no policies: deny by default.

revoke all on public.google_oauth_states from anon, authenticated;

grant all on public.google_oauth_states to service_role;
