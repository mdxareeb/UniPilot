-- =============================================================================
-- Task 22.x — an event's optional course (17.5's "course?")
-- =============================================================================
--
-- 17.5 positions a *class* block, and its requirements name an optional
-- course. The course is the student's own `subjects` row, so an event may
-- reference one: `subject_id uuid` with `on delete set null` — a
-- classification, not ownership, matching the established rule
-- (`tasks.source_document_id`, `events.source_document_id`). Deleting a
-- subject must not delete the student's calendar.
--
-- Cross-user integrity: a plain FK to `subjects(id)` would let a crafted
-- request attach another student's subject id (the row exists, so the FK
-- passes, while RLS only guards `events.user_id`). A `security invoker`
-- trigger closes that: the referenced subject must belong to the event's own
-- user. Running under the caller's role also means RLS on `subjects` scopes
-- the check for authenticated callers, and the explicit `user_id` equality
-- holds for the service role too.
--
-- Index: `subject_id` gets one so "events for this subject" is a lookup
-- rather than a scan once the calendar filters by course.
--
-- The same-user trigger also covers updates: changing `subject_id` or
-- `user_id` re-checks (user_id itself is immutable in practice, but the
-- trigger does not assume it).
-- =============================================================================

alter table public.events
  add column subject_id uuid references public.subjects (id) on delete set null;

comment on column public.events.subject_id is
  'Optional course for the event; must belong to the same user (trigger). SET NULL on subject delete: classification, not ownership.';

create index events_subject_id_idx on public.events (subject_id);

-- The guard: a referenced subject must exist for the event's own user.
-- `security invoker` (the default) keeps RLS applicable for client calls;
-- `search_path = ''` forces fully qualified names.
create or replace function public.ensure_event_subject_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subject_id is not null then
    if not exists (
      select 1
        from public.subjects s
       where s.id = new.subject_id
         and s.user_id = new.user_id
    ) then
      raise exception 'events.subject_id must reference a subject owned by the event user';
    end if;
  end if;
  return new;
end;
$$;

create trigger ensure_event_subject_owner
  before insert or update of subject_id, user_id on public.events
  for each row execute function public.ensure_event_subject_owner();

-- -----------------------------------------------------------------------------
-- Rollback (reference; the workflow is forward-only)
-- -----------------------------------------------------------------------------
-- Local: `supabase db reset` after removing this file from the chain.
-- Manual: drop trigger ensure_event_subject_owner on public.events;
--   drop function public.ensure_event_subject_owner();
--   drop index public.events_subject_id_idx;
--   alter table public.events drop column subject_id;
