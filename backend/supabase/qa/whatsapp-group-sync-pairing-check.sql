-- =============================================================================
-- WhatsApp group sync - pairing-code storage check
-- =============================================================================
--
-- Rolled-back SQL proof of the pairing RPCs:
--   * the phone number and the code are encrypted at rest (no plaintext), and a
--     wrong key raises
--   * the database re-validates the number (digits only, 8-15, no leading 0)
--     and the code (8 alphanumerics) even if a caller already did
--   * the code expires, and a stale one is cleared and reads as null
--   * clear_whatsapp_pairing removes the number AND the code but leaves the
--     session credentials alone; clear_whatsapp_session removes everything
--   * the new status/link_method values are accepted, bad ones rejected
--   * clients cannot execute any of it
--
--   Get-Content backend\supabase\qa\whatsapp-group-sync-pairing-check.sql |
--     wsl -d kali-linux -u root -e docker exec -i supabase_db_unipilot `
--       psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- =============================================================================

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  k text := 'check-key-not-a-real-secret';
  raw bytea;
  v text;
  bad text;
begin
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- number round trip, encrypted, wrong key raises ---------------------------------
  perform public.set_whatsapp_pairing_phone(u1, '919876543210', k);
  if public.get_whatsapp_pairing_phone(u1, k) is distinct from '919876543210' then
    raise exception 'CHECK FAILED: the number did not round-trip';
  end if;
  select phone_enc into raw from public.whatsapp_session_secrets where user_id = u1;
  if position('9876543210'::bytea in raw) > 0 then
    raise exception 'CHECK FAILED: the number is stored in plaintext';
  end if;
  if public.get_whatsapp_pairing_phone(u2, k) is not null then
    raise exception 'CHECK FAILED: another user has a number';
  end if;
  begin
    perform public.get_whatsapp_pairing_phone(u1, 'wrong-key');
    raise exception 'CHECK FAILED: a wrong key decrypted the number';
  exception when others then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
  end;
  raise notice 'ok   the number round-trips, is encrypted, is per user, and a wrong key raises';

  -- the database re-validates the number ----------------------------------------------
  foreach bad in array array['+919876543210', '0919876543210', '91 98765 43210', '98765', '1234567890123456', '91-98765', 'abcdefghij', '']
  loop
    begin
      perform public.set_whatsapp_pairing_phone(u1, bad, k);
      raise exception 'CHECK FAILED: accepted malformed number %', bad;
    exception when others then
      if sqlerrm like 'CHECK FAILED%' then raise; end if;
    end;
  end loop;
  if public.get_whatsapp_pairing_phone(u1, k) is distinct from '919876543210' then
    raise exception 'CHECK FAILED: a rejected number overwrote the stored one';
  end if;
  raise notice 'ok   malformed numbers (+, spaces, dashes, leading 0, too short/long) are rejected';

  -- code: round trip, normalised, encrypted, validated ----------------------------------
  perform public.set_whatsapp_pairing_code(u1, 'abcd-1234', k, 120);
  v := public.get_whatsapp_pairing_code(u1, k);
  if v is distinct from 'ABCD1234' then
    raise exception 'CHECK FAILED: the code was not normalised/round-tripped (%)', v;
  end if;
  select pairing_code_enc into raw from public.whatsapp_session_secrets where user_id = u1;
  if position('ABCD1234'::bytea in raw) > 0 then
    raise exception 'CHECK FAILED: the code is stored in plaintext';
  end if;
  foreach bad in array array['ABC', 'ABCDEFGHI', 'ABCD 123', 'ABCD!234', '']
  loop
    begin
      perform public.set_whatsapp_pairing_code(u1, bad, k, 120);
      raise exception 'CHECK FAILED: accepted malformed code %', bad;
    exception when others then
      if sqlerrm like 'CHECK FAILED%' then raise; end if;
    end;
  end loop;
  raise notice 'ok   the code is normalised, encrypted and validated';

  -- code + expiry in one read (the mobile countdown) ---------------------------------------
  perform public.set_whatsapp_pairing_code(u1, 'QWER9876', k, 120);
  select s.code into v from public.get_whatsapp_pairing_status(u1, k) s;
  if v is distinct from 'QWER9876' then
    raise exception 'CHECK FAILED: get_whatsapp_pairing_status did not return the code (%)', v;
  end if;
  if not exists (
    select 1 from public.get_whatsapp_pairing_status(u1, k) s
     where s.expires_at > now() + interval '100 seconds'
       and s.expires_at <= now() + interval '121 seconds'
  ) then
    raise exception 'CHECK FAILED: the expiry is not ~120 s away';
  end if;
  begin
    perform public.get_whatsapp_pairing_status(u1, 'wrong-key');
    raise exception 'CHECK FAILED: a wrong key read the pairing status';
  exception when others then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
  end;
  update public.whatsapp_session_secrets
     set pairing_expires_at = now() - interval '1 second' where user_id = u1;
  if exists (select 1 from public.get_whatsapp_pairing_status(u1, k)) then
    raise exception 'CHECK FAILED: an expired code still has a status row';
  end if;
  raise notice 'ok   the status read returns code + expiry, and nothing once expired';
  perform public.set_whatsapp_pairing_code(u1, 'ABCD-1234', k, 120);

  -- expiry ----------------------------------------------------------------------------------
  update public.whatsapp_session_secrets
     set pairing_expires_at = now() - interval '1 second' where user_id = u1;
  if public.get_whatsapp_pairing_code(u1, k) is not null then
    raise exception 'CHECK FAILED: an expired code was returned';
  end if;
  if exists (select 1 from public.whatsapp_session_secrets
              where user_id = u1 and (pairing_code_enc is not null or pairing_expires_at is not null)) then
    raise exception 'CHECK FAILED: an expired code was not cleared';
  end if;
  if public.get_whatsapp_pairing_phone(u1, k) is null then
    raise exception 'CHECK FAILED: clearing an expired code removed the number';
  end if;
  raise notice 'ok   the code expires, is cleared when stale, and leaves the number alone';

  -- clear_whatsapp_pairing vs clear_whatsapp_session -----------------------------------------------
  perform public.set_whatsapp_creds(u1, '{"noiseKey":"abc"}', k);
  perform public.set_whatsapp_pairing_code(u1, 'ZXCV5678', k, 120);
  perform public.clear_whatsapp_pairing(u1);
  if public.get_whatsapp_pairing_phone(u1, k) is not null
     or public.get_whatsapp_pairing_code(u1, k) is not null then
    raise exception 'CHECK FAILED: clear_whatsapp_pairing left the number or the code';
  end if;
  if public.get_whatsapp_creds(u1, k) is null then
    raise exception 'CHECK FAILED: clear_whatsapp_pairing removed the credentials';
  end if;
  perform public.set_whatsapp_pairing_phone(u1, '919876543210', k);
  perform public.clear_whatsapp_session(u1);
  if exists (select 1 from public.whatsapp_session_secrets where user_id = u1) then
    raise exception 'CHECK FAILED: clear_whatsapp_session left the secrets row (number included)';
  end if;
  raise notice 'ok   clear_whatsapp_pairing drops number+code only; clear_whatsapp_session drops everything';

  -- status / link_method vocabulary ---------------------------------------------------------------------
  insert into public.whatsapp_sessions (user_id, status, link_method)
  values (u1, 'code_ready', 'pairing_code');
  begin
    update public.whatsapp_sessions set status = 'pairing' where user_id = u1;
    raise exception 'CHECK FAILED: an unknown status was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.whatsapp_sessions set link_method = 'sms' where user_id = u1;
    raise exception 'CHECK FAILED: an unknown link_method was accepted';
  exception when check_violation then null;
  end;
  if (select link_method from public.whatsapp_sessions where user_id = u2) is not null then
    raise exception 'CHECK FAILED: unexpected row';
  end if;
  raise notice 'ok   code_ready / pairing_code are valid; unknown values are rejected';

  -- clients cannot execute any of it -----------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.get_whatsapp_pairing_phone(u1, k);
    raise exception 'CHECK FAILED: authenticated read the number';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute get_whatsapp_pairing_phone';
  end;
  begin
    perform public.set_whatsapp_pairing_phone(u1, '919876543210', k);
    raise exception 'CHECK FAILED: authenticated stored a number';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute set_whatsapp_pairing_phone';
  end;
  begin
    perform public.get_whatsapp_pairing_code(u1, k);
    raise exception 'CHECK FAILED: authenticated read the code';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute get_whatsapp_pairing_code';
  end;
  begin
    perform public.clear_whatsapp_pairing(u1);
    raise exception 'CHECK FAILED: authenticated cleared pairing data';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute clear_whatsapp_pairing';
  end;
  reset role;

  raise notice 'ALL CHECKS PASSED';
end
$$;

rollback;
