-- =============================================================================
-- WhatsApp group sync — the pairing code WITH its expiry
-- =============================================================================
--
-- The mobile app shows a countdown next to the pairing code ("expires in 1:42")
-- so the user knows how long they have to type it under Linked devices. The
-- secrets table is unreachable for every API role, so the expiry has to come
-- out of a definer RPC too. `get_whatsapp_pairing_code` (previous migration)
-- keeps returning just the code; this one returns code AND expiry, with the same
-- rule: a stale code reads as nothing and is cleared.
--
-- Service role only, `search_path = ''`, EXECUTE revoked from
-- `public`/`anon`/`authenticated` before the grant.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.get_whatsapp_pairing_status(uuid, text);
-- =============================================================================

create or replace function public.get_whatsapp_pairing_status(
  p_user_id uuid,
  p_key text
)
returns table (code text, expires_at timestamptz)
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
    return;
  end if;

  return query
    select extensions.pgp_sym_decrypt(v_enc, p_key)::text, v_expires;
end;
$$;

comment on function public.get_whatsapp_pairing_status(uuid, text) is
  'WhatsApp group sync: the live pairing code and its expiry; no row once expired. Service role only.';

revoke all on function public.get_whatsapp_pairing_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_whatsapp_pairing_status(uuid, text) to service_role;
