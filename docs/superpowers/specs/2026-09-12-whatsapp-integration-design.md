# WhatsApp integration — design

Date: 2026-09-12
Status: revised after founder review (2026-09-12) — awaiting re-review; not
yet approved for implementation.
Task IDs: TASK.md `46.11`–`46.20` (founder-requested insertion; see D9).

## 1. Summary

A Python service under `whatsapp/` turns WhatsApp chats into UniPilot calendar
events, driven by the Task 29.1 background job runner through four new job
kinds (`whatsapp.connect`, `whatsapp.sync`, `whatsapp.push`,
`whatsapp.disconnect`). Results are
persisted server-side in new owner-only tables; the student reviews detected
candidates on `/integrations` and confirms them into `events` (tagged
`source='whatsapp'`) and into their Google Calendar when connected.

The existing tool (`whatsapp/Default Project/`) supplied the proven message
parser (`whatsapp_reader.py`) and event extractor (`event_extractor.py`); those
rules are moved, not rewritten.

## 2. Goal / non-goals

Goal:

- Export-upload path (hosted): drop/upload a WhatsApp `.txt` export.
- Live path (self-host only, env-gated): WhatsApp Web via Selenium with a
  per-user browser profile and a pollable QR/status surface.
- Candidate review: confirm/reject detected events with honest states.
- Confirmed events land in `events` with `source='whatsapp'` and are pushed to
  the connected Google Calendar, deduped by fingerprint.
- `/calendar` marks WhatsApp-sourced events.

Non-goals:

- Sending WhatsApp messages or reminders (this is inbound extraction only;
  the old "Coming soon" card copy promised reminders and is replaced).
- Gmail integration (card stays coming-soon).
- Hosted live mode: live mode never runs on the hosted deployment.
- Two-way Google Calendar sync (push only, matching `calendar_sync.py`).
  Editing or deleting a confirmed event in UniPilot does not update or remove
  the Google event (one-way push limitation; recorded in §9 and §14).

## 3. STEP 0 security record (done before this design)

- Deleted from `whatsapp/Default Project/`: `credentials.json`, `token.json`,
  `.wa_profile/`, `data/`, `output/`, `__pycache__/`.
- Root `.gitignore` gained `/whatsapp/**/.wa_profile/`,
  `/whatsapp/**/credentials.json`, `/whatsapp/**/token.json`,
  `/whatsapp/**/.env`, `/whatsapp/**/data/`, `/whatsapp/**/output/`,
  `/whatsapp/**/__pycache__/`, `*.pyc`; `.env.example` stays tracked.
- Verified: `git check-ignore` matches every path; `git status` shows no secret.
  The folder was untracked, so no history scrub is needed.
- User-side rotation still required: rotate the Google OAuth client/secret,
  revoke the old token, unlink the WhatsApp linked device.

## 4. Architecture

```
/integrations (Next.js)
  │  upload .txt              │ start live connect/scan         │ confirm/reject
  ▼                           ▼                                 ▼
whatsapp-exports bucket   integration_runs row             Server Actions (gated)
  │                           │                                 │
  └─ finalize → enqueueJob("whatsapp.sync", {runId})             ├─ insert events (source_ref = fingerprint)
                              │                                 └─ enqueueJob("whatsapp.push", {candidateId})
                              ▼
backend/worker/run.mjs (Task 29.1)
  │  claim_jobs → handler →
  │  spawn(`python -m wa_service`, JSON payload on stdin)
  ▼
whatsapp/wa_service (Python)
  ├─ reads run/profile/token via PostgREST (service role)
  ├─ export: download object → parse → extract → write messages+candidates
  ├─ live:   Selenium per-user profile → QR → collect → same write path
  └─ push:   refresh Google token → insert with extendedProperty dedupe
                              │
                              ▼
Supabase (integration_runs / integration_messages / integration_candidates /
          events / google_calendar_credentials)
```

Data flow decisions:

- The Node handler owns the Supabase connection and the spawn; Python receives
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in its environment (never argv,
  never the job payload) and writes rows itself with the service role.
- The job payload carries ids only (`{ runId }` / `{ candidateId }`), per the
  29.1 contract.
- Google tokens never leave the server; the browser only ever sees a boolean
  Google connection status. The live QR is the one credential-shaped payload a
  browser receives: owner-only, encrypted at rest, TTL'd, and never logged
  (§6.2).

## 5. Decisions

D1. **Service home**: keep the top-level `whatsapp/` path; delete the
`Default Project/` nesting; the importable package is `whatsapp/wa_service/`.
Rationale: the STEP 0 ignore rules are rooted at `/whatsapp/**`, the source
tool's provenance stays obvious, and the root monorepo layout (`frontend/`,
`backend/`) is untouched. `backend/worker/whatsappJobs.mjs` spawns it.

D2. **Upload transport**: a private `whatsapp-exports` Storage bucket
(`text/plain`, 25 MiB — the same cap as documents, so the product has one
upload story), path `{user_id}/{run_id}/export.txt`, uploaded directly from
the browser with the session token exactly like documents. Rationale: the
proven 23.x pipeline; no Server Action body-size workarounds; the Python
service downloads it server-side.

D3. **Dedupe scope**: `integration_candidates` is unique per
`(user_id, fingerprint)` and `events` is unique per
`(user_id, source, source_ref)`. A re-sync can neither resurface a reviewed
candidate nor create a second event; `NULL` `source_ref` keeps manual events
unconstrained (Postgres default `NULLS DISTINCT`). **Rejection is terminal**:
a rejected candidate keeps its fingerprint, so re-syncing or re-uploading the
same chat never re-offers it; the UI copy and the reject confirmation say so,
and the event can still be created manually from `/calendar`.

D4. **Push is its own job** (`whatsapp.push`): OAuth refresh and Google API
calls live in Python; the worker retries with the existing backoff; the
frontend stays responsive. Idempotency comes from `candidates.pushed_at` plus a
Google `privateExtendedProperty` lookup keyed by the fingerprint.

