-- 20.9 — usage ledger writes become server-only.
--
-- The ledger backs quotas and cost control (R5) and is audit data: an
-- authenticated client must not be able to write (or rewrite) its own usage.
-- The owner keeps SELECT for their own usage view; the service role (tool
-- runs, AI calls, document processing) performs every write. Notifications and
-- subscriptions already follow the same server-write pattern.
--
-- Rollback:
--   create policy "usage_events_insert_own"
--     on public.usage_events for insert to authenticated
--     with check (auth.uid() = user_id);

drop policy "usage_events_insert_own" on public.usage_events;
