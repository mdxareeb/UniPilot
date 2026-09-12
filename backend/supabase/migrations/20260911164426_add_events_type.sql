-- =============================================================================
-- Task 22.6 — the event type vocabulary
-- =============================================================================
--
-- The calendar's blocks are typed: 17.5 renders class blocks, 17.6 exams and
-- 17.7 deadlines. The ratified schema deliberately carried no type (20.6 built
-- only what 16.x/17.x could describe honestly without a data layer), so this
-- migration ratifies the closed set those three blocks name.
--
-- Decision (recorded in DATABASE.md §State vocabularies and TASK.md 22.6):
--   - `class` · `exam` · `deadline`, text + a named CHECK — the same
--     vocabulary policy as every other closed set here (readable errors,
--     cheap to replace; no enum, no lookup table for three values).
--   - NULL means "a plain event with no category" (a study session, a meeting
--     reminder). There is no `other` sentinel: absence is the absence of a
--     value, so a block's "render the type treatment only when supplied" rule
--     is one `is null` test. The calendar legend (17.8) lists the three
--     category treatments, not a fourth for NULL.
--
-- No RLS change: the owner-only policies on `events` are row-wide. No index:
-- type is a display/grouping field, not a query key; if a future view filters
-- by it, that migration adds the index with the query that needs it.
-- =============================================================================

alter table public.events
  add column type text
    constraint events_type_check
    check (type in ('class', 'exam', 'deadline'));

comment on column public.events.type is
  'Optional category: class | exam | deadline. NULL = a plain event with no category.';

-- -----------------------------------------------------------------------------
-- Rollback (reference; the workflow is forward-only)
-- -----------------------------------------------------------------------------
-- Local: `supabase db reset` after removing this file from the chain.
-- Manual: alter table public.events drop column type;  (constraint and comment
--   go with it; no data migration involved).
