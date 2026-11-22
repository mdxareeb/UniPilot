-- =============================================================================
-- WhatsApp group sync (Stage 1) - encrypted session store check
-- =============================================================================
--
-- Rolled-back SQL proof of the Task 2 RPCs:
--   * credentials and signal keys round-trip through pgcrypto
--   * the stored bytes are not the plaintext
--   * a wrong key RAISES (it is never mistaken for "no session")
--   * a NULL value in set_whatsapp_auth_keys deletes the key
--   * the QR expires, and a stale QR is cleared and reads as null
--   * clear_whatsapp_session wipes the user's secrets only
--   * clients (authenticated / anon) cannot execute any of it
--
--   Get-Content backend\supabase\qa\whatsapp-group-sync-rpc-check.sql |
--     wsl -d kali-linux -u root -e docker exec -i supabase_db_unipilot `
--       psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- =============================================================================

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  k text := 'check-key-not-a-real-secret';
  v text;
  n integer;
  raw bytea;
begin
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- credentials round trip ----------------------------------------------------
  perform public.set_whatsapp_creds(u1, '{"noiseKey":"abc"}', k);
  v := public.get_whatsapp_creds(u1, k);
  if v is distinct from '{"noiseKey":"abc"}' then
    raise exception 'CHECK FAILED: credentials did not round-trip (%)', v;
  end if;
  select creds_enc into raw from public.whatsapp_session_secrets where user_id = u1;
  if position('noiseKey'::bytea in raw) > 0 then
    raise exception 'CHECK FAILED: credentials are stored in plaintext';
  end if;
  if public.get_whatsapp_creds(u2, k) is not null then
    raise exception 'CHECK FAILED: another user has credentials';
  end if;
  raise notice 'ok   credentials round-trip, are not stored in plaintext, and are per user';

  -- a wrong key raises --------------------------------------------------------
  begin
    perform public.get_whatsapp_creds(u1, 'wrong-key');
    raise exception 'CHECK FAILED: a wrong key decrypted the credentials';
  exception when others then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
    raise notice 'ok   a wrong key raises instead of reading as "no session"';
  end;

  -- signal keys: batch set, get, overwrite, delete ----------------------------
  perform public.set_whatsapp_auth_keys(u1, jsonb_build_array(
    jsonb_build_object('type', 'pre-key', 'id', '1', 'value', 'AAA'),
    jsonb_build_object('type', 'pre-key', 'id', '2', 'value', 'BBB'),
    jsonb_build_object('type', 'session', 'id', 'x', 'value', 'CCC')
  ), k);
  perform public.set_whatsapp_auth_keys(u2, jsonb_build_array(
    jsonb_build_object('type', 'pre-key', 'id', '1', 'value', 'OTHER')
  ), k);

  select count(*) into n from public.get_whatsapp_auth_keys(u1, 'pre-key', array['1','2','3'], k);
  if n <> 2 then raise exception 'CHECK FAILED: expected 2 pre-keys, got %', n; end if;
  select value into v from public.get_whatsapp_auth_keys(u1, 'pre-key', array['1'], k);
  if v <> 'AAA' then raise exception 'CHECK FAILED: wrong pre-key value (%)', v; end if;
  select value into v from public.get_whatsapp_auth_keys(u2, 'pre-key', array['1'], k);
  if v <> 'OTHER' then raise exception 'CHECK FAILED: keys leaked across users'; end if;
  select value_enc into raw from public.whatsapp_auth_keys
   where user_id = u1 and key_type = 'pre-key' and key_id = '1';
  if position('AAA'::bytea in raw) > 0 then
    raise exception 'CHECK FAILED: a signal key is stored in plaintext';
  end if;

  perform public.set_whatsapp_auth_keys(u1, jsonb_build_array(
    jsonb_build_object('type', 'pre-key', 'id', '1', 'value', 'AAA2')
  ), k);
  select value into v from public.get_whatsapp_auth_keys(u1, 'pre-key', array['1'], k);
  if v <> 'AAA2' then raise exception 'CHECK FAILED: key overwrite failed'; end if;

  perform public.set_whatsapp_auth_keys(u1, jsonb_build_array(
    jsonb_build_object('type', 'pre-key', 'id', '2', 'value', null)
  ), k);
  select count(*) into n from public.get_whatsapp_auth_keys(u1, 'pre-key', array['2'], k);
  if n <> 0 then raise exception 'CHECK FAILED: a null value did not delete the key'; end if;
  raise notice 'ok   signal keys: batched set/get, overwrite, null-deletes, encrypted, per user';

  begin
    perform public.set_whatsapp_auth_keys(u1, '{"not":"an array"}'::jsonb, k);
    raise exception 'CHECK FAILED: a non-array payload was accepted';
  exception when others then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
    raise notice 'ok   malformed key batches are rejected';
  end;

  -- QR with TTL ---------------------------------------------------------------
  perform public.set_whatsapp_session_qr(u1, '2@qr-payload', k, 60);
  v := public.get_whatsapp_session_qr(u1, k);
  if v is distinct from '2@qr-payload' then
    raise exception 'CHECK FAILED: QR did not round-trip (%)', v;
  end if;
  select qr_enc into raw from public.whatsapp_session_secrets where user_id = u1;
  if position('qr-payload'::bytea in raw) > 0 then
    raise exception 'CHECK FAILED: QR is stored in plaintext';
  end if;

  update public.whatsapp_session_secrets
     set qr_expires_at = now() - interval '1 second' where user_id = u1;
  if public.get_whatsapp_session_qr(u1, k) is not null then
    raise exception 'CHECK FAILED: an expired QR was returned';
  end if;
  if exists (select 1 from public.whatsapp_session_secrets
              where user_id = u1 and (qr_enc is not null or qr_expires_at is not null)) then
    raise exception 'CHECK FAILED: an expired QR was not cleared';
  end if;
  if public.get_whatsapp_creds(u1, k) is null then
    raise exception 'CHECK FAILED: clearing the QR removed the credentials';
  end if;

  perform public.set_whatsapp_session_qr(u1, '2@qr-two', k, 60);
  perform public.clear_whatsapp_session_qr(u1);
  if public.get_whatsapp_session_qr(u1, k) is not null then
    raise exception 'CHECK FAILED: clear_whatsapp_session_qr left a QR';
  end if;
  raise notice 'ok   QR is encrypted, expires, is cleared when stale and on demand, and leaves credentials intact';

  -- logout wipes this user's secrets only ----------------------------------------
  perform public.clear_whatsapp_session(u1);
  if exists (select 1 from public.whatsapp_session_secrets where user_id = u1)
     or exists (select 1 from public.whatsapp_auth_keys where user_id = u1) then
    raise exception 'CHECK FAILED: clear_whatsapp_session left secrets behind';
  end if;
  select count(*) into n from public.get_whatsapp_auth_keys(u2, 'pre-key', array['1'], k);
  if n <> 1 then raise exception 'CHECK FAILED: logout of u1 removed u2 keys'; end if;
  raise notice 'ok   clear_whatsapp_session wipes the owner''s secrets and nobody else''s';

  -- clients cannot execute any of it ---------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.get_whatsapp_creds(u1, k);
    raise exception 'CHECK FAILED: authenticated executed get_whatsapp_creds';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute get_whatsapp_creds';
  end;
  begin
    perform public.set_whatsapp_auth_keys(u1, '[]'::jsonb, k);
    raise exception 'CHECK FAILED: authenticated executed set_whatsapp_auth_keys';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute set_whatsapp_auth_keys';
  end;
  begin
    perform public.get_whatsapp_session_qr(u1, k);
    raise exception 'CHECK FAILED: authenticated executed get_whatsapp_session_qr';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute get_whatsapp_session_qr';
  end;
  begin
    perform public.clear_whatsapp_session(u1);
    raise exception 'CHECK FAILED: authenticated executed clear_whatsapp_session';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute clear_whatsapp_session';
  end;

  reset role;
  set local role anon;
  begin
    perform public.get_whatsapp_creds(u1, k);
    raise exception 'CHECK FAILED: anon executed get_whatsapp_creds';
  exception when insufficient_privilege then
    raise notice 'ok   anon cannot execute the session RPCs';
  end;
  reset role;

  raise notice 'ALL CHECKS PASSED';
end
$$;

rollback;
