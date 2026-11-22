-- Google Calendar integration: the idempotent gcal.sync enqueue RPC.
-- =============================================================================
--
-- enqueue_gcal_sync(p_user_id):
--   * false when the user has no connected google connection row (the
--     caller's honest "not connected");
--   * false while a live gcal.sync job for the same user exists (a retry of
--     the caller - a double-tapped Sync Now - must not double-enqueue);
--   * otherwise one jobs row, ids-only payload { userId }.
--
-- Service role only, security definer, search_path = '' - the whatsapp
-- enqueue_raw_message_extraction pattern.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.enqueue_gcal_sync(uuid);
-- =============================================================================

create or replace function public.enqueue_gcal_sync(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return false;
  end if;

  if not exists (
    select 1 from public.integration_connections c
     where c.user_id = p_user_id
       and c.provider = 'google'
       and c.status = 'connected'
  ) then
    return false;
  end if;

  -- One live job per user: a second request while one runs is a no-op.
  if exists (
    select 1 from public.jobs j
     where j.kind = 'gcal.sync'
       and j.status in ('queued', 'running')
       and j.user_id = p_user_id
  ) then
    return false;
  end if;

  insert into public.jobs (user_id, kind, payload)
  values (
    p_user_id,
    'gcal.sync',
    jsonb_build_object('userId', p_user_id)
  );
  return true;
end;
$$;

comment on function public.enqueue_gcal_sync(uuid) is
  'Google Calendar sync: queues one ids-only gcal.sync job for a connected user. Idempotent while a live job exists. Service role only.';

revoke all on function public.enqueue_gcal_sync(uuid) from public, anon, authenticated;

grant execute on function public.enqueue_gcal_sync(uuid) to service_role;
