# UniPilot database schema (ratified by Task 20.6)

**Status: applied and verified on the LOCAL stack.** Eight versioned
migrations define, extend and lock down the ratified schema — the init schema,
the `profiles.timezone` column, the hosted legacy backfill (a guarded no-op on
a fresh database), the server-only usage ledger policy, the atomic
onboarding write (`complete_onboarding`, Task 13.10), the tasks priority
vocabulary (Task 21.7), the events type vocabulary (Task 22.6), and the
event course reference with its same-user trigger (Task 22.x). The hosted project
has **not** been contacted: its cutover is prepared and locally validated but
waits on explicit founder approval (§Hosted reconciliation runbook, Task 20.7).

> **Hosted cutover.** The hosted project has a differently-shaped `profiles`
> table (`full_name`, `college`, `program`, `semester text`, `timezone`,
> `preferences`) and its own profile-provisioning trigger. Moving it onto the
> ratified shape is a reviewed, backed-up operator event — never `db push` —
> described in §Hosted reconciliation runbook below.

## What this schema does and does not include

- **In:** tables, ownership FKs, deny-by-default RLS with written owner-only
  policies, state vocabularies, indexes, updated-at triggers, the profile
  provisioning trigger, the atomic onboarding write
  (`public.complete_onboarding`, Task 13.10), and the generated TypeScript view
  of all of it (`frontend/lib/supabase/database.types.ts`, Task 20.8).
- **Out (owned elsewhere):** storage
  buckets and upload wiring (24.x), document processing jobs (29.x/24.x),
  embeddings and search (25.x), billing logic (later phases), and every
  application data-access path (Stage 3 binds the UI).
- **No application data is seeded, ever.** `backend/supabase/seed.sql` is intentionally
  empty; the only sanctioned identity is the QA user from
  `backend/supabase/qa/seed-qa-identity.mjs` (Task 20.10), which the trigger below gives
  a single empty profile row.

## Tables

| Table | Purpose | Ownership |
| --- | --- | --- |
| `profiles` | 1:1 with `auth.users`; onboarding answers, timezone and completion stamp | `id` = `auth.users.id`, cascade |
| `subjects` | The student's courses (onboarding subjects, editable later) | `user_id` → `auth.users`, cascade |
| `documents` | Uploaded files + index status (`uploaded`/`indexing`/`indexed`/`failed`) | `user_id`, cascade |
| `document_chunks` | Ordered text of a document (no embeddings yet — 25.x) | via `document_id` parent |
| `tasks` | Assignments with status, priority (21.7), due date, effort, provenance | `user_id`, cascade |
| `events` | Classes/exams/deadlines on a timeline, typed (22.6) and optionally linked to a course (22.x) | `user_id`, cascade |
| `conversations` | Assistant conversation threads | `user_id`, cascade |
| `messages` | Thread messages (`user`/`assistant`/`system`) | via `conversation_id` parent |
| `tool_runs` | One row per tool execution; per-run job states | `user_id`, cascade |
| `notifications` | In-app notifications; `read_at` is the read marker | `user_id`, cascade |
| `subscriptions` | Billing shape only: plan/status/provider ids | `user_id` unique, cascade |
| `usage_events` | Append-only cost/usage ledger | `user_id`, cascade |
| `jobs` | Durable background jobs: kind, payload, status/attempts/backoff, worker lease (29.1) | `user_id`, nullable (system jobs), cascade |

### Relationships

```
auth.users ──1:1── profiles
auth.users ──1:N── subjects, documents, tasks, events,
                   conversations, tool_runs, notifications,
                   usage_events, subscriptions (unique 1:1)
auth.users ──1:N── jobs                 (nullable: NULL = system job)
documents  ──1:N── document_chunks     (cascade)
documents  ──1:N── tasks.source_document_id   (SET NULL: provenance, not ownership)
documents  ──1:N── events.source_document_id  (SET NULL: provenance, not ownership)
subjects   ──1:N── events.subject_id          (SET NULL: classification, not ownership; a trigger keeps the subject on the event's own user)
conversations ──1:N── messages         (cascade)
```

