-- =============================================================================
-- WhatsApp group sync — the encrypted session-store RPCs
-- =============================================================================
--
-- `whatsapp_session_secrets` and `whatsapp_auth_keys` carry no API-role grants
-- and no policies (see 20261118154551). These definer functions are the only
-- way to read or write them, and only the service role may execute them. They
-- follow the `google_calendar_credentials` / `set_whatsapp_qr` pattern:
--
--   * `security definer`, `search_path = ''`, every object schema-qualified;
--   * pgcrypto (`extensions.pgp_sym_encrypt/decrypt`) with the server-only key
--     `UNIPILOT_INTEGRATIONS_KEY` passed as a parameter — never stored;
--   * EXECUTE revoked from `public`/`anon`/`authenticated` BEFORE the
--     `service_role` grant (the 29.1 default-grant trap);
--   * a wrong key makes decrypt RAISE, so a mismatched key can never be
--     mistaken for "no session".
--
-- Functions (all service-role only):
--
--   set_whatsapp_creds / get_whatsapp_creds     Baileys `creds` (BufferJSON text)
--   get_whatsapp_auth_keys / set_whatsapp_auth_keys
--                                               signal keys, batched; a NULL
--                                               value in a set deletes the key
--   set_whatsapp_session_qr / get_whatsapp_session_qr / clear_whatsapp_session_qr
--                                               the live QR with a hard TTL
--   clear_whatsapp_session                      logout: deletes creds, QR and
--                                               every key for the user
--
-- Values are opaque text to the database. The bridge serialises Baileys
-- objects with Baileys' BufferJSON before encrypting.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.clear_whatsapp_session(uuid);
--   drop function public.clear_whatsapp_session_qr(uuid);
--   drop function public.get_whatsapp_session_qr(uuid, text);
--   drop function public.set_whatsapp_session_qr(uuid, text, text, integer);
--   drop function public.set_whatsapp_auth_keys(uuid, jsonb, text);
--   drop function public.get_whatsapp_auth_keys(uuid, text, text[], text);
--   drop function public.get_whatsapp_creds(uuid, text);
--   drop function public.set_whatsapp_creds(uuid, text, text);
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Credentials
-- -----------------------------------------------------------------------------

create or replace function public.set_whatsapp_creds(
  p_user_id uuid,
  p_creds text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_creds, '') = '' or coalesce(p_key, '') = '' then
    raise exception 'set_whatsapp_creds requires a user, credentials and a key';
  end if;
  insert into public.whatsapp_session_secrets (user_id, creds_enc)
  values (p_user_id, extensions.pgp_sym_encrypt(p_creds, p_key))
  on conflict (user_id) do update set
    creds_enc = excluded.creds_enc;
end;
$$;

create or replace function public.get_whatsapp_creds(
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
  select s.creds_enc into v_enc
    from public.whatsapp_session_secrets s
   where s.user_id = p_user_id;
  if v_enc is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_enc, p_key)::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Signal keys (batched)
-- -----------------------------------------------------------------------------

