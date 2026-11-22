-- =============================================================================
-- WhatsApp group sync — atomic, idempotent message ingestion
-- =============================================================================
--
-- The bridge hands captured messages to the database in batches. One definer
-- function does the whole step so it cannot half-happen:
--
--   ingest_raw_messages(p_user_id, p_rows jsonb)
--     * inserts into `raw_messages` ... ON CONFLICT DO NOTHING. That single
--       clause covers BOTH unique constraints, `(user_id, fingerprint)` and
--       `(user_id, group_jid, whatsapp_msg_id)`, so a redelivered message, a
--       history replay or a re-sync can never create a second row;
--     * only for groups that are CURRENTLY ACTIVE for that user. The bridge
--       already filters, but the privacy rule ("ignore every chat unless the
--       owner switched it on") is enforced here too, so a bridge bug cannot
--       ingest an unmonitored group;
--     * enqueues one ids-only `whatsapp.extract` job per NEW text message in
--       the same statement, so a row can never exist without its job. Media
--       messages are enqueued later by `enqueue_raw_message_extraction`, once
--       the file is safely in Storage;
--     * stamps `monitored_groups.last_synced_at`;
--     * returns only the rows it actually inserted (the bridge needs them to
--       capture attachments, and a duplicate must not trigger a second
--       download).
--
--   enqueue_raw_message_extraction(p_user_id, p_message_id)
--     queues the extraction job for an owned, still-`queued` message unless a
--     live job for it already exists.
--
-- Both are service-role only, `security definer`, `search_path = ''`, with
-- EXECUTE revoked from `public`/`anon`/`authenticated` before the grant.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.enqueue_raw_message_extraction(uuid, uuid);
--   drop function public.ingest_raw_messages(uuid, jsonb);
-- =============================================================================

create or replace function public.ingest_raw_messages(
  p_user_id uuid,
  p_rows jsonb
)
returns table (
  message_id uuid,
  whatsapp_msg_id text,
  group_jid text,
  media_type text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'ingest_raw_messages requires a user';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'ingest_raw_messages expects a JSON array';
  end if;

  return query
  with incoming as (
    select r.value as v from jsonb_array_elements(p_rows) as r(value)
  ),
  inserted as (
    insert into public.raw_messages as m (
      user_id, group_jid, whatsapp_msg_id, fingerprint, sender_name,
      sent_at, raw_text, media_type, file_sha256, status
    )
    select
      p_user_id,
      i.v ->> 'group_jid',
      i.v ->> 'whatsapp_msg_id',
      i.v ->> 'fingerprint',
      coalesce(i.v ->> 'sender_name', ''),
      (i.v ->> 'sent_at')::timestamptz,
      coalesce(i.v ->> 'raw_text', ''),
      coalesce(i.v ->> 'media_type', 'none'),
      nullif(i.v ->> 'file_sha256', ''),
      coalesce(i.v ->> 'status', 'queued')
    from incoming i
    join public.monitored_groups g
      on g.user_id = p_user_id
     and g.group_jid = i.v ->> 'group_jid'
     and g.is_active
    on conflict do nothing
    returning m.id, m.group_jid, m.whatsapp_msg_id, m.media_type, m.status
  ),
  queued_jobs as (
    insert into public.jobs (user_id, kind, payload)
    select p_user_id, 'whatsapp.extract', jsonb_build_object('rawMessageId', x.id)
    from inserted x
    where x.status = 'queued' and x.media_type = 'none'
    returning 1
  ),
  touched as (
    update public.monitored_groups g
       set last_synced_at = now()
     where g.user_id = p_user_id
       and g.group_jid in (select y.group_jid from inserted y)
    returning 1
  )
  select x.id, x.whatsapp_msg_id, x.group_jid, x.media_type, x.status
    from inserted x;
end;
$$;

comment on function public.ingest_raw_messages(uuid, jsonb) is
  'WhatsApp group sync: idempotent batch insert into raw_messages for ACTIVE groups only, with one whatsapp.extract job per new text message. Returns only the rows inserted. Service role only.';

create or replace function public.enqueue_raw_message_extraction(
  p_user_id uuid,
  p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.raw_messages m
     where m.id = p_message_id
       and m.user_id = p_user_id
       and m.status = 'queued'
  ) then
    return false;
  end if;

  -- One live job per message: a retry of the caller must not double-enqueue.
  if exists (
    select 1 from public.jobs j
     where j.kind = 'whatsapp.extract'
       and j.status in ('queued', 'running')
       and j.payload ->> 'rawMessageId' = p_message_id::text
  ) then
    return false;
  end if;

  insert into public.jobs (user_id, kind, payload)
  values (
    p_user_id,
    'whatsapp.extract',
    jsonb_build_object('rawMessageId', p_message_id)
  );
  return true;
end;
$$;

comment on function public.enqueue_raw_message_extraction(uuid, uuid) is
  'WhatsApp group sync: queues the extraction job for an owned, still-queued message (used after a file is stored). Idempotent while a live job exists. Service role only.';

revoke all on function public.ingest_raw_messages(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_raw_message_extraction(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.ingest_raw_messages(uuid, jsonb) to service_role;
grant execute on function public.enqueue_raw_message_extraction(uuid, uuid) to service_role;