All ownership foreign keys are `ON DELETE CASCADE`: removing an auth user
removes everything they own. The two `source_document_id` references are
`ON DELETE SET NULL` on purpose — deleting a file must not silently delete work
the student may have edited.

## Decisions (TASK.md 20.6)

| Decision | Choice | Why |
| --- | --- | --- |
| Name mapping | `first_name` + `last_name` | Onboarding validates two separate fields; one `full_name` cannot recover them. Nullable until onboarding writes. |
| `onboarding_completed_at` | `timestamptz`, nullable | NULL = not completed; "skip" leaves it NULL; the stamp records *when* and supports 14.10. |
| `academic_year` / `semester` | `smallint` codes, checks `1–5` / `1–2` | The onboarding values ("Year 3", "Semester 2") are a closed ordinal set; codes are stable and queryable, display strings are presentation. |
| Value vocabulary policy | **text + named CHECK constraints**, consistently | Readable errors, cheap to replace in a migration; enums are hard to change and lookup tables add joins for 2–5 values. Open taxonomies (`usage_events.kind`, `subscriptions.provider`) stay unconstrained text and are documented at the column. |
| `document_chunks.embedding` | **Deferred to 25.x** | The dimension is a model choice 25.x owns; a nullable column now risks locking the wrong one. 25.x adds the extension, column and index. |
| Profile provisioning | DB trigger on `auth.users` insert (id only) | 1:1 invariant holds from the first moment; no window where an authenticated user has no profile. Onboarding fills the row through `complete_onboarding` (13.10). |
| `timezone` | ratified `text not null default 'UTC'` (IANA name) | R15 needs one timezone strategy, the value already exists hosted, and dropping it would cost calendar correctness. Names (`Europe/London`), never offsets — offsets break across DST. |
| Child-table RLS | `EXISTS` on the parent | `document_chunks`/`messages` carry no `user_id`; ownership is inherited, so it cannot drift from the parent. |
| `events.type` | nullable text + named CHECK (`class`/`exam`/`deadline`) | 17.5–17.7 name three block treatments. NULL = a plain event with no category; there is deliberately no `other` sentinel, so "render the type treatment only when supplied" is one value-or-null test. |
| `events.subject_id` | nullable FK → `subjects`, `ON DELETE SET NULL`, guarded by a same-user trigger | 17.5's optional "course?". Classification, not ownership: deleting a subject must not delete calendar history. The FK alone would accept a foreign subject id (RLS guards only the event's owner), so `ensure_event_subject_owner` requires the referenced subject to belong to the event's user. |

## RLS policy pattern

RLS is **enabled on all 13 tables**; every client-permitted operation has a
written owner-only policy via `auth.uid()`. Operations only the server performs
have no client policy (the service role bypasses RLS by design; the 29.1 job
functions and the storage bucket are the two service-role-only surfaces).

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| profiles | owner | owner | owner | — (cascade with auth user) |
| subjects, documents, tasks, events, conversations | owner | owner | owner | owner |
| document_chunks | via parent | via parent | via parent | via parent |
| messages | via parent | via parent | via parent | via parent |
| tool_runs | owner | owner | owner | — (run history is not erasable) |
| notifications | owner | — (server writes) | owner (marks `read_at`) | owner (dismiss) |
| subscriptions | owner | — (billing service role) | — (billing service role) | — |
| usage_events | owner | — (server writes; ledger is append-only) | — | — |
| jobs | owner (own rows; system jobs invisible) | — (service role only) | — (service role only) | — (service role only) |

`grant select, insert, update, delete` is given to `authenticated` for every
table; RLS is the filter. `anon` is revoked outright — no table here is public.

**Proof:** `frontend/tests/qa/rls-isolation.spec.ts` (Task 20.9) exercises this matrix
with two real users plus an anonymous client — own-row reads, cross-user empty
reads and zero-row cross updates/deletes, child-table isolation through the
parent, denied server-only writes, denied anon reads/writes, and a residue-free
teardown. It was proven able to fail: relaxing `tasks_select_own` to `using
(true)` made it fail with `QA1 must not read QA2's tasks`, then the policy was
restored (Task 20.9 also moved `usage_events` INSERT to server-only, matching
the R5 cost-control boundary).

