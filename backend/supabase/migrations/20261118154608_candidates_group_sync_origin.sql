-- =============================================================================
-- WhatsApp group sync — the review queue learns about live group candidates
-- =============================================================================
--
-- `integration_candidates` is the existing review queue on `/integrations`
-- (pending → confirmed | rejected, rejection terminal via the unique
-- `(user_id, fingerprint)`). Group-sync items below the confidence threshold,
-- and items that propose a brand-new subject, go through the same queue so the
-- student has ONE place to review. The table was shaped for export runs, so it
-- is generalised additively:
--
--   * run_id        nullable: a live group candidate has no export run.
--                   A check keeps it required for `export` rows.
--   * start_at      nullable for task candidates (an assignment with no
--                   resolvable date is still a useful task); a check keeps it
--                   required for event candidates.
--   * origin        export (default, every existing row) | live_group.
--   * kind          event (default) | task — which table a confirm writes to.
--   * event_type / task_type  the classification the confirm will apply
--                   (`events.type` or `tasks.task_type`).
--   * confidence    the extractor's 0..1 score, shown in the review UI.
--   * subject_id / proposed_subject_name  a matched course, or a NEW course the
--                   model proposed (never created without approval).
--   * source_message_id  the raw message; ON DELETE SET NULL so the 30-day
--                   purge leaves the queue intact. The candidate keeps its own
--                   `message_text` copy of the one reviewed message.
--   * group_name    which group it came from (display only).
--
-- Existing rows are untouched: they take the defaults (origin=export,
-- kind=event) and already satisfy both new checks.
--
-- Rollback (reference; the workflow is forward-only):
--   delete from public.integration_candidates where origin = 'live_group';
--   alter table public.integration_candidates
--     drop constraint integration_candidates_run_required_check,
--     drop constraint integration_candidates_start_required_check;
--   alter table public.integration_candidates
--     alter column run_id set not null, alter column start_at set not null;
--   drop index public.integration_candidates_source_message_id_idx;
--   alter table public.integration_candidates
--     drop column group_name, drop column source_message_id,
--     drop column proposed_subject_name, drop column subject_id,
--     drop column confidence, drop column task_type, drop column event_type,
--     drop column kind, drop column origin;
-- =============================================================================

alter table public.integration_candidates
  alter column run_id drop not null,
  alter column start_at drop not null;

alter table public.integration_candidates
  add column origin text not null default 'export'
    constraint integration_candidates_origin_check
    check (origin in ('export', 'live_group')),
  add column kind text not null default 'event'
    constraint integration_candidates_kind_check
    check (kind in ('event', 'task')),
  add column event_type text
    constraint integration_candidates_event_type_check
    check (event_type is null or event_type in ('class', 'exam', 'deadline')),
  add column task_type text
    constraint integration_candidates_task_type_check
    check (task_type is null or task_type in ('assignment', 'quiz')),
  add column confidence real
    constraint integration_candidates_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column subject_id uuid references public.subjects (id) on delete set null,
  add column proposed_subject_name text
    constraint integration_candidates_proposed_subject_check
    check (proposed_subject_name is null or length(trim(proposed_subject_name)) between 1 and 100),
  add column source_message_id uuid
    references public.raw_messages (id) on delete set null,
  add column group_name text
    constraint integration_candidates_group_name_check
    check (group_name is null or length(group_name) <= 200);

alter table public.integration_candidates
  add constraint integration_candidates_run_required_check
    check (origin = 'live_group' or run_id is not null),
  add constraint integration_candidates_start_required_check
    check (kind = 'task' or start_at is not null);

comment on column public.integration_candidates.origin is
  'export (run-based, default) | live_group (WhatsApp group sync).';
comment on column public.integration_candidates.kind is
  'event | task: which table a confirm writes to.';
comment on column public.integration_candidates.confidence is
  'Extractor confidence 0..1 (group sync); shown in the review UI.';
comment on column public.integration_candidates.proposed_subject_name is
  'A NEW course the model proposed; created only when the owner approves.';
comment on column public.integration_candidates.source_message_id is
  'raw_messages row (group sync). SET NULL on purge; message_text keeps the reviewed copy.';

create index integration_candidates_source_message_id_idx
  on public.integration_candidates (source_message_id);
create index integration_candidates_subject_id_idx
  on public.integration_candidates (subject_id);
