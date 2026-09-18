# QA Session â€” the permitted authenticated environment (Task 20.10)

This is the permanent way to obtain a **real authenticated UniPilot session**
against a **non-production** environment. Future tasks that need an
authenticated browser session (3.10, 12.2, 12.3, 16.12, 16.13, 17.13, and
every authenticated feature after them) start here instead of deferring or
creating their own identity.

> **The founder account is never used for QA.** The two QA identities below
> (QA1 for browser sessions, QA2 for the isolation proof) are the only
> sanctioned sessions. The hosted (production) project is never written
> to by any of this â€” the seed refuses non-local targets by construction.

## What exists

| Piece | Where |
| --- | --- |
| Local Supabase stack | Docker Engine inside the `kali-linux` WSL2 distro; trimmed config (studio/realtime/edge-runtime/analytics off; **storage on since Task 23.x** â€” the `documents` bucket lives in the versioned migration) |
| Stack config | `backend/supabase/config.toml` (git-ignored â€” CLI-generated, see backend/EMAIL.md) |
| QA identity seed | `backend/supabase/qa/seed-qa-identity.mjs` (checked in, idempotent; creates QA1 + QA2) |
| Playwright fixture | `frontend/tests/qa/auth.setup.ts` + `frontend/playwright.config.ts` (QA1) |
| Storage state | `frontend/.playwright/qa-session.json` (git-ignored; configurable via `QA_STORAGE_STATE`) |
| Smoke proof | `frontend/tests/qa/authenticated.spec.ts` (reaches the protected /onboarding route authenticated â€” proves the fixture, nothing more) |
| RLS isolation proof | `frontend/tests/qa/rls-isolation.spec.ts` (QA1 vs QA2 vs anon, schema-level; Task 20.9) |
| Onboarding persistence proof | `frontend/tests/qa/onboarding.spec.ts` (QA1 completes through the real flow, QA2 skips; failure/retry, duplicate writes, redirect gate, two-user isolation; Task 13.10) |
| Finish-setup affordance proof | `frontend/tests/qa/finish-setup.spec.ts` (QA2 incomplete sees the dashboard banner + setup link, QA1 complete sees neither, guest callout only, reduced motion; Task 14.10) |
| Auth guard matrix proof | `frontend/tests/qa/auth-guards.spec.ts` (guest workspace states,
  the /onboarding bounce with sanitized `?next=`, public guest dashboard, callback notices, authenticated
  control, proxy-matcher guard; Task 14.11, updated for guest browsing) |
| Guest browsing proof | `frontend/tests/qa/guest-browsing.spec.ts` (every workspace route renders its
  guest state, zero data reads, skippable prompt on each surface's control, Continue browsing/Escape
  dismiss, "Sign in" â†’ `/login?next=<path>`; guest-browsing feature) |
| Tasks data proof | `frontend/tests/qa/tasks-data.spec.ts` (task validation/date units + QA1/QA2 CRUD,
  status and priority isolation under RLS, id-scoped teardown; Task 21.x) |
| Tasks UI flows | `frontend/tests/qa/tasks-ui.spec.ts` (authenticated create/edit/delete, pointer + keyboard
  status moves, detail + foreign id, forced-failure rollback, reduced motion; Task 16.x) |
| Events data proof | `frontend/tests/qa/events-data.spec.ts` (event validation/DST units + QA1/QA2
  list/get/create/update/delete isolation, range window, type/course guards, id-scoped teardown; Task 22.x) |
| Calendar UI flows | `frontend/tests/qa/calendar-ui.spec.ts` (authenticated create/typed blocks/legend,
  all-day span, month+week rendering, detail + edit + confirmed delete, foreign id, forced-failure
  rollback, guest render, reduced motion; Task 17.x) |
| Documents data/storage proof | `frontend/tests/qa/documents-data.spec.ts` (pure validation + QA1/QA2
  private-bucket isolation â€” own access, cross-user and anon denials, bucket MIME/size rejections,
  row-delete chunk cascade; Task 23.x) |
| Documents UI flows | `frontend/tests/qa/documents-ui.spec.ts` (real upload with progress â†’ verified
  record + object, magic-byte rejection with cleanup, rename path-stability, delete object/row/chunks,
  guest prompt; Task 23.x) |
