-- =============================================================================
-- Task 21.7 — the task priority vocabulary
-- =============================================================================
--
-- The ratified schema deliberately carried no priority on `tasks` (20.6 built
-- only what 16.x could describe honestly). 21.7 ratifies the minimal missing
-- vocabulary so the 16.5 card and a future edit control have a real column to
-- read and write.
--
-- Decision (recorded in DATABASE.md §State vocabularies and TASK.md 21.7):
--   - `low` · `medium` · `high`, text + a named CHECK — the same vocabulary
--     policy as every other closed set in this schema (readable errors, cheap
--     to replace in a migration; no enum, no lookup table for three values).
--   - NULL means "no priority set", exactly like `due_date` and
--     `effort_minutes`. There is no `none` sentinel: absence is the absence of
--     a value, so the card's "render only when supplied" rule (16.5) is the
--     same test as `is null` and no UI has to translate a fake level.
--   - No fourth level, no numeric scale, no colour meaning. The card prints
--     the word in the project's mono metadata line; the vocabulary it prints
--     is the vocabulary this constraint enforces.
--
-- No RLS change: the owner-only policies on `tasks` already cover every column
-- of the row, and the column is nullable, so existing rows stay valid.
-- No index: priority is a display field today, not a filter or sort key; if a
-- future task query filters by it, that migration adds the index with the
-- query that needs it.
-- =============================================================================

alter table public.tasks
  add column priority text
    constraint tasks_priority_check
    check (priority in ('low', 'medium', 'high'));

comment on column public.tasks.priority is
  'Optional priority: low | medium | high. NULL = no priority set (16.5 renders only when present).';

-- -----------------------------------------------------------------------------
-- Rollback (reference; the workflow is forward-only)
-- -----------------------------------------------------------------------------
-- Local: `supabase db reset` after removing this file from the chain.
-- Manual: alter table public.tasks drop column priority;  (the constraint and
--   its comment go with the column; no data migration is involved).
