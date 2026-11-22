-- =============================================================================
-- WhatsApp group sync — tasks gain a course and honest provenance
-- =============================================================================
--
-- Assignments and quizzes extracted from group messages land in `tasks`
-- (exams, labs and events land in `events`; see the next migration). Four things
-- are added, all additive:
--
--   * subject_id       the task's course. `tasks` had no course link at all; a
--                      plain FK would let a crafted request attach another
--                      student's subject, so the same-user trigger from
--                      20260911164428_add_events_subject.sql is repeated here.
--   * source/source_ref  provenance, mirroring `events` (46.12): `manual` or
--                      `whatsapp_group`, plus a detector fingerprint. The
--                      unique (user_id, source, source_ref) index is the
--                      dedupe key — a re-sync can never create a second task.
--   * source_message_id  the raw message the task came from. ON DELETE SET
--                      NULL: it is provenance, not ownership, so the 30-day
--                      raw_messages purge never deletes a deadline.
--   * confidence_score / task_type  what the extractor believed and how it
--                      classified the item (`assignment` | `quiz`).
--
-- Provenance is server-only. A `security invoker` trigger resets every
-- provenance column for any caller that is not the service role, exactly like
-- `lock_event_provenance` does for events, so a client can never forge a
-- "from WhatsApp" marker or a confidence score.
--
-- Rollback (reference; the workflow is forward-only):
--   drop trigger lock_task_provenance on public.tasks;
--   drop function public.lock_task_provenance();
--   drop trigger ensure_task_subject_owner on public.tasks;
--   drop function public.ensure_task_subject_owner();
--   drop index public.tasks_user_source_ref_key;
--   drop index public.tasks_subject_id_idx;
--   drop index public.tasks_source_message_id_idx;
--   alter table public.tasks
--     drop column task_type, drop column confidence_score,
--     drop column source_message_id, drop column source_ref,
--     drop column source, drop column subject_id;
-- =============================================================================

alter table public.tasks
  add column subject_id uuid references public.subjects (id) on delete set null,
  add column source text not null default 'manual'
    constraint tasks_source_check check (source in ('manual', 'whatsapp_group')),
  add column source_ref text,
  add column source_message_id uuid
    references public.raw_messages (id) on delete set null,
  add column confidence_score real
    constraint tasks_confidence_score_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  add column task_type text
    constraint tasks_task_type_check
    check (task_type is null or task_type in ('assignment', 'quiz'));

comment on column public.tasks.subject_id is
  'Optional course; must belong to the same user (trigger). SET NULL on subject delete: classification, not ownership.';
comment on column public.tasks.source is
  'Provenance: manual | whatsapp_group. Server-only; a trigger forces manual for non-service-role callers.';
comment on column public.tasks.source_ref is
  'Detector fingerprint for whatsapp_group rows; NULL for manual rows.';
comment on column public.tasks.source_message_id is
  'The raw_messages row this task was extracted from. SET NULL on purge: provenance, not ownership.';
comment on column public.tasks.confidence_score is
  'Extractor confidence 0..1 for whatsapp_group rows; NULL for manual rows.';
comment on column public.tasks.task_type is
  'assignment | quiz for extracted tasks; NULL for manual rows.';

create index tasks_subject_id_idx on public.tasks (subject_id);
create index tasks_source_message_id_idx on public.tasks (source_message_id);

create unique index tasks_user_source_ref_key
  on public.tasks (user_id, source, source_ref);

-- The same-user guard for subject_id (copy of ensure_event_subject_owner).
create or replace function public.ensure_task_subject_owner()
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
      raise exception 'tasks.subject_id must reference a subject owned by the task user';
    end if;
  end if;
  return new;
end;
$$;

create trigger ensure_task_subject_owner
  before insert or update of subject_id, user_id on public.tasks
  for each row execute function public.ensure_task_subject_owner();

-- Provenance is server-only: reset it for every caller that is not the
-- service role.
create or replace function public.lock_task_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
    new.source_message_id := null;
    new.confidence_score := null;
    new.task_type := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_task_provenance() is
  'WhatsApp group sync: forces manual provenance for every non-service-role caller (mirror of lock_event_provenance).';

create trigger lock_task_provenance
  before insert or update of source, source_ref, source_message_id, confidence_score, task_type
  on public.tasks
  for each row execute function public.lock_task_provenance();

revoke all on function public.ensure_task_subject_owner() from public, anon, authenticated;
revoke all on function public.lock_task_provenance() from public, anon, authenticated;
