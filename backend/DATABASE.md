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
| `document_chunks` | Ordered text of a document with its source page and the nullable 1536-dim embedding (25.x) | via `document_id` parent |
| `tasks` | Assignments with status, priority (21.7), due date, effort, provenance | `user_id`, cascade |
| `events` | Classes/exams/deadlines on a timeline, typed (22.6) and optionally linked to a course (22.x) | `user_id`, cascade |
| `conversations` | Assistant conversation threads | `user_id`, cascade |
| `messages` | Thread messages (`user`/`assistant`/`system`) | via `conversation_id` parent |
| `assistant_actions` | The 27.x action log: one row per proposed assistant action, its normalized payload, status and settled result | `user_id`, cascade; `conversation_id` cascade; `message_id` SET NULL |
| `tool_runs` | One row per tool execution; per-run job states | `user_id`, cascade |
| `notifications` | In-app notifications; `read_at` is the read marker | `user_id`, cascade |
| `subscriptions` | Billing shape only: plan/status/provider ids | `user_id` unique, cascade |
| `usage_events` | Append-only cost/usage ledger | `user_id`, cascade |
| `jobs` | Durable background jobs: kind, payload, status/attempts/backoff, worker lease (29.1) | `user_id`, nullable (system jobs), cascade |
| `integration_connections` | Per-user integration state (`whatsapp`/`google`): status, live profile ref, encrypted QR + 60 s expiry (46.x) | `user_id`, cascade; unique per `(user_id, provider)` |
| `integration_runs` | One WhatsApp scan/sync (`export`/`live`): status, counts, error, timestamps; `storage_path` XOR `chat_name` (46.x) | `user_id`, cascade; `connection_id` SET NULL |
| `integration_messages` | Raw imported messages (30-day best-effort purge): run, position, sender, time, body (46.x) | `run_id` → run (cascade), `user_id`, cascade |
| `integration_candidates` | Detected events awaiting review: fingerprint, dates, reviewed message copy, push state (46.x) | `user_id`, cascade; `event_id`/`message_id` SET NULL |
| `google_calendar_credentials` | One pgcrypto-encrypted Google refresh token per user; no API-role grants, RPC-only (46.x) | `user_id` PK, cascade |

### Relationships

```
auth.users ──1:1── profiles
auth.users ──1:N── subjects, documents, tasks, events,
                   conversations, tool_runs, notifications,
                   usage_events, subscriptions (unique 1:1)
auth.users ──1:N── jobs                 (nullable: NULL = system job)
auth.users ──1:N── integration_connections, integration_runs,
                   integration_messages, integration_candidates
auth.users ──1:1── google_calendar_credentials
integration_connections ──1:N── integration_runs    (SET NULL: scan history survives)
integration_runs ──1:N── integration_messages, integration_candidates (cascade)
integration_candidates ── event_id → events / message_id → integration_messages (both SET NULL)
documents  ──1:N── document_chunks     (cascade)
documents  ──1:N── tasks.source_document_id   (SET NULL: provenance, not ownership)
documents  ──1:N── events.source_document_id  (SET NULL: provenance, not ownership)
subjects   ──1:N── events.subject_id          (SET NULL: classification, not ownership; a trigger keeps the subject on the event's own user)
conversations ──1:N── messages         (cascade)
conversations ──1:N── assistant_actions (cascade; message_id SET NULL)
assistant_actions ──1:N── tasks.source_action_id  (SET NULL: the 27.13 retry anchor)
assistant_actions ──1:N── events.source_action_id (SET NULL: the 27.13 retry anchor)
```

All ownership foreign keys are `ON DELETE CASCADE`: removing an auth user
removes everything they own (including both credential rows). The
non-ownership references are `ON DELETE SET NULL` on purpose — deleting a
file, a connection, an event or a purged message must not silently delete
work or review history: `tasks.source_document_id`,
`events.source_document_id`, `integration_runs.connection_id`,
`integration_candidates.event_id` and `integration_candidates.message_id`,
and the 27.13 anchors `tasks.source_action_id`/`events.source_action_id`
(deleting the action log row must never delete the task the user already has).

