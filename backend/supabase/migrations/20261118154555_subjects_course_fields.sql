-- =============================================================================
-- WhatsApp group sync — subjects become the matching target for group messages
-- =============================================================================
--
-- `subjects` is already the student's course list (onboarding writes it, events
-- reference it). The group-sync pipeline needs three more facts to sort a
-- message into the right course without inventing a second table:
--
--   * course_code  — "CS301", "MATH-201": the strongest deterministic signal.
--   * color_tag    — an optional, short UI tag. A plain slug, not a colour
--                    system: the design language is monochrome and the closed
--                    vocabulary lives in the UI layer, not in the database.
--   * aliases      — nicknames the class actually uses ("DSA", "algo"),
--                    matched case-insensitively and whitespace-normalised.
--
-- All three are optional and additive: existing rows and the onboarding RPC
-- are unaffected. The subjects RLS policies and the owner-CRUD grants already
-- cover new columns (table-level grants), so no policy change is needed.
--
-- Rollback (reference; the workflow is forward-only):
--   drop index public.subjects_user_course_code_key;
--   alter table public.subjects
--     drop column aliases, drop column color_tag, drop column course_code;
-- =============================================================================

alter table public.subjects
  add column course_code text
    constraint subjects_course_code_check
    check (course_code is null or (length(trim(course_code)) between 1 and 32)),
  add column color_tag text
    constraint subjects_color_tag_check
    check (color_tag is null or (length(trim(color_tag)) between 1 and 32)),
  add column aliases text[] not null default '{}'
    constraint subjects_aliases_check
    check (cardinality(aliases) <= 10);

comment on column public.subjects.course_code is
  'Optional course code (e.g. CS301); the strongest deterministic match for group messages. Unique per user, case-insensitive.';
comment on column public.subjects.color_tag is
  'Optional short UI tag (slug). The palette itself lives in the design system, not here.';
comment on column public.subjects.aliases is
  'Up to 10 nicknames used to match group messages to this subject (case-insensitive).';

create unique index subjects_user_course_code_key
  on public.subjects (user_id, lower(course_code))
  where course_code is not null;