| Jobs runner proof | `frontend/tests/qa/jobs-runner.spec.ts` (drives `backend/worker/run.mjs --once`:
  claim â†’ succeeded, retry backoff â†’ dead-letter, non-retryable â†’ failed, stale lock reclaim, system
  job invisibility, RLS + denied client writes/RPCs, residue-free; Task 29.1) |
| Document processing proof | `frontend/tests/qa/documents-processing.spec.ts` (real upload â†’ worker â†’
  indexed chunks/pages, DOCX unit, retry â†’ dead-letter, corrupt permanent failure, OCR-block copy,
  page limit, chunk RLS, step-0 ACL denials, benchmark honesty; Task 24.x) |
| Documents hub flows | `frontend/tests/qa/documents-hub.spec.ts` (upload â†’ progress â†’ Parsingâ€¦ â†’
  Searchable through the poll, search/filters with honest empties, rename/delete, inline PDF +
  download-only DOCX previews, failed-state retry, quota copy, 320/375/1280 + reduced motion, guest;
  Task 18.x) |
| Retrieval proof | `frontend/tests/qa/documents-search.spec.ts` (re-index idempotency with page
  refs, keyword hits + snippets + document/page filters, honest empty, QA1/QA2 RLS, the search
  panel â†’ preview flow, and the 25.11 harness honesty; Task 25.x) |
| Assistant backend proof | `frontend/tests/qa/assistant-backend.spec.ts` (provider honesty +
  timeout/retry, injection guard, context budget, structured-action parser, real turns with
  conversation/message/usage persistence and ordering, server-only message writes, owner + RAG
  cross-user isolation, rate/spend guards; Task 26.x) |
| WhatsApp security/retention proof | `frontend/tests/qa/whatsapp-security.spec.ts` +
  `whatsapp-retention.spec.ts` (bucket/table/RPC ACLs, encrypted QR round-trip + 60 s TTL,
  token-key rotation, 30-day purge, events provenance forge-proof; Task 46.12) |
| WhatsApp worker/job proof | `frontend/tests/qa/whatsapp-jobs.spec.ts` (real export object â†’
  Node worker â†’ Python `whatsapp.sync`, re-run dedupe, missing-object failure, non-retryable
  missing-interpreter failure, `whatsapp.push` no-op; Task 46.13) |
| WhatsApp export-flow proof | `frontend/tests/qa/whatsapp-ui.spec.ts` + `whatsapp-export.spec.ts`
  (upload â†’ scan â†’ candidate review â†’ confirm with calendar marker â†’ reject, live-gate UI;
  Task 46.15) |
| Env file | `frontend/.env.development.local` (git-ignored; copy from `frontend/.env.development.local.example`) |

## The QA identities (two users since Task 20.9)

| Identity | Email | Password env var | Display name | Used by |
| --- | --- | --- | --- | --- |
| QA1 | `qa.unipilot@unipilot.test` | `UNIPILOT_QA_PASSWORD` | `QA` | `frontend/tests/qa/auth.setup.ts` fixture (storage state) |
| QA2 | `qa2.unipilot@unipilot.test` | `UNIPILOT_QA2_PASSWORD` | `QA 2` | `frontend/tests/qa/rls-isolation.spec.ts` (second user) |