-- Returns the decrypted value for each requested id that exists.
create or replace function public.get_whatsapp_auth_keys(
  p_user_id uuid,
  p_key_type text,
  p_ids text[],
  p_key text
)
returns table (key_id text, value text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select k.key_id,
           extensions.pgp_sym_decrypt(k.value_enc, p_key)::text
      from public.whatsapp_auth_keys k
     where k.user_id = p_user_id
       and k.key_type = p_key_type
       and k.key_id = any (p_ids);
end;
$$;

-- p_entries: [{"type": "...", "id": "...", "value": "..." | null}, ...]
-- A null/absent value deletes the key. One call = one transaction.
create or replace function public.set_whatsapp_auth_keys(
  p_user_id uuid,
  p_entries jsonb,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_type text;
  v_id text;
  v_value text;
begin
  if p_user_id is null or coalesce(p_key, '') = '' then
    raise exception 'set_whatsapp_auth_keys requires a user and a key';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'set_whatsapp_auth_keys expects a JSON array';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_type := v_entry ->> 'type';
    v_id := v_entry ->> 'id';
    v_value := v_entry ->> 'value';
    if coalesce(v_type, '') = '' or coalesce(v_id, '') = '' then
      raise exception 'set_whatsapp_auth_keys: every entry needs a type and an id';
    end if;

    if v_value is null then
      delete from public.whatsapp_auth_keys
       where user_id = p_user_id and key_type = v_type and key_id = v_id;
    else
      insert into public.whatsapp_auth_keys (user_id, key_type, key_id, value_enc)
      values (p_user_id, v_type, v_id, extensions.pgp_sym_encrypt(v_value, p_key))
      on conflict (user_id, key_type, key_id) do update set
        value_enc = excluded.value_enc;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Live QR (hard TTL, mirrors set_whatsapp_qr)
-- -----------------------------------------------------------------------------

create or replace function public.set_whatsapp_session_qr(
  p_user_id uuid,
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
  if p_user_id is null or coalesce(p_qr, '') = '' or coalesce(p_key, '') = '' then
    raise exception 'set_whatsapp_session_qr requires a user, a payload and a key';
  end if;
  insert into public.whatsapp_session_secrets (user_id, qr_enc, qr_expires_at)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(p_qr, p_key),
    now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 60), 5), 300))
  )
  on conflict (user_id) do update set
    qr_enc = excluded.qr_enc,
    qr_expires_at = excluded.qr_expires_at;
end;
$$;

-- Returns the QR only while unexpired; a stale QR is cleared and reads as null.
create or replace function public.get_whatsapp_session_qr(
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
  select s.qr_enc, s.qr_expires_at into v_enc, v_expires
    from public.whatsapp_session_secrets s
   where s.user_id = p_user_id;

  if v_enc is null or v_expires is null or v_expires <= now() then
    update public.whatsapp_session_secrets
       set qr_enc = null, qr_expires_at = null
     where user_id = p_user_id
       and qr_enc is not null
       and (qr_expires_at is null or qr_expires_at <= now());
    return null;
  end if;
  return extensions.pgp_sym_decrypt(v_enc, p_key)::text;
end;
$$;

create or replace function public.clear_whatsapp_session_qr(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.whatsapp_session_secrets
     set qr_enc = null, qr_expires_at = null
   where user_id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Logout / disconnect: forget everything secret about this user's session
-- -----------------------------------------------------------------------------

create or replace function public.clear_whatsapp_session(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.whatsapp_auth_keys where user_id = p_user_id;
  delete from public.whatsapp_session_secrets where user_id = p_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Grants — explicit revokes before every service_role grant
-- -----------------------------------------------------------------------------

revoke all on function public.set_whatsapp_creds(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_creds(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_auth_keys(uuid, text, text[], text)
  from public, anon, authenticated;
revoke all on function public.set_whatsapp_auth_keys(uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.set_whatsapp_session_qr(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_session_qr(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_whatsapp_session_qr(uuid)
  from public, anon, authenticated;
revoke all on function public.clear_whatsapp_session(uuid)
  from public, anon, authenticated;

grant execute on function public.set_whatsapp_creds(uuid, text, text) to service_role;
grant execute on function public.get_whatsapp_creds(uuid, text) to service_role;
grant execute on function public.get_whatsapp_auth_keys(uuid, text, text[], text) to service_role;
grant execute on function public.set_whatsapp_auth_keys(uuid, jsonb, text) to service_role;
grant execute on function public.set_whatsapp_session_qr(uuid, text, text, integer) to service_role;
grant execute on function public.get_whatsapp_session_qr(uuid, text) to service_role;
grant execute on function public.clear_whatsapp_session_qr(uuid) to service_role;
grant execute on function public.clear_whatsapp_session(uuid) to service_role;
