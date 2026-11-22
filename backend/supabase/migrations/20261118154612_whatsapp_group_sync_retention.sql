-- =============================================================================
-- WhatsApp group sync — 30-day retention for raw message text
-- =============================================================================
--
-- `raw_messages` holds the text of group messages the student opted into. It is
-- an input to extraction, not an archive: rows older than 30 days are deleted.
-- Every extracted task, event, document and review candidate references the
-- message with ON DELETE SET NULL, so the purge removes the raw text and
-- nothing the student actually uses.
--
-- `purge_expired_raw_messages(p_user_id)` is service-role only. The bridge and
-- the Integrations read path call it best-effort (the same posture as the
-- 30-day `integration_messages` purge); passing NULL purges every user.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.purge_expired_raw_messages(uuid, integer);
-- =============================================================================

create or replace function public.purge_expired_raw_messages(
  p_user_id uuid default null,
  p_retention_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.raw_messages m
   where m.created_at < now() - make_interval(days => greatest(coalesce(p_retention_days, 30), 1))
     and (p_user_id is null or m.user_id = p_user_id);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_expired_raw_messages(uuid, integer) is
  'WhatsApp group sync: deletes raw_messages older than the retention window (default 30 days). Extracted rows survive (ON DELETE SET NULL). Service role only.';

revoke all on function public.purge_expired_raw_messages(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_raw_messages(uuid, integer)
  to service_role;
