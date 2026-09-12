-- Task 23.1 — the private `documents` bucket and its owner-folder policies.
--
-- Storage is the first subsystem whose rows do not live in `public`, so its
-- rules live here rather than in the schema migration: `storage.buckets`
-- carries the bucket's own constraints, and RLS on `storage.objects` is the
-- enforcement layer for every upload/read/delete — the same authority model
-- as the rest of the product (auth.uid(), never a client-supplied owner).
--
-- Path convention (17.x's sibling decision for documents):
--
--     {user_id}/{document_id}/{sanitized-name}
--
-- The leading folder is the RLS key, so the policies below compare
-- `(storage.foldername(name))[1]` against `auth.uid()::text`. A user can
-- never address another user's folder even with a forged path, and the
-- per-document folder keeps names collision-free when two students upload
-- `notes.pdf`.
--
-- Bucket constraints mirror the server allowlist in
-- `frontend/lib/data/documentValues.ts` (24.x's accepted types at launch):
--   - 25 MiB (26214400 bytes) — the documented 23.5 limit;
--   - PDF, DOCX, PNG, JPEG.
-- Storage API enforces both before any object is written; the finalize
-- Server Action re-checks magic bytes and the real object size server-side
-- (23.4), so the bucket constraint is a fast first gate, not the only one.
--
-- `public = false` means no unauthenticated URL resolves; reads go through
-- authenticated/signed downloads only.
--
-- Rollback (reference; the workflow is forward-only):
--   delete from storage.objects where bucket_id = 'documents';
--   drop policy "documents_objects_select_own" on storage.objects;
--   ... (all four policies)
--   delete from storage.buckets where id = 'documents';

-- -----------------------------------------------------------------------------
-- 1. The bucket: private, 25 MiB, the closed launch MIME set.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2. RLS on storage.objects — owner-folder only, authenticated only.
--    `anon` has no policy at all, so every request without a session is
--    denied by the same default-deny the public schema uses.
-- -----------------------------------------------------------------------------

drop policy if exists "documents_objects_select_own" on storage.objects;
create policy "documents_objects_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_objects_insert_own" on storage.objects;
create policy "documents_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update covers a rename/move; the WITH CHECK keeps the destination in the
-- caller's own folder, so an owned object can never be moved into someone
-- else's prefix.
drop policy if exists "documents_objects_update_own" on storage.objects;
create policy "documents_objects_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_objects_delete_own" on storage.objects;
create policy "documents_objects_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
