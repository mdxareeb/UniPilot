# QA Session — the permitted authenticated environment (Task 20.10)

This is the permanent way to obtain a **real authenticated UniPilot session**
against a **non-production** environment. Future tasks that need an
authenticated browser session (3.10, 12.2, 12.3, 16.12, 16.13, 17.13, and
every authenticated feature after them) start here instead of deferring or
creating their own identity.

> **The founder account is never used for QA.** The two QA identities below
> (QA1 for browser sessions, QA2 for the isolation proof) are the only
> sanctioned sessions. The hosted (production) project is never written
> to by any of this — the seed refuses non-local targets by construction.

## What exists

| Piece | Where |
| --- | --- |
| Local Supabase stack | Docker Engine inside the `kali-linux` WSL2 distro; trimmed config (studio/realtime/edge-runtime/analytics off; **storage on since Task 23.x** — the `documents` bucket lives in the versioned migration) |
| Stack config | `backend/supabase/config.toml` (git-ignored — CLI-generated, see backend/EMAIL.md) |
| QA identity seed | `backend/supabase/qa/seed-qa-identity.mjs` (checked in, idempotent; creates QA1 + QA2) |
| Playwright fixture | `frontend/tests/qa/auth.setup.ts` + `frontend/playwright.config.ts` (QA1) |
| Storage state | `frontend/.playwright/qa-session.json` (git-ignored; configurable via `QA_STORAGE_STATE`) |
| Smoke proof | `frontend/tests/qa/authenticated.spec.ts` (reaches the protected /onboarding route authenticated — proves the fixture, nothing more) |
| RLS isolation proof | `frontend/tests/qa/rls-isolation.spec.ts` (QA1 vs QA2 vs anon, schema-level; Task 20.9) |
| Onboarding persistence proof | `frontend/tests/qa/onboarding.spec.ts` (QA1 completes through the real flow, QA2 skips; failure/retry, duplicate writes, redirect gate, two-user isolation; Task 13.10) |
| Finish-setup affordance proof | `frontend/tests/qa/finish-setup.spec.ts` (QA2 incomplete sees the dashboard banner + setup link, QA1 complete sees neither, guest callout only, reduced motion; Task 14.10) |
| Auth guard matrix proof | `frontend/tests/qa/auth-guards.spec.ts` (guest workspace states,
  the /onboarding bounce with sanitized `?next=`, public guest dashboard, callback notices, authenticated
  control, proxy-matcher guard; Task 14.11, updated for guest browsing) |
| Guest browsing proof | `frontend/tests/qa/guest-browsing.spec.ts` (every workspace route renders its
  guest state, zero data reads, skippable prompt on each surface's control, Continue browsing/Escape
  dismiss, "Sign in" → `/login?next=<path>`; guest-browsing feature) |
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
  private-bucket isolation — own access, cross-user and anon denials, bucket MIME/size rejections,
  row-delete chunk cascade; Task 23.x) |
| Documents UI flows | `frontend/tests/qa/documents-ui.spec.ts` (real upload with progress → verified
  record + object, magic-byte rejection with cleanup, rename path-stability, delete object/row/chunks,
  guest prompt; Task 23.x) |
| Jobs runner proof | `frontend/tests/qa/jobs-runner.spec.ts` (drives `backend/worker/run.mjs --once`:
  claim → succeeded, retry backoff → dead-letter, non-retryable → failed, stale lock reclaim, system
  job invisibility, RLS + denied client writes/RPCs, residue-free; Task 29.1) |
| Document processing proof | `frontend/tests/qa/documents-processing.spec.ts` (real upload → worker →
  indexed chunks/pages, DOCX unit, retry → dead-letter, corrupt permanent failure, OCR-block copy,
  page limit, chunk RLS, step-0 ACL denials, benchmark honesty; Task 24.x) |
| Env file | `frontend/.env.development.local` (git-ignored; copy from `frontend/.env.development.local.example`) |

## The QA identities (two users since Task 20.9)

| Identity | Email | Password env var | Display name | Used by |
| --- | --- | --- | --- | --- |
| QA1 | `qa.unipilot@unipilot.test` | `UNIPILOT_QA_PASSWORD` | `QA` | `frontend/tests/qa/auth.setup.ts` fixture (storage state) |
| QA2 | `qa2.unipilot@unipilot.test` | `UNIPILOT_QA2_PASSWORD` | `QA 2` | `frontend/tests/qa/rls-isolation.spec.ts` (second user) |

