-- =============================================================================
-- Task 20.6 — ratify the UniPilot schema (Stage 2 item 8)
-- =============================================================================
--
-- The first versioned migration. It defines every table the product's roadmap
-- depends on, with ownership, row-level security and the indexes the named
-- query patterns need. It is applied locally with `supabase db reset`; 20.7
-- owns the hosted rollout, and no linked push is ever made from here.
--
-- ── Decisions (recorded in TASK.md 20.6 and DATABASE.md) ────────────────────
--
-- 1. Names: `first_name` + `last_name`, not `full_name`. Onboarding collects two
--    separate validated fields (onboardingData.ts `firstName`/`lastName`), and
--    a single column cannot recover them (AUTH_ARCHITECTURE.md made the same
--    call). Both nullable: a provisioned row has no name until onboarding runs.
-- 2. `onboarding_completed_at timestamptz`, nullable. NULL = not completed;
--    "skip" simply never stamps it, and the timestamp records when (14.10).
-- 3. `academic_year` / `semester`: smallint codes with range checks
--    (1–5, 1–2). The onboarding display strings ("Year 3", "Semester 2") are
--    presentation; the closed ordinal set is stable, compact and queryable,
--    and mapping is trivial in 13.10. Storing display text would force a
--    parsing migration later.
-- 4. Closed vocabularies use text + named CHECK constraints — one policy
--    everywhere (no enums, no lookup tables). Named constraints are readable in
--    errors and cheap to replace in a future migration; Postgres enums are hard
--    to remove values from and lookup tables add joins for lists of 2–5 values.
--    Open taxonomies stay unconstrained text and are documented: 
--    `usage_events.kind` (cost metrics grow with phases 24.x/26.x) and
--    `subscriptions.provider` (provider slug; R21 keeps the UI provider-free).
-- 5. `document_chunks.embedding`: deferred to 25.x. The embedding dimension is
--    a model choice 25.x owns; a nullable column now risks locking the wrong
--    dimension. Boundary: document_chunks stores text + ordering here; 25.x
--    adds the extension, the vector column and the similarity index.
-- 6. profiles rows are provisioned by a trigger on `auth.users` insert
--    (security definer, id only), matching the hosted project's existing
--    behaviour. Onboarding writes the fields later (13.10 owns persistence).
--    The trigger avoids a window where an authenticated user has no profile.
--    NOTE for 20.7: the hosted project already has a profiles provisioner on
--    its differently-shaped table — reconcile before applying hosted.
-- 7. Ownership FKs (`user_id` → auth.users) all ON DELETE CASCADE. The two
--    cross-references (`tasks.source_document_id`, `events.source_document_id`)
--    are ON DELETE SET NULL: they are provenance, not ownership, and deleting a
--    file must not silently destroy work the student may have edited.
--
-- Deny-by-default: RLS is ENABLED on every table, every operation a client may
-- perform has a written owner-only policy, and operations that only the server
-- (service role) performs deliberately have no client policy. Child tables
-- (document_chunks, messages) inherit ownership through EXISTS on their parent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Shared helpers
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` honest for every table that has it. Attached per table
-- below. `search_path` is emptied so the function cannot resolve objects
-- through a caller-controlled path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Provisions the 1:1 profile row when an auth user is created. `security
-- definer` because the insert must succeed regardless of the caller's role
-- (the auth service creates users), and the function's own search_path is
-- emptied so only explicitly qualified names resolve.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. profiles — 1:1 with auth.users
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  institution text,
  course_program text,
  academic_year smallint
    constraint profiles_academic_year_check
    check (academic_year between 1 and 5),
  semester smallint
    constraint profiles_semester_check
    check (semester between 1 and 2),
  planning_style text
    constraint profiles_planning_style_check
    check (planning_style in ('steady', 'balanced', 'deadline_driven')),
  reminder_lead text
    constraint profiles_reminder_lead_check
    check (reminder_lead in ('1_day', '3_days', '1_week')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  '1:1 with auth.users; provisioned by trigger, filled by onboarding (13.10).';
comment on column public.profiles.academic_year is
  '1–5; maps to onboarding "Year N".';
comment on column public.profiles.semester is
  '1–2; maps to onboarding "Semester N".';
comment on column public.profiles.onboarding_completed_at is
  'NULL = not completed; finish stamps it, skip must not.';

-- -----------------------------------------------------------------------------
-- 2. subjects — the student's courses
-- -----------------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint subjects_name_check
    check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subjects_user_id_name_key unique (user_id, name)
);

-- -----------------------------------------------------------------------------
-- 3. documents — uploaded files and their index status
-- -----------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint documents_name_check
    check (length(trim(name)) > 0),
  storage_path text,
  mime_type text,
  size_bytes bigint
    constraint documents_size_bytes_check
    check (size_bytes is null or size_bytes >= 0),
  page_count integer
    constraint documents_page_count_check
    check (page_count is null or page_count > 0),
  status text not null default 'uploaded'
    constraint documents_status_check
    check (status in ('uploaded', 'indexing', 'indexed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.documents.storage_path is
  'Object path in Supabase Storage; buckets are 24.x''s concern.';
comment on column public.documents.status is
  'uploaded → indexing → indexed; a failed run records error_message.';

-- -----------------------------------------------------------------------------
-- 4. document_chunks — ordered text of a document (embeddings deferred to 25.x)
-- -----------------------------------------------------------------------------

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  chunk_index integer not null
    constraint document_chunks_chunk_index_check
    check (chunk_index >= 0),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_chunks_document_id_chunk_index_key
    unique (document_id, chunk_index)
);

comment on table public.document_chunks is
  'Text + ordering only. 25.x adds the pgvector extension, the embedding column and the index.';

-- -----------------------------------------------------------------------------
-- 5. tasks
-- -----------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null
    constraint tasks_title_check
    check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo'
    constraint tasks_status_check
    check (status in ('todo', 'in_progress', 'done')),
  due_date timestamptz,
  effort_minutes integer
    constraint tasks_effort_minutes_check
    check (effort_minutes is null or effort_minutes > 0),
  -- Provenance, not ownership: keep the task if its source file is deleted.
  source_document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. events — classes, exams and deadline dates
-- -----------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null
    constraint events_title_check
    check (length(trim(title)) > 0),
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz
    constraint events_end_at_check
    check (end_at is null or end_at >= start_at),
  all_day boolean not null default false,
  -- Provenance, not ownership (see tasks.source_document_id).
  source_document_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. conversations + messages — the assistant's history
-- -----------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  role text not null
    constraint messages_role_check
    check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. tool_runs — one row per tool execution (per-run states, not the registry)
-- -----------------------------------------------------------------------------

create table public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Matches `ToolId` in components/tools/toolCatalog.ts. Deliberately a plain
  -- text column, not a FK: the registry is code, not a table, and the registry
  -- states (live/planned/disabled) are a different axis from per-run states.
  tool_id text not null
    constraint tool_runs_tool_id_check
    check (length(trim(tool_id)) > 0),
  status text not null default 'queued'
    constraint tool_runs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed')),
  input jsonb,
  output jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.tool_runs.tool_id is
  'Registry id (toolCatalog.ts). No FK by design: the registry is code.';
comment on column public.tool_runs.status is
  'Per-run job state; processing/failed live here, never in the registry.';

-- -----------------------------------------------------------------------------
-- 9. notifications
-- -----------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint notifications_kind_check
    check (kind in ('deadline', 'workload', 'document', 'system')),
  title text not null
    constraint notifications_title_check
    check (length(trim(title)) > 0),
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.notifications.read_at is
  'NULL = unread; the client may only UPDATE this (and DELETE to dismiss).';

-- -----------------------------------------------------------------------------
-- 10. subscriptions — billing shape only, no logic
-- -----------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan text not null default 'free'
    constraint subscriptions_plan_check
    check (plan in ('free', 'pro', 'team')),
  status text not null default 'active'
    constraint subscriptions_status_check
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  -- Open taxonomy: a provider slug (e.g. 'stripe'); R21 keeps providers out of
  -- the UI, so the database stores an opaque identifier rather than a type.
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'One row per user. Owner may SELECT only; the billing webhook (service role) writes.';

-- -----------------------------------------------------------------------------
-- 11. usage_events — append-only cost/usage ledger
-- -----------------------------------------------------------------------------

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Open taxonomy (documents pages, AI tokens, tool runs, …): new kinds arrive
  -- with phases 24.x/26.x and must not need a constraint migration per kind.
  kind text not null
    constraint usage_events_kind_check
    check (length(trim(kind)) > 0),
  quantity numeric not null default 1
    constraint usage_events_quantity_check
    check (quantity >= 0),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.usage_events is
  'Append-only ledger: owner may SELECT/INSERT; no UPDATE/DELETE policy.';

-- -----------------------------------------------------------------------------
-- 12. updated_at triggers (every table that has the column)
-- -----------------------------------------------------------------------------

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_subjects_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();
create trigger set_document_chunks_updated_at
  before update on public.document_chunks
  for each row execute function public.set_updated_at();
create trigger set_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger set_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();
create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();
create trigger set_messages_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();
create trigger set_tool_runs_updated_at
  before update on public.tool_runs
  for each row execute function public.set_updated_at();
create trigger set_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();
create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
create trigger set_usage_events_updated_at
  before update on public.usage_events
  for each row execute function public.set_updated_at();

-- Profile provisioning: one row per new auth user (auth.users is owned by
-- Supabase; the trigger is the supported extension point).
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 13. Row-level security — deny by default, owner-only
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.tool_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;

-- profiles: the owner reads and maintains their row. No DELETE policy —
-- profiles are removed by the auth.users cascade, never directly.
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- subjects / tasks / events / documents / conversations: full owner CRUD.
create policy "subjects_select_own"
  on public.subjects for select to authenticated
  using (auth.uid() = user_id);
create policy "subjects_insert_own"
  on public.subjects for insert to authenticated
  with check (auth.uid() = user_id);
create policy "subjects_update_own"
  on public.subjects for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "subjects_delete_own"
  on public.subjects for delete to authenticated
  using (auth.uid() = user_id);

create policy "tasks_select_own"
  on public.tasks for select to authenticated
  using (auth.uid() = user_id);
create policy "tasks_insert_own"
  on public.tasks for insert to authenticated
  with check (auth.uid() = user_id);
create policy "tasks_update_own"
  on public.tasks for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "tasks_delete_own"
  on public.tasks for delete to authenticated
  using (auth.uid() = user_id);

create policy "events_select_own"
  on public.events for select to authenticated
  using (auth.uid() = user_id);
create policy "events_insert_own"
  on public.events for insert to authenticated
  with check (auth.uid() = user_id);
create policy "events_update_own"
  on public.events for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "events_delete_own"
  on public.events for delete to authenticated
  using (auth.uid() = user_id);

create policy "documents_select_own"
  on public.documents for select to authenticated
  using (auth.uid() = user_id);
create policy "documents_insert_own"
  on public.documents for insert to authenticated
  with check (auth.uid() = user_id);
create policy "documents_update_own"
  on public.documents for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "documents_delete_own"
  on public.documents for delete to authenticated
  using (auth.uid() = user_id);

create policy "conversations_select_own"
  on public.conversations for select to authenticated
  using (auth.uid() = user_id);
create policy "conversations_insert_own"
  on public.conversations for insert to authenticated
  with check (auth.uid() = user_id);
create policy "conversations_update_own"
  on public.conversations for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "conversations_delete_own"
  on public.conversations for delete to authenticated
  using (auth.uid() = user_id);

-- Child tables inherit ownership from their parent through EXISTS; a row is
-- only visible/insertable/updatable/deletable when its parent belongs to the
-- caller. They deliberately carry no `user_id` of their own.
create policy "document_chunks_select_owned_parent"
  on public.document_chunks for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );
create policy "document_chunks_insert_owned_parent"
  on public.document_chunks for insert to authenticated
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );
create policy "document_chunks_update_owned_parent"
  on public.document_chunks for update to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );
create policy "document_chunks_delete_owned_parent"
  on public.document_chunks for delete to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

create policy "messages_select_owned_parent"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
create policy "messages_insert_owned_parent"
  on public.messages for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
create policy "messages_update_owned_parent"
  on public.messages for update to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
create policy "messages_delete_owned_parent"
  on public.messages for delete to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- tool_runs: the owner sees and drives their own runs; no DELETE policy so run
-- history cannot be erased from the client.
create policy "tool_runs_select_own"
  on public.tool_runs for select to authenticated
  using (auth.uid() = user_id);
create policy "tool_runs_insert_own"
  on public.tool_runs for insert to authenticated
  with check (auth.uid() = user_id);
create policy "tool_runs_update_own"
  on public.tool_runs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- notifications: written by the server, read/dismissed by the owner (the
-- UPDATE policy is what marks `read_at`). No INSERT policy for clients.
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "notifications_delete_own"
  on public.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- subscriptions: read-only for the owner; the billing webhook (service role)
-- owns every write. This is what stops a client-side "upgrade".
create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

-- usage_events: append-only ledger — the owner may read their usage and insert
-- a run's event; history is never rewritten from the client.
create policy "usage_events_select_own"
  on public.usage_events for select to authenticated
  using (auth.uid() = user_id);
create policy "usage_events_insert_own"
  on public.usage_events for insert to authenticated
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 14. Indexes — ownership, FK columns and the named query patterns
-- -----------------------------------------------------------------------------

-- profiles: the PK is the user id; nothing else is queried by key.
create index subjects_user_id_idx on public.subjects (user_id);
-- `subjects_user_id_name_key` already covers (user_id, name).

create index documents_user_id_idx on public.documents (user_id);

-- `document_chunks_document_id_chunk_index_key` covers document_id lookups.
create index document_chunks_document_id_idx
  on public.document_chunks (document_id);

create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_due_date_idx on public.tasks (due_date);
create index tasks_source_document_id_idx
  on public.tasks (source_document_id);

create index events_user_id_idx on public.events (user_id);
create index events_start_at_idx on public.events (start_at);
create index events_source_document_id_idx
  on public.events (source_document_id);

create index conversations_user_id_idx on public.conversations (user_id);
create index messages_conversation_id_idx
  on public.messages (conversation_id);

create index tool_runs_user_id_idx on public.tool_runs (user_id);

create index notifications_user_id_idx on public.notifications (user_id);

-- `subscriptions_user_id_key` already covers the unique user_id lookup.

create index usage_events_user_id_occurred_at_idx
  on public.usage_events (user_id, occurred_at);

-- -----------------------------------------------------------------------------
-- 15. Grants — the client role gets table access; RLS above is the filter.
--     `anon` is revoked outright: no table in this schema is public.
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on all tables in schema public
  to authenticated;
revoke all on all tables in schema public from anon;

-- -----------------------------------------------------------------------------
-- Rollback (reference; the workflow is forward-only)
-- -----------------------------------------------------------------------------
-- Local: `supabase db reset` after removing this file from the chain.
-- Hosted: restore the pre-push dump (DATABASE.md §Hosted reconciliation
-- runbook); this migration is not otherwise reversible.
-- Manual: drop the 12 tables (cascade), drop the `set_*_updated_at` triggers
-- and the `on_auth_user_created` trigger on auth.users, then drop the functions
-- public.set_updated_at and public.handle_new_user.

-- One-time normalization (20.7, pre-hosted): this file was renamed from
-- `20260911064824_init_schema.sql` (local wall time) to its true UTC timestamp.
-- It had only ever been applied to the local stack. Migrations now use UTC
-- timestamps generated by `supabase migration new`.