## Decisions (TASK.md 20.6)

| Decision | Choice | Why |
| --- | --- | --- |
| Name mapping | `first_name` + `last_name` | Onboarding validates two separate fields; one `full_name` cannot recover them. Nullable until onboarding writes. |
| `onboarding_completed_at` | `timestamptz`, nullable | NULL = not completed; "skip" leaves it NULL; the stamp records *when* and supports 14.10. |
| `academic_year` / `semester` | `smallint` codes, checks `1–5` / `1–2` | The onboarding values ("Year 3", "Semester 2") are a closed ordinal set; codes are stable and queryable, display strings are presentation. |
| Value vocabulary policy | **text + named CHECK constraints**, consistently | Readable errors, cheap to replace in a migration; enums are hard to change and lookup tables add joins for 2–5 values. Open taxonomies (`usage_events.kind`, `subscriptions.provider`) stay unconstrained text and are documented at the column. |
| `document_chunks.embedding` | **Resolved in 25.x**: `extensions.vector(1536)`, nullable | The 20.6 deferral is closed: the model family is OpenAI `text-embedding-3-small` (1536 dims — also `text-embedding-ada-002`'s size, so the column does not lock the provider). NULL = not embedded yet (keyword-searchable); no vector is fabricated, and a swap is a re-embed run, never an in-place edit. |
| Profile provisioning | DB trigger on `auth.users` insert (id only) | 1:1 invariant holds from the first moment; no window where an authenticated user has no profile. Onboarding fills the row through `complete_onboarding` (13.10). |
| `timezone` | ratified `text not null default 'UTC'` (IANA name) | R15 needs one timezone strategy, the value already exists hosted, and dropping it would cost calendar correctness. Names (`Europe/London`), never offsets — offsets break across DST. |
| Child-table RLS | `EXISTS` on the parent | `document_chunks`/`messages` carry no `user_id`; ownership is inherited, so it cannot drift from the parent. |
| `events.type` | nullable text + named CHECK (`class`/`exam`/`deadline`) | 17.5–17.7 name three block treatments. NULL = a plain event with no category; there is deliberately no `other` sentinel, so "render the type treatment only when supplied" is one value-or-null test. |
| `events.subject_id` | nullable FK → `subjects`, `ON DELETE SET NULL`, guarded by a same-user trigger | 17.5's optional "course?". Classification, not ownership: deleting a subject must not delete calendar history. The FK alone would accept a foreign subject id (RLS guards only the event's owner), so `ensure_event_subject_owner` requires the referenced subject to belong to the event's user. |

## RLS policy pattern

RLS is **enabled on all 19 tables**; every client-permitted operation has a
written owner-only policy via `auth.uid()` — except `google_calendar_credentials`,
which is deliberately deny-by-default (no policy, no grants, RPC-only).
Operations only the server performs have no client policy (the service role
bypasses RLS by design; the 29.1 job functions, the `integration_*` writes,
the credential RPCs, the `assistant_actions` writes and the private storage
surface are server-only).

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| profiles | owner | owner | owner | — (cascade with auth user) |
| subjects, documents, tasks, events, conversations | owner | owner | owner | owner |
| document_chunks | via parent | via parent | via parent | via parent |
| messages | via parent | — (server-only writes, Task 26.4) | — (server-only writes) | — (server-only writes) |
| assistant_actions | owner | — (server-only writes, Task 27.8) | — (server-only writes) | — (server-only writes) |
| tool_runs | owner | owner | owner | — (run history is not erasable) |
| notifications | owner | — (server writes) | owner (marks `read_at`) | owner (dismiss) |
| subscriptions | owner | — (billing service role) | — (billing service role) | — |
| usage_events | owner | — (server writes; ledger is append-only) | — | — |
| jobs | owner (own rows; system jobs invisible) | — (service role only) | — (service role only) | — (service role only) |
| integration_connections, integration_runs, integration_messages, integration_candidates | owner | — (service-side writes) | — (service-side writes) | — (service-side writes) |
| google_calendar_credentials | — (no policy, no grants, RPC-only) | — | — | — |

