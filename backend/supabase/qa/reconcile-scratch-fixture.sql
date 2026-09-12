-- =============================================================================
-- 20.7 — reconciliation scratch fixture (QA ONLY; never part of migrations)
-- =============================================================================
--
-- Recreates the hosted LEGACY profile shape so the hosted cutover can be
-- validated locally before production is touched. Run it only in a throwaway
-- database (see DATABASE.md §Hosted reconciliation runbook → Local validation),
-- never in the local dev database and never in any shared environment: it
-- creates a legacy `public.profiles` table on purpose.
--
-- The rows below are synthetic (obviously fake names/ids, no real user data).
-- They cover the mapping edge cases: a two-part name, a mononym, a
-- multi-word surname, unknown semester text, blank timezone and both
-- preference key spellings.
-- =============================================================================

create schema if not exists auth;

-- Scratch-only stand-in for Supabase's `auth.uid()` (which reads the request
-- JWT claims). The real one exists in the hosted/local Supabase auth schema;
-- the throwaway database needs it so the ratified policies can be created and
-- the reconciliation applies exactly as it will in production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table auth.users (
  id uuid primary key
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  college text,
  program text,
  semester text,
  timezone text default 'UTC',
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The legacy provisioner, shaped like the hosted one: create a profile row per
-- new auth user.
create function public.provision_legacy_profile()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.provision_legacy_profile();

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');

-- Row 1 — full mapping.
update public.profiles set
  full_name = 'Areeb Khan',
  college = 'UCL',
  program = 'Computer Science',
  semester = 'Semester 2',
  timezone = 'Europe/London',
  preferences = '{"planning_style": "Balanced", "reminder_lead": "1 week before"}'::jsonb
where id = '11111111-1111-1111-1111-111111111111';

-- Row 2 — mononym, numeric semester, no preferences (reminder must default).
update public.profiles set
  full_name = 'Madonna',
  college = 'MIT',
  program = 'Physics',
  semester = '2',
  timezone = 'America/New_York',
  preferences = '{}'::jsonb
where id = '22222222-2222-2222-2222-222222222222';

-- Row 3 — multi-word surname, unmapped semester, blank timezone, camelCase key.
update public.profiles set
  full_name = 'van der Berg',
  college = 'ETH',
  program = 'Maths',
  semester = 'Trimester 3',
  timezone = '',
  preferences = '{"planningStyle": "Deadline-driven"}'::jsonb
where id = '33333333-3333-3333-3333-333333333333';
