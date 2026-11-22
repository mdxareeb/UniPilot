# Migration workflow (Task 20.7)

The repeatable, local-first workflow for every schema change. The schema
contract lives in [`../DATABASE.md`](../DATABASE.md); this file is the
process around it.

## Rules

1. **Location and name.** Migrations live in `backend/supabase/migrations/` as
   `<UTC timestamp>_<snake_name>.sql`, e.g.
   `20260911020548_add_profile_timezone.sql`. Create them with
   `supabase migration new <snake_name>` — never by hand — so the timestamp is
   UTC and monotonic.
2. **Never edit an applied migration.** Once a migration has been applied to
   any shared environment, it is history. Fix forward with a new migration.
   (Local-only fixes before hosted application are possible, but re-run
   `supabase db reset` afterwards and say so in the commit/PR. The init
   migration was renamed once this way, pre-hosted, to normalize it to UTC.)
3. **One logical change per migration.** Column add, policy change and backfill
   are separate files; this keeps a failed apply identifiable and the rollback
   note exact.
4. **Forward-only, with a rollback note.** Every migration ends with a comment
   naming how its change is undone (`drop column …`, restore the pre-push dump,
   …). Rollback is a documented operation, not an assumed one.
5. **No data.** Migrations create/alter schema and move existing rows; they
   never insert application data. `backend/supabase/seed.sql` stays intentionally empty
   and the only identity is the QA user from
   `backend/supabase/qa/seed-qa-identity.mjs` (20.10).

## Local commands (safe defaults)

```powershell
# apply every migration from scratch + run the intentionally-empty seed.sql
wsl -d kali-linux -u root -e sh -c "cd /mnt/c/.../unipilot/backend && supabase db reset"

# apply only pending migrations to the running local database
supabase migration up

# what the local database has recorded (--local is required: without a flag
# the CLI expects a linked project)
supabase migration list --local

# plpgsql/schema lint
supabase db lint

# capture intentional local changes as a new migration (then review it)
supabase db diff -f <snake_name>
```

Run the `supabase` commands from `backend/` (inside WSL) — or from the repo
root via the npm scripts (`npm run db:reset`, `db:lint`, …), which invoke the
same CLI through WSL.

`supabase db reset` may be run at any time; it destroys and rebuilds the local
database and re-applies the chain in filename order. Re-run the QA seed after a
reset:

```powershell
npm run seed:qa                     # from the repo root
```

## Generated database types

The typed layer is generated from the LOCAL schema, committed, and never
hand-edited (`frontend/lib/supabase/database.types.ts`, owned by Task 20.8). It is the
step after migration → local verify, per TASK.md 0.15:

```powershell
# regenerate after a migration + db reset + db lint (run from backend/)
wsl -d kali-linux -u root -e sh supabase/ops/generate-types.sh

# optional manual check: regenerate and diff against the committed file
wsl -d kali-linux -u root -e sh supabase/ops/check-types.sh
```

- `--local` is mandatory inside both scripts: without a flag the CLI targets
  the linked project.
- `frontend/lib/supabase/schema-contract.ts` is a types-only guard: it fails `tsc` if a
  ratified table or column disappears from the generated file, so a bad
  regeneration is caught at build time.
- The npm scripts `npm run db:types` / `npm run db:check-types` (repo root, or
  `-w backend`) wrap these WSL commands. They are not portable across machines
  on their own: the WSL distro name is machine-specific (QA_SESSION.md) and is
  hardcoded in `backend/package.json` — adjust it there on another machine.

## Hosted (never automatic)

The hosted project is production.

- **Read-only compare** needs a linked project and a Supabase access token
  (`supabase link`, then `supabase migration list --linked` /
  `supabase db diff --linked`). Neither exists in this repo/working
  environment today; see the 20.7 task note.
- **Never** run `supabase db push`/`migration up --linked` without the founder's
  explicit approval and the full runbook in `backend/DATABASE.md`
  §Hosted reconciliation runbook (backup → preflight → apply → verify →
  rollback plan).
- The hosted cutover is a deliberate event, not a side effect of a local task.

## Review checklist for any new migration

- [ ] RLS is enabled on every new table.
- [ ] Every client-permitted operation has a written policy; server-only
      operations deliberately have none.
- [ ] Ownership FKs reference `auth.users` with `on delete cascade`; any
      non-ownership reference is documented and does not cascade silently.
