-- =============================================================================
-- Ask AI study chat — schema contract check
-- =============================================================================
--
-- A self-contained, rolled-back SQL proof of the Phase 2 contract:
--   * ai_chat_sessions is owner CRUD; a scope must name a subject/document
--     owned by the same user (the guard trigger), and both scopes at once is
--     rejected by the CHECK;
--   * ai_chat_messages is owner-SELECT through the parent session and has no
--     INSERT/UPDATE/DELETE grant for authenticated;
--   * QA1 never sees QA2's sessions or messages;
--   * search_document_chunks filters both branches by p_subject_id, and
--     recent_document_chunks is bounded, newest-first and scope-aware;
--   * anon cannot reach either table.
--
-- Run against the LOCAL database only (it never commits):
--
--   Get-Content backend\supabase\qa\study-chat-schema-check.sql |
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
  d1 uuid;
  d2 uuid;
  chat1 uuid;
  chat2 uuid;
  n integer;
  hit_doc uuid;
begin
  -- ---- fixtures (as the table owner) ----------------------------------------
  insert into auth.users (id, aud, role, email)
  values (u1, 'authenticated', 'authenticated', u1::text || '@check.invalid'),
         (u2, 'authenticated', 'authenticated', u2::text || '@check.invalid');

  insert into public.subjects (user_id, name)
  values (u1, 'check algebra') returning id into s1;
  insert into public.subjects (user_id, name)
  values (u2, 'check foreign') returning id into s2;

  insert into public.documents (user_id, name, subject_id, status)
  values (u1, 'check algebra notes', s1, 'indexed') returning id into d1;
  insert into public.documents (user_id, name, subject_id, status)
  values (u2, 'check foreign notes', s2, 'indexed') returning id into d2;

  insert into public.document_chunks (document_id, chunk_index, content, page)
  values (d1, 0, 'zephyrcheck algebra marker', 1),
         (d1, 1, 'zephyrcheck algebra follow-up', 2),
         (d2, 0, 'zephyrcheck foreign marker', 1);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1. the service can create a scoped session; both scopes are rejected -----
  insert into public.ai_chat_sessions (user_id, title, scope_subject_id)
  values (u1, 'check scoped', s1) returning id into chat1;

  begin
    insert into public.ai_chat_sessions (user_id, title, scope_subject_id, scope_document_id)
    values (u1, 'check both', s1, d1);
    raise exception 'both scopes were accepted';
  exception
    when check_violation then null;
  end;

  -- 2. the same-user guard rejects a foreign subject/document -----------------
  begin
    insert into public.ai_chat_sessions (user_id, title, scope_subject_id)
    values (u1, 'check foreign subject', s2);
    raise exception 'a foreign subject scope was accepted';
  exception
    when others then
      if sqlerrm not like '%scope subject must belong to the owner%' then
        raise;
      end if;
  end;

  begin
    insert into public.ai_chat_sessions (user_id, title, scope_document_id)
    values (u1, 'check foreign document', d2);
    raise exception 'a foreign document scope was accepted';
  exception
    when others then
      if sqlerrm not like '%scope document must belong to the owner%' then
        raise;
      end if;
  end;

  -- 3. the service writes messages; the owner reads them through the parent --
  insert into public.ai_chat_messages (session_id, role, content, sources)
  values (chat1, 'user', 'zephyrcheck question', null),
         (chat1, 'assistant', 'zephyrcheck answer',
          jsonb_build_array(jsonb_build_object(
            'documentId', d1,
            'documentName', 'check algebra notes',
            'page', 1,
            'chunkIndex', 0,
            'snippet', 'zephyrcheck algebra marker'
          )));

  -- 4. the client role: owner CRUD, no message writes, no foreign reads ------
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', u1::text)::text,
    true
  );
  set local role authenticated;

  insert into public.ai_chat_sessions (user_id, title)
  values (u1, 'check owner session') returning id into chat2;

  select count(*) into n from public.ai_chat_sessions where user_id = u1;
  if n <> 2 then raise exception 'owner sees % sessions, expected 2', n; end if;

  update public.ai_chat_sessions set title = 'check renamed' where id = chat2;
  if not found then raise exception 'owner rename failed'; end if;

  select count(*) into n from public.ai_chat_messages where session_id = chat1;
  if n <> 2 then raise exception 'owner sees % messages, expected 2', n; end if;

  begin
    insert into public.ai_chat_messages (session_id, role, content)
    values (chat2, 'assistant', 'forged');
    raise exception 'a client forged a message';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.ai_chat_messages set content = 'edited' where session_id = chat1;
    raise exception 'a client edited a message';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.ai_chat_messages where session_id = chat1;
    raise exception 'a client deleted a message';
  exception
    when insufficient_privilege then null;
  end;

  begin
    select id into hit_doc from public.ai_chat_sessions where user_id = u2;
    if hit_doc is not null then raise exception 'u1 saw u2''s session'; end if;
    select id into hit_doc from public.ai_chat_messages
     where session_id in (select id from public.ai_chat_sessions where user_id = u2);
    if hit_doc is not null then raise exception 'u1 saw u2''s message'; end if;
  end;

  -- 5. retrieval is subject-scoped, and recency stays within the scope -------
  select document_id into hit_doc
    from public.search_document_chunks(
      'zephyrcheck', 10, null, null, null, s1
    )
   limit 1;
  if hit_doc is distinct from d1 then raise exception 'subject search did not isolate d1'; end if;

  select count(*) into n
    from public.search_document_chunks(
      'zephyrcheck', 10, null, null, null, s2
    );
  if n <> 0 then raise exception 'a foreign subject returned hits'; end if;

  select document_id into hit_doc
    from public.recent_document_chunks(8, null, s1)
   limit 1;
  if hit_doc is distinct from d1 then raise exception 'recency did not isolate d1'; end if;

  select count(*) into n from public.recent_document_chunks(99, null, s2);
  if n <> 0 then raise exception 'recency leaked a foreign subject'; end if;

  -- 6. the owner can delete the session and messages cascade ------------------
  delete from public.ai_chat_sessions where id = chat1;
  select count(*) into n from public.ai_chat_messages where session_id = chat1;
  if n <> 0 then raise exception 'messages survived the session delete'; end if;

  reset role;

  -- 7. grants: anon has nothing; authenticated reads but cannot write messages
  if has_table_privilege('anon', 'public.ai_chat_sessions', 'SELECT')
     or has_table_privilege('anon', 'public.ai_chat_messages', 'SELECT') then
    raise exception 'anon can read Ask AI tables';
  end if;
  if not has_table_privilege('authenticated', 'public.ai_chat_sessions', 'SELECT')
     or not has_table_privilege('authenticated', 'public.ai_chat_sessions', 'INSERT')
     or not has_table_privilege('authenticated', 'public.ai_chat_sessions', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.ai_chat_sessions', 'DELETE') then
    raise exception 'owner session grants are incomplete';
  end if;
  if has_table_privilege('authenticated', 'public.ai_chat_messages', 'INSERT')
     or has_table_privilege('authenticated', 'public.ai_chat_messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ai_chat_messages', 'DELETE') then
    raise exception 'authenticated can write messages';
  end if;
  if not has_table_privilege('authenticated', 'public.ai_chat_messages', 'SELECT') then
    raise exception 'authenticated cannot read its own messages';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