D5. **Server-only writes**: `integration_connections`, `integration_runs`,
`integration_messages`, `integration_candidates` get owner `SELECT` policies
and no client write policies; every mutation runs in a gated Server Action
through the service client. `google_calendar_credentials` has no policies and
no table grants for any API role — only security-definer RPCs (§6.6).
`events` keeps its owner CRUD, but provenance is server-only: a
`security invoker` trigger forces `source='manual'`/`source_ref=NULL` for every
caller that is not the service role, so a crafted authenticated request cannot
forge a WhatsApp-sourced event (§6.1).

D6. **Live mode is self-host only**: gated by `UNIPILOT_WHATSAPP_LIVE=1` (read
server-side) and marked `[!]` verified-blocked in this environment (needs a
self-host Chrome + phone QR scan). No fake status is ever shown.

D7. **Google Calendar**: per-user OAuth using an app-owned client from server
env (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`); refresh token
stored in the server-only table. When the env is absent the card reads "Not
configured on this server" and no Connect control is offered. E2E push
verification is `[!]` blocked with the exact dependency; pytest covers the
insert/dedupe against a mocked Google client.

D8. **Lease heartbeat**: the `whatsapp.sync` handler keeps a long Python scan
alive with a new `touch_job` RPC while the child runs (live scans can exceed
the 5-minute claim lease). This is a small, additive extension of the 29.1
protocol; it never changes existing job semantics.

D9. **Task IDs**: append `46.11`–`46.20` under `# 46. Calendar Integrations`;
add Stage 3 execution item 24; append a CURRENT STATE entry. Existing `46.x`
items stay untouched even where this work overlaps them (46.2/46.3/46.4/46.6
note the overlap in their eventual wrap-up, but this task does not claim them).
Adding this work as **Stage 3 item 24 is a founder-requested insertion** — the
roadmap originally scheduled integrations in Stage 7; the Stage 3/Execution
Order entry records that it was pulled forward by founder request so the
ordering stays honest.

D10. **Baseline correction**: the suite is at 145/145, not 141/141; the new
specs extend that count.

D11. **Secrets at rest**: Google refresh tokens and live QR payloads are
encrypted with pgcrypto (`pgp_sym_encrypt`) under a single server-only env key,
`UNIPILOT_INTEGRATIONS_KEY`. The key lives only in the server environment
(`frontend/.env*.local` locally, the platform secret store in production), is
never in the database, never in a `NEXT_PUBLIC_*` variable, and never logged.
Google access tokens are never persisted at all (§6.6). Rotation: generate a
new key, run the `rotate_google_token_key(p_old, p_new)` definer RPC, then swap
the env value; QR rows need no rotation because they expire in under two
minutes (§6.2). Key home and rotation are documented in DATABASE.md.

D12. **Privacy and retention**: the uploaded export object is deleted as soon
as the sync job reaches a terminal state (succeeded, permanent failure, or
attempts exhausted — the Node handler owns this because it knows the retry
outcome). `integration_messages` (the raw chat archive) is purged
best-effort after 30 days and deleted immediately on disconnect; candidate
rows keep only the single reviewed message as provenance. Message bodies, QR
payloads and tokens never appear in logs, error strings, or test artifacts
(§6.10).

D13. **Limits and delivery contract**: one active WhatsApp run per user at a
time, 20 runs per rolling 24 h, 5,000 parsed messages per run and 500 new
candidates per run — enforced in the Server Actions before enqueue and in the
Python service as a hard stop, with sanitized over-limit copy mirroring the
document quota. Separately: **`npm run test` must stay runnable without
Python** (Python-dependent specs honest-skip with a clear reason, never a
false pass; `UNIPILOT_REQUIRE_PYTHON=1` turns those skips into failures), and
`npm run test:whatsapp` runs pytest plus the Python-dependent specs. The
worker host that serves export/push must ship Python + `wa_service` + the
declared dependencies; §8 and §13 state that deployment contract.

## 6. Data model

One migration for the schema (events provenance, the four integration tables,
the encrypted credential RPCs, `touch_job`) plus one for the bucket, following
20.6/23.1 style (comments, named CHECKs, owner RLS, explicit grants, indexes,
`updated_at` trigger). No data migration (Rule 5).

Grants for the four integration tables follow the 29.1 pattern explicitly:
`revoke all` from `anon`, `grant select` to `authenticated` (RLS then filters
rows), `grant all` to `service_role`; only the credential table is tighter
(§6.6).

### 6.1 `events` provenance

```sql
alter table public.events
  add column source text not null default 'manual'
    constraint events_source_check check (source in ('manual', 'whatsapp')),
  add column source_ref text;

create unique index events_user_source_ref_key
  on public.events (user_id, source, source_ref);
```

`source_ref` is the detector fingerprint (32 hex chars) for WhatsApp rows and
`NULL` for manual rows. Comment both columns.

Provenance is server-only, enforced by a `security invoker` trigger in the same
style as `ensure_event_subject_owner` (22.x): any caller that is not the
service role — i.e. every browser session — has `source` reset to `'manual'`
and `source_ref` cleared, so a crafted authenticated insert/update can neither
forge a WhatsApp tag nor collide with the dedupe index:

```sql
create or replace function public.lock_event_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
  end if;
  return new;
end;
$$;

create trigger lock_event_provenance
  before insert or update of source, source_ref on public.events
  for each row execute function public.lock_event_provenance();
```

The RLS isolation spec proves the forge attempt: an authenticated client insert
with `source='whatsapp'` lands as a manual event, and a `source_ref` update is
ignored.

### 6.2 `integration_connections`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null → auth.users cascade | |
| provider | text not null | CHECK `whatsapp \| google` |
| mode | text | CHECK `export \| live`; provider consistency: `(provider = 'whatsapp') = (mode is not null)` |
| status | text not null default 'pending' | CHECK `pending \| connected \| disconnected \| error` |
| profile_ref | text | self-host browser profile key (`<user_id>`) |
| qr_data_enc | bytea | `pgp_sym_encrypt(qr data-URL, key)` while `pending`; never plain, never logged |
| qr_expires_at | timestamptz | hard TTL (60 s); an expired QR is treated as absent and cleared |
| last_error | text | sanitized |
| created_at / updated_at | timestamptz | trigger |

Unique `(user_id, provider)`. RLS: owner `SELECT` only; `revoke all` +
`grant select to authenticated`; `grant all to service_role`.

The live QR is a login credential, so it is never persisted in the clear and
never outlives its usefulness. Three definer RPCs (the two that touch the
payload take the key per call; all three granted to `service_role` only and
revoked from `anon`/`authenticated`) own the flow:

- `set_whatsapp_qr(p_connection_id, p_qr, p_key, p_ttl_seconds)` —
  encrypts and stamps `qr_expires_at`; the connect job re-arms it every ~20 s
  while pending (WhatsApp rotates its own QR on about that cadence);
- `get_whatsapp_qr(p_connection_id, p_key)` — returns the data-URL only to a
  server caller while unexpired; an expired row returns NULL and the columns
  are cleared in the same call;
- `clear_whatsapp_qr(p_connection_id)` — called immediately on connect
  success, on timeout/error, and on disconnect.

The QR never appears in Python/Node logs, job payloads, error strings,
screenshots, or test fixtures. The frontend holds it only in component state
for the pending window and does not cache it.

### 6.3 `integration_runs`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null cascade | |
| connection_id | uuid → integration_connections set null | live runs |
| mode | text not null | CHECK `export \| live` |
| status | text not null default 'queued' | CHECK `queued \| running \| succeeded \| failed` |
| storage_path | text | export only: object key in `whatsapp-exports`, no bucket prefix, e.g. `{user_id}/{run_id}/export.txt` |
| chat_name | text | live only: the chat typed by the user |
| message_count | integer not null default 0 ≥ 0 | parsed after sender filtering; capped (D13) |
| candidate_count | integer not null default 0 ≥ 0 | new candidates inserted (dedupe-aware); capped (D13) |
| error | text | sanitized |
| started_at / completed_at | timestamptz | |
| created_at / updated_at | timestamptz | trigger |

The input reference is deliberately split into two typed columns (there is no
ambiguous `input_ref`). A CHECK keeps the pair unambiguous:
`(mode = 'export') = (storage_path is not null)` and
`(mode = 'live') = (chat_name is not null)`; the export path is known when the
run is created (the Server Action generates the run id), so no nullable interim
state exists.

Indexes: `(user_id, created_at desc)`, `(status)`. RLS owner `SELECT` only.

### 6.4 `integration_messages`

`id`, `run_id` → runs cascade, `user_id` → users cascade, `position integer
not null ≥ 0`, `sender text not null`, `sent_at timestamptz not null`,
`body text not null`, `created_at`. Unique `(run_id, position)`; index
`(user_id, sent_at)`. RLS owner `SELECT` only.

### 6.5 `integration_candidates`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid not null cascade | |
| run_id | uuid not null → runs cascade | first run that detected it |
| fingerprint | text not null | detector hash |
| title | text not null | cleaned title |
| start_at | timestamptz not null | UTC instant |
| end_at | timestamptz | |
| all_day | boolean not null default false | |
| message_id | uuid → integration_messages set null | |
| message_sender | text not null | |
| message_text | text not null | snapshot |
| status | text not null default 'pending' | CHECK `pending \| confirmed \| rejected` |
| event_id | uuid → events set null | set on confirm |
| pushed_at | timestamptz | Google push idempotency marker |
| provider_event_id | text | Google event id |
| push_error | text | sanitized |
| created_at / updated_at | timestamptz | trigger |

Unique `(user_id, fingerprint)`; indexes `(user_id, status)`, `(run_id)`.
RLS owner `SELECT` only.

`rejected` is terminal: the unique fingerprint means a re-sync or re-upload
never resurrects it, and the confirm modal says so before rejecting (D3).

### 6.6 `google_calendar_credentials` (encrypted at rest)

| column | type | notes |
|---|---|---|
| user_id | uuid pk → users cascade | |
| refresh_token_enc | bytea not null | `pgp_sym_encrypt(refresh_token, key)`; the only stored token |
| scope | text | granted scopes |
| calendar_id | text not null default 'primary' | |
| connected_at | timestamptz | |
| updated_at | timestamptz | trigger |

No plaintext token column exists, and **access tokens are never persisted** —
the callback discards the one Google returns, and the push job mints a
short-lived access token in memory from the encrypted refresh token on every
run. The table has RLS enabled with zero policies and **no table grants for
any API role** (including `service_role`); it is reachable only through
security-definer RPCs that take the server-only key per call and are
`revoke`d from `public`/`anon`/`authenticated` and `grant`ed to
`service_role`:

- `upsert_google_credentials(p_user_id, p_refresh_token, p_scope,
  p_calendar_id, p_key)` — insert or replace, encrypting with `p_key`;
- `get_google_credentials(p_user_id, p_key)` — returns metadata plus the
  decrypted refresh token; used by the push job only;
- `delete_google_credentials(p_user_id)` — disconnect;
- `rotate_google_token_key(p_old_key, p_new_key)` — re-encrypts every row
  under the new key (the documented rotation step, D11).

The key (`UNIPILOT_INTEGRATIONS_KEY`) lives only in the server environment,
never in the database and never in a client-visible variable. Postgres
statement logging stays off (Supabase default), so the per-call key does not
reach query logs. DATABASE.md records the key's home and the rotation
runbook; there is no deferred-hardening caveat — encryption ships with this
task.

### 6.7 `whatsapp-exports` bucket

`storage.buckets` row: private, 25 MiB (`26214400`), `text/plain` — the same
cap as `documents` (D2). RLS on `storage.objects` mirrors
`documents_objects_*` with `bucket_id = 'whatsapp-exports'` and the
`{user_id}/…` owner-folder check for select/insert/update/delete.

### 6.8 `touch_job` (29.1 protocol extension)

`public.touch_job(p_job_id uuid, p_worker_id text) returns void`: extends
`locked_at` to `now()` only when the job is `running` and `locked_by` matches;
security definer, `set search_path = ''`, revoked from `public/anon/
authenticated`, granted to `service_role`.

### 6.9 Type regeneration

`npm run db:reset` → `npm run db:types` (regenerates
`frontend/lib/supabase/database.types.ts`, including the new tables and RPC
signatures) → `npm run db:check-types`.

### 6.10 Privacy and retention

- **Export objects**: the Node handler deletes the `whatsapp-exports` object
  when the job settles terminally — on success, on a non-retryable failure, or
  when attempts are exhausted. While a retry is still possible the object is
  kept so the retry can read it; after the last attempt it is removed. The
  `abortExportRunAction` deletes the object and the run row immediately when
  the client upload fails.
- **Stale queued runs**: an export run created but never finalized (browser
  closed mid-upload) stops counting as active after 60 minutes; the next
  overview read marks it `failed` with the sanitized "upload never finished"
  error (best-effort, same hook as the retention purge). This keeps the
  one-active-run rule from locking a user out after an abandoned upload.
- **Raw archive (`integration_messages`)**: best-effort purge of rows older
  than 30 days, executed by the server-side overview read
  (`getWhatsAppOverview`, which calls `purgeExpiredWhatsAppMessages(userId)`)
  at the next `/integrations` visit by that user — there is no scheduler yet,
  so the rule is "on next use", stated in DATABASE.md; deleted immediately on
  WhatsApp disconnect; cascade-deleted with the user.
- **Candidates**: keep `message_sender` + `message_text` for the single
  reviewed message (provenance); they are not the bulk archive.
- **Never logged**: message bodies, QR payloads, tokens, and the encryption
  key are excluded from Python/Node logs, `last_error`/`error` strings, job
  payloads, screenshots, and test artifacts. Errors are sanitized before they
  reach any table or UI.

### 6.11 Limits (D13)

| limit | value | enforced where |
|---|---|---|
| active runs per user | 1 | Server Action before enqueue |
| runs per user / rolling 24 h | 20 | Server Action before enqueue |
| messages parsed per run | 5,000 | Python hard stop (counts stay honest) |
| new candidates per run | 500 | Python hard stop |

Over-limit responses use sanitized copy in `integrationErrors.ts` (mirroring
the documents quota), never raw database errors. The Python caps are the
backstop: a capped run still ends `succeeded` with the capped counts, and the
UI states plainly that the input was truncated.

## 7. Job protocol

| kind | payload | handler |
|---|---|---|
| `whatsapp.connect` | `{ connectionId }` | spawn `wa_service connect` |
| `whatsapp.sync` | `{ runId }` | spawn `wa_service sync` |
| `whatsapp.push` | `{ candidateId }` | spawn `wa_service push` |
| `whatsapp.disconnect` | `{ userId }` | spawn `wa_service disconnect` |

- `backend/worker/whatsappJobs.mjs` exports the four handlers. Shared helper
  `spawnWhatsApp(action, payload, ctx)`:
  - `spawn(process.env.WHATSAPP_PYTHON ?? "python", ["-m", "wa_service", action], { cwd: <repo>/whatsapp, env: { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UNIPILOT_INTEGRATIONS_KEY } })`;
  - payload JSON on stdin, closed after write;
  - stdout captured for a JSON result line; stderr logged via `ctx.log` (no
    secrets, no message bodies, no QR);
  - a `setInterval` heartbeat calls `touch_job` every 60 s while the child
    runs; cleared on exit;
  - **mode-aware safety timeout** — the handler loads the run row to pick it:
    export sync `WHATSAPP_SYNC_TIMEOUT` (default 5 min); live sync derived from
    the LIVE knobs, `120 s + LIVE_MAX_MESSAGES × LIVE_SCROLL_WAIT +
    LIVE_STALE_ROUNDS × 15 s`, floored at 10 min; connect
    `LIVE_QR_TIMEOUT + 60 s`; push 2 min; disconnect 1 min. A killed child
    throws a retryable error;
  - terminal-state export cleanup: when the child exits, the handler deletes
    the run's `whatsapp-exports` object if there is no error, or the failure is
    non-retryable, or `attempt >= maxAttempts` (D12); the object survives
    exactly as long as a retry is possible;
  - child exit ≠ 0 → parse the JSON error `{ error, retryable }` from stdout if
    present and throw accordingly (Python declares `retryable=false` for
    invalid input / revoked Google grant / limits abuse).
- Enqueue points (all after their Server Action gate, via `enqueueJob`):
  - finalize export run → `whatsapp.sync`;
  - enable live access → `whatsapp.connect`;
  - start live scan → `whatsapp.sync`;
  - confirm candidate with a Google connection → `whatsapp.push`;
  - disconnect live access → `whatsapp.disconnect` (the action hides the
    connection immediately and deletes the raw archive; the job removes the
    on-disk profile).

## 8. Python service

Layout:

```
whatsapp/
  README.md                  # service doc: install, run, env, self-host
  .env.example               # updated (no credentials.json/token.json)
  .gitignore                 # retained; root rules also cover
  requirements.txt           # dateparser, requests
  requirements-live.txt      # selenium (self-host only)
  requirements-google.txt    # google-api-python-client, google-auth-oauthlib, google-auth-httplib2
  requirements-dev.txt       # pytest
  pytest.ini                 # pythonpath = .; testpaths = tests
  wa_service/
    __init__.py
    __main__.py              # CLI: connect | sync | push | disconnect, JSON stdin
    config.py                # env-driven; no global file paths
    models.py                # Message, DetectedEvent (moved as-is)
    reader.py                # = whatsapp_reader.py logic
    extractor.py             # = event_extractor.py logic (rules unchanged)
    live.py                  # = whatsapp_live.py, per-user profile dir + purge
    fingerprint.py           # = calendar_sync._event_fingerprint
    calendar_push.py         # token refresh + insert + extendedProperty dedupe
    supabase_client.py       # PostgREST + RPC helpers (service role)
    timezones.py             # naive local → UTC via zoneinfo + profile tz
  tests/
    fixtures/sample_chat.txt
    test_reader.py
    test_extractor.py
    test_fingerprint.py
    test_calendar_push.py
```

Contract details:

- `sync` (export): load run + profile timezone; download the run's
  `storage_path` object via the Storage REST endpoint with the service key;
  parse and extract; write `integration_messages` (position = message index)
  and upsert `integration_candidates` with
  `Prefer: resolution=ignore-duplicates` to count only new ones; update the
  run to `succeeded` with counts. Any failure updates the run to `failed` with
  sanitized `error` and exits non-zero. The parsed-message and candidate caps
  from D13 are hard stops; a capped run still succeeds and reports the capped
  counts.
- `sync` (live): open the per-user profile (`WHATSAPP_PROFILE_ROOT` env,
  default `whatsapp/.profiles/<user_id>`), open the chat named by `chat_name`,
  collect, then the same write path. Profiles are per user, created `0700`
  where the OS supports it, keyed by the validated user UUID, and never
  shared; live mode is documented as single-tenant, dedicated-worker-host
  only (no live mode on a shared/multi-tenant worker), and the profile is
  purged by `disconnect`. The Node handler never passes credentials beyond
  env.
- `connect` (live): launch the profile, wait for login up to
  `LIVE_QR_TIMEOUT`, call `set_whatsapp_qr` every ~20 s while pending, set
  `connected` and `clear_whatsapp_qr` on success, `error` + sanitized
  `last_error` and a cleared QR on timeout/failure. The QR is never written
  to logs or stdout.
- `disconnect`: validate the user id, remove
  `WHATSAPP_PROFILE_ROOT/<user_id>` recursively if present (no-op on a host
  that never held it), and exit cleanly; the connection row is already marked
  `disconnected` and the raw archive deleted server-side.
- `push`: load candidate + event + profile timezone; no-op when `pushed_at` is
  set or no credentials exist; decrypt the refresh token through
  `get_google_credentials`; mint an access token in memory only (never
  stored); look up `privateExtendedProperty`
  `unipilot_source_ref=<fingerprint>` before insert; insert; write
  `provider_event_id` + `pushed_at`; on `invalid_grant` set `retryable=false`
  and connection `status='error'`. One-way limitation: nothing here observes
  later edits/deletes of the UniPilot event.
- All-day events: stored instants are `[local 00:00, next-day local 00:00)`
  converted to UTC, matching `eventValues.ts`; Google gets `date` start and
  `end + 1 day`.
- Fingerprint: `sha256("start|end|sender|text.lower()[:200]")` truncated to
  32 hex chars (the `calendar_sync._event_fingerprint` rule, moved verbatim).
- Config: `DEFAULT_TIMEZONE` fallback, `DATE_ORDER` (default `DMY`),
  `IGNORE_SENDERS`, `LIVE_*` knobs as today; profile timezone wins over
  `DEFAULT_TIMEZONE`. The child also needs `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET` (token refresh) and
  `UNIPILOT_INTEGRATIONS_KEY` (RPC decrypt), all inherited from the worker's
  environment. Deterministic tests inject `now`/`tz` rather than relying on
  the wall clock.
- Removed global paths: `GOOGLE_CREDENTIALS_FILE`, `GOOGLE_TOKEN_FILE`,
  `pushed_log.json`, `WATCH_FOLDER`/`OUTPUT_FOLDER` file scanning (the run row
  names its input). Nothing in the service writes `.env`, tokens, or QR data
  to disk.

## 9. Google Calendar OAuth (per user)

- **Env ownership** (server-only, never `NEXT_PUBLIC_*`):
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `UNIPILOT_INTEGRATIONS_KEY`. Locally they live in
  `frontend/.env.development.local` (the Node worker loads that same file via
  `--env-file`, so the Python child inherits them); in production the platform
  secret store supplies them to **both** the Next server (code exchange,
  connect/disconnect RPCs) and the worker host (token refresh + RPC decrypt).
  §13 lists the exact example-file updates; a missing pair disables the
  feature honestly rather than failing at click time.
- `connectGoogleCalendarAction` (gated): if unconfigured → sanitized error
  ("Google Calendar isn't configured on this server."); otherwise sets a
  random `state` in an httpOnly cookie and redirects to Google's consent URL
  (`access_type=offline`, `prompt=consent`,
  scope `https://www.googleapis.com/auth/calendar.events`,
  redirect `{origin}/api/integrations/google/callback`).
- Route handler `frontend/app/api/integrations/google/callback/route.ts`:
  verifies state cookie + session user, exchanges the code, discards the
  access token Google returns, stores only the encrypted refresh token via
  `upsert_google_credentials` (§6.6), upserts the `google` connection row
  (`status='connected'`), enqueues `whatsapp.push` for already-confirmed,
  un-pushed candidates (bounded to 100, so a later connection backfills), then
  clears the cookie and redirects to `/integrations`.
- `disconnectGoogleCalendarAction` (gated): calls
  `delete_google_credentials` and marks the connection disconnected. Google's
  revoke endpoint is not called; the stored refresh token is destroyed, and
  revoking the grant from the Google account side always remains available.
- The UI shows real status only: `Connected`, `Not connected`, `Not configured
  on this server`, or `error` with a retry.
- **One-way limitation (documented, deliberately not solved)**: deleting or
  editing a confirmed event in UniPilot does not delete or update the Google
  Calendar event. Two-way sync is a future task, not smuggled into this one;
  no UI behavior changes as part of this note.

## 10. Frontend

### 10.1 Data layer (documents split)

- `frontend/lib/data/integrationValues.ts` — pure types/constants/parsers:
  run/candidate view types, status labels, file validation (`.txt`,
  `text/plain`, ≤ 25 MiB), quota/limit constants, fingerprint passthrough.
- `frontend/lib/data/integrationErrors.ts` — sanitized copy, including the
  exported over-limit, not-configured, and rejection-permanent strings.
- `frontend/lib/data/integrations.ts` — server-only service:
  `getWhatsAppOverview(userId)` (which also runs
  `purgeExpiredWhatsAppMessages(userId)` per D12), `listRuns`,
  `listCandidates`, `getConnection`, `getGoogleStatus`, `isLiveEnabled()`,
  `getActiveRunCount`, `getRunsSince`.
- `frontend/lib/data/integrationActions.ts` — `"use server"` actions, each
  gated with `requireOnboardedUser("/integrations")` before try/catch:
  `createExportRunAction`, `finalizeExportRunAction`, `abortExportRunAction`,
  `startLiveConnectAction`, `startLiveScanAction`, `disconnectWhatsAppAction`,
  `confirmCandidateAction`, `rejectCandidateAction`,
  `connectGoogleCalendarAction`, `disconnectGoogleCalendarAction`,
  `getWhatsAppStatusAction` (poll).
- Limits (D13) are checked in the actions before every enqueue: one active run
  per user, 20 runs per rolling 24 h; the sanitized copy says what was hit and
  what to do. `createExportRunAction` generates the run id and inserts
  `storage_path` up front.
- Confirm flow (service client after the gate): verify candidate ownership and
  `pending`; insert the event with `source='whatsapp'`, `source_ref=fingerprint`,
  `on conflict do nothing`; fetch the existing row when deduped; set candidate
  `confirmed` + `event_id`; enqueue `whatsapp.push` only when a Google
  connection exists. The service role is required because §6.1 forces
  provenance through the server-only trigger.
- Reject flips `status='rejected'` after the confirmation modal; no event, no
  push, and the candidate never returns (rejection is terminal).
- `startLiveConnectAction` upserts the WhatsApp connection row
  (`mode='live'`, `status='pending'`, `profile_ref=<user_id>`) and enqueues
  `whatsapp.connect`; it is a no-op while the row is already
  `pending`/`connected` (no duplicate connect jobs). `startLiveScanAction`
  creates a live run (`chat_name`, `connection_id`) and enqueues
  `whatsapp.sync`; `disconnectWhatsAppAction` marks the row disconnected,
  deletes `integration_messages` for the user, and enqueues
  `whatsapp.disconnect`. All three refuse unless `isLiveEnabled()`, and the
  live panel states that live access requires a self-hosted worker with a
  browser (it is not offered on the hosted deployment).
- The QR status poll is a gated Server Action calling `get_whatsapp_qr`; the
  data-URL is returned to the owner only, held in component state, and dropped
  the moment the connection flips to `connected`/`error` or the TTL expires.

### 10.2 Page and components (`frontend/app/(app)/integrations/`)

- `page.tsx` stays guest-aware (`getWorkspaceAccess`); for signed-in users it
  loads the overview + Google status and renders `IntegrationsWorkspace`.
- WhatsApp card becomes real: connection status, export dropzone + file input,
  runs history, candidate review (confirm/reject with pending states),
  `UNIPILOT_WHATSAPP_LIVE=1`-gated live panel (connect → QR → chat name →
  scan). Gmail card is unchanged.
- Honest states: empty ("No scans yet"), queued/running (live region +
  polling), succeeded with zero candidates, succeeded with a truncation note
  when a D13 cap was hit, failed with sanitized error, over-limit copy,
  not-configured Google.
- Reject opens the `Modal` pattern (destructive confirm) that says plainly
  "Rejected events don't come back on re-scan; create it manually from the
  calendar if you change your mind" (D3).
- Guests: cards render; every action calls `requireAuth(reason)` and opens the
  existing skippable sign-in prompt; nothing is written.
- Motion: `Card`, `MotionListItem` (runs/candidates, `AnimatePresence` for
  filtered rows), `MotionNotice` for status/errors, `Modal` for destructive
  disconnect confirmation, `data-enter` ladder; no new presets, reduced-motion
  safe, no animation controls content existence.
- A11y: keyboard-operable dropzone (button + visually hidden input), focus
  retained after actions, `aria-live="polite"` run status, confirm/reject
  buttons carry accessible names containing the candidate title.

### 10.3 Calendar marker

`EventItem` gains `source?: "whatsapp"`; `events.ts` selects `source`;
`EventBlocks.tsx` renders a neutral Lucide `MessageCircle` + visually hidden
"From WhatsApp" (and a mono "via WhatsApp" line in the event detail). The
official brand mark remains confined to `/integrations` per DESIGN.md.

## 11. Testing

**Python availability contract (D13).** `npm run test` never requires Python.
`frontend/tests/qa/whatsappService.ts` exposes `hasWhatsAppService()` (cached
`spawnSync(python, ["-c", "import wa_service"], { cwd: whatsapp })`); every
Python-dependent spec calls `test.skip(!hasWhatsAppService(), "<clear reason>")`
at describe level, so the run reports skips — never a false pass. With
`UNIPILOT_REQUIRE_PYTHON=1` (set by `npm run test:whatsapp`) the helper makes
the absence a hard failure instead. `npm run test:whatsapp` runs
`python -m pytest ../whatsapp` plus `playwright test` on the Python-dependent
spec files explicitly (`tests/qa/whatsapp-export.spec.ts`,
`tests/qa/whatsapp-jobs.spec.ts`, and the object-deletion case of
`tests/qa/whatsapp-retention.spec.ts`) with that env set, so the two contracts
cannot silently swap.

Python (pytest, committed under `whatsapp/tests/` with
`whatsapp/pytest.ini` setting `pythonpath = .`):

- reader: bracketed and comma formats, 12 h/24 h, multiline messages, unicode
  direction marks, malformed lines.
- extractor: sample_chat's five detections (12/09 7 pm, "tomorrow 10:30 am",
  "Sunday 5pm", ISO range, "October 2nd" all-day), range vs single time,
  all-day fallback, noise skip, title cleanup, dedupe, deterministic `now`,
  message/candidate caps stop at the limit and report capped counts.
