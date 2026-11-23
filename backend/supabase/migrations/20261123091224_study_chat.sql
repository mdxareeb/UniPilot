-- Ask AI study chat: isolated mobile sessions and server-written messages.
-- =============================================================================
--
-- Two tables keep the mobile study chat separate from the web assistant's
-- conversations/messages:
--
--   * ai_chat_sessions — one thread per student, optionally scoped to one
--     subject or one document. The owner may create, rename (title), and
--     delete a thread; the scope columns must name rows owned by the same
--     user (guard trigger below).
--   * ai_chat_messages — ordered user/assistant turns. Messages are written
--     only by the Bearer route through the service client; the owner has
--     SELECT through the parent session and no INSERT/UPDATE/DELETE grant.
--     `sources` is the compact citation array the UI renders and is written
--     by the route, never by a client.
--
-- Retrieval itself stays in public.search_document_chunks (subject filter
-- added in the same phase) and the assistant prompt/limits stay shared.
--
-- Rollback (reference; the workflow is forward-only):
--   drop table public.ai_chat_messages;
--   drop table public.ai_chat_sessions;
--   drop function public.guard_ai_chat_scope();
-- =============================================================================

create table public.ai_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text
    constraint ai_chat_sessions_title_check
    check (title is null or length(trim(title)) between 1 and 120),
  scope_subject_id uuid references public.subjects (id) on delete set null,
  scope_document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- All materials = both null; a subject or a single document, never both.
  constraint ai_chat_sessions_scope_check
    check (scope_subject_id is null or scope_document_id is null)
);

comment on table public.ai_chat_sessions is
  'Ask AI study threads: owner-created sessions with an optional subject/document scope. Messages are server-written.';

create index ai_chat_sessions_user_updated_idx
  on public.ai_chat_sessions (user_id, updated_at desc);

create trigger set_ai_chat_sessions_updated_at
  before update on public.ai_chat_sessions
  for each row execute function public.set_updated_at();

/**
 * A session's scope must name a subject/document owned by the same student.
 * Foreign-key integrity alone cannot express that: subjects and documents are
 * owner rows, and the id alone does not prove ownership. Runs for owner inserts
 * and updates and for service-side writes too.
 */
create or replace function public.guard_ai_chat_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.scope_subject_id is not null and not exists (
    select 1
      from public.subjects s
     where s.id = new.scope_subject_id
       and s.user_id = new.user_id
  ) then
    raise exception 'ai_chat_sessions: scope subject must belong to the owner';
  end if;

  if new.scope_document_id is not null and not exists (
    select 1
      from public.documents d
     where d.id = new.scope_document_id
       and d.user_id = new.user_id
  ) then
    raise exception 'ai_chat_sessions: scope document must belong to the owner';
  end if;

  return new;
end;
$$;

comment on function public.guard_ai_chat_scope() is
  'Ask AI: keeps a session scope on rows owned by the same student.';

create trigger guard_ai_chat_scope
  before insert or update of user_id, scope_subject_id, scope_document_id
  on public.ai_chat_sessions
  for each row execute function public.guard_ai_chat_scope();

alter table public.ai_chat_sessions enable row level security;

create policy "ai_chat_sessions_select_own"
  on public.ai_chat_sessions for select to authenticated
  using (auth.uid() = user_id);

create policy "ai_chat_sessions_insert_own"
  on public.ai_chat_sessions for insert to authenticated
  with check (auth.uid() = user_id);

create policy "ai_chat_sessions_update_own"
  on public.ai_chat_sessions for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "ai_chat_sessions_delete_own"
  on public.ai_chat_sessions for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.ai_chat_sessions from anon, authenticated;
grant select, insert, update, delete on public.ai_chat_sessions to authenticated;
grant all on public.ai_chat_sessions to service_role;

revoke all on function public.guard_ai_chat_scope()
  from public, anon, authenticated;

create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_chat_sessions (id) on delete cascade,
  role text not null
    constraint ai_chat_messages_role_check
    check (role in ('user', 'assistant')),
  content text not null
    constraint ai_chat_messages_content_check
    check (length(trim(content)) between 1 and 20000),
  status text not null default 'complete'
    constraint ai_chat_messages_status_check
    check (status in ('complete', 'failed')),
  sources jsonb
    constraint ai_chat_messages_sources_check
    check (
      sources is null
      or (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 12)
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ai_chat_messages is
  'Ask AI study turns. Server-written only; the owner reads them through the parent session. sources is the citation array the UI renders.';

create index ai_chat_messages_session_created_idx
  on public.ai_chat_messages (session_id, created_at, id);

create trigger set_ai_chat_messages_updated_at
  before update on public.ai_chat_messages
  for each row execute function public.set_updated_at();

alter table public.ai_chat_messages enable row level security;

create policy "ai_chat_messages_select_owned_parent"
  on public.ai_chat_messages for select to authenticated
  using (
    exists (
      select 1
        from public.ai_chat_sessions s
       where s.id = ai_chat_messages.session_id
         and s.user_id = auth.uid()
    )
  );

revoke all on public.ai_chat_messages from anon, authenticated;
grant select on public.ai_chat_messages to authenticated;
grant all on public.ai_chat_messages to service_role;