### Storage (private bucket — Task 23.1)

The `documents` bucket is the one non-`public` surface, and it follows the
same authority model: RLS on `storage.objects`, `auth.uid()` only.

| Piece | Decision |
| --- | --- |
| Bucket | `documents`, `public = false` — no unauthenticated URL ever resolves; reads go through authenticated/signed downloads |
| Constraints | `file_size_limit = 26214400` (25 MiB) and `allowed_mime_types` = PDF, DOCX, PNG, JPEG — the same allowlist `frontend/lib/data/documentValues.ts` validates against |
| Path convention | `{user_id}/{document_id}/{sanitized-name}`; the leading folder is the RLS key, and the per-document folder keeps names collision-free |
| Policies | `documents_objects_select_own` / `_insert_own` / `_update_own` / `_delete_own`, each `to authenticated` with `bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text`; the update policy's `WITH CHECK` also keeps the destination in the caller's folder |
| `anon` | no policy at all → default-deny, exactly like the public schema |

Server-side finalize re-checks the object's real size and magic bytes before a
row is settled (23.4/23.5); the bucket constraint is the fast first gate.

**Proof:** `frontend/tests/qa/documents-data.spec.ts` (Task 23.x) signs in
both QA users through the real Storage API: own upload/download/list/remove
work; cross-user reads, writes and deletes are denied; `anon` is denied;
disallowed MIME types and oversize objects are rejected with no residue; a
document row delete cascades its chunks. `documents-ui.spec.ts` covers the
browser pipeline (reserve → direct upload with real progress → magic-byte
finalize) plus rename/delete through the UI.

### Background jobs (Task 29.1)

