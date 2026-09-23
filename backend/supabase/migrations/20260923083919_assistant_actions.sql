-- =============================================================================
-- Tasks 27.1/27.8 — the assistant action log (`public.assistant_actions`)
-- =============================================================================
--
-- Every action the assistant proposes (27.1's closed vocabulary) gets one row
-- here: what was proposed, what the user did with it, and what the executor
-- settled. The row is the audit trail R3 asks for and the idempotency anchor
-- 27.13 reads (`unique (user_id, idempotency_key)`).
--
-- Design decisions:
--
-- * `type` mirrors 27.1's closed union (`task.create`, `reminder.create`,
--   `event.create`, `presentation.create`) as a named CHECK, like the other
--   schema vocabularies — an unknown type cannot even be logged.
-- * `payload` is the normalized action payload (`parseAssistantAction`'s
--   output): the exact value the confirmation card rendered and the executor
--   ran. jsonb because it is a presentation/audit value, not a relational
--   entity. `result` carries the executor's settled facts (created row ids)
--   and `error` the sanitized failure copy; neither is ever client-written.
-- * `status` is the closed vocabulary `proposed | confirmed | rejected |
--   succeeded | failed`: proposed → confirmed | rejected, then confirmed →
--   succeeded | failed. `settled_at` records the terminal transition.
-- * `message_id` points at the assistant message that proposed the action and
--   is nullable: deleting a message must not erase the audit trail (SET NULL),
--   while deleting the conversation removes its actions (CASCADE).
-- * `idempotency_key` is required and unique per user: 27.13's duplicate
--   prevention is a database fact, not a UI convention.
-- * Writes are server-only (the messages posture, 26.4): no client role may
--   INSERT/UPDATE/DELETE; owners may SELECT their own rows through RLS. The
--   turn pipeline and the executor write with the service role.
--
-- Rollback (reference; the workflow is forward-only):
--   drop table public.assistant_actions;
-- =============================================================================

create table public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  type text not null
    constraint assistant_actions_type_check
    check (type in ('task.create', 'reminder.create', 'event.create', 'presentation.create')),
  payload jsonb not null,
  status text not null default 'proposed'
    constraint assistant_actions_status_check
    check (status in ('proposed', 'confirmed', 'rejected', 'succeeded', 'failed')),
  result jsonb,
  error text,
  idempotency_key text not null
    constraint assistant_actions_idempotency_key_check
    check (length(trim(idempotency_key)) > 0),
  proposed_at timestamptz not null default now(),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_actions_user_idempotency_key
    unique (user_id, idempotency_key)
);

comment on table public.assistant_actions is
  'Tasks 27.1/27.8: one row per proposed assistant action. Owner SELECT only;
   every write is service-side.';
comment on column public.assistant_actions.payload is
  'The normalized 27.1 payload (parseAssistantAction output): the exact value
   the confirmation card rendered and the executor ran.';
comment on column public.assistant_actions.status is
  'proposed → confirmed | rejected; confirmed → succeeded | failed.';
comment on column public.assistant_actions.result is
  'Settled facts written by the executor (e.g. the created row id).';
comment on column public.assistant_actions.idempotency_key is
  '27.13: unique per user; a repeated proposal can never execute twice.';
comment on column public.assistant_actions.settled_at is
  'When the action reached a terminal status; NULL while proposed/confirmed.';

-- The owner's conversation view (27.8) and the message link the UI/log reads.
create index assistant_actions_user_conversation_idx
  on public.assistant_actions (user_id, conversation_id);
create index assistant_actions_message_id_idx
  on public.assistant_actions (message_id);

create trigger set_assistant_actions_updated_at
  before update on public.assistant_actions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS + grants — owner reads only; every write is server-side.
-- -----------------------------------------------------------------------------

alter table public.assistant_actions enable row level security;

create policy "assistant_actions_select_own"
  on public.assistant_actions for select to authenticated
  using (auth.uid() = user_id);

-- Explicit grants: authenticated may read (RLS filters), anon gets nothing,
-- and the service role owns every write path. The blanket revoke also removes
-- the Supabase bootstrap's default table grants, so even a future RLS mistake
-- cannot open a client write path.
revoke all on public.assistant_actions from anon, authenticated;
grant select on public.assistant_actions to authenticated;
grant all on public.assistant_actions to service_role;