- fingerprint: stability and sensitivity.
- calendar_push: body shape for timed/all-day, dedupe lookup, `invalid_grant`
  → non-retryable, access token never persisted, mocked Google service (no
  network).

Playwright (frontend/tests/qa/):

- `integrations.spec.ts` rewritten: real WhatsApp card + Gmail still
  coming-soon; guest sees prompt, no writes; light/dark marks.
- `whatsapp-ui.spec.ts` (no Python required): card states, not-configured
  Google copy, reject modal copy, over-limit copy, and the live panel with the
  flag off (the committed test env): no connect control, explicit "needs a
  self-hosted worker" statement. The flag-on panel is verified in the MCP pass
  with `UNIPILOT_WHATSAPP_LIVE=1` (the live end-to-end itself stays `[!]`
  blocked).
- `whatsapp-export.spec.ts` (Python required, honest-skip): upload
  `sample_chat.txt` → run runs → messages and candidates appear → confirm one
  → event in `/calendar` carries the WhatsApp marker → reject one via the
  modal → absent (and still absent after re-sync) → re-sync creates no
  duplicate → cleanup (rows by id, storage object, event) and console clean.
- `whatsapp-jobs.spec.ts` (Python required, honest-skip): drives
  `worker/run.mjs --once` against a seeded export object; success path +
  dedupe on re-run + failure path sets run `failed`/job retry; `touch_job`
  extends the lease; the export object is deleted on terminal settle; caps
  and `UNIPILOT_REQUIRE_PYTHON` behavior.