Both identities are RFC 2606 reserved `.test` addresses (dot-bearing so the
app's own email validation accepts them) and are created `email_confirm: true`
through the GoTrue Admin API (the supported server-side mechanism â€” no
confirmation link is intercepted or faked). Since Task 13.10 the suite has a
deliberate onboarding contract:

- **QA1 ends onboarding-complete.** `frontend/tests/qa/onboarding.spec.ts`
  resets it, completes the real flow through the UI, and leaves the persisted
  profile answers plus two subjects at rest. That is what lets the workspace
  specs pass 13.10's redirect gate; QA1 owns exactly the rows onboarding wrote
  and nothing else.
- **QA2 stays incomplete and pristine.** It proves skip (which writes nothing),
  the incomplete redirect gate and two-user isolation. At rest it has only its
  trigger-provisioned empty profile row.

The isolation spec creates the rows it needs through the service role and
deletes exactly those ids again â€” never by `user_id`, so it cannot disturb the
onboarding state. `profiles` keeps one row per identity; `subjects` keeps only
QA1's two onboarding rows.

Passwords live only in their environment variables in
`frontend/.env.development.local`; never in a `NEXT_PUBLIC_*` var, never
committed, never logged, never in a screenshot (the login form masks them).

## One-time setup (already done on this machine, listed for a fresh machine)

1. Docker Engine in WSL (needs systemd): `wsl -d kali-linux -u root` then
   `apt-get install docker-ce` (Docker's Debian repo; backend/EMAIL.md
   documents the Docker Desktop alternative on Windows if you have admin
   rights).
2. Supabase CLI (pinned **v2.116.0**) in WSL: release binary â†’ `/usr/local/bin/supabase`.
3. Run `supabase init` / `supabase start` from `backend/` inside WSL:
   `wsl -d kali-linux -u root -e sh -c "cd /mnt/c/<checkout>/backend && supabase init && supabase start"`
   (init is once; `backend/supabase/config.toml` is regenerated per machine).
4. `copy frontend\.env.development.local.example frontend\.env.development.local`,
   set `UNIPILOT_QA_PASSWORD` and `UNIPILOT_QA2_PASSWORD` (distinct 8+ char
   values â€” local-only), then run the seed.
5. Keep WSL alive while QA runs: `wsl -d kali-linux --exec sleep 2147483647`
   (or any long-lived WSL process) â€” otherwise Windows tears the VM down and
   the stack goes with it.

## Daily usage

Start the local stack, then run the suite â€” it owns its own server:

```powershell
wsl -d kali-linux -u root -e sh -c "cd /mnt/c/<checkout>/backend && supabase start"   # if not already up
npm run test         # from the repo root: builds + starts its own production server, then qa-auth-setup â†’ qa-onboarding â†’ every other spec
```

Stop any manual `npm run dev` first: port 3000 must be free for the suite's
server (a run that finds it taken fails loudly).

Project order matters: `qa-onboarding` is a Playwright project dependency of
`chromium-authenticated`, so the onboarding pass completes QA1 *before* the
workspace specs load /tasks, /calendar, /documents and /assistant. Without it,
13.10's redirect gate would send those tests into /onboarding. The onboarding
project is idempotent: it resets and re-completes QA1 on every run.

One-line reference for future task prompts: **"use the QA fixture â€” `npm run
test` from the repo root with the local stack up (the suite starts its own
production server), then `storageState: frontend/.playwright/qa-session.json`
(see QA_SESSION.md)"**.

## One writer at a time (2026-09-12 stabilisation)

The suite owns a **production** server: `frontend/playwright.config.ts` declares
a `webServer` (`npm run build && npm run start`, `reuseExistingServer: false`),
with the local `NEXT_PUBLIC_*` values passed explicitly so `next build` can
never pick up `.env.local`'s hosted project. A manual `npm run dev` must be
stopped before `npm run test` â€” if port 3000 is taken the run fails loudly
instead of silently sharing a server it does not control. Production is
deliberate: under the suite's parallel load `next dev` tore down in-flight
streams (`Error: The destination stream closed early`) and reset keep-alive
connections during on-demand compiles, which surfaced as a transport
`read ECONNRESET` in a route probe even though every assertion was correct.
`next start` has no HMR or compile-on-request churn.

**Never run two suites, two agent sessions, or `db:reset`/`seed:qa` while a
test run is active against this tree.** Concurrent runs reset/completed the QA
identities mid-suite, restarted the dev server under in-flight requests, and
produced `ECONNRESET` / `ERR_CONNECTION_REFUSED` / "Target page, context or
browser has been closed" failures that looked exactly like flaky specs. The
2026-09-12 reconciliation ran one suite at a time; after the fixes the full
suite passed **101/101 three consecutive times**, each run from a fresh
`db:reset` + `seed:qa` and the suite's own freshly built server
(`frontend/.playwright/stabilization-green-2026-09-12-run{1,2,3}.log`; the
single-run reconciliation log is `recon-green-2026-09-12.log`). Every observed
failure was contention or dev-server churn, not product.

If a second process does start anyway, the enforcement tool is
`frontend/scripts/qa-single-writer.ps1` â€” start the suite, then point the guard
at its PID; it terminates competing Playwright/dev-server processes for the
duration while leaving the run's own process tree alone:

```powershell
$p = Start-Process npm.cmd -ArgumentList run,test -PassThru
powershell -NoProfile -File frontend/scripts/qa-single-writer.ps1 -RootPid $p.Id
```

**If parallel sessions are genuinely needed**, do not share this tree or this
stack; give each session its own git worktree with:
- its own `backend/supabase/config.toml` (CLI-generated, git-ignored) with
  distinct API/DB/Studio ports (`supabase start` from that worktree's
  `backend/`),
- its own `frontend/.env.development.local` pointing at that stack's URL/keys
  (plus its own `UNIPILOT_QA_PASSWORD` / `UNIPILOT_QA2_PASSWORD`),
- its own seeded QA identities (`npm run seed:qa` inside the worktree) and its
  own `.playwright/qa-session.json`.

Never seed or reset one session's database while another session's tests run
against it.

For MCP-browser QA (Playwright MCP tools): drive the same real login form at
`/login` with `qa.unipilot@unipilot.test` + `UNIPILOT_QA_PASSWORD` read from
`frontend/.env.development.local` — never type the password into a tool call or
screenshot it.

**Breach recorded (2026-09-16).** During a native-presentation task an agent's
MCP login surfaced `UNIPILOT_QA_PASSWORD` once in a tool result. No artifact
held it, the password was rotated immediately afterwards, and both identities
were re-synced and re-validated through the real login UI. The rule below is
now explicit.

**Secret rule (no exceptions).** QA credentials never appear in tool results,
logs, screenshots, diffs or reports. Never `cat`/`type`/`Get-Content` an env
file into a tool result; never echo a password, token or cookie; never inline a
password into a command string that a transcript captures. Authenticate
browsers with the stored session (`frontend/.playwright/qa-session.json`) or a
script that reads the env itself and prints only booleans/ids. If a secret is
ever surfaced, stop, rotate it (`--reset` seed + fresh storage state), and
record the incident here.

Expiry handling: the fixture validates any existing storage state first (it
loads `/onboarding` â€” the one protected route since guests can browse the
workspace â€” and a redirect to `/login` means expired/revoked) and
re-authenticates through the real UI rather than failing. The storage-state
file holds only Supabase's HTTP-only session cookie.

Missing env vars: the fixture fails with a message naming
`UNIPILOT_QA_PASSWORD`, the exact file it belongs in, and the seed command â€”
quoted in full in the file header.

## Verification screenshots

Every ad-hoc verification screenshot â€” Playwright MCP runs and one-off probes â€”
goes to **`frontend/screenshots/`**, a single git-ignored folder at the
frontend workspace root. The Playwright MCP server is launched with
`--output-dir frontend/screenshots` (`opencode.json`), and explicit filenames
use `frontend/screenshots/<name>.png`. Run artifacts that belong to a test run
(storage state, traces, `test-results/`) stay under `frontend/.playwright/` â€”
never mix the two. The convention is also documented in
`frontend/screenshots.md` and the browser-qa skill.

## Seeding / resetting

```powershell
npm run seed:qa                          # from the repo root: create (idempotent)
npm run seed:qa -w backend -- --reset    # destroy + recreate
```

Equivalent direct form (run from `backend/` â€” this is what the npm script does):

```powershell
node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs          # create (idempotent)
node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs --reset  # destroy + recreate
```

- `npm run seed:qa` leaves **QA1 onboarded** with the standard fixture (QA /
  One / UniPilot Test University / Computer Science / Year 2 / Semester 1 /
  balanced / 1 week / Linear Algebra + Thermodynamics) and **QA2 data-free**.
  `frontend/tests/qa/onboarding.spec.ts` still resets QA1 itself (answers and
  subjects) before proving the real flow, so pre-onboarding does not weaken
  that proof.
- Running the seed twice does not error and never duplicates (it finds each
  identity by exact email, only ensures `email_confirm`, and makes no writes
  at all when QA1 is already onboarding-complete).
- The seed **refuses to run** against any non-`localhost`/`127.0.0.1`
  Supabase URL, loudly, before making any network call. The hosted project
  can never be seeded by accident.
- Full environment reset (destroys the identities with everything else):
  `supabase stop --no-backup && supabase start` inside WSL from `backend/`,
  then re-run the seed.
- Clearing session state: delete `frontend/.playwright/qa-session.json` (the
  fixture re-creates it on next run).

## Two-user isolation proof (Task 20.9)

`frontend/tests/qa/rls-isolation.spec.ts` signs in as both identities with
their real passwords, seeds one owned row per table (plus one document chunk
and one message) through the service role, and asserts: anon is denied every
read and write; each user sees and changes only their own rows; cross-user
update/delete affect zero rows; child tables isolate through their parent;
server-only writes (subscriptions, usage events, notifications) are denied to
authenticated clients. Teardown removes every seeded row and the spec asserts
only the two trigger-provisioned `profiles` rows remain. It never contacts
hosted.

## WhatsApp integration QA (Task 46.x)

The WhatsApp proof is three projects after `qa-jobs-runner`, all dependencies
of `chromium-authenticated` so the full suite always runs them in order:

```
qa-whatsapp-security   whatsapp-security.spec.ts + whatsapp-retention.spec.ts
  â†’ qa-whatsapp-jobs   whatsapp-jobs.spec.ts
  â†’ qa-whatsapp-flow   whatsapp-ui.spec.ts + whatsapp-export.spec.ts
```

All three projects raise their timeout to 240 s: the worker-driving specs need
Python startup and the lock wait, and the security/retention file pair waits on
the same cross-file lock under a targeted `--no-deps` run.

An upload only queues its `whatsapp.sync` job â€” the worker (`npm run worker` /
`npm run worker:once`) is what processes it, so a scan left `queued` means the
worker is not running.

**One worker at a time.** All three projects share QA1's integration rows and
the global `claim_jobs`, which is why they are chained rather than parallel. A
targeted `--no-deps` run can still select them together, so each
worker-driving spec acquires `frontend/tests/qa/workerLock.ts` â€” an
existence lock at `.playwright/whatsapp-worker.lock` with a 240 s stale-mtime
steal â€” for its window. In the full suite the dependency chain makes it
uncontended, and the one-writer rule from the section above still applies (no
second suite, no `db:reset`/`seed:qa` while tests run).

**Python contract.** The pytest half is standalone:

```powershell
npm run test:whatsapp          # root â†’ backend: python -m pytest ../whatsapp
```

The Playwright half probes `python -c "import wa_service"` from `whatsapp/`
before running. When the probe fails, the Python-dependent tests are reported as
skipped with the honest reason `python/wa_service unavailable on this host
(install whatsapp/requirements-dev.txt; see whatsapp/README.md)` â€” never
faked. Strict mode turns a failing probe into a collection failure instead:

```powershell
# honest-skip (default) â€” the Python-dependent tests report skipped under `npm run test`
npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts
# strict â€” missing Python fails the run at collection
$env:UNIPILOT_REQUIRE_PYTHON="1"; npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts tests/qa/whatsapp-export.spec.ts; Remove-Item Env:\UNIPILOT_REQUIRE_PYTHON
```

`UNIPILOT_REQUIRE_PYTHON=1` fails with the install message quoted in
`whatsapp/README.md`; `WHATSAPP_PYTHON` overrides the interpreter for both the
probe and the worker's Python spawn (default `python`).

**Cleanup obligations.** The worker-driving specs (`whatsapp-jobs`,
`whatsapp-export`) seed through the service role and delete exactly their ids
(including the `noop.test` lease fixture, which is not a `whatsapp.*` kind),
and their `afterAll` asserts QA1 has zero residue in `jobs` and the
`integration_*` tables plus no objects under its `whatsapp-exports` prefix (the
export spec also checks `events` with `source = 'whatsapp'`). `whatsapp-security`
and `whatsapp-retention` delete their seeded rows by id in `afterAll` without
absolute residue counts; the security spec additionally removes its bucket
objects and its `google_calendar_credentials` rows through the
`delete_google_credentials` RPC (never a direct write). `whatsapp-ui` otherwise
performs no writes: its queued-state test seeds exactly one `queued` run
through the service role and deletes it by id before it releases the worker
lock. Verification screenshots for the UI proof (`whatsapp-*` names)
go to `frontend/screenshots/` under the usual convention.

**Review-mode coverage (46.21â€“46.25).** The flow specs also prove the
manual/automatic choice: an automatic run settles the user's pending candidates
whose fingerprints the run re-detects into `events` (fingerprint dedupe;
`/calendar` shows the WhatsApp marker) and enqueues no push without Google;
re-running the same export adds no candidates, events or pushes; QA2's pending
candidate is never touched (isolation); a connected google row makes the run
enqueue ids-only `whatsapp.push` jobs that stay `queued` (the Google client pair
is overridden on the worker call only â€” no real OAuth exchange, so the P7.3
`[!]` blocker stands); a manual run leaves candidates pending; and an upload
against a live connected row patches `review_mode` only (`mode`/`status`
untouched). On the Python side, pytest also covers a re-scan that re-detects an
earlier pending candidate (it settles), that a rejected fingerprint is not
resurrected, and that an already-confirmed fingerprint is not re-stated. The UI
preselection test reads the connection default, so the upload that reserves an
export run now leaves a `review_mode` connection row on QA1: the export
spec's `seedWhatsAppConnection` helper patches an existing row or inserts one,
tracks its id and deletes it in teardown, and the existing afterAll
zero-residue checks (jobs, `integration_*` tables, WhatsApp events, bucket
prefix) cover the rest.

**Detection-settings coverage (46.26â€“46.30).** The same specs prove the two
per-connection detection preferences. Unit level: the export envelope is
inferred from its unambiguous components, so an MDY fixture with a second
component > 12 detects its two dated events on **2026-09-12** and
**2026-09-20** under the DMY default, while message-text dates follow the
saved `date_order`. Worker-driven flows prove the two candidate sets through
the real upload path: with the defaults (`DMY`, relative off) the MDY export
yields exactly **2** pending candidates, and toggling "Also detect weekday and
relative dates" before upload persists `detect_relative_dates=true` and
yields **5** (Sat Sep 12, Mon Sep 14, Tue Sep 15, Fri Sep 18, Sun Sep 20).
Settings persistence/preselection: the UI test seeds a connection
(`MDY`/true), reloads, and proves the radiogroup/checkbox come up
preselected; switching them and intercepting the server-action POST shows the
new values in the upload payload; the live-row test proves the patch path
persists both settings while `mode`/`status` stay transport-owned. The
`seedWhatsAppConnection` helper tracks and deletes its connection row, and the
existing afterAll zero-residue checks apply.

### [!] Live mode E2E is blocked in this environment

```
[!] Live end-to-end verification blocked: requires a single-tenant worker host
with Chrome + selenium (whatsapp/requirements-live.txt) and a physical phone to
scan the WhatsApp Web QR; no QR was ever faked. Flag-off/flag-on UI, action
gating, and the Python connect/disconnect units are verified.
```

### [!] Google Calendar push E2E is blocked in this environment

```
[!] Google Calendar push end-to-end verification blocked: requires a Google
Cloud OAuth client (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) with
{origin}/api/integrations/google/callback registered. The insert/dedupe/refresh
paths are covered by pytest with a mocked Google client; the no-credentials
no-op is covered end to end; no calendar push was faked.
```

## What this deliberately does NOT include

- **No application data beyond onboarding.** The identities own no
  tasks/events/documents; the only rows they keep are the trigger-provisioned
  `profiles` entries plus QA1's Task 13.10 onboarding answers and two subjects
  (the state the redirect gate needs). QA2 stays empty. Anything the isolation
  spec creates is deleted inside the test. The documents specs (23.x) follow
  the same rule: they upload through the real pipeline, then delete their own
  objects and rows (with a prefix sweep as the backstop), so the bucket is
  empty at rest. The jobs-runner spec (29.1) likewise deletes every job it
  inserts and asserts zero job rows before it finishes. The assistant-backend
  spec (26.x) deletes its conversations/messages and assistant usage rows by
  owner and asserts the tables are empty at rest.
- **No third identity.** Two users are what the RLS proof needs; a future
  task that needs more adds them here with their own env var and history
  entry.
- **No auth-behavior changes.** Server-side resolution (`requireUser`,
  `sessionViewer`), the proxy, RLS and the login flow are untouched by the QA
  fixtures.
- **No service-role key in any browser.** The key is read only by the seed
  and the isolation spec (Node processes) from `SUPABASE_SERVICE_ROLE_KEY`;
  the browser storage state holds only the anon-key session cookie.

## WSL2 port-forwarding workaround (2026-09-14)

On this host Windows' `winnat` dynamically reserved a TCP range containing
Supabase's API port 54321, so `127.0.0.1:54321` stopped forwarding from Windows
into WSL2 while the stack stayed healthy (reachable inside WSL). The local
stack's API port was therefore moved to **54937** (outside the reserved
ranges): `backend/supabase/config.toml` `[api] port`, plus the API URL in
`frontend/.env.development.local` â€” `supabase stop && supabase start` applies
it, and all data persists. The specs' local-only guards require a
`127.0.0.1`/`localhost` URL, so prefer this over pointing the env at the WSL
IP. With an elevated shell, check `netsh interface ipv4 show excludedportrange
protocol=tcp` first: any port inside a listed range cannot be forwarded into
Windows. To return to the standard port later, free it (`net stop winnat &&
net start winnat` or an explicit exclusion) and revert `config.toml` + the env.
