# WhatsApp integration service

Python service behind UniPilot's WhatsApp → calendar integration. It parses a
WhatsApp chat export (the hosted path) or reads WhatsApp Web live through
Selenium (self-host only), detects event-like messages, and writes runs,
messages and candidates into Supabase for review on `/integrations`.

## Review modes

Every run records its review mode — chosen at upload; live scans run in manual
mode (the default). **Manual** keeps detected events as pending candidates for
review on `/integrations`, while **automatic** adds the pending events it
re-detects to the calendar when the scan finishes. The worker processes the
scan either way — in automatic mode `sync` settles the user's pending candidates
whose fingerprints the run re-detects (new or earlier) into `events`, deduped by
the `source_ref` fingerprint (the same key a manual confirm uses), so a re-scan
never duplicates an event. Rejected or already-confirmed fingerprints are never
resurrected or re-pushed; pending candidates the run does not re-detect (e.g.
another chat) stay for review.

## Detection settings

The saved connection carries two detection preferences chosen at upload and
persisted by the next upload: **date order** for ambiguous numeric dates in
message text (`DMY` default, `MDY`), and **relative dates** (opt-in, off by
default). Date order applies to message text only — the export envelope is
parsed with its own inferred order (`infer_date_order`; a documented gap only
for year-first/ISO envelopes, where it falls back to the connection's saved
order). With relative dates on, a weekday/relative mention is detected only
when the message also carries a clock time or an academic keyword (submission,
submit, exam, deadline, presentation, class, test, quiz, assignment, viva,
due); it is an all-day event without a time, and time-only mentions stay
rejected either way. The export path uses the connection's saved order;
the `DATE_ORDER` env is consulted only by `live._sort_key`.

## Export vs live

- **Export** (hosted): the user uploads a chat `.txt` to the private
  `whatsapp-exports` bucket; the run row names its object, the service downloads
  it server-side, parses and extracts, then the object is deleted on terminal
  settle. No browser is involved and the worker host only needs
  `requirements.txt`.
- **Live** (self-host only): the service opens a private, per-user Chrome
  profile, the user scans the QR once, and the service drives WhatsApp Web to
  scroll back and collect messages before persisting them through the same
  path as export. Live mode is single-tenant — a dedicated worker host, never a
  shared one.

Live mode is the only path that needs `requirements-live.txt` and Chrome; the
worker host that serves export/push never installs them.

## Job protocol

The Node worker (`backend/worker/`) spawns the service per job:

```
python -m wa_service <action>
```

One JSON payload on stdin, one JSON result line on stdout. The payload carries
ids only; credentials and chat data are never passed on argv or through the job
payload. Exit code 0 means the action completed; a non-zero exit prints
`{"ok": false, "error": "<sanitized>", "retryable": <bool>}`.

| action | payload | behaviour |
|---|---|---|
| `whatsapp.connect` | `{ "connectionId": uuid }` | launch the user's profile, publish the rotating QR through `set_whatsapp_qr`, mark the connection `connected` and clear the QR on login, or `error` on timeout |
| `whatsapp.sync` | `{ "runId": uuid }` | export: download and parse the run's object; live: collect the named chat via the per-user profile; both write messages/candidates and settle the run |
| `whatsapp.push` | `{ "candidateId": uuid }` | push a confirmed candidate to the connected Google Calendar (idempotent) |
| `whatsapp.disconnect` | `{ "userId": uuid }` | delete the user's on-disk browser profile |

## Install

Python 3.11+ is required. From `whatsapp/`:

```sh
python -m pip install -r requirements.txt          # always needed (parse/extract)
python -m pip install -r requirements-google.txt   # Google Calendar push
python -m pip install -r requirements-live.txt     # live mode, single-tenant worker host only
```

For the pytest suite, `python -m pip install -r requirements-dev.txt`
(requirements.txt + pytest) is sufficient.

`requirements.txt` includes `tzdata`, the IANA timezone database: Windows'
`zoneinfo` needs it to resolve `DEFAULT_TIMEZONE` and profile timezones
(Linux/macOS ship their own).

## Environment

The service reads process environment only — it never loads a `.env` file.
Normally the worker supplies these (locally the Node worker loads
`frontend/.env.development.local` via `--env-file`); `.env.example` documents
the keys. All are non-public, server-side values.

| variable | purpose |
|---|---|
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role PostgREST/Storage access |
| `UNIPILOT_INTEGRATIONS_KEY` | pgcrypto key for the encrypted QR/Google credential RPCs |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | per-user Google OAuth token refresh |
| `GOOGLE_CALENDAR_ID` | target calendar when the credentials row has none (default `primary`) |
| `WHATSAPP_PROFILE_ROOT` | live browser-profile root (default `whatsapp/.profiles/<user_id>`) |
| `DEFAULT_TIMEZONE` | fallback timezone when the profile has none (`Asia/Kolkata`) |
| `DATE_ORDER` | `DMY` (default) or `MDY` for numeric dates |
| `DEFAULT_EVENT_DURATION_MINUTES` | default duration when no end time is found |
| `IGNORE_SENDERS` | comma-separated sender names/numbers to skip |
| `WHATSAPP_MESSAGE_CAP` / `WHATSAPP_CANDIDATE_CAP` | hard per-run stops (5000 / 500) |
| `LIVE_QR_TIMEOUT`, `LIVE_MAX_MESSAGES`, `LIVE_SCROLL_WAIT`, `LIVE_STALE_ROUNDS` | live-mode knobs (QR wait seconds, scroll cap, scroll pause, patient empty rounds) |