- `whatsapp-security.spec.ts`: the §6.1 forge attempt (authenticated insert
  with `source='whatsapp'` lands manual, `source_ref` update ignored); the
  gated RPCs (`upsert/get/delete/rotate_google_credentials`, `set/get/
  clear_whatsapp_qr`, `touch_job`) are denied to `anon`/`authenticated` and
  work for the service client; `get_whatsapp_qr` returns NULL and clears past
  `qr_expires_at`; `rotate_google_token_key` round-trips; no plaintext token
  is reachable through any client role (the table has no grants).
- `whatsapp-retention.spec.ts`: backdate `integration_messages.created_at` via
  the service client, run the overview read, assert the 30-day purge; assert
  disconnect deletes the raw archive; assert export-object deletion on a
  terminal job (this last case is Python required and honest-skips).
- `rls-isolation.spec.ts`: new tables added to `OWNED_TABLES`/`RESIDUE_TABLES`
  and no-residue cleanup.
- Google: disconnected/not-configured UI asserted; OAuth exchange is not
  E2E-testable here (`[!]` blocked, exact dependency: `GOOGLE_OAUTH_CLIENT_ID`
  + `GOOGLE_OAUTH_CLIENT_SECRET`; the push logic is covered by the mocked
  pytest suite).

## 12. Verification plan (real Chromium via Playwright MCP)

