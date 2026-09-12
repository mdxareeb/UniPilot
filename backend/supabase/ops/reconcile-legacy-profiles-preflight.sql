-- =============================================================================
-- 20.7 — hosted reconciliation PREFLIGHT (reviewed manual step, not a migration)
-- =============================================================================
--
-- Run against the HOSTED project ONLY after explicit founder approval, inside
-- the maintenance window described in DATABASE.md §Hosted reconciliation
-- runbook, and only on top of a fresh pre-push dump.
--
-- Why this is not a migration: it must happen BEFORE the init migration can
-- create the ratified `public.profiles` on a database that already has the
-- legacy table. Keeping it out of `supabase/migrations/` keeps the normal
-- local chain a pure forward-create path while the hosted cutover stays an
-- explicit, reviewed operator step.
--
-- Effects, in order:
--   1. Confirms the legacy shape (a `full_name` column) and refuses to run
--      twice (`profiles_legacy` already present).
--   2. Drops every non-internal trigger on `auth.users` — on the hosted project
--      the legacy profile provisioner is the only one, and every dropped name
--      is printed as a NOTICE for the operator to review.
--   3. Renames `public.profiles` to `public.profiles_legacy`.
--
-- After this: apply the migration chain. `20260911011824_init_schema.sql`
-- creates the ratified schema, `..._add_profile_timezone.sql` adds the timezone
-- column, and `..._backfill_legacy_profiles.sql` copies the rows across and
-- drops the legacy table.
--
-- Rollback: restore the pre-push dump. This file changes DDL and is not
-- itself reversible without the dump.
-- =============================================================================

do $$
declare
  trigger_row record;
  legacy_shape boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'full_name'
  ) into legacy_shape;

  if not legacy_shape then
    raise notice 'preflight: public.profiles is not in the legacy shape; nothing to do';
    return;
  end if;

  if to_regclass('public.profiles_legacy') is not null then
    raise exception
      'preflight: public.profiles_legacy already exists; resolve manually before re-running';
  end if;

  for trigger_row in
    select t.tgname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
  loop
    raise notice 'preflight: dropping trigger % on auth.users', trigger_row.tgname;
    execute format('drop trigger %I on auth.users', trigger_row.tgname);
  end loop;

  alter table public.profiles rename to profiles_legacy;
  raise notice 'preflight: renamed public.profiles to public.profiles_legacy';
end $$;
