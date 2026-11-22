-- =============================================================================
-- WhatsApp group sync (Stage 1) - ingestion check
-- =============================================================================
--
-- Rolled-back SQL proof of ingest_raw_messages / enqueue_raw_message_extraction:
--   * only ACTIVE groups are ingested (an inactive or unknown group is dropped)
--   * redelivery / replay creates no second row (both unique constraints)
--   * one ids-only whatsapp.extract job per NEW text message, none for noise
--     or media, and none for duplicates
--   * last_synced_at is stamped
--   * another user's group of the same jid is not affected
--   * clients cannot execute either function
--
--   Get-Content backend\supabase\qa\whatsapp-group-sync-ingest-check.sql |
--     wsl -d kali-linux -u root -e docker exec -i supabase_db_unipilot `
--       psql -U postgres -d postgres -v ON_ERROR_STOP=1
-- =============================================================================

begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  n integer;
  returned integer;
  mid uuid;
  jid_on text := '111@g.us';
  jid_off text := '222@g.us';
  batch jsonb;
begin
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into public.monitored_groups (user_id, group_jid, group_name, is_active)
  values (u1, jid_on, 'On group', true),
         (u1, jid_off, 'Off group', false),
         (u2, jid_on, 'Other user same jid', false);

  batch := jsonb_build_array(
    jsonb_build_object('group_jid', jid_on, 'whatsapp_msg_id', 'A1',
      'fingerprint', repeat('a', 64), 'sender_name', 'Prof',
      'sent_at', '2026-11-18T10:00:00Z', 'raw_text', 'Assignment 3 due Friday',
      'media_type', 'none', 'status', 'queued'),
    jsonb_build_object('group_jid', jid_on, 'whatsapp_msg_id', 'A2',
      'fingerprint', repeat('b', 64), 'sender_name', 'Sam',
      'sent_at', '2026-11-18T10:01:00Z', 'raw_text', 'lol',
      'media_type', 'none', 'status', 'ignored_noise'),
    jsonb_build_object('group_jid', jid_on, 'whatsapp_msg_id', 'A3',
      'fingerprint', repeat('c', 64), 'sender_name', 'Prof',
      'sent_at', '2026-11-18T10:02:00Z', 'raw_text', 'Notes attached',
      'media_type', 'pdf', 'file_sha256', repeat('d', 64), 'status', 'queued'),
    jsonb_build_object('group_jid', jid_off, 'whatsapp_msg_id', 'B1',
      'fingerprint', repeat('e', 64), 'sender_name', 'Mum',
      'sent_at', '2026-11-18T10:03:00Z', 'raw_text', 'Dinner at 8',
      'media_type', 'none', 'status', 'queued'),
    jsonb_build_object('group_jid', '999@g.us', 'whatsapp_msg_id', 'C1',
      'fingerprint', repeat('f', 64), 'sender_name', 'Who',
      'sent_at', '2026-11-18T10:04:00Z', 'raw_text', 'unknown group',
      'media_type', 'none', 'status', 'queued')
  );

  -- 1. only the active group's three rows land --------------------------------
  select count(*) into returned from public.ingest_raw_messages(u1, batch);
  if returned <> 3 then
    raise exception 'CHECK FAILED: expected 3 ingested rows, got %', returned;
  end if;
  select count(*) into n from public.raw_messages
   where user_id = u1 and group_jid in (jid_off, '999@g.us');
  if n <> 0 then
    raise exception 'CHECK FAILED: a message from an inactive/unknown group was stored';
  end if;
  raise notice 'ok   only ACTIVE groups are ingested (inactive and unknown groups dropped)';

  -- 2. jobs: one ids-only job for the new text message, none for noise/media ---
  select count(*) into n from public.jobs
   where user_id = u1 and kind = 'whatsapp.extract';
  if n <> 1 then
    raise exception 'CHECK FAILED: expected exactly 1 extract job, got %', n;
  end if;
  select m.id into mid from public.raw_messages m
   where m.user_id = u1 and m.whatsapp_msg_id = 'A1';
  if not exists (
    select 1 from public.jobs j
     where j.user_id = u1 and j.kind = 'whatsapp.extract'
       and j.payload = jsonb_build_object('rawMessageId', mid)
  ) then
    raise exception 'CHECK FAILED: the job payload is not ids-only {rawMessageId}';
  end if;
  if exists (select 1 from public.jobs where payload::text like '%Assignment%') then
    raise exception 'CHECK FAILED: message text leaked into a job payload';
  end if;
  raise notice 'ok   one ids-only job for the new text message; none for noise or media';

  -- 3. replay creates nothing -----------------------------------------------------
  select count(*) into returned from public.ingest_raw_messages(u1, batch);
  if returned <> 0 then
    raise exception 'CHECK FAILED: a replayed batch inserted % rows', returned;
  end if;
  select count(*) into n from public.raw_messages where user_id = u1;
  if n <> 3 then raise exception 'CHECK FAILED: replay changed the row count to %', n; end if;
  select count(*) into n from public.jobs where user_id = u1 and kind = 'whatsapp.extract';
  if n <> 1 then raise exception 'CHECK FAILED: replay enqueued more jobs (%)', n; end if;
  raise notice 'ok   replaying the same batch inserts nothing and enqueues nothing';

  -- 4. same WhatsApp message id with a different fingerprint is still a duplicate
  select count(*) into returned from public.ingest_raw_messages(u1, jsonb_build_array(
    jsonb_build_object('group_jid', jid_on, 'whatsapp_msg_id', 'A1',
      'fingerprint', repeat('9', 64), 'sender_name', 'Prof',
      'sent_at', '2026-11-18T10:00:30Z', 'raw_text', 'edited text',
      'media_type', 'none', 'status', 'queued')));
  if returned <> 0 then
    raise exception 'CHECK FAILED: a re-delivered message id created a second row';
  end if;
  raise notice 'ok   the same WhatsApp message id cannot create a second row';

  -- 5. last_synced_at -------------------------------------------------------------
  if not exists (select 1 from public.monitored_groups
                  where user_id = u1 and group_jid = jid_on and last_synced_at is not null) then
    raise exception 'CHECK FAILED: last_synced_at was not stamped';
  end if;
  if exists (select 1 from public.monitored_groups
              where user_id = u2 and last_synced_at is not null) then
    raise exception 'CHECK FAILED: another user''s group was touched';
  end if;
  raise notice 'ok   last_synced_at stamped for the active group only';

  -- 6. a fingerprint is per user: u2 (group off) ingests nothing, u1 unaffected ----
  select count(*) into returned from public.ingest_raw_messages(u2, batch);
  if returned <> 0 then
    raise exception 'CHECK FAILED: u2 ingested from groups it never switched on';
  end if;
  raise notice 'ok   another user with the same group jid but switched off ingests nothing';

  -- 7. the media message is enqueued only once its file is stored ---------------------
  select m.id into mid from public.raw_messages m
   where m.user_id = u1 and m.whatsapp_msg_id = 'A3';
  if not public.enqueue_raw_message_extraction(u1, mid) then
    raise exception 'CHECK FAILED: the media message was not enqueued';
  end if;
  if public.enqueue_raw_message_extraction(u1, mid) then
    raise exception 'CHECK FAILED: a second live job was created for the same message';
  end if;
  if public.enqueue_raw_message_extraction(u2, mid) then
    raise exception 'CHECK FAILED: another user enqueued this user''s message';
  end if;
  raise notice 'ok   enqueue is idempotent while a job is live and owner-scoped';

  -- 8. clients cannot execute either function --------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.ingest_raw_messages(u1, batch);
    raise exception 'CHECK FAILED: authenticated executed ingest_raw_messages';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute ingest_raw_messages';
  end;
  begin
    perform public.enqueue_raw_message_extraction(u1, mid);
    raise exception 'CHECK FAILED: authenticated executed enqueue_raw_message_extraction';
  exception when insufficient_privilege then
    raise notice 'ok   authenticated cannot execute enqueue_raw_message_extraction';
  end;
  reset role;

  raise notice 'ALL CHECKS PASSED';
end
$$;

rollback;