QA fixture (`qa.unipilot@unipilot.test`) on the local stack; stop the manual
dev server before `npm run test`.

1. Upload `sample_chat.txt` on `/integrations`; wait for the run to succeed.
2. Confirm one candidate → open `/calendar` → the event shows the WhatsApp
   marker; reject one via the modal → it never appears.
3. Re-upload the same export → no new pending candidates, no second event, and
   no rejected candidate resurrection.
4. Light + dark at 375 and 1280: layout, focus, accessible names.
5. Console clean; network only expected requests; screenshots under
   `frontend/screenshots/` (never of a live QR).
6. Security/retention: the forge attempt lands manual; QR RPC TTL/clear works;
   token RPC round-trip + rotation works; client roles cannot reach the
   credential table or any gated RPC; the 30-day purge and disconnect delete
   work; limits return sanitized copy.
7. Live mode: `[!]` blocked — needs a self-host Chrome + WhatsApp QR scan
   (`selenium` + `LIVE_QR_TIMEOUT`) and a single-tenant worker host; the UI
   must say so honestly.
8. Google push: `[!]` blocked — needs `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET`; pytest covers the logic with a mocked client.
9. `npm run typecheck`, `lint`, `build`; `npm run test` green with Python
   present, and the Python-less path proven by running once with
   `WHATSAPP_PYTHON` pointed at a missing binary (specs report as skipped with
   the clear reason, never passed); `npm run test:whatsapp` green. The
   production worker host that serves export/push must ship Python +
   `wa_service` + the declared dependencies (deployment note in §13).

