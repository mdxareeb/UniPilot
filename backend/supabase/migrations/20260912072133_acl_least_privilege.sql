-- =============================================================================
-- Task 24.x step 0 — ACL audit: least privilege for the public schema
-- =============================================================================
--
-- The 29.1 jobs finding (Supabase's bootstrap grants EXECUTE on new functions
-- and ALL on new tables *directly* to `anon`/`authenticated`, so a PUBLIC
-- revoke is not enough) prompted a full audit of the local schema against the
-- DATABASE.md RLS matrix. Findings, all fixed here:
--
-- 1. Every public table carried the bootstrap's `MAINTAIN`, `REFERENCES`,
--    `TRIGGER` and `TRUNCATE` grants for `authenticated`. `TRUNCATE` is the
--    dangerous one: it is NOT subject to RLS, so a session that could reach
--    Postgres directly could empty any table regardless of policy. The other
--    three are structural (DDL-adjacent) and nothing in the product needs
--    them. All four are revoked from `anon` and `authenticated` on every
--    table in the schema.
--
-- 2. Five tables carried write grants with no policy behind them (dead but
--    over-exposed). They are revoked to match the matrix exactly:
--      - usage_events: no client write policy (server ledger)  → revoke I/U/D
--      - subscriptions: billing service role only              → revoke I/U/D
--      - notifications: no client INSERT (server writes)       → revoke INSERT
--      - profiles: no DELETE policy (cascade with auth user)   → revoke DELETE
--      - tool_runs: run history is not erasable                → revoke DELETE
--
-- 3. Four functions carried EXECUTE for `anon`/`authenticated` from the
--    bootstrap. `complete_onboarding` is intentionally callable by
--    `authenticated` (security invoker, RLS-guarded) but never by `anon`;
--    the three trigger functions (`handle_new_user`, `set_updated_at`,
--    `ensure_event_subject_owner`) are only ever run by their triggers and
--    EXECUTE is not required for that, so both client roles lose it.
--
-- What the audit deliberately left alone: the matrix's intended DML grants
-- (owner CRUD for subjects/tasks/events/documents/chunks/conversations/
-- messages/notifications/tool_runs, owner SELECT for jobs/usage_events/
-- subscriptions) and the RLS policies themselves. `anon` had no table grants
-- already (the init migration revoked them); this migration removes the
-- remaining structural/write over-hangs and the trigger-function EXECUTE.
--
-- Verified after apply (psql): tables grant `authenticated` only
-- SELECT/INSERT/UPDATE/DELETE as the matrix allows; no `anon` table grants;
-- function ACLs are owner + `service_role` only (plus `authenticated` on
-- `complete_onboarding`, minus `anon`).
--
-- Rollback (reference; the workflow is forward-only):
--   grant truncate, references, trigger, maintain on all tables in schema
--     public to anon, authenticated;  -- restores the bootstrap posture only
--   grant execute on function public.handle_new_user() to anon, authenticated;
--   ... (the audit should not be rolled back; this note is for completeness)
-- =============================================================================

-- 1. Structural privileges — never needed by the client roles.
revoke maintain, references, trigger, truncate
  on all tables in schema public
  from anon, authenticated;

-- 2. Write grants with no policy: align the ACL with the matrix.
revoke insert, update, delete on public.usage_events from authenticated;
revoke insert, update, delete on public.subscriptions from authenticated;
revoke insert on public.notifications from authenticated;
revoke delete on public.profiles from authenticated;
revoke delete on public.tool_runs from authenticated;

-- 3. Function EXECUTE.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.set_updated_at() from anon, authenticated;
revoke execute on function public.ensure_event_subject_owner()
  from anon, authenticated;
revoke execute on function public.complete_onboarding(
  text, text, text, text, smallint, smallint, text, text, text[]
) from anon;
