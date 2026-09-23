-- =============================================================================
-- Task 27.13 (T27-D) — the safe retry anchor (`tasks`/`events.source_action_id`)
-- =============================================================================
--
-- The 27.x executor settles each action's log row exactly once, but a crash
-- between the claim (`proposed → confirmed`) and the settle leaves the row
-- `confirmed` while the created task/event already exists. Without a link back
-- from the created row to the action, a retry could only answer "unavailable"
-- and the user would be left with a row nobody can name.
--
-- `source_action_id` is that link, and the partial unique index is the
-- schema-level half of 27.13's no-double-create promise: at most one task and
-- at most one event per user can ever carry the same action id, so a retried
-- confirmation (or two racing ones) cannot insert a second row — the insert
-- fails the unique index instead of silently duplicating.
--
-- Design decisions:
--
-- * `on delete set null`: the anchor is provenance, like
--   `source_document_id` — deleting the action row (or the conversation that
--   cascades it) must never delete the task/event the user already has.
-- * The indexes are partial (`where source_action_id is not null`): rows
--   without an anchor (every manually created task/event) do not participate,
--   and each index doubles as the retry lookup's access path for
--   `(user_id, source_action_id)`.
-- * Only the service-side executor writes the column; the manual create
--   actions never accept it from a client payload, so there is no client write
--   path to it.
--
-- Rollback (reference; the workflow is forward-only):
--   drop index public.tasks_user_source_action_id_key;
--   alter table public.tasks drop column source_action_id;
--   drop index public.events_user_source_action_id_key;
--   alter table public.events drop column source_action_id;
-- =============================================================================

alter table public.tasks
  add column source_action_id uuid
    references public.assistant_actions (id) on delete set null;

alter table public.events
  add column source_action_id uuid
    references public.assistant_actions (id) on delete set null;

comment on column public.tasks.source_action_id is
  'Task 27.13: the assistant action whose confirmation created this task.
   Provenance, not ownership (SET NULL); the partial unique index makes a
   crashed confirmation''s retry unable to create a second row.';
comment on column public.events.source_action_id is
  'Task 27.13: the assistant action whose confirmation created this event
   (see tasks.source_action_id).';

create unique index tasks_user_source_action_id_key
  on public.tasks (user_id, source_action_id)
  where source_action_id is not null;

create unique index events_user_source_action_id_key
  on public.events (user_id, source_action_id)
  where source_action_id is not null;