The generic durable runner (24.x's document pipeline is its first consumer).

| Piece | Decision |
| --- | --- |
| Store | `public.jobs`: `kind`, `payload` jsonb, `status`, `attempts`/`max_attempts`, `run_after`, `locked_at`/`locked_by` (worker lease), `last_error`, timestamps; nullable `user_id` = system job |
| Indexes | `jobs_claim_idx` on `(run_after) where status='queued'`; `jobs_reclaim_idx` on `(locked_at) where status='running'`; `jobs_user_id_idx` for owner reads |
| Claim | `claim_jobs(p_worker_id, p_limit)` — `FOR UPDATE SKIP LOCKED` flips due `queued` rows to `running` (`attempts+1`, lease) and reclaims `running` rows whose 5-minute lease expired first |
| Settle | `finish_job(id, worker, error, retryable)` — `succeeded`; non-retryable → `failed`; attempts exhausted → `dead_letter`; otherwise `queued` with `least(2^(attempts-1)·30s, 1h)` backoff; only the lease holder may settle |
| Privileges | both functions `security definer`, EXECUTE revoked from `public`/`anon`/`authenticated` (the Supabase bootstrap grants EXECUTE directly to those roles, so a PUBLIC revoke alone is not enough) and granted to `service_role`; table: SELECT for authenticated (own rows, RLS), nothing for anon, all for service_role |
| Enqueue | server-only `frontend/lib/data/jobs.ts` (`enqueueJob`) via `frontend/lib/supabase/service.ts`; called from Server Actions after their gate |
| Runner | `backend/worker/run.mjs` + `handlers.mjs` (plain Node ESM, `npm run worker:once -w backend`); handler = `async (payload, ctx) => {}`, `.retryable = false` for permanent failures |

**Proof:** `frontend/tests/qa/jobs-runner.spec.ts` (Task 29.1) drives the real
worker: claim → succeeded; retry backoff → dead-letter; non-retryable →
failed; stale lock reclaimed while a fresh lock is untouched; system job
invisible to users; client writes and `claim_jobs`/`finish_job` RPCs denied
for both `authenticated` and `anon`; zero rows left at the end.

### ACL audit (Task 24.x step 0)

The 29.1 finding prompted a full audit of the public schema against the RLS
matrix above. Supabase's bootstrap grants `EXECUTE` on new functions and `ALL`
on new tables **directly** to `anon`/`authenticated`, so a `REVOKE ... FROM
PUBLIC` alone is not enough. Findings and fixes
(`20260912072133_acl_least_privilege.sql`):

| Finding | Fix |
| --- | --- |
| Every public table carried `MAINTAIN`, `REFERENCES`, `TRIGGER`, `TRUNCATE` for `authenticated` (`TRUNCATE` bypasses RLS) | revoked from `anon` + `authenticated` on all tables |
| `usage_events` / `subscriptions` carried INSERT/UPDATE/DELETE with no policy | revoked |
| `notifications` carried INSERT (server-writes only) | revoked |
| `profiles` / `tool_runs` carried DELETE (no policy; history is not erasable) | revoked |
| `complete_onboarding` had EXECUTE for `anon` | revoked (authenticated keeps it, by design) |
| `handle_new_user`, `set_updated_at`, `ensure_event_subject_owner` had EXECUTE for both client roles | revoked (trigger functions need no client EXECUTE) |

Post-audit state (psql-verified): `authenticated` holds exactly the matrix's
DML on each table, `anon` holds zero table grants, definer functions are
owner + `service_role` only, and every revoked write now answers "permission
denied" before RLS is even consulted — a strictly stronger denial than the
old zero-rows filtering (`rls-isolation.spec.ts` asserts both shapes).

### Document processing (Task 24.x)

| Piece | Decision |
| --- | --- |
| Trigger | the 23.x finalize action enqueues `document.process` and flips the row to `indexing` in the same hand-off |
| Extraction | pdfjs-dist (PDF, one unit per page + `page_count`) and mammoth (DOCX, one unit, `page_count` NULL) in the worker package; 25.x owns the real embedding chunking |
| Normalization | `backend/worker/extract/text.mjs`: NFKC, CRLF→LF, line-break de-hyphenation, whitespace/blank-run collapse |
| Scan detection | a PDF with fewer than 4 non-space characters has no text layer → honest OCR-unavailable failure (24.6 blocked, no text faked) |
| Limits | 200 pages / 2,000,000 characters per document; over-limit is a permanent sanitized failure with no chunks |
| OCR | **blocked**: no provider/credential exists; `extract/ocr.mjs` is the seam and images fail with the honest copy (`OCR_DEPENDENCY` names what is missing) |
| Copy | `documentProcessing.mjs` `PROCESSING_COPY` is the only thing written to `documents.error_message`; library/DB messages stay in worker logs |
| Benchmark | `backend/worker/benchmark.mjs` + `benchmark-fixtures/` measure expected-vs-extracted Dice similarity and exit non-zero with no fixtures; 24.14 is `[~]` until a real human-checked set exists |

**Proof:** `frontend/tests/qa/documents-processing.spec.ts` (Task 24.x) drives
the real worker through the UI hand-off and service-seeded rows: indexed
chunks/pages, DOCX unit, retry → dead-letter, permanent corrupt failure, OCR
block, page limit, chunk RLS, ACL denials and the benchmark's honest
no-fixtures failure.

## Onboarding write (`complete_onboarding`, Task 13.10)

`public.complete_onboarding(...)` is the one database operation onboarding
performs. It is `security invoker` — it runs as the calling `authenticated`
role, so the owner-only RLS policies above remain the enforcement layer — and it
derives the user from `auth.uid()` only, so no argument can address another
student's rows. In one transaction it:

1. upserts the profile answers and stamps `onboarding_completed_at` with
   `coalesce(existing, now())`, so a repeated submission never moves the
   original completion time;
2. replaces the `subjects` set (delete the user's rows, insert the normalized
   list), so repeats cannot duplicate rows and stale subjects cannot survive.

A missing profile raises before anything is written, which is what makes "a
failed save stamps nothing" true. Subject names are trimmed, blanks dropped and
case-insensitive repeats collapsed, matching the flow's own rule; the
`subjects_user_id_name_key` unique constraint and the vocabulary CHECKs are the
final guard. `EXECUTE` is revoked from `public` and granted to `authenticated`
only, and the Server Action additionally validates the payload before calling it
(`frontend/lib/data/onboarding.ts`).

## Indexes

- `user_id` on every owned table (directly, or as the leading column of
  `subjects (user_id, name)` unique / `subscriptions (user_id)` unique /
  `usage_events (user_id, occurred_at)`).
- FK columns: `document_chunks.document_id` (also unique with `chunk_index`),
  `messages.conversation_id`, `tasks.source_document_id`,
  `events.source_document_id`, `events.subject_id`.
- Named query patterns: `tasks.due_date`, `events.start_at`,
  `usage_events (user_id, occurred_at)`.

## State vocabularies (text + CHECK)

- `documents.status`: `uploaded` · `indexing` · `indexed` · `failed` (Task
  24.10). `failed` is terminal for a permanent processing failure and the
  resting state while a retryable failure waits out its backoff;
  `error_message` always carries sanitized copy (24.12).
- `tasks.status`: `todo` · `in_progress` · `done`
- `tasks.priority`: `low` · `medium` · `high` (Task 21.7). NULL = no priority
  set — there is deliberately no `none` sentinel, so absence is the absence of
  a value and the 16.5 card's "render only when supplied" rule is one `is
  null` test. No fourth level, no numeric scale, no colour meaning.
- `events.type`: `class` · `exam` · `deadline` (Task 22.6). NULL = a plain
  event with no category — no `other` sentinel either; the legend lists the
  three category treatments only.
- `messages.role`: `user` · `assistant` · `system`
- `tool_runs.status`: `queued` · `processing` · `completed` · `failed`
  (per-run job states; the **registry** states `live`/`planned`/`disabled` stay
  in `frontend/components/tools/toolCatalog.ts`, never here. `tool_runs.tool_id` is a
  text id matching the registry and intentionally has no FK.)
- `notifications.kind`: `deadline` · `workload` · `document` · `system`
- `subscriptions.plan`: `free` · `pro` · `team`
- `subscriptions.status`: `active` · `trialing` · `past_due` · `canceled` · `incomplete`
- `profiles.planning_style`: `steady` · `balanced` · `deadline_driven`
  (onboarding "Steady"/"Balanced"/"Deadline-driven")
- `profiles.reminder_lead`: `1_day` · `3_days` · `1_week`
  (onboarding "1 day before"/"3 days before"/"1 week before")
- `jobs.status`: `queued` · `running` · `succeeded` · `failed` (permanent,
  handler-declared) · `dead_letter` (attempts exhausted) — Task 29.1

## Migration workflow

The full process — naming, the never-edit-an-applied-migration rule, the review
checklist and the command set — lives in
[`backend/supabase/MIGRATIONS.md`](./supabase/MIGRATIONS.md). In one place:

- Migrations live in `backend/supabase/migrations/<UTC timestamp>_<snake_name>.sql`,
  generated with `supabase migration new <name>`; forward-only, one logical
  change per file, with a rollback note at the end of every file.
- Local (run from `backend/`): `supabase db reset` (full chain + the
  intentionally-empty seed), `supabase migration up`,
  `supabase migration list --local`, `supabase db lint`,
  `supabase db diff -f <name>`.
- After a local verify, regenerate and commit the typed layer:
  `backend/supabase/ops/generate-types.sh` (`check-types.sh` diffs on demand). The
  clients in `frontend/lib/supabase/` all carry the `Database` generic, and
  `frontend/lib/supabase/schema-contract.ts` fails `tsc` if a ratified table or column
  disappears.
- Hosted stays read-only compare (`--linked`) until the founder approves a
  rollout; an unreviewed `db push` is prohibited.

## Hosted reconciliation runbook (Task 20.7)

**Status: prepared and locally validated; NOT executed. Awaiting explicit
founder approval.** This working environment has no Supabase access token and
the CLI is not linked, so even a read-only hosted compare is unavailable today.

### Decision

Reconcile the existing hosted data — do not wipe. The hosted
`public.profiles` table is renamed aside, the ratified chain is applied, and a
guarded backfill copies rows across before the legacy table is dropped. The
pre-push dump is the archive and the rollback.

### Column mapping (`20260911020549_backfill_legacy_profiles.sql`)

| Legacy | Ratified | Mapping / ambiguity |
| --- | --- | --- |
| `full_name` | `first_name` + `last_name` | best-effort split at the first space. A mononym leaves `last_name` NULL; `"van der Berg"` becomes first `van`, last `der Berg`. The split cannot be reversed — the dump keeps the original string. |
| `college` | `institution` | direct |
| `program` | `course_program` | direct |
| `semester` (text) | `semester` smallint 1–2 | `1`/`semester 1`/`sem 1`/`s1` → 1; `2`/… → 2; anything else → NULL (counted in verification) |
| — | `academic_year` | absent from the legacy shape → NULL |
| `preferences` | `planning_style` | `planning_style`/`planningStyle`, values `steady`/`balanced`/`deadline-driven`; else NULL |
| `preferences` | `reminder_lead` | same key spellings; else the onboarding default `3_days` |
| `timezone` | `timezone` | kept (R15); blank → `UTC` |
| — | `onboarding_completed_at` | no legacy marker exists → NULL; nobody is marked complete falsely |

### Runbook (only after approval)

1. **Freeze.** Treat the cutover as a maintenance window; no writes during it.
2. **Back up (rollback archive).** `supabase db dump --linked -f backup-pre-20.7.sql` (needs `supabase link` + access token) and keep a second copy outside the repo. Do not proceed without it.
3. **Record current state.** `supabase migration list --linked`; if the hosted history is not empty/known, stop and reconcile versions first.
4. **Preflight.** Run `backend/supabase/ops/reconcile-legacy-profiles-preflight.sql` against hosted and review every NOTICE (the dropped `auth.users` trigger names) before continuing.
5. **Apply the chain.** `supabase migration up --linked` — applies init → timezone → backfill. The backfill prints a NOTICE when it reconciles and drops `profiles_legacy`.
6. **Verify.** `auth.users` count = `profiles` count; no `profiles_legacy`; RLS on; `on_auth_user_created` present; NULL counts for unmapped semester/planning_style and for `onboarding_completed_at`; a founder login smoke test.
7. **Rollback** (any failure): restore `backup-pre-20.7.sql`. There is no partial forward fix without the dump.
8. **Record** the approval and executed commands in the Task 20.7 note.

### Local validation (executed 2026-09-11)

A disposable `reconcile_scratch` database in the local container was given the
legacy shape and three synthetic rows via
`backend/supabase/qa/reconcile-scratch-fixture.sql`, then the exact hosted sequence was
applied: preflight → init → timezone → backfill. Assertions:

| Case | Result |
| --- | --- |
| `Areeb Khan`, `Semester 2`, `{"planning_style":"Balanced","reminder_lead":"1 week before"}`, `Europe/London` | `Areeb / Khan / 2 / balanced / 1_week / Europe/London` |
| `Madonna`, `2`, `{}`, `America/New_York` | `Madonna / NULL / 2 / NULL / 3_days / America/New_York` |
| `van der Berg`, `Trimester 3`, `{"planningStyle":"Deadline-driven"}`, `""` | `van / der Berg / NULL / deadline_driven / 3_days / UTC` |

`profiles_legacy` gone, RLS enabled, 12 tables / 40 policies, the new
`on_auth_user_created` present, 3/3 rows copied. The scratch database was
dropped afterwards.

## Verification performed (local, 2026-09-11)

- `supabase db reset` applied all twelve migrations cleanly, repeatably on a
  fresh database: `20260911011824_init_schema.sql`,
  `20260911020548_add_profile_timezone.sql`,
  `20260911020549_backfill_legacy_profiles.sql` (no-op on a fresh database),
  `20260911032752_lock_usage_ledger.sql`,
  `20260911034901_complete_onboarding.sql`,
  `20260911151733_add_task_priority.sql`,
  `20260911164426_add_events_type.sql`,
  `20260911164428_add_events_subject.sql`,
  `20260912053249_documents_storage_bucket.sql`,
  `20260912065021_jobs_runner.sql`,
  `20260912072133_acl_least_privilege.sql`,
  `20260912072153_documents_failed_state.sql`.
- `supabase migration list --local` shows all twelve versions applied;
  `supabase db lint` → "No schema errors found".
- ACL audit (24.x step 0): live ACLs match the matrix — `authenticated` holds
  only the commissioned DML per table, `anon` zero table grants, trigger
  functions owner+`service_role` only, `complete_onboarding` authenticated
  only; the denials are asserted in `rls-isolation.spec.ts` and
  `documents-processing.spec.ts`.
- Jobs (29.1): `pg_policies` shows the one owner-only SELECT policy; the
  function ACLs carry `service_role` (and the owner) only — no `anon`/
  `authenticated` EXECUTE — and the table grants are SELECT-only for
  `authenticated`; the lifecycle proofs live in
  `frontend/tests/qa/jobs-runner.spec.ts`.
- Storage (23.1): `storage.buckets` holds one row — `documents`, `public =
  false`, 26214400 bytes, the four allowed MIME types — and
  `pg_policies` shows the four `documents_objects_*` owner-folder policies on
  `storage.objects`; a real-browser upload lands under the caller's prefix and
  a fake PDF is rejected and cleaned up
  (`frontend/tests/qa/documents-ui.spec.ts`).
- `events` (22.x): nullable `type` with the named CHECK, and nullable
  `subject_id` → `subjects` guarded by `ensure_event_subject_owner`, which
  rejects a subject that belongs to another user;
  `frontend/tests/qa/events-data.spec.ts` proves the two-user isolation, the
  range window, the CHECKs, the same-user subject guard and an id-scoped
  residue-free teardown.
- `tasks.priority` (21.7): nullable text with the named `tasks_priority_check`
  (`low`/`medium`/`high`); `frontend/tests/qa/tasks-data.spec.ts` proves the
  two-user isolation of create/list/get/update/delete/status/priority, the
  CHECKs rejecting invalid status/priority/blank titles/non-positive effort,
  and an id-scoped residue-free teardown.
- `complete_onboarding` (13.10): security-invoker function, `EXECUTE` granted
  to `authenticated` only; `frontend/tests/qa/onboarding.spec.ts` exercises the atomic
  write through the real UI (completion, skip, forced failure + retry,
  duplicate submissions, two-user isolation) and proves a missing profile
  raises with nothing written; `rls-isolation.spec.ts` proves `anon` cannot
  execute it, QA2 cannot read QA1's persisted subjects, and teardown (now
  id-scoped) leaves the onboarding rows intact.
- 13/13 tables exist; `relrowsecurity = true` on each; 40 policies total
  (matrix above); 13 `updated_at` triggers + `on_auth_user_created` on
  `auth.users`; 34 indexes (public schema); `anon` has zero grants and no job
  function EXECUTE.
- QA identities re-seeded after reset (two users since Task 20.9): each auth
  user gets exactly one trigger-provisioned profile row, every application
  table empty until the onboarding QA runs.
- RLS smoke: `set role anon` → `permission denied`; authenticated with a
  foreign `sub` → 0 profiles; with the QA `sub` → 1 profile.
- Hosted reconciliation validated in a scratch database (§Local validation);
  scratch database dropped.
- Generated types: `backend/supabase/ops/generate-types.sh` produced
  `frontend/lib/supabase/database.types.ts` from the local schema; a second run produced
  no diff; `check-types.sh` reports a match; the generated `profiles` row
  includes `timezone` and all 12 tables are present; `server.ts`, `client.ts`
  and `proxy-session.ts` carry `<Database>`; `schema-contract.ts` was proved to
  fail `tsc` when a ratified column is renamed, then reverted.
- Two-user RLS isolation: `frontend/tests/qa/rls-isolation.spec.ts` passes against the
  local stack with two real sessions (QA1/QA2) plus anon, covering the matrix
  above and tearing down every row it creates; relaxing one policy made it fail
  with a clear message, then the policy was restored.
- No hosted contact: the CLI is not linked (`backend/supabase/.temp` has no
  `project-ref`) and no command used `--linked`.

Re-run/verify locally:

```powershell
wsl -d kali-linux -u root -e sh -c "cd /mnt/c/.../unipilot/backend && supabase db reset"
npm run seed:qa                     # from the repo root
```
