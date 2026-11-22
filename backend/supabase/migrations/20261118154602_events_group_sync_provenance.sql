-- =============================================================================
-- WhatsApp group sync — events: a new source and extraction provenance
-- =============================================================================
--
-- Exams, labs and general events extracted from group messages land in
-- `events`. `events` already carries `source` / `source_ref` (46.12), a course
-- (`subject_id`, 22.x) and a `type` vocabulary (`class` | `exam` | `deadline`),
-- so this migration adds only what is missing:
--
--   * source       gains `whatsapp_group`. The existing value `whatsapp` stays
--                  for events confirmed from export/Selenium candidates, so the
--                  two paths remain distinguishable in the calendar.
--   * source_message_id  the raw message the event came from. ON DELETE SET
--                  NULL: provenance, not ownership — the 30-day raw_messages
--                  purge must never delete a calendar entry.
--   * confidence_score   what the extractor believed (0..1).
--
-- No `task_type` column: `events.type` already classifies the row. The mapping
-- the pipeline uses is exam → `exam`, lab → `class`, general event → NULL.
--
-- `lock_event_provenance` is replaced (create or replace) so that the two new
-- columns are server-only as well. It still resets provenance for every
-- caller that is not the service role.
--
-- Rollback (reference; the workflow is forward-only):
--   -- restore the 46.12 body of lock_event_provenance() and its trigger
--   --   (before insert or update of source, source_ref), then:
--   delete from public.events where source = 'whatsapp_group';
--   alter table public.events drop constraint events_source_check;
--   alter table public.events add constraint events_source_check
--     check (source in ('manual', 'whatsapp'));
--   drop index public.events_source_message_id_idx;
--   alter table public.events
--     drop column confidence_score, drop column source_message_id;
-- =============================================================================

alter table public.events drop constraint events_source_check;
alter table public.events
  add constraint events_source_check
  check (source in ('manual', 'whatsapp', 'whatsapp_group'));

alter table public.events
  add column source_message_id uuid
    references public.raw_messages (id) on delete set null,
  add column confidence_score real
    constraint events_confidence_score_check
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1));

comment on column public.events.source is
  'Provenance: manual | whatsapp (export/Selenium) | whatsapp_group (live group sync). Server-only; a trigger forces manual for non-service-role callers.';
comment on column public.events.source_message_id is
  'The raw_messages row this event was extracted from. SET NULL on purge: provenance, not ownership.';
comment on column public.events.confidence_score is
  'Extractor confidence 0..1 for whatsapp_group rows; NULL otherwise.';

create index events_source_message_id_idx on public.events (source_message_id);

create or replace function public.lock_event_provenance()
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
  end if;
  return new;
end;
$$;

comment on function public.lock_event_provenance() is
  'Task 46.12 + group sync: forces manual provenance for every non-service-role caller.';

drop trigger lock_event_provenance on public.events;
create trigger lock_event_provenance
  before insert or update of source, source_ref, source_message_id, confidence_score
  on public.events
  for each row execute function public.lock_event_provenance();

revoke all on function public.lock_event_provenance() from public, anon, authenticated;