`WHATSAPP_PYTHON` (interpreter selection) and `WHATSAPP_SYNC_TIMEOUT`
(export-sync seconds) are read by the Node worker, not by the service; both are
documented in `backend/.env.example`.

`UNIPILOT_INTEGRATIONS_KEY` rotation: call
`rotate_google_token_key(p_old, p_new)` as the service role, swap the value on
the Next server and the worker host, then restart both. QR rows need no
rotation (60 s TTL). The full runbook is in `backend/DATABASE.md`.

## Worker-host contract

The host that runs `npm run worker -w backend` (the Node worker in
`backend/worker/`, which spawns `python -m wa_service <action>` per job) must
satisfy:

1. **Python 3.11+** and the dependency groups: `requirements.txt` for
   export/push, plus `requirements-google.txt` for `whatsapp.push`, and
   `requirements-live.txt` only on the single-tenant live host.
2. **Environment** supplied through the platform secret store (locally
   inherited from `frontend/.env.development.local` by the worker's
   `--env-file`): `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`),
   `SUPABASE_SERVICE_ROLE_KEY`, `UNIPILOT_INTEGRATIONS_KEY`, and the Google
   pair for push.
3. **The worker process** under a process manager: `npm run worker -w backend`;
   `WHATSAPP_PYTHON` may name an absolute interpreter.
4. **Sanitized, expected failures** (no missing dependency ever fakes a
   success): a missing interpreter fails the job non-retryably with the
   actionable "install Python and whatsapp/requirements*.txt" message; missing
   Google libraries fail only `whatsapp.push`; missing Selenium/Chrome fails
   only live jobs.
5. **Single-tenant live mode**: `WHATSAPP_PROFILE_ROOT` on a private volume,
   per-user `0700` profile dirs, purged on disconnect.

An upload only queues its `whatsapp.sync` job; the worker
(`npm run worker` / `npm run worker:once`) is what processes it, so a scan that
stays `queued` means the worker is not running.

The worker log must contain only sanitized service errors (`whatsapp service
failed`-class messages). Tokens, the encryption key, QR payloads, message
bodies and chat exports must never appear in logs, job payloads, error
strings, screenshots, or test artifacts — the Node handler and this service
both keep to that rule.

### Test suite

The contract is enforced by the test suite: `npm run test:whatsapp` runs the
pytest suite alone, and the worker-Python Playwright specs run against the
local stack with the QA seed up. Run them through the frontend workspace from
the repo root (the config loads `frontend/.env.development.local` relative to
its run directory):

```
npm run test:whatsapp          # pytest, no local stack needed
# honest-skip worker specs (local stack + QA seed up):
npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts
npm run test -w frontend -- tests/qa/whatsapp-export.spec.ts
# strict worker-Python run (PowerShell):
$env:UNIPILOT_REQUIRE_PYTHON="1"; npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts tests/qa/whatsapp-export.spec.ts; Remove-Item Env:\UNIPILOT_REQUIRE_PYTHON
```

Suite runs must keep the repo's single-writer rule
(`frontend/scripts/qa-single-writer.ps1`); the WhatsApp projects additionally
serialize through `frontend/tests/qa/workerLock.ts` for targeted `--no-deps`
runs (see QA_SESSION.md).

On a host without Python the Python-dependent specs report as skipped with the
reason `python/wa_service unavailable on this host (install
whatsapp/requirements-dev.txt; see whatsapp/README.md)`. With
`UNIPILOT_REQUIRE_PYTHON=1` the same run fails at collection with the exact
string ``UNIPILOT_REQUIRE_PYTHON=1 but `python -c 'import wa_service'` failed
from whatsapp/ — install python + whatsapp/requirements-dev.txt (see
whatsapp/README.md)``. `WHATSAPP_PYTHON` overrides the interpreter for both the
probe and the worker spawn (default `python`).

## Privacy and retention

- Uploaded export objects are deleted as soon as the sync job reaches a
  terminal state (success, permanent failure, or attempts exhausted).
- Raw messages (`integration_messages`) are purged best-effort after 30 days on
  the next `/integrations` read, and deleted immediately on disconnect.
- The live QR is a login credential: encrypted at rest, 60-second TTL, cleared
  on connect/timeout/disconnect, and never logged or persisted in the clear.
- Candidate rows keep only the single reviewed message as provenance; the bulk
  archive is the only raw store.

### [!] Live mode is blocked in this repository's environment

Live mode needs Chrome plus a phone QR scan on a single-tenant host
(`selenium` + `LIVE_QR_TIMEOUT`); the hosted deployment never offers it
(`UNIPILOT_WHATSAPP_LIVE` gates the UI). In this environment it is marked
`[!]` verified-blocked — no fake status is ever shown, and the pytest suite
covers the parsing/extraction paths without a browser.

### [!] Google Calendar push is unverified in this repository's environment

Push needs a Google Cloud OAuth client (`GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET`) with `{origin}/api/integrations/google/callback`
registered. In this environment it is marked `[!]` verified-blocked — no push
is ever faked: the insert/dedupe/refresh paths are covered by pytest with a
mocked Google client, and the no-credentials no-op is covered end to end.
