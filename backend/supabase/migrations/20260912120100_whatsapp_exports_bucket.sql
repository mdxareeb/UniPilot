-- =============================================================================
-- Task 46.12 — the private whatsapp-exports bucket (spec §6.7, D2)
-- =============================================================================
--
-- text/plain only, 25 MiB (same cap as documents), private; owner-folder RLS
-- keyed on `(storage.foldername(name))[1] = auth.uid()::text`.
--
-- Rollback (reference; forward-only): delete objects, drop the four policies,
-- delete from storage.buckets where id = 'whatsapp-exports'.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-exports', 'whatsapp-exports', false, 26214400, array['text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "whatsapp_exports_objects_select_own" on storage.objects;
create policy "whatsapp_exports_objects_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_insert_own" on storage.objects;
create policy "whatsapp_exports_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_update_own" on storage.objects;
create policy "whatsapp_exports_objects_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_delete_own" on storage.objects;
create policy "whatsapp_exports_objects_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);
