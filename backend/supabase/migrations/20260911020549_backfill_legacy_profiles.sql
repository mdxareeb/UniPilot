-- 20.7 — backfill the hosted legacy `profiles_legacy` into the ratified shape.
--
-- This migration runs in the hosted reconciliation sequence only. On a fresh
-- local database (and on any database that never had the legacy shape) there is
-- no `public.profiles_legacy` table, so the block is a no-op — which is what
-- makes the reconciliation migration safe to keep in the normal chain.
--
-- Hosted sequence (see DATABASE.md §Hosted reconciliation runbook):
--   1. pre-push dump (the rollback archive)
--   2. supabase/ops/reconcile-legacy-profiles-preflight.sql  (rename + drop the
--      legacy auth.users provisioner)
--   3. apply this migration chain (init → timezone → this backfill)
--
-- Mapping decisions, and where ambiguity is unavoidable:
--   full_name → first_name + last_name  best-effort split on the first space.
--       A mononym leaves last_name NULL; a multi-word surname
--       ("van der Berg") puts everything after the first word in last_name.
--       The split cannot be reversed, so the pre-push dump is kept as the
--       record of the original string.
--   college → institution, program → course_program (same meaning, ratified
--       names).
--   semester text → smallint 1–2. Known spellings map; anything else is NULL
--       and is counted in the post-migration verification.
--   academic_year: does not exist in the legacy shape → NULL (13.10 collects
--       it going forward).
--   preferences jsonb → planning_style / reminder_lead. Known keys/values map
--       case-insensitively; reminder_lead falls back to the onboarding default
--       '3_days' ("3 days before"), planning_style stays NULL when absent.
--   timezone → the ratified column, defaulting to 'UTC' when blank.
--   onboarding_completed_at: no legacy marker exists (audited in
--       AUTH_ARCHITECTURE.md) → NULL, so no one is falsely marked complete.
--
-- Rollback: restore the pre-push dump (this migration drops the legacy table;
-- the dump is the archive, not a second copy in the schema).

-- The block is wrapped in a DO so the guard can return early. The table is
-- locked for the duration so no row can arrive between the copy and the drop.
do $$
begin
  if to_regclass('public.profiles_legacy') is null then
    raise notice 'backfill: no public.profiles_legacy table; nothing to reconcile';
    return;
  end if;

  lock table public.profiles_legacy in access exclusive mode;

  insert into public.profiles (
    id,
    first_name,
    last_name,
    institution,
    course_program,
    academic_year,
    semester,
    planning_style,
    reminder_lead,
    timezone,
    onboarding_completed_at,
    created_at,
    updated_at
  )
  select
    legacy.id,
    nullif(split_part(trim(coalesce(legacy.full_name, '')), ' ', 1), ''),
    nullif(
      trim(
        substr(
          trim(coalesce(legacy.full_name, '')),
          length(split_part(trim(coalesce(legacy.full_name, '')), ' ', 1)) + 1
        )
      ),
      ''
    ),
    nullif(trim(coalesce(legacy.college, '')), ''),
    nullif(trim(coalesce(legacy.program, '')), ''),
    null, -- academic_year does not exist in the legacy shape
    case lower(trim(coalesce(legacy.semester, '')))
      when '1' then 1
      when 'semester 1' then 1
      when 'sem 1' then 1
      when 's1' then 1
      when '2' then 2
      when 'semester 2' then 2
      when 'sem 2' then 2
      when 's2' then 2
      else null
    end,
    case lower(coalesce(
      legacy.preferences ->> 'planning_style',
      legacy.preferences ->> 'planningStyle'
    ))
      when 'steady' then 'steady'
      when 'balanced' then 'balanced'
      when 'deadline-driven' then 'deadline_driven'
      when 'deadline_driven' then 'deadline_driven'
      else null
    end,
    coalesce(
      case lower(coalesce(
        legacy.preferences ->> 'reminder_lead',
        legacy.preferences ->> 'reminderLead'
      ))
        when '1_day' then '1_day'
        when '1 day before' then '1_day'
        when '3_days' then '3_days'
        when '3 days before' then '3_days'
        when '1_week' then '1_week'
        when '1 week before' then '1_week'
        else null
      end,
      '3_days'
    ),
    coalesce(nullif(trim(legacy.timezone), ''), 'UTC'),
    null, -- no legacy completion marker; must not be marked complete
    coalesce(legacy.created_at, now()),
    coalesce(legacy.updated_at, now())
  from public.profiles_legacy as legacy
  on conflict (id) do nothing;

  drop table public.profiles_legacy;
  raise notice 'backfill: legacy profiles reconciled and dropped';
end $$;
