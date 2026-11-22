-- =============================================================================
-- WhatsApp group sync (Stage 1) - schema contract check
-- =============================================================================
--
-- A self-contained, rolled-back SQL proof of the Task 1 schema:
--   * RLS isolation between two users (no data is read or written across them)
--   * secrets tables are unreachable for client roles
--   * the owner may flip monitored_groups.is_active and nothing else
--   * the fingerprint is unique per user, not globally
--   * provenance columns cannot be forged by a client
--   * subject ownership triggers
--   * the 30-day purge removes raw_messages but NEVER the extracted
--     tasks / events / documents / candidates (ON DELETE SET NULL)
--
-- Run against the LOCAL database only (it never commits):
--
--   Get-Content backend\supabase\qa\whatsapp-group-sync-schema-check.sql |
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
  s1 uuid;
  s2 uuid;
  m1 uuid;
  m2 uuid;
  d1 uuid;
  g1 uuid;
  n integer;
  fp1 text := repeat('a', 64);
begin
  -- ---- fixtures (as the table owner) --------------------------------------
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');

  -- Everything below that writes provenance acts as the service role.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into public.subjects (user_id, name, course_code, aliases)
  values (u1, 'Data Structures', 'CS301', array['DSA']) returning id into s1;
  insert into public.subjects (user_id, name) values (u2, 'Other') returning id into s2;

  insert into public.raw_messages
    (user_id, group_jid, whatsapp_msg_id, fingerprint, sender_name, sent_at, raw_text)
  values (u1, '120363@g.us', 'MSG1', fp1, 'Prof', now(), 'Assignment 3 due Friday')
  returning id into m1;

  -- 1. fingerprint is unique PER USER: u2 may reuse it, u1 may not -----------
  insert into public.raw_messages
    (user_id, group_jid, whatsapp_msg_id, fingerprint, sender_name, sent_at, raw_text)
  values (u2, '120363@g.us', 'MSG1', fp1, 'Prof', now(), 'same text, other user')
  returning id into m2;

  begin
    insert into public.raw_messages
      (user_id, group_jid, whatsapp_msg_id, fingerprint, sent_at)
    values (u1, '120363@g.us', 'MSG2', fp1, now());
    raise exception 'CHECK FAILED: duplicate per-user fingerprint was accepted';
  exception when unique_violation then
    raise notice 'ok   fingerprint unique per user, reusable across users';
  end;

  -- 2. extracted rows with source_message_id ---------------------------------
  insert into public.tasks
    (user_id, title, due_date, subject_id, source, source_ref,
     source_message_id, confidence_score, task_type)
  values (u1, 'Assignment 3', now() + interval '3 days', s1, 'whatsapp_group',
          'ref-1', m1, 0.93, 'assignment');

  insert into public.events
    (user_id, title, start_at, subject_id, source, source_ref,
     source_message_id, confidence_score, type)
  values (u1, 'Midterm', now() + interval '10 days', s1, 'whatsapp_group',
          'ref-2', m1, 0.9, 'exam');

  insert into public.documents
    (user_id, name, storage_path, mime_type, source, source_message_id,
     file_sha256, subject_id, ai_summary, topic_tags)
  values (u1, 'notes.pdf', u1::text || '/x/notes.pdf', 'application/pdf',
          'whatsapp_group', m1, repeat('b', 64), s1, 'Week 3 notes',
          array['trees'])
  returning id into d1;

  insert into public.integration_candidates
    (user_id, run_id, fingerprint, title, start_at, message_sender, message_text,
     origin, kind, confidence, source_message_id, proposed_subject_name)
  values (u1, null, 'cand-1', 'Maybe quiz', now() + interval '5 days', 'Prof',
          'quiz maybe', 'live_group', 'event', 0.6, m1, 'Algorithms');

  -- duplicate extraction can never create a second row ------------------------
  begin
    insert into public.tasks
      (user_id, title, source, source_ref)
    values (u1, 'Assignment 3 again', 'whatsapp_group', 'ref-1');
    raise exception 'CHECK FAILED: duplicate task source_ref was accepted';
  exception when unique_violation then
    raise notice 'ok   duplicate task source_ref rejected';
  end;

  begin
    insert into public.documents (user_id, name, file_sha256)
    values (u1, 'notes copy.pdf', repeat('b', 64));
    raise exception 'CHECK FAILED: duplicate file_sha256 was accepted';
  exception when unique_violation then
    raise notice 'ok   duplicate file_sha256 rejected per user';
  end;

  -- 3. candidate shape rules --------------------------------------------------
  begin
    insert into public.integration_candidates
      (user_id, run_id, fingerprint, title, start_at, message_sender, message_text)
    values (u1, null, 'cand-bad-run', 'x', now(), 's', 't');
    raise exception 'CHECK FAILED: export candidate without a run was accepted';
  exception when check_violation then
    raise notice 'ok   export candidates still require a run';
  end;

  begin
    insert into public.integration_candidates
      (user_id, run_id, fingerprint, title, start_at, message_sender, message_text,
       origin, kind)
    values (u1, null, 'cand-bad-start', 'x', null, 's', 't', 'live_group', 'event');
    raise exception 'CHECK FAILED: event candidate without a start was accepted';
  exception when check_violation then
    raise notice 'ok   event candidates still require a start';
  end;

  insert into public.integration_candidates
    (user_id, run_id, fingerprint, title, start_at, message_sender, message_text,
     origin, kind, task_type)
  values (u1, null, 'cand-task', 'Undated task', null, 's', 't',
          'live_group', 'task', 'assignment');
  raise notice 'ok   undated task candidates are allowed';

  -- 4. subject ownership triggers ---------------------------------------------
  begin
    insert into public.tasks (user_id, title, subject_id) values (u1, 'x', s2);
    raise exception 'CHECK FAILED: task accepted another user''s subject';
  exception when raise_exception then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
    raise notice 'ok   tasks.subject_id must belong to the same user';
  end;

  begin
    insert into public.documents (user_id, name, subject_id) values (u1, 'x', s2);
    raise exception 'CHECK FAILED: document accepted another user''s subject';
  exception when raise_exception then
    if sqlerrm like 'CHECK FAILED%' then raise; end if;
    raise notice 'ok   documents.subject_id must belong to the same user';
  end;

  -- 5. the 30-day purge keeps every extracted row ------------------------------
  update public.raw_messages set created_at = now() - interval '31 days' where id = m1;
  select public.purge_expired_raw_messages(u1) into n;
  if n <> 1 then
    raise exception 'CHECK FAILED: purge deleted % rows, expected 1', n;
  end if;
  if exists (select 1 from public.raw_messages where id = m1) then
    raise exception 'CHECK FAILED: expired raw message survived the purge';
  end if;
  if not exists (select 1 from public.raw_messages where id = m2) then
    raise exception 'CHECK FAILED: purge touched another user''s message';
  end if;
  select count(*) into n from public.tasks
   where user_id = u1 and source_ref = 'ref-1' and source_message_id is null;
  if n <> 1 then raise exception 'CHECK FAILED: task did not survive the purge'; end if;
  select count(*) into n from public.events
   where user_id = u1 and source_ref = 'ref-2' and source_message_id is null;
  if n <> 1 then raise exception 'CHECK FAILED: event did not survive the purge'; end if;
  select count(*) into n from public.documents
   where id = d1 and source_message_id is null;
  if n <> 1 then raise exception 'CHECK FAILED: document did not survive the purge'; end if;
  select count(*) into n from public.integration_candidates
   where user_id = u1 and fingerprint = 'cand-1' and source_message_id is null;
  if n <> 1 then raise exception 'CHECK FAILED: candidate did not survive the purge'; end if;
  raise notice 'ok   purge removed the raw message; task, event, document and candidate survived with source_message_id NULL';

  -- 6. monitored_groups: activation stamp -------------------------------------
  insert into public.monitored_groups (user_id, group_jid, group_name)
  values (u1, '120363@g.us', 'CS301 2026') returning id into g1;
  if exists (select 1 from public.monitored_groups where id = g1 and (is_active or activated_at is not null)) then
    raise exception 'CHECK FAILED: groups must default to inactive';
  end if;
  raise notice 'ok   groups default to is_active = false';

  -- a fresh u1 message so the isolation check below can see "own, not other"
  insert into public.raw_messages
    (user_id, group_jid, whatsapp_msg_id, fingerprint, sent_at)
  values (u1, '120363@g.us', 'MSG3', repeat('d', 64), now());

  -- ---- client-role checks: act as u1 ----------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.monitored_groups set is_active = true where id = g1;
  select count(*) into n from public.monitored_groups
   where id = g1 and is_active and activated_at is not null;
  if n <> 1 then raise exception 'CHECK FAILED: owner could not activate a group / no activated_at'; end if;
  raise notice 'ok   owner can switch a group on; activated_at is stamped';

  begin
    update public.monitored_groups set group_name = 'renamed' where id = g1;
    raise exception 'CHECK FAILED: owner could rename a group';
  exception when insufficient_privilege then
    raise notice 'ok   owner cannot change anything but is_active';
  end;

  begin
    insert into public.raw_messages (user_id, group_jid, whatsapp_msg_id, fingerprint, sent_at)
    values (u1, '120363@g.us', 'FORGED', repeat('c', 64), now());
    raise exception 'CHECK FAILED: client inserted into raw_messages';
  exception when insufficient_privilege then
    raise notice 'ok   clients cannot write raw_messages';
  end;

  begin
    perform 1 from public.whatsapp_session_secrets;
    raise exception 'CHECK FAILED: client read whatsapp_session_secrets';
  exception when insufficient_privilege then
    raise notice 'ok   whatsapp_session_secrets is unreachable for clients';
  end;

  begin
    perform 1 from public.whatsapp_auth_keys;
    raise exception 'CHECK FAILED: client read whatsapp_auth_keys';
  exception when insufficient_privilege then
    raise notice 'ok   whatsapp_auth_keys is unreachable for clients';
  end;

  begin
    perform public.purge_expired_raw_messages(u1);
    raise exception 'CHECK FAILED: client called the purge function';
  exception when insufficient_privilege then
    raise notice 'ok   purge function is service-role only';
  end;

  -- isolation: u1 sees its own message and never u2's
  select count(*) into n from public.raw_messages;
  if n <> 1 then
    raise exception 'CHECK FAILED: u1 sees % raw_messages, expected exactly its own 1', n;
  end if;
  select count(*) into n from public.raw_messages where user_id = u2;
  if n <> 0 then
    raise exception 'CHECK FAILED: u1 can read u2 raw_messages';
  end if;
  raise notice 'ok   RLS: a user sees only their own raw_messages';

  -- provenance cannot be forged by a client: the trigger resets it
  insert into public.tasks
    (user_id, title, source, source_ref, source_message_id, confidence_score, task_type)
  values (u1, 'client task', 'whatsapp_group', 'forged', m2, 0.99, 'quiz');
  select count(*) into n from public.tasks
   where user_id = u1 and title = 'client task'
     and source = 'manual' and source_ref is null and source_message_id is null
     and confidence_score is null and task_type is null;
  if n <> 1 then raise exception 'CHECK FAILED: client forged task provenance'; end if;

  insert into public.events (user_id, title, start_at, source, source_ref, confidence_score)
  values (u1, 'client event', now(), 'whatsapp_group', 'forged', 0.99);
  select count(*) into n from public.events
   where user_id = u1 and title = 'client event'
     and source = 'manual' and source_ref is null and confidence_score is null;
  if n <> 1 then raise exception 'CHECK FAILED: client forged event provenance'; end if;

  insert into public.documents (user_id, name, source)
  values (u1, 'client doc', 'whatsapp_group');
  select count(*) into n from public.documents
   where user_id = u1 and name = 'client doc' and source = 'upload';
  if n <> 1 then raise exception 'CHECK FAILED: client forged document provenance'; end if;
  raise notice 'ok   clients cannot forge task/event/document provenance';

  reset role;
  raise notice 'ALL CHECKS PASSED';
end
$$;

rollback;