## 13. Docs and task updates

- `TASK.md`: `46.11`–`46.20` (service refactor + pytest; schema/bucket;
  worker kinds + heartbeat; data layer + actions + limits; export UI; live
  mode `[!]`; Google OAuth + encrypted push; calendar marker + spec rewrite;
  docs; verification), Stage 3 item 24 (recorded as the founder-requested
  pull-forward per D9), CURRENT STATE entry.
- `backend/DATABASE.md`: table matrix rows, events provenance trigger, new
  section "WhatsApp integration (Task 46.x)" covering the encrypted credential
  table (key home + rotation runbook), QR TTL handling, retention rule, limits,
  bucket notes.
- `QA_SESSION.md`: new specs, `whatsapp-exports` cleanup, Python-less
  honest-skip contract, `test:whatsapp`, live/Google blocked notes.
- `AGENTS.md`: one line naming `whatsapp/` as the Python service workspace and
  the worker-host requirement.
- `whatsapp/README.md`: install/run/env/self-host/live-blocked notes,
  including "the worker host must ship Python + the service for export/push"
  and the 30-day archive retention.
- Env examples: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
  `UNIPILOT_INTEGRATIONS_KEY`, `UNIPILOT_WHATSAPP_LIVE`,
  `WHATSAPP_SYNC_TIMEOUT` (frontend — also inherited by the worker via
  `--env-file`), `WHATSAPP_PYTHON`, `WHATSAPP_PROFILE_ROOT` (backend), and the
  updated `whatsapp/.env.example`. Each example states that the Google pair and
  the encryption key are **required by both** the Next server and the Python
  worker.

