# Google Calendar sync: status and design

Google Calendar is UniPilot's first two-way provider: UniPilot imports the
calendars a student chooses, and — only when they opt in — exports their own
deadlines to a dedicated **UniPilot** calendar. The inbound and outbound
directions can never meet: imported rows are excluded from export, and the
export calendar is excluded from import.

The mobile screen is the only new UI. The web `/integrations` Google card and
the existing `whatsapp.push` path keep their behavior.

## Decisions (approved)

1. **OAuth client:** a Google **Web application** client; the redirect URIs are
   `http://localhost:3000/api/integrations/google/callback` and the
   `127.0.0.1` equivalent for local work. The same client pair is readable by
   the worker host (`frontend/.env` and `backend/.env`).
2. **Scope:** `https://www.googleapis.com/auth/calendar.events` — one grant
   covers reading events (`events.list`) and writing them
   (`events.insert`/`events.patch`).
3. **Defaults:** the primary calendar starts **ON**; secondary, holiday and
   birthday calendars start **OFF**, so personal noise is not auto-imported.
4. **Deletion semantics:** a Google event with `status = "cancelled"` deletes
   its local `events` row.
5. **Export timing:** outbound runs only inside `gcal.sync` — on connect and on
   an explicit **Sync Now** — never on a hidden timer.
6. **Provenance:** imported events use row-level
   `source = 'google_calendar'` + `source_ref = <google event id>`; connection
   rows use `provider = 'google'`. A task's `source` is never changed by an
   export; only `tasks.google_event_id` is set.
7. **Disconnect:** revoke the token at Google, wipe the encrypted credentials,
   the calendar list and cursors, and settle the connection as `disconnected`.
   Imported UniPilot rows stay; events already exported to Google stay.

## Data flow

```
 mobile app                Next.js (Bearer)                 Google
 ──────────                ───────────────                 ──────
 Connect ───────────────▶ POST /connect
                          mint state row (SHA-256)
                          ◀── authorizationUrl ────────────▶ consent
                          GET /callback?code&state
                          consume state (single use)
                          code → refresh token
                          store encrypted (pgcrypto)
                          ◀── 302 unipilot://oauth/google?status=connected
 Sync Now ──────────────▶ POST /sync (≥5 min throttle)
                          enqueue_gcal_sync ──▶ jobs(gcal.sync)

 worker (backend/)                                 Google
 ─────────────────                                 ──────
 gcal.sync
   refresh access token in memory ◀──────────────── token endpoint
   calendarList.list ─────────────────────────────▶ calendars
   events.list per active calendar ◀──────────────▶ events (+syncToken)
   upsert events(source='google_calendar')
   cancelled → delete local row
   opt-in export:
     find-or-create "UniPilot" calendar ──────────▶ calendars
     insert never-exported rows ──────────────────▶ events.insert
     patch exported rows ─────────────────────────▶ events.patch
   stamp last_synced_at + one integration_runs(mode='sync')
```

## Schema

Six forward-only migrations:

| Migration | Change |
| --- | --- |
| `20261122132216_google_oauth_states.sql` | `google_oauth_states` (hashed, single-use, 10-minute state; service-only, RLS with no policies) |
| `20261122132217_google_calendars.sql` | `google_calendars` (owner SELECT + `is_active` update only; worker owns cursors/names) |
| `20261122132218_google_connection_sync_fields.sql` | `integration_connections.last_synced_at`, `auto_export_to_gcal`, `export_calendar_id` |
| `20261122132220_gcal_event_provenance.sql` | `events.source` gains `google_calendar`; `events.google_event_id` + `tasks.google_event_id` with per-user partial unique indexes; provenance triggers extended |
| `20261122132221_integration_runs_sync_mode.sql` | `integration_runs.mode` gains `sync` (neither storage path nor chat name) |
| `20261122132245_gcal_sync_enqueue_rpc.sql` | `enqueue_gcal_sync(uuid)` — connected-row gate + one live job per user + ids-only payload |

`npm run db:lint` is clean and `backend/supabase/qa/google-calendar-schema-check.sql`
asserts the contract end to end (two-user isolation, `google_oauth_states`
unreachable by API roles, primary/secondary defaults, provenance locks,
export-id uniqueness, disconnecting leaves imported/exported rows). It prints
`ALL CHECKS PASSED` on the local stack.

## OAuth (two clients, one callback)

**Web (existing, unchanged):** httpOnly `google_oauth_state` cookie + the
server's own code exchange; the callback redirects to `/integrations`.

**Mobile (new):** no cookies on the client, so:

1. `POST /api/integrations/google-calendar/connect` mints 64 random hex chars,
   stores **only** the SHA-256 in `google_oauth_states` with a 10-minute expiry,
   and returns a consent URL (`access_type=offline`, `prompt=consent`).
2. The app opens that URL with `expo-web-browser`; the browser comes back to
   the registered server callback.
3. The callback hashes the incoming `state`, atomically claims an unconsumed,
   unexpired row, exchanges the code, stores the **refresh token only**
   (pgcrypto, `UNIPILOT_INTEGRATIONS_KEY`), discards the access token, and
   redirects to `unipilot://oauth/google?status=connected` (or `status=error`).
4. A replay finds no unconsumed row. No code, token or raw state is stored in
   the state table or written to logs.

