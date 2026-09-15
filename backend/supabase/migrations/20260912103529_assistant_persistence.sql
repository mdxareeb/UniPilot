-- =============================================================================
-- Task 26.x — assistant persistence: turn state, sources, ordering, writes
-- =============================================================================
--
-- The assistant's turns need three things the 20.6 schema deliberately did not
-- carry, plus one access decision:
--
-- 1. `messages.status` — a turn can fail after the user's message is already
--    persisted, and the UI must never present a half-written answer as
--    complete. `complete | failed` is the closed vocabulary; a failed assistant
--    message stores sanitized copy in `content` and the status says so. The
--    column defaults to `complete` so every existing/legacy row, and every
--    user message, is correct without a backfill.
--
-- 2. `messages.sources` — the cited workspace chunks for an assistant answer
--    (26.7): an array of `{ documentId, documentName, page, chunkIndex }`
--    objects, or NULL when the answer cites nothing. JSONB because the shape
--    is presentation data owned by the assistant layer, not a relational
--    entity (the chunk rows themselves are relational).
--
-- 3. Ordering indexes — message lists read `(conversation_id, created_at,
--    id)` (deterministic even when two rows share a timestamp), and
--    conversation lists read `(user_id, updated_at desc)` (most recent first).
--
-- 4. Writes become server-only. The matrix previously gave `messages` full
--    owner CRUD through its parent; 26.4 requires that **no client role** can
--    insert — including assistant/system messages the client must never be
--    able to forge. INSERT/UPDATE/DELETE are revoked from `authenticated` (no
--    `anon` grant existed) and the three write policies are dropped. SELECT
--    keeps its parent policy. All writes now run through the server's
--    service-role client, which is the only writer that can be trusted about
--    `role` and `status`.
--
-- Rollback (reference; the workflow is forward-only):
--   grant insert, update, delete on public.messages to authenticated;
--   create policy "messages_insert_owned_parent" on public.messages for insert
--     to authenticated with check (exists (select 1 from public.conversations c
--       where c.id = conversation_id and c.user_id = auth.uid()));
--   ... (update/delete policies likewise)
--   drop index public.conversations_user_updated_idx;
--   drop index public.messages_conversation_created_idx;
--   alter table public.messages drop column sources;
--   alter table public.messages drop column status;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Turn state + cited sources
-- -----------------------------------------------------------------------------

alter table public.messages
  add column status text not null default 'complete'
    constraint messages_status_check
    check (status in ('complete', 'failed'));

comment on column public.messages.status is
  'Task 26.12: complete = the turn finished (or the assistant honestly said it
   was unconfigured); failed = the turn failed and content holds sanitized
   copy. A failed assistant message is never presented as an answer.';

alter table public.messages
  add column sources jsonb;

comment on column public.messages.sources is
  'Task 26.7: assistant answers cite workspace chunks as
   [{ documentId, documentName, page, chunkIndex }]; NULL when nothing was
   cited. Presentation data owned by the assistant layer, not an entity.';

-- -----------------------------------------------------------------------------
-- 2. Ordering indexes
-- -----------------------------------------------------------------------------

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at, id);

create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- 3. Messages become server-write-only (26.4)
-- -----------------------------------------------------------------------------

revoke insert, update, delete on public.messages from authenticated;
drop policy "messages_insert_owned_parent" on public.messages;
drop policy "messages_update_owned_parent" on public.messages;
drop policy "messages_delete_owned_parent" on public.messages;

-- The service role is the only writer now; make the grant explicit rather
-- than relying on the bootstrap default.
grant all on public.messages to service_role;