No commits or staging in this task (explicit instruction); the spec doc and
all changes stay in the working tree.

## 14. Risks and blocked items

- **Live mode** `[!]`: no self-host browser/QR in this environment. Implemented,
  never faked. Requires a single-tenant worker host; per-user `0700` profile
  directories; no shared-worker live mode.
- **Google push** `[!]`: no OAuth credentials. Connect UI shows "not
  configured"; push logic is pytest-covered with a mocked client. Encryption
  and rotation are covered by the security spec.
- **One-way push**: edits/deletes in UniPilot do not propagate to Google;
  documented in §9 and deliberately not solved here. Two-way sync is out of
  scope.
- **Key handling**: the pgcrypto key travels to Postgres per RPC call, so
  statement logging must stay off (Supabase default) and DATABASE.md records
  the rotation runbook.
- **Python-less environments**: `npm run test` stays green with honest skips;
  the worker host that serves export/push must ship Python + the service +
  declared deps (deployment contract).
- **Python 3.14** is young; `dateparser`/`selenium`/`google-*` wheel support is
  verified at install time. If a wheel is missing, the exact package and error
  are recorded and the remaining suites stay green.
- **Long live scans**: mitigated by `touch_job`; a killed child fails the job
  retryably.
- **Brand-mark rule**: the WhatsApp mark must not leak to `/calendar`; the
  marker there is Lucide + text only.
- **Baseline drift**: suite is 145/145; new tests raise the count.

## Addendum (2026-09-13) — Automatic vs Manual review mode

Task IDs: TASK.md `46.21`–`46.25` (appended under 46; no existing item
renumbered). Status: implemented and covered by the guarded suite; Google push
stays `[!]` (see §14).