The deep link lands on `mobile-app/src/app/oauth/google.tsx`, which exists in
both auth states; the root layout also handles the Android cold-start hazard
(the router's `getInitialURL` 150 ms race) by reading `Linking.getLinkingURL()`
and routing to the Google Calendar screen.

## Bearer API

All under `frontend/app/api/integrations/google-calendar/`; authenticated with
the Supabase access token (`lib/auth/apiAuth.ts`), owner-scoped, `no-store`,
and 403 until onboarding is complete.

| Route | Behavior |
| --- | --- |
| `GET /` | Snapshot: `configured`, `status`, `lastError`, `autoExport`, `lastSyncedAt`, calendars |
| `POST /connect` | `{ authorizationUrl }`; `503` when the OAuth pair is unset |
| `POST /calendars/{id}/active` | `{ active: boolean }`; owner + calendar id scoped |
| `POST /sync` | `accepted` / `throttled` (≥5 minutes since `last_synced_at`) / `not_connected` |
| `POST /auto-export` | `{ enabled: boolean }` |
| `POST /disconnect` | Best-effort revoke, credential wipe, calendars/cursors wipe, `disconnected` row; returns the keep-your-events notice |

The service layer is `frontend/lib/data/googleCalendar.ts`.

## Worker

`backend/worker/gcal/`:

- `googleClient.mjs` — token refresh, `calendarList.list`, `events.list` with
  `syncToken`/`410`, find-or-create the export calendar, `events.insert`,
  `events.patch`. Error mapping: `400/401/403` → permanent `revoked`; `429`/`5xx`/
  network → retryable `unavailable`; malformed bodies → retryable
  `invalid_response`. Google bodies are never logged.
- `repo.mjs` — the DB half (connection gate, encrypted credential read,
  calendar upserts, event upsert/delete, cursors, export sets, run/usage rows).
- `sync.mjs` — the `gcal.sync` handler (`backend/worker/handlers.mjs`). The job
  lease heartbeats for the whole pass; a revoked grant flips the connection to
  `error` with "Google authorization expired; reconnect Google Calendar.",
  records one `integration_runs(mode='sync', status='failed')` row, and is not
  retried.

The first run is bounded (`-30d…+365d`) instead of crawling the whole calendar.
Later runs use the stored cursor; a `410` clears it and re-syncs that bounded
window once. Export is capped at 100 inserts + 100 patches per pass. Every
exported event carries `extendedProperties.private.unipilotSource`.

## Mobile

- `mobile-app/src/app/google-calendar.tsx` — status card
  (Connected / Not linked / Needs reconnect / Not available), Connect,
  calendar switches with optimistic revert, auto-export switch, Sync Now with
  the server's throttle copy, and a confirm-first disconnect `BottomSheet`.
- `mobile-app/src/features/googleCalendar/` — `gcalValues.ts` (pure parsers,
  state→controls table, sort rule), `gcalApi.ts` (injectable Bearer client),
  `gcalClient.ts` (app wiring), `useGcal.ts` (focus read + actions).
- `mobile-app/src/features/workspace/registries.ts` — the `google-calendar`
  entry now resolves `Connected` / `Needs reconnect` / `Not linked` /
  `Not available` and carries `lastSyncedAt`; the More hub reads it.
- Calendar events imported from Google show a **Google Calendar** pill and the
  detail sheet says `Source: Google Calendar`; a task with `google_event_id`
  shows a **Google Calendar** pill and an `Exported` detail row. Tasks never
  change `source` because of an export.

## Automated verification

- `npm run test:gcal` — 11 mocked-HTTP worker tests: config gate, token refresh,
  revoked vs retryable errors, `410` handling, cancelled-event deletion,
  primary-ON/secondary-OFF upsert, export insert/patch and loop guards, run
  row `mode='sync'`, heartbeat-started.
- `npm run mobile:typecheck`, `mobile:lint`, `mobile:test` — 181 Jest tests,
  including the snapshot parser, state→controls table, API client (Bearer
  header, toggle body, three sync outcomes, 401/500/network mapping), registry
  statuses and the Calendar/Tasks provenance mapping.
- `npm run db:lint` + the schema-check script on the local stack.
- **Local worker smoke (2026-11-22):** a QA identity connection with a bogus
  stored refresh token was enqueued through the real `enqueue_gcal_sync` RPC
  and processed by `worker:once`. Google's token endpoint really rejected it;
  the job settled `failed` (permanent), the connection became `error` with the
  reconnect copy, and one `integration_runs(mode='sync', status='failed')` row
  was written. This proves the handler registration, encrypted-credential read,
  real HTTP error mapping and settlement path. It is **not** a successful
  import/export.

## Live verification status

- [!] **Not yet exercised against live Google.** The OAuth client pair is set
  in `frontend/.env`/`backend/.env`, but a real consent round trip, a real
  calendar list and a real import/export have not been run in this session.
  Until that happens, the only evidence is the mocked-fetch suite and the
  schema contract. The device legs (connect → consent → deep-link return,
  calendar toggles, Sync Now import, auto-export round trip, disconnect) are
  also pending.
- Live E2E requires: a registered Web-application OAuth client with the two
  localhost redirect URIs, a Google account on its Test users list, the local
  stack up, and `npm run worker` (or `worker:once`) running with the same
  client pair.

## Known gaps and risks

- Google is not a stable test double: quota, consent-screen changes and
  verification status can change behavior without a code change.
- The export calendar is found by name (`UniPilot`) or by the stored id. If a
  user renames it and the stored id is lost (disconnect clears it), a new
  calendar is created on the next export.
- Export is idempotent per row, but a Google-side deletion of an exported
  event is not detected; the next PATCH re-creates nothing and reports the
  missing event as a rejected request. A reconciliation pass is a future item.
- Disconnect does not delete already-exported Google events (approved).