Both identities are RFC 2606 reserved `.test` addresses (dot-bearing so the
app's own email validation accepts them) and are created `email_confirm: true`
through the GoTrue Admin API (the supported server-side mechanism — no
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
deletes exactly those ids again — never by `user_id`, so it cannot disturb the
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
2. Supabase CLI (pinned **v2.116.0**) in WSL: release binary → `/usr/local/bin/supabase`.
3. Run `supabase init` / `supabase start` from `backend/` inside WSL:
   `wsl -d kali-linux -u root -e sh -c "cd /mnt/c/Users/moham/OneDrive/Desktop/Projects/unipilot/unipilot/backend && supabase init && supabase start"`
   (init is once; `backend/supabase/config.toml` is regenerated per machine).
4. `copy frontend\.env.development.local.example frontend\.env.development.local`,
   set `UNIPILOT_QA_PASSWORD` and `UNIPILOT_QA2_PASSWORD` (distinct 8+ char
   values — local-only), then run the seed.
5. Keep WSL alive while QA runs: `wsl -d kali-linux --exec sleep 2147483647`
   (or any long-lived WSL process) — otherwise Windows tears the VM down and
   the stack goes with it.

## Daily usage

Start the local stack, then run the suite — it owns its own server:

```powershell
wsl -d kali-linux -u root -e sh -c "cd /mnt/c/Users/moham/OneDrive/Desktop/Projects/unipilot/unipilot/backend && supabase start"   # if not already up
npm run test         # from the repo root: builds + starts its own production server, then qa-auth-setup → qa-onboarding → every other spec
```

Stop any manual `npm run dev` first: port 3000 must be free for the suite's
server (a run that finds it taken fails loudly).

Project order matters: `qa-onboarding` is a Playwright project dependency of
`chromium-authenticated`, so the onboarding pass completes QA1 *before* the
workspace specs load /tasks, /calendar, /documents and /assistant. Without it,
13.10's redirect gate would send those tests into /onboarding. The onboarding
project is idempotent: it resets and re-completes QA1 on every run.

One-line reference for future task prompts: **"use the QA fixture — `npm run
test` from the repo root with the local stack up (the suite starts its own
production server), then `storageState: frontend/.playwright/qa-session.json`
(see QA_SESSION.md)"**.

## One writer at a time (2026-09-12 stabilisation)

The suite owns a **production** server: `frontend/playwright.config.ts` declares
a `webServer` (`npm run build && npm run start`, `reuseExistingServer: false`),
with the local `NEXT_PUBLIC_*` values passed explicitly so `next build` can
never pick up `.env.local`'s hosted project. A manual `npm run dev` must be
stopped before `npm run test` — if port 3000 is taken the run fails loudly
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
`frontend/scripts/qa-single-writer.ps1` — start the suite, then point the guard
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

Expiry handling: the fixture validates any existing storage state first (it
loads `/onboarding` — the one protected route since guests can browse the
workspace — and a redirect to `/login` means expired/revoked) and
re-authenticates through the real UI rather than failing. The storage-state
file holds only Supabase's HTTP-only session cookie.

Missing env vars: the fixture fails with a message naming
`UNIPILOT_QA_PASSWORD`, the exact file it belongs in, and the seed command —
quoted in full in the file header.

## Verification screenshots

Every ad-hoc verification screenshot — Playwright MCP runs and one-off probes —
goes to **`frontend/screenshots/`**, a single git-ignored folder at the
frontend workspace root. The Playwright MCP server is launched with
`--output-dir frontend/screenshots` (`opencode.json`), and explicit filenames
use `frontend/screenshots/<name>.png`. Run artifacts that belong to a test run
(storage state, traces, `test-results/`) stay under `frontend/.playwright/` —
never mix the two. The convention is also documented in
`frontend/screenshots.md` and the browser-qa skill.

## Seeding / resetting

```powershell
npm run seed:qa                          # from the repo root: create (idempotent)
npm run seed:qa -w backend -- --reset    # destroy + recreate
```

Equivalent direct form (run from `backend/` — this is what the npm script does):

```powershell
node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs          # create (idempotent)
node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs --reset  # destroy + recreate
```

- Running the seed twice does not error and never duplicates (it finds each
  identity by exact email and only ensures `email_confirm`).
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

## What this deliberately does NOT include

- **No application data beyond onboarding.** The identities own no
  tasks/events/documents; the only rows they keep are the trigger-provisioned
  `profiles` entries plus QA1's Task 13.10 onboarding answers and two subjects
  (the state the redirect gate needs). QA2 stays empty. Anything the isolation
  spec creates is deleted inside the test. The documents specs (23.x) follow
  the same rule: they upload through the real pipeline, then delete their own
  objects and rows (with a prefix sweep as the backstop), so the bucket is
  empty at rest. The jobs-runner spec (29.1) likewise deletes every job it
  inserts and asserts zero job rows before it finishes.
- **No third identity.** Two users are what the RLS proof needs; a future
  task that needs more adds them here with their own env var and history
  entry.
- **No auth-behavior changes.** Server-side resolution (`requireUser`,
  `sessionViewer`), the proxy, RLS and the login flow are untouched by the QA
  fixtures.
- **No service-role key in any browser.** The key is read only by the seed
  and the isolation spec (Node processes) from `SUPABASE_SERVICE_ROLE_KEY`;
  the browser storage state holds only the anon-key session cookie.
