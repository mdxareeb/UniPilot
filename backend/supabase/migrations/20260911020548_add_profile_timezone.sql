-- 20.7 — add the ratified `profiles.timezone` column.
--
-- Decision: keep the legacy timezone value as a first-class column rather than
-- dropping it. R15 requires one timezone strategy; the value already exists in
-- the hosted data and the calendar (17.x) will need it. It is an IANA name
-- (e.g. "Europe/London"), never a UTC offset: offsets break twice a year,
-- names do not. NOT NULL default 'UTC' matches the legacy hosted default, so
-- every row — including trigger-provisioned ones — has a usable value.
--
-- Backfill of the legacy value into this column is the next migration
-- (20260911020549), guarded to run only where the legacy table exists.
--
-- Rollback: `alter table public.profiles drop column timezone;`

alter table public.profiles
  add column timezone text not null default 'UTC';

comment on column public.profiles.timezone is
  'IANA timezone name (R15), e.g. Europe/London; default UTC.';