`grant select, insert, update, delete` is given to `authenticated` for every
table; RLS is the filter. The exceptions: the four `integration_*` tables and
`assistant_actions` grant SELECT only (their writes are service-side), and
`google_calendar_credentials` grants nothing to any API role — `anon`,
`authenticated` **and** `service_role` are all revoked, so only the definer
RPCs reach it. `anon` is revoked outright — no table here is public.

**Proof:** `frontend/tests/qa/rls-isolation.spec.ts` (Task 20.9) exercises this matrix
with two real users plus an anonymous client — own-row reads, cross-user empty
reads and zero-row cross updates/deletes, child-table isolation through the
parent, denied server-only writes, denied anon reads/writes, and a residue-free
teardown. It was proven able to fail: relaxing `tasks_select_own` to `using
(true)` made it fail with `QA1 must not read QA2's tasks`, then the policy was
restored (Task 20.9 also moved `usage_events` INSERT to server-only, matching
the R5 cost-control boundary).

### Storage (private bucket — Task 23.1)

The private buckets follow the same authority model: RLS on `storage.objects`,
`auth.uid()` only. `documents` is documented here; `whatsapp-exports` (46.x) in
§WhatsApp integration.

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

### Search & embeddings (Task 25.x)

| Piece | Decision |
| --- | --- |
| Extension | `vector` in the `extensions` schema (Supabase's convention) |
| Model / dimension | OpenAI `text-embedding-3-small`, **1536** — the 20.6 deferral resolved; the column is nullable and NULL means "not embedded yet", never a fabricated vector |
| Chunking (25.1) | `backend/worker/chunkText.mjs`: ~1200-character windows, 200-character overlap, ends preferring paragraph → sentence → word boundaries; deterministic |
| Re-index (25.12) | the `document.reindex` job replaces a document's chunks (delete-then-insert, idempotent) and embeds them when a provider exists; the document's processing status is untouched |
| Indexes (25.5) | HNSW `extensions.vector_cosine_ops` on `embedding`; GIN on `to_tsvector('english', content)` |
| Retrieval (25.6–25.9) | `search_document_chunks(p_query, p_limit, p_document_id, p_page, p_embedding)`: keyword branch (`websearch_to_tsquery` + `ts_rank`), optional cosine vector branch, reciprocal-rank fusion (k = 60), `ts_headline` snippets with `[[…]]` markers; returns document id/name, page, chunk index, content, snippet, score, match kind; security invoker (RLS through the parent); execute granted to `authenticated` + `service_role` only (anon revoked explicitly) |
| Provider (25.3/25.6) | **blocked**: no embedding provider or credential exists; `backend/worker/embed.mjs` and the data layer's `semanticSearchStatus()` state the exact dependency, `p_embedding` stays NULL, and search is keyword-only by construction |
| References (25.9) | every hit carries the document id and page; 24.x's page units stamp `page` too, so references work before a re-index |
| Benchmark (25.11) | `backend/worker/searchBenchmark.mjs` + `search-fixtures/`: real-query recall@k and MRR, exits non-zero with no fixtures; `[~]` until a human-checked set exists, and no accuracy numbers are recorded |

**Proof:** `frontend/tests/qa/documents-search.spec.ts` (Task 25.x): re-index
idempotency with page references and an untouched document status; keyword
hits with snippets, document/page filters, an honest empty result, QA1/QA2 RLS
and the security-invoker session read; the real panel flow including the
`?preview=` navigation; and the harness's honest no-fixtures failure.

### Assistant backend (Task 26.x)

| Piece | Decision |
| --- | --- |
| Provider (26.1) | `frontend/lib/ai/provider.ts`: one `chat`/`stream`/`embed` interface, env-only registry (`ASSISTANT_PROVIDER`/`ASSISTANT_API_KEY`/`ASSISTANT_MODEL`, server-only, `.env.example`), honest unconfigured status — the registry is empty and **no key or client exists in this repo** (blocked, never faked) |
| Conversations (26.3) | owner CRUD through the session client (RLS), most-recently-active first; delete cascades messages |
| Messages (26.4) | reads through the parent RLS policy; **writes server-only** — `20260912103529_assistant_persistence.sql` revokes INSERT/UPDATE/DELETE from `authenticated` and drops the write policies, and the service verifies conversation ownership before a service-role insert, so clients cannot forge `role`/`status`/`sources` |
| Turn state (26.12) | `messages.status` (`complete|failed`) + `messages.sources` jsonb (cited document id/name/page/chunk) |
| Ordering | `messages (conversation_id, created_at, id)`; `conversations (user_id, updated_at desc)` |
| RAG (26.5) | 25.x `search_document_chunks` through the session client (RLS scope); cross-user retrieval proven in the spec |
| Budget (26.6) | 8 chunks / 2000 tokens (≈8000 chars, 4 chars/token), deduped, word-boundary truncation, provenance kept |
| Streaming (26.8) | `POST /api/assistant/turn` → SSE frames `start/delta/sources/done/error`; the provider-stream leg is wired and blocked |
| Limits (26.10/26.15) | 10 turns/minute and a documented 200,000-token monthly guard, both read from `usage_events`; plan-driven entitlements `[~]` for billing 49.x |
| Usage (26.11) | `assistant_turn` (1) per turn and `assistant_tokens` (prompt+completion) when a provider reports usage |
| Injection (26.16) | one immutable system message; all user/retrieved text quoted inside `<workspace_data>` with delimiter/control-character defusal; no tool execution from retrieved text |
| Tool contract (26.9) | fenced `unipilot-action` JSON, parsed with `requiresConfirmation` forced true; 27.x executes, nothing does here |

**Proof:** `frontend/tests/qa/assistant-backend.spec.ts` (Task 26.x): provider
honesty and the timeout/retry policy, the injection guard, the context budget,
the structured-action parser, real turns persisting conversation/messages/
usage in order, server-write-only messages with owner isolation, RAG
cross-user isolation through real turns, and the rate/spend guards.

### Assistant action engine (Task 27.x)

Two migrations: `20260923083919_assistant_actions.sql` (the log) and
`20260923125254_assistant_action_source_anchors.sql` (the 27.13 retry anchor).
The log is written only by the server (registration in the turn pipeline and
the confirm/reject Server Actions). The executor's task/event writes run
through the caller's own session client, so RLS authorizes them exactly as the
manual path would; the presentation write goes through the service role inside
the service layer (`presentations.ts`), exactly as the tool's own Server Action
does — that table has no client write path.

| Piece | Decision |
| --- | --- |
| `assistant_actions` | One row per proposed action: `type` (closed CHECK), `payload` jsonb (the normalized 27.1 payload the card rendered and the executor ran), `status`, `result` jsonb (the settled facts), `error` (sanitized copy), `idempotency_key`, `proposed_at`/`settled_at`; `unique (user_id, idempotency_key)` is 27.9/27.13's duplicate prevention, and `message_id` SET NULL keeps the audit trail when a message is deleted |
| Writes | server-only: RLS owner-SELECT only, INSERT/UPDATE/DELETE revoked from `authenticated` (the messages posture), so no client can forge or settle an action |
| Anchor (27.13) | `tasks.source_action_id` / `events.source_action_id` → `assistant_actions` (SET NULL) plus the partial unique `(user_id, source_action_id) where source_action_id is not null`: a crashed confirmation's retry finds the created row through the anchor and settles `succeeded`, and the unique index makes a second insert impossible. Presentations carry no anchor — a crashed presentation confirmation stays honestly UNAVAILABLE on retry |
| Executor | `frontend/lib/data/assistantActionLog.ts`: claim `proposed → confirmed` (one winner), run the mapping (`createTask`/`createEvent`/`createPresentationForUser`), settle `succeeded`/`failed`; a terminal row returns its stored state and never re-executes |
| Copy | only sanitized strings (`ASSISTANT_ACTION_COPY`, `presentationErrors.ts`) ever reach the confirmation card; raw PostgREST/provider errors stay server-side |
| Extraction | **provider-dependent**: the assistant that would emit the fenced `unipilot-action` blocks is unconfigured (26.1), so extraction is proven through the SSE stub fixture and directly-constructed actions; registration, the executor and the confirmation UI are live |

**Proof:** `frontend/tests/qa/assistant-actions.spec.ts` (the 27.1 contract,
the real log, the executor, the wired presentation deck + queued job, the
anchor recovery), `frontend/tests/qa/assistant-ui.spec.ts` (the confirmation
cards, reject, the owner-verified document link, the wired presentation card)
and `assistant-backend.spec.ts` (the turn pipeline's registration).

### WhatsApp integration (Task 46.x)

Four migrations: `20260912120000_whatsapp_integration.sql` (the schema),
`20260912120100_whatsapp_exports_bucket.sql` (the private export bucket),
`20260913050000_whatsapp_review_mode.sql` (review mode) and
`20260913080000_whatsapp_detection_settings.sql` (detection settings). The
Python service in `whatsapp/` (spawned by `backend/worker/whatsappJobs.mjs`) is
the only writer of the raw rows; `frontend/lib/data/integrations.ts` owns the
review, reservation and hygiene writes. Both write through the service role —
the browser never writes any of these tables.

| Piece | Decision |
| --- | --- |
| `integration_connections` | One row per `(user_id, provider)`; `provider` `whatsapp`/`google`, `mode` NULL (google) or `export`/`live` (whatsapp only), `status` `pending`/`connected`/`disconnected`/`error`; `profile_ref` names the worker's browser profile; `qr_data_enc`/`qr_expires_at` hold the encrypted live QR only |
| `integration_runs` | One scan/sync per row; `mode` `export`/`live`, `status` `queued`/`running`/`succeeded`/`failed`; the input CHECK requires `storage_path` XOR `chat_name`; `message_count`/`candidate_count` default 0 with `>= 0` checks |
| Review mode | `integration_connections.review_mode` / `integration_runs.review_mode`: text not null default `manual`, CHECK `manual`/`automatic` (46.21–46.25). The connection column is the user's default choice, persisted by the next upload (`reserveExportRun` patches `review_mode` only — a live row's `mode`/`status` are never clobbered); the run column records the mode actually used. Automatic settles the user's pending candidates whose fingerprints the run re-detects (new or earlier runs), inserting events only for that pending set; pending candidates outside the detected set — e.g. from another chat — stay pending, and rejected or already-confirmed fingerprints are never resurrected or re-pushed. It enqueues `whatsapp.push` only when a google connection and the Google client env pair exist. Accepted M1 mixed state: a candidate rejected mid-run can leave one orphan event; the orphan event is accepted, and any later insert with the same `source_ref` resolves to it instead of duplicating |
| Detection settings | `integration_connections.date_order`: text not null default `DMY`, CHECK `DMY`/`MDY` (46.26–46.30). It is the **user preference on the persistence/extraction path**: message-TEXT numeric dates ("9/10") are read with it (DMY = 9 Oct, MDY = Sep 10), and `reserveExportRun` persists it with the next upload. The export **envelope** uses its own inferred order, falling back to the connection's order — `infer_date_order` infers its order from unambiguous 1–2 digit components (majority signal; tie → `None`; year-first/ISO envelopes carry no signal) and `sync` falls back to the connection's order. The export path uses the `integration_connections.date_order` column; `Settings.date_order` (`DATE_ORDER` env, DMY default) is now consulted only by `live._sort_key`. `integration_connections.detect_relative_dates`: boolean not null default false. Opt-in conservative gate: a weekday/relative mention qualifies only when the message also carries a clock time or an academic keyword (submission/submit/exam/deadline/presentation/class/test/quiz/assignment/viva/due), all-day when no time; time-only mentions stay rejected in both modes |
| `integration_messages` | Raw imported messages, unique `(run_id, position)`; the 30-day purge target |
| `integration_candidates` | Detected events awaiting review; unique `(user_id, fingerprint)`; dates, `all_day`, the reviewed message copy, `status` `pending`/`confirmed`/`rejected`, `event_id`, push state |
| `google_calendar_credentials` | One row per user: `refresh_token_enc` bytea (pgcrypto), `scope`, `calendar_id`; **no table grants for `anon`, `authenticated` or `service_role`** and no RLS policy — reachable only through the definer RPCs below |
| RLS | The four owner tables: RLS enabled, one `*_select_own` policy each (`auth.uid() = user_id`), `authenticated` SELECT-only; every client write is revoked (no write policy), `service_role` holds all. `google_calendar_credentials` is deny-by-default |
| RPCs (8) | `upsert_google_credentials(uuid,text,text,text,text)` · `get_google_credentials(uuid,text)` · `delete_google_credentials(uuid)` · `rotate_google_token_key(text,text)` · `set_whatsapp_qr(uuid,text,text,integer)` · `get_whatsapp_qr(uuid,text)` · `clear_whatsapp_qr(uuid)` · `touch_job(uuid,text)` — all `security definer` with `search_path = ''`; EXECUTE revoked from `public`/`anon`/`authenticated` before the `service_role` grants (the 29.1 default-grant trap) |
| Limits (D13) | One active run (`queued`/`running`) per user, 20 runs per rolling 24 h, 5,000 messages and 500 candidates per run (Python `WHATSAPP_MESSAGE_CAP`/`WHATSAPP_CANDIDATE_CAP` defaults, mirrored by the TS constants in `frontend/lib/data/integrationValues.ts`). The guard counts through the owner-RLS client (`head: true`, exact count); the browser upload is re-checked at finalize |
| Stale sweeps | On every `/integrations` overview read, best-effort and read-triggered (no scheduler): a `queued` run older than 1 h (upload never finalized) and a `running` run older than 1 h (worker died outside a `ServiceError`) are marked `failed` with sanitized copy (`WHATSAPP_ACTIVE_WINDOW_MS = 3_600_000`) |
| Events provenance | `events.source` text not null default `manual` (CHECK `manual`/`whatsapp`) + `events.source_ref`; unique `events_user_source_ref_key (user_id, source, source_ref)`; the security-invoker trigger `lock_event_provenance` fires before insert/update of `source`/`source_ref` and overwrites both to `manual`/NULL for every caller whose `auth.role()` is not `service_role`, so no client can forge WhatsApp provenance. The service writers reach PostgREST with the service key (so `auth.role()` reads `service_role`); confirm upserts on the unique key, so a re-scan or double-click cannot duplicate the event |
| QR TTL | `set_whatsapp_qr` encrypts the data-URL and stamps `qr_expires_at = now() + least(greatest(coalesce(p_ttl_seconds, 60), 5), 300)` (Python sends 60); `get_whatsapp_qr` returns it only while unexpired and clears both columns when stale; `clear_whatsapp_qr` runs on connect, on QR timeout and on disconnect. The payload is never plain, never logged |
| Retention | `integration_messages` older than 30 days are purged on the next `/integrations` overview read (service role, `created_at < now - 30 days`) — **read-triggered; a scheduled purge is a future item**. Candidates keep the one reviewed message they were built from (`message_sender`/`message_text` copies; `message_id` SET NULL). Disconnect deletes the owner's raw message archive and its `whatsapp.disconnect` job purges the on-disk browser profile |
| Export objects | Removed by `whatsapp.sync` on success and on a terminal failure; a retryable failure keeps the object for the retry. The browser uploads directly to `<user_id>/<run_id>/export.txt`, finalize re-checks existence and size, abort removes object + row |
| Bucket | `whatsapp-exports`: private, 25 MiB (`26214400`), `text/plain` only; four owner-folder policies (`whatsapp_exports_objects_{select,insert,update,delete}_own`) keyed on `(storage.foldername(name))[1] = auth.uid()::text`, exactly like `documents` |
| Key | `UNIPILOT_INTEGRATIONS_KEY`, server env only: locally `frontend/.env.development.local`, platform secret store in production; never in the DB, never `NEXT_PUBLIC_*`; inherited by the worker host (env file) and passed to the Python child. `upsert_google_credentials` stores `extensions.pgp_sym_encrypt(refresh_token, key)`; **access tokens are never persisted** (the push worker mints an in-memory one per run) |
| Rotation | 1) Generate a new random key; 2) call `public.rotate_google_token_key(p_old, p_new)` as the service role (re-encrypts every stored token); 3) swap the env value on the Next server and the worker host; 4) restart both. QR rows need no rotation (60 s TTL) |
| Logging condition (P0.2) | pgcrypto is safe only while no logging trigger can capture the RPC statement. Measured on the local stack: `log_statement=ddl`, `log_min_duration_statement=-1`, `log_min_duration_sample=-1`, `log_transaction_sample_rate=0`, `log_parameter_max_length=-1`, `log_parameter_max_length_on_error=0`, `log_min_error_statement=error`, `log_min_messages=warning`, pgaudit `none`; `pg_stat_statements` stores normalized text with placeholders. **Supabase Vault is required** if `log_statement` is `all`/`mod`, any duration/sample/transaction logging is on (`log_min_duration_statement`/`log_min_duration_sample` >= 0, `log_transaction_sample_rate` > 0), `log_parameter_max_length` is `-1` or `> 0` while a logging trigger is active, `log_parameter_max_length_on_error` != 0, or an audit extension logs these calls — then move the secrets to `vault.create_secret`/`vault.decrypted_secrets` behind the same RPCs and record it here |
| Google push | Insert-only and deduped by fingerprint: the worker lists `privateExtendedProperty=[unipilot_source_ref=<fingerprint>]` first and only inserts when absent. **Editing or deleting a confirmed UniPilot event does not update or delete the Google event** — the connected panel says so verbatim ("Pushed once — editing or deleting an event here doesn't change Google Calendar."). `invalid_grant` writes the candidate's `push_error` and flips the connection to `error` |
| `touch_job` | The additive 29.1 lease extension: `touch_job(p_job_id, p_worker_id)` moves `locked_at` to now only for the `running` job held by that worker and raises otherwise; service-role only, called by long scans through the job heartbeat |

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
- Assistant action engine (27.x): `assistant_actions_user_conversation_idx`
  (`user_id, conversation_id`) and `assistant_actions_message_id_idx`; the
  partial unique anchors `tasks_user_source_action_id_key` /
  `events_user_source_action_id_key` on `(user_id, source_action_id) where
  source_action_id is not null` (27.13 — also the retry lookup's access path).
- WhatsApp integration: unique `events_user_source_ref_key`
  (`user_id, source, source_ref`); `integration_runs_user_created_idx`
  (`user_id, created_at desc`) and `integration_runs_status_idx`;
  `integration_messages_user_sent_idx` (`user_id, sent_at`);
  `integration_candidates_user_status_idx` (`user_id, status`) and
  `integration_candidates_run_idx` (`run_id`); unique
  `integration_connections_user_provider_key` (`user_id, provider`),
  `integration_messages_run_position_key` (`run_id, position`) and
  `integration_candidates_user_fingerprint_key` (`user_id, fingerprint`).

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
- `events.source`: `manual` · `whatsapp` (Task 46.x). `manual` is the default
  and is forced by the `lock_event_provenance` trigger for every non-service
  caller; only a `whatsapp` row carries a `source_ref` fingerprint, and the
  unique `(user_id, source, source_ref)` key is the dedupe.
- `messages.role`: `user` · `assistant` · `system`
- `messages.status`: `complete` · `failed` (Task 26.x). A failed turn stores
  sanitized copy and says so; a failed assistant message is never presented
  as an answer.
- `assistant_actions.type`: `task.create` · `reminder.create` · `event.create`
  · `presentation.create` (Task 27.x). The vocabulary is closed: an unknown
  type cannot even be logged, and adding a fifth type needs a forward
  migration plus the TypeScript union.
- `assistant_actions.status`: `proposed` · `confirmed` · `rejected` ·
  `succeeded` · `failed` (Task 27.x). `proposed → confirmed | rejected`, then
  `confirmed → succeeded | failed`; `settled_at` marks the terminal
  transition. `confirmed` is the claimed-but-unsettled crash state, recovered
  through the `source_action_id` anchor (27.13).
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
- `integration_connections.provider`: `whatsapp` · `google`; `.mode`: NULL
  (google) · `export` · `live` (whatsapp only); `.status`: `pending` ·
  `connected` · `disconnected` · `error` (Task 46.x)
- `integration_runs.mode`: `export` · `live`; `.status`: `queued` · `running` ·
  `succeeded` · `failed` (Task 46.x)
- `integration_connections.review_mode` / `integration_runs.review_mode`:
  `manual` · `automatic` (Task 46.x). `manual` is the default and keeps the
  pending-candidate review flow; `automatic` settles the user's pending
  candidates whose fingerprints the run re-detects on sync completion (new or
  from earlier runs), inserting events only for that pending set — pending
  candidates outside the detected set stay pending, and rejected or
  already-confirmed fingerprints are never resurrected.
- `integration_connections.date_order`: `DMY` · `MDY` (Task 46.x). `DMY` is
  the default and matches the founder's export; it governs ambiguous numeric
  dates in message TEXT only — the export envelope uses its own inferred
  order, falling back to the connection's order; the export path uses the
  connection column and the `DATE_ORDER` env is consulted only by
  `live._sort_key`.
  `detect_relative_dates` is a boolean (default false): the opt-in
  conservative gate for weekday/relative mentions (clock time or academic
  keyword required; all-day without a time).
- `integration_candidates.status`: `pending` · `confirmed` · `rejected`
  (Task 46.x). Rejection is terminal — the fingerprint is unique, so a
  dismissed suggestion cannot come back on a re-scan.

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

## Verification performed (local, 2026-09-13)

- `supabase db reset` applied all eighteen migrations cleanly, repeatably on
  a fresh database: `20260911011824_init_schema.sql`,
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
  `20260912072153_documents_failed_state.sql`,
  `20260912095011_search_embeddings.sql`,
  `20260912103529_assistant_persistence.sql`,
  `20260912120000_whatsapp_integration.sql`,
  `20260912120100_whatsapp_exports_bucket.sql`,
  `20260913050000_whatsapp_review_mode.sql`,
  `20260913080000_whatsapp_detection_settings.sql`.
- `supabase migration list --local` shows all eighteen versions applied;
  `supabase db lint` → "No schema errors found".
- Detection settings (46.26–46.30): `integration_connections` carries
  `date_order` (default `DMY`, CHECK `DMY`/`MDY`) and `detect_relative_dates`
  (default false) with their column comments; applied with
  `supabase migration up` (no reset) and the founder's 3 runs / 1034 messages
  stayed unchanged, while `db:lint`/`db:check-types` are clean.
- Assistant (26.x): `messages` carries the status/sources columns, its write
  grants are revoked from `authenticated` (server-only writes), the ordering
  indexes exist, and the turn pipeline's persistence/RAG/limits are proven by
  `frontend/tests/qa/assistant-backend.spec.ts`.
- Action engine (27.x): `assistant_actions` carries the closed `type`/`status`
  CHECKs, the per-user idempotency key and owner-SELECT-only RLS; the
  `tasks`/`events.source_action_id` anchors and their partial unique indexes
  are applied (`20260923125254_assistant_action_source_anchors.sql`), and
  `db:reset`/`db:lint`/`db:check-types` are clean.
- Search (25.x): the extension is installed in `extensions`, the embedding and
  page columns match the declared types, the HNSW + GIN indexes exist, and the
  function ACL is `authenticated` + `service_role` only; the live query path is
  proven by `frontend/tests/qa/documents-search.spec.ts`.
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
- 18/18 tables exist; `relrowsecurity = true` on each; 41 policies total
  (matrix above); 17 `updated_at` triggers + `on_auth_user_created` on
  `auth.users`; 52 indexes (public schema); `anon` has zero grants and no job
  or search function EXECUTE.
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
  includes `timezone` and all 18 tables are present; `server.ts`, `client.ts`
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