- [ ] Indexes cover `user_id`, FK columns and the query patterns the feature
      names.
- [ ] `updated_at` exists and has the `set_updated_at` trigger.
- [ ] No fabricated/seed application data.
- [ ] No generated types here — 20.8 owns the typed layer.
- [ ] Rollback note is present and honest.
- [ ] `supabase db reset` and `supabase db lint` are clean; the reconciliation
      scratch test still passes if the change touches profiles.
- [ ] Types regenerated (`backend/supabase/ops/generate-types.sh`) and committed; the
      `schema-contract.ts` asserts still compile.

## Files

| Path | Role |
| --- | --- |
| `20260911011824_init_schema.sql` | Ratified schema (Task 20.6) |
| `20260911020548_add_profile_timezone.sql` | R15 timezone column (Task 20.7) |
| `20260911020549_backfill_legacy_profiles.sql` | Hosted legacy → ratified backfill, guarded no-op locally (Task 20.7) |
| `20260911032752_lock_usage_ledger.sql` | Usage ledger writes become server-only (Task 20.9) |
| `20260911034901_complete_onboarding.sql` | Atomic, security-invoker onboarding write: profile answers + subject replacement + completion stamp in one transaction (Task 13.10) |
| `20260911151733_add_task_priority.sql` | The task priority vocabulary: nullable `priority` text + named CHECK `low`/`medium`/`high`, NULL = unset (Task 21.7) |
| `20260911164426_add_events_type.sql` | The event type vocabulary: nullable `type` text + named CHECK `class`/`exam`/`deadline`, NULL = plain event (Task 22.6) |
| `20260911164428_add_events_subject.sql` | Optional event course: nullable `subject_id` → `subjects` (SET NULL) plus the same-user owner trigger (Task 22.x) |
| `20260912053249_documents_storage_bucket.sql` | The private `documents` bucket (25 MiB, PDF/DOCX/PNG/JPEG) and the owner-folder RLS policies on `storage.objects` (Task 23.1) |
| `20260912065021_jobs_runner.sql` | The durable `jobs` store, its partial claim/reclaim indexes, owner-only SELECT RLS, and the service-role-only `claim_jobs`/`finish_job` protocol (Task 29.1) |
| `20260912072133_acl_least_privilege.sql` | Step-0 ACL audit: revoke the bootstrap's structural table grants, policy-less write grants and client function EXECUTE to match the DATABASE.md matrix (Task 24.x) |
| `20260912095011_search_embeddings.sql` | pgvector in `extensions`, `document_chunks.embedding vector(1536)` + `page`, HNSW cosine and GIN full-text indexes, and the hybrid-ready `search_document_chunks` retrieval function (Task 25.x) |
| `20260912103529_assistant_persistence.sql` | Assistant turns: `messages.status` + `sources`, ordering indexes, and server-only message writes (write grants revoked, write policies dropped) (Task 26.x) |
| `20260912072153_documents_failed_state.sql` | The documents status vocabulary gains `failed` (uploaded → indexing → indexed / failed), with sanitized `error_message` (Task 24.10) |
| `20260912120000_whatsapp_integration.sql` | WhatsApp integration schema: `events` provenance (`source`/`source_ref` + lock trigger), the four owner-only integration tables, deny-by-default `google_calendar_credentials`, and the service-role-only credential/QR RPCs (Task 46.12) |
| `20260912120100_whatsapp_exports_bucket.sql` | The private `whatsapp-exports` bucket (25 MiB, `text/plain`) and its four owner-folder `storage.objects` policies (Task 46.12) |
| `20260913050000_whatsapp_review_mode.sql` | Review mode: `integration_connections.review_mode` / `integration_runs.review_mode` (`manual`/`automatic`, default `manual`) (Task 46.21) |
| `20260913080000_whatsapp_detection_settings.sql` | Detection settings: `integration_connections.date_order` (`DMY`/`MDY`, default `DMY`) and `detect_relative_dates` (default false) (Task 46.26) |
| `20260923083919_assistant_actions.sql` | The 27.x action log: `assistant_actions` (closed `type`/`status` CHECKs, per-user idempotency key, owner-SELECT RLS, service-role-only writes) (Tasks 27.1/27.8) |
| `20260923125254_assistant_action_source_anchors.sql` | The 27.13 safe retry anchor: `tasks`/`events.source_action_id` → `assistant_actions` (SET NULL) plus the partial unique `(user_id, source_action_id)` indexes (Task 27.13, T27-D) |
| `20261118154551_whatsapp_group_sync_tables.sql` | WhatsApp group sync: `whatsapp_sessions` (status + `desired_state` command channel), the deny-by-default `whatsapp_session_secrets` / `whatsapp_auth_keys`, `monitored_groups` (`is_active` default false, owner-toggle column grant) and `raw_messages` (per-user fingerprint) |
| `20261118154555_subjects_course_fields.sql` | `subjects.course_code` / `color_tag` / `aliases`: the matching targets for group messages |
| `20261118154558_tasks_group_sync_provenance.sql` | `tasks.subject_id` (+ owner trigger), `source`/`source_ref`/`source_message_id` (SET NULL)/`confidence_score`/`task_type`, and the server-only provenance lock |
| `20261118154602_events_group_sync_provenance.sql` | `events.source` gains `whatsapp_group`; `source_message_id` (SET NULL) + `confidence_score`; `lock_event_provenance` replaced to cover them |
| `20261118154605_documents_group_sync_provenance.sql` | `documents.source` gains `whatsapp_group`; `source_message_id` (SET NULL), `file_sha256` (unique per user), `subject_id`, `ai_summary`, `topic_tags`, owner + provenance triggers |
| `20261118154608_candidates_group_sync_origin.sql` | `integration_candidates` generalised for live group candidates: nullable `run_id`/`start_at` behind checks, `origin`, `kind`, classification, confidence, subject match/proposal, `source_message_id` (SET NULL) |
| `20261118154612_whatsapp_group_sync_retention.sql` | `purge_expired_raw_messages`: the 30-day raw-text purge (service role only) |
| `20261118155450_whatsapp_group_sync_session_rpcs.sql` | The eight service-role-only definer RPCs over the encrypted session store: credentials, batched signal keys, QR with TTL, and logout (pgcrypto, `UNIPILOT_INTEGRATIONS_KEY`) |
| `20261118171254_whatsapp_group_sync_ingest.sql` | `ingest_raw_messages` (atomic, idempotent, active-groups-only batch insert that enqueues one ids-only `whatsapp.extract` job per new text message) and `enqueue_raw_message_extraction` (queues a media message once its file is stored) |
| `20261119112803_whatsapp_group_sync_pairing_code.sql` | Mobile pairing-code link: status `code_ready`, `whatsapp_sessions.link_method` (`qr`/`pairing_code`), encrypted `phone_enc` / `pairing_code_enc` / `pairing_expires_at` on the secrets table, and the service-role-only RPCs `set/get_whatsapp_pairing_phone` (digits-only E.164, 8-15 digits, validated in SQL), `set/get_whatsapp_pairing_code` (TTL clamped 30-300 s) and `clear_whatsapp_pairing` |
| `20261119113748_whatsapp_group_sync_pairing_status.sql` | `get_whatsapp_pairing_status(uuid, text)`: the live code AND its expiry (no row once expired; stale values are cleared). Service role only |
| `qa/whatsapp-group-sync-ingest-check.sql` | Rolled-back SQL proof of the ingest RPCs (active-only, replay no-op, ids-only jobs, owner scoping, grants) |
| `qa/whatsapp-group-sync-pairing-check.sql` | Rolled-back SQL proof of the pairing RPCs (phone sanitising and rejection, ciphertext at rest, code expiry, clear, grants) |
| `qa/whatsapp-group-sync-rpc-check.sql` | Rolled-back SQL proof of the session RPCs (round trip, ciphertext at rest, wrong key raises, QR expiry, grants) |
| `qa/whatsapp-group-sync-schema-check.sql` | Rolled-back SQL proof of the group-sync schema contract (RLS isolation, secrets, provenance locks, purge survival) |
| `ops/reconcile-legacy-profiles-preflight.sql` | Hosted preflight (rename + drop legacy trigger), run manually after approval |
| `ops/generate-types.sh` | Regenerate `frontend/lib/supabase/database.types.ts` from the local schema (Task 20.8) |
| `ops/check-types.sh` | Manual drift check: regenerate and diff against the committed types |
| `qa/seed-qa-identity.mjs` | The only sanctioned identity seed (Task 20.10) |
| `qa/reconcile-scratch-fixture.sql` | Scratch-only legacy fixture for validating the hosted cutover locally |