The original standalone tool exposed `ASK_BEFORE_PUSH` / `--ask` to choose
between reviewing matches and pushing them directly. UniPilot moves that choice
into the product without changing the extraction pipeline: the user picks
**Review each event** or **Add automatically** at upload time on
`/integrations`, and the choice is persisted as the WhatsApp connection's
default (`integration_connections.review_mode`) so the next upload is
pre-selected. The run records the mode it actually used
(`integration_runs.review_mode`), so history stays honest even after the
default changes.

Schema (46.21): migration `20260913050000_whatsapp_review_mode.sql` adds
`review_mode text not null default 'manual'` with CHECK
(`manual` | `automatic`) to both tables. No RLS/grant changes: the existing
owner-SELECT / server-write policies still apply. Applied on the local stack
with `supabase migration up`; existing rows are backfilled by the default and
the founder's rows are preserved.

Automatic flow (46.22; scope corrected by B6.1): when `sync` completes, Python
settles the user's pending candidates whose fingerprints the run re-detects
(new or from earlier runs), inserting events only for that pending set —
mapping each to an `events` row with the same body mapping as the TS confirm
(`source='whatsapp'`, `source_ref=fingerprint`, UTC instants, range end
preserved) and deduped by the unique `(user_id, source, source_ref)` key;
ignored inserts resolve to the existing event ids through a batched
`source_ref=in.(...)` select. Pending candidates outside the detected set —
e.g. from another chat — stay pending, and rejected or already-confirmed
fingerprints are never resurrected or re-pushed. The candidate settle is
guarded (`status=eq.pending`, `return=representation`): a candidate that lost
the pending race is never overwritten, and only candidates this run
transitioned to `confirmed` are eligible for `whatsapp.push`. Push
jobs are ids-only (`{ candidateId }`) and enqueued only when the google
connection is `connected` and the Google client env pair is present (mirroring
the TS `getGoogleStatus` gate). Manual mode is unchanged: candidates stay
`pending` for the review UI, and the TS confirm path still owns the push
enqueue. The UI reuses the card flow: a radiogroup preselected from the
connection default, one honest sentence per mode, and a per-run mode label in
the run history (46.23).

Honest limitations:

- **Detected-set scope.** Automatic mode settles the user's pending candidates
  whose fingerprints the run re-detects — new or left pending by earlier runs.
  Pending candidates outside the detected set (e.g. another chat) stay pending,
  and rejected or already-confirmed fingerprints are never resurrected; there
  is no bulk "confirm everything" retro-action.
- **Orphan-event race window (M1).** The events insert happens before the
  guarded candidate settle, so a candidate rejected between the two leaves one
  orphan event. The orphan event is accepted: any later insert with the same
  `source_ref` resolves to it instead of duplicating, and the rejected
  candidate is never overwritten or pushed.
- **No cross-transaction settle.** Python writes through PostgREST, so the
  events insert and the candidate patch are separate round-trips with no
  database transaction spanning them; the dedupe key, not a transaction, is
  what makes a retry safe.
- **Google push remains `[!]`** in this environment without
  `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`: the enqueue is
  proven with env overrides on the worker call, no real OAuth exchange or
  calendar insert happens, while automatic events still land in `events` and
  render on `/calendar`.

## Addendum (2026-09-13) — envelope order, same-day years, relative dates

Task IDs: TASK.md `46.26`–`46.30` (appended under 46; no existing item
renumbered). Status: implemented, the founder's affected rows corrected in
place, and verified against the real export plus the full suite.

Root cause (measured on the founder's 753-message export): the export
ENVELOPE is month-first — 493 messages carry a second component > 12 and 0
carry a first component > 12 — while extraction defaulted to
`DATE_ORDER=DMY`, so ambiguous envelope timestamps were read day-first and
the two "12th sept"/"20th sept" mentions landed in 2027. A same-day year roll
compounded it: with the base at the message day's midnight and the future
preference, a candidate equal to the base (00:00 same day) was treated as
past and rolled a year.

Fix: `infer_date_order` reads unambiguous 1–2 digit envelope components
(first > 12 → day-first signal, second > 12 → month-first signal), returns
`MDY`/`DMY` by majority and `None` on ties; `sync` parses the envelope with
the inferred order (fallback to the connection's `date_order`), while
message-TEXT dates always use the connection's `date_order`. The relative
base is normalized to the message day's midnight, plus a narrow post-parse
correction that keeps the un-rolled year only when the future parse is
exactly one year later with the same month/day and the current-period parse
is the base day itself.

Conservative relative gate (opt-in, `detect_relative_dates` default false): a
weekday/relative mention qualifies only when the message also carries a clock
time or an academic keyword (submission/submit/exam/deadline/presentation/
class/test/quiz/assignment/viva/due); with an academic keyword and no time it
is an all-day event; time-only mentions stay rejected in both modes.

Settings (46.26): migration `20260913080000_whatsapp_detection_settings.sql`
(the 18th) adds `integration_connections.date_order` (text not null default
`DMY`, CHECK `DMY`/`MDY`) and `detect_relative_dates` (boolean not null
default false). The connection column is the user preference on the
persistence/extraction path, persisted by the next upload; the export path
uses the connection column, and the `DATE_ORDER` env (`Settings.date_order`)
is now consulted only by `live._sort_key`. The upload UI adds the date-order radiogroup and the
relative-dates checkbox, preselected from the connection default (46.29).
Founder data was corrected in place by UPDATE (row ids, confirmed status,
event linkage and the 2 candidates / 2 events preserved; `source_ref`
realigned to the candidate fingerprints), and the real-export probe dates the
five relative-on events 2026-06-19, 2026-07-06, 2026-07-07, 2026-09-12 and
2026-09-20 (46.30).

Limitations:

- **Year-first envelopes are not inferred.** `infer_date_order` skips
  components longer than two digits, so an ISO/year-first export carries no
  order signal and falls back to the connection's `date_order` (live WhatsApp
  Web DOM envelopes are numeric day/month pairs, so no current path hits the
  gap).
- **Same-day correction scope.** The un-roll applies only when the future
  parse is exactly one year ahead with the same month/day and the
  current-period parse is the base day; a genuinely past mention still rolls
  forward.
- **Relative detection is conservative and off by default.** Qualifying
  mentions without a time become all-day events; keyword-free weekday
  mentions stay rejected even with the toggle on.
