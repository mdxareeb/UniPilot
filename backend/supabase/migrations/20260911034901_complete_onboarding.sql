-- =============================================================================
-- Task 13.10 — complete onboarding atomically
-- =============================================================================
--
-- Onboarding persistence has two writes that must agree: the profile answers
-- (plus the completion stamp) and the replacement of the student's subject set.
-- PostgREST has no client-side transaction, so the whole operation lives in one
-- `security invoker` function: the profile upsert, the subject replacement and
-- `onboarding_completed_at` either all commit or none do. A failure can never
-- leave a half-saved profile marked complete.
--
-- Invoker, not definer: the function runs as the calling `authenticated` role,
-- so the existing owner-only RLS policies on `profiles` and `subjects` are the
-- enforcement layer. `auth.uid()` is the only user the function can write, and
-- a guest (or a missing profile row) raises instead of silently succeeding.
--
-- Idempotent by construction: `onboarding_completed_at` is only stamped when it
-- is still NULL (`coalesce`), and the subject set is replaced rather than
-- appended, so a repeated submission — a double click, a retry after a timeout,
-- a replayed request — cannot duplicate rows or move the original completion
-- time. The function still folds the profile answers, so a retry after a failed
-- first attempt stores what the student actually submitted.
--
-- Server-side normalization repeats the parts the unique constraint cannot
-- express (trim, case-insensitive de-duplication of names, drop blanks) so a
-- direct RPC call is held to the same invariant as the UI. Closed vocabularies
-- (`planning_style`, `reminder_lead`, year/semester ranges) stay enforced by the
-- named CHECK constraints from the init migration.
-- =============================================================================

create or replace function public.complete_onboarding(
  p_first_name text,
  p_last_name text,
  p_institution text,
  p_course_program text,
  p_academic_year smallint,
  p_semester smallint,
  p_planning_style text,
  p_reminder_lead text,
  p_subjects text[] default '{}'
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_completed_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'complete_onboarding requires an authenticated user';
  end if;

  -- 1. Profile: fill the answers and stamp completion exactly once. The
  --    `returning` + `not found` pair is the "profile must exist" guard: the
  --    auth.users trigger provisions every profile, so a missing row is a
  --    broken invariant and an exception — not a silent no-op that would
  --    return a completion time for a write that never happened.
  update public.profiles
     set first_name = p_first_name,
         last_name = p_last_name,
         institution = p_institution,
         course_program = p_course_program,
         academic_year = p_academic_year,
         semester = p_semester,
         planning_style = p_planning_style,
         reminder_lead = p_reminder_lead,
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = auth.uid()
   returning onboarding_completed_at into v_completed_at;

  if not found then
    raise exception 'complete_onboarding: no profile for the authenticated user';
  end if;

  -- 2. Subjects: replace the set. Delete-then-insert is the transaction-safe
  --    form of "these are my subjects now" — no stale row can survive, and a
  --    repeated call rebuilds the identical set without duplicate names. The
  --    derived table trims, drops blanks and keeps one spelling per
  --    case-insensitive name, the same rule the onboarding step applies.
  delete from public.subjects
   where user_id = auth.uid();

  insert into public.subjects (user_id, name)
  select auth.uid(), normalized.name
    from (
      select distinct on (lower(trim(candidate.name)))
             trim(candidate.name) as name
        from unnest(coalesce(p_subjects, '{}'::text[])) as candidate(name)
       where length(trim(candidate.name)) > 0
       order by lower(trim(candidate.name)), trim(candidate.name)
    ) as normalized;

  return v_completed_at;
end;
$$;

comment on function public.complete_onboarding(
  text, text, text, text, smallint, smallint, text, text, text[]
) is
  'Task 13.10: upserts the onboarding profile, replaces the subject set and
   stamps onboarding_completed_at once (coalesce) in a single transaction.
   Security invoker: RLS owner policies on profiles/subjects are the guard.';

-- Only signed-in students may call it. Revoking the default PUBLIC grant keeps
-- `anon` and unrelated roles out; the auth.uid() check above is the second
-- layer. No table grants change here.
revoke all on function public.complete_onboarding(
  text, text, text, text, smallint, smallint, text, text, text[]
) from public;
grant execute on function public.complete_onboarding(
  text, text, text, text, smallint, smallint, text, text, text[]
) to authenticated;

-- -----------------------------------------------------------------------------
-- Rollback (reference; the workflow is forward-only)
-- -----------------------------------------------------------------------------
-- Local: `supabase db reset` after removing this file from the chain.
-- Manual: drop function public.complete_onboarding(text, text, text, text,
--   smallint, smallint, text, text, text[]); no data was added by this
--   migration, so no row backfill is required.
