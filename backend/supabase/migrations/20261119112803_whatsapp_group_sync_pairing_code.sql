-- =============================================================================
-- WhatsApp group sync — linking by PAIRING CODE (the mobile app's path)
-- =============================================================================
--
-- A QR code shown on a phone cannot be scanned by the same phone's WhatsApp, so
-- the mobile app links with WhatsApp's "Link with phone number" option: the
-- user enters their number, the bridge asks WhatsApp for an 8-character code,
-- and the user types that code under WhatsApp > Linked devices.
--
-- Schema changes (all additive):
--   * whatsapp_sessions.status gains `code_ready` (the pairing-code twin of
--     `qr_ready`), and a new `link_method` (`qr` | `pairing_code`) records how
--     this link attempt was requested.
--   * whatsapp_session_secrets gains three encrypted/expiring columns:
--       phone_enc            the user's number, digits-only E.164
--       pairing_code_enc     the code the bridge got from WhatsApp
--       pairing_expires_at   when that code stops being valid
--     The number is a secret like the credentials next to it: pgcrypto-encrypted,
--     unreachable by any API role, and deleted as soon as the link succeeds, a
--     link attempt ends, or the session is cleared.
--
-- Five definer RPCs (service role only, `search_path = ''`, EXECUTE revoked
-- from `public`/`anon`/`authenticated` before the grant, pgcrypto key passed in):
--   set_whatsapp_pairing_phone / get_whatsapp_pairing_phone
--   set_whatsapp_pairing_code / get_whatsapp_pairing_code
--   clear_whatsapp_pairing
--
-- The number is validated again here (digits only, 8-15 digits, no leading 0),
-- so a bug in any caller cannot store a malformed value.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.clear_whatsapp_pairing(uuid);
--   drop function public.get_whatsapp_pairing_code(uuid, text);
--   drop function public.set_whatsapp_pairing_code(uuid, text, text, integer);
--   drop function public.get_whatsapp_pairing_phone(uuid, text);
--   drop function public.set_whatsapp_pairing_phone(uuid, text, text);
--   alter table public.whatsapp_session_secrets
--     drop column pairing_expires_at, drop column pairing_code_enc, drop column phone_enc;
--   alter table public.whatsapp_sessions drop column link_method;
--   update public.whatsapp_sessions set status = 'disconnected' where status = 'code_ready';
--   alter table public.whatsapp_sessions drop constraint whatsapp_sessions_status_check;
--   alter table public.whatsapp_sessions add constraint whatsapp_sessions_status_check
--     check (status in ('disconnected', 'qr_ready', 'connected'));
-- =============================================================================

alter table public.whatsapp_sessions
  drop constraint whatsapp_sessions_status_check;
alter table public.whatsapp_sessions
  add constraint whatsapp_sessions_status_check
  check (status in ('disconnected', 'qr_ready', 'code_ready', 'connected'));

alter table public.whatsapp_sessions
  add column link_method text not null default 'qr'
    constraint whatsapp_sessions_link_method_check
    check (link_method in ('qr', 'pairing_code'));

comment on column public.whatsapp_sessions.link_method is
  'How this link attempt was requested: qr (web) or pairing_code (mobile). The bridge reads it to choose between publishing a QR and requesting a pairing code.';

alter table public.whatsapp_session_secrets
  add column phone_enc bytea,
  add column pairing_code_enc bytea,
  add column pairing_expires_at timestamptz;

comment on column public.whatsapp_session_secrets.phone_enc is
  'pgcrypto-encrypted phone number (digits-only E.164) for a pairing-code link. Deleted when the link succeeds or the attempt ends.';
comment on column public.whatsapp_session_secrets.pairing_code_enc is
  'pgcrypto-encrypted 8-character pairing code; expires at pairing_expires_at.';

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

create or replace function public.set_whatsapp_pairing_phone(
  p_user_id uuid,
  p_phone text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_key, '') = '' then
    raise exception 'set_whatsapp_pairing_phone requires a user and a key';
  end if;
  -- digits only, 8-15 digits (E.164 maximum), no leading zero, no "+"
  if p_phone is null or p_phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'set_whatsapp_pairing_phone: not a digits-only E.164 number';
  end if;
  insert into public.whatsapp_session_secrets (user_id, phone_enc)
  values (p_user_id, extensions.pgp_sym_encrypt(p_phone, p_key))
  on conflict (user_id) do update set phone_enc = excluded.phone_enc;
end;
$$;

create or replace function public.get_whatsapp_pairing_phone(
  p_user_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enc bytea;
begin
  select s.phone_enc into v_enc
    from public.whatsapp_session_secrets s
   where s.user_id = p_user_id;
  if v_enc is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_enc, p_key)::text;
end;
$$;

create or replace function public.set_whatsapp_pairing_code(
  p_user_id uuid,
  p_code text,
  p_key text,
  p_ttl_seconds integer default 120
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(replace(coalesce(p_code, ''), '-', ''));
begin
  if p_user_id is null or coalesce(p_key, '') = '' then
    raise exception 'set_whatsapp_pairing_code requires a user and a key';
  end if;
  if v_code !~ '^[A-Z0-9]{8}$' then
    raise exception 'set_whatsapp_pairing_code: not an 8-character code';
  end if;
  insert into public.whatsapp_session_secrets
    (user_id, pairing_code_enc, pairing_expires_at)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(v_code, p_key),
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 120), 30), 300))
  )
  on conflict (user_id) do update set
    pairing_code_enc = excluded.pairing_code_enc,
    pairing_expires_at = excluded.pairing_expires_at;
end;
$$;

-- Returns the code only while unexpired; a stale one is cleared and reads as null.
create or replace function public.get_whatsapp_pairing_code(
  p_user_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enc bytea;
  v_expires timestamptz;
begin
  select s.pairing_code_enc, s.pairing_expires_at into v_enc, v_expires
    from public.whatsapp_session_secrets s
   where s.user_id = p_user_id;

  if v_enc is null or v_expires is null or v_expires <= now() then
    update public.whatsapp_session_secrets
       set pairing_code_enc = null, pairing_expires_at = null
     where user_id = p_user_id
       and pairing_code_enc is not null
       and (pairing_expires_at is null or pairing_expires_at <= now());
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_enc, p_key)::text;
end;
$$;

-- Forget the number and the code (link succeeded, attempt ended, or disconnect).
create or replace function public.clear_whatsapp_pairing(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_session_secrets
     set phone_enc = null, pairing_code_enc = null, pairing_expires_at = null
   where user_id = p_user_id;
end;
$$;

revoke all on function public.set_whatsapp_pairing_phone(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_pairing_phone(uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_whatsapp_pairing_code(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_pairing_code(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_whatsapp_pairing(uuid)
  from public, anon, authenticated;

grant execute on function public.set_whatsapp_pairing_phone(uuid, text, text) to service_role;
grant execute on function public.get_whatsapp_pairing_phone(uuid, text) to service_role;
grant execute on function public.set_whatsapp_pairing_code(uuid, text, text, integer) to service_role;
grant execute on function public.get_whatsapp_pairing_code(uuid, text) to service_role;
grant execute on function public.clear_whatsapp_pairing(uuid) to service_role;
