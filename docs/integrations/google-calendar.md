# Google Calendar sync: status and design

Google Calendar is UniPilot's first two-way provider: UniPilot imports the
calendars a student chooses, and — only when they opt in — exports their own
deadlines to a dedicated **UniPilot** calendar. The inbound and outbound
directions can never meet: imported rows are excluded from export, and the
export calendar is excluded from import.

The mobile screen is the only new UI. The web `/integrations` Google card and
the existing `whatsapp.push` path keep their behavior.

## Decisions (approved)

1. **OAuth client:** a Google **Web application** client. The registered
   redirect URI proven live is
   `http://localhost:3000/api/integrations/google/callback`; the server builds
   it from `NEXT_PUBLIC_SITE_URL` (set locally to `http://localhost:3000`).
   The `127.0.0.1` equivalent must be registered too if that origin is used —
   the live pass hit `redirect_uri_mismatch` for it. The same client pair is
   readable by the worker host (`frontend/.env` and `backend/.env`).
2. **Scopes (recorded deviation, proven necessary live):** three scopes in one
   grant — `calendar.events` (event read/write),
   `calendar.calendarlist.readonly` (`calendarList.list`), and
   `calendar.app.created` (create the dedicated UniPilot calendar). The initial
   `calendar.events`-only decision was insufficient: Google answers
   `calendarList.list` and `calendars.insert` with 403
   `insufficientPermissions`. The full `calendar` scope is deliberately not
   requested.
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
  `invalid_response`. A 403 is also Google's answer for a missing scope, so the
  reconnect copy is the honest next action for both. Google bodies are never
  logged.
- `repo.mjs` — the DB half (connection gate, encrypted credential read,
  calendar upserts, event upsert/delete, cursors, export sets, run/usage rows).
- `sync.mjs` — the `gcal.sync` handler (`backend/worker/handlers.mjs`). The job
  lease heartbeats for the whole pass; a revoked grant flips the connection to
  `error` with "Google authorization expired; reconnect Google Calendar.",
  records one `integration_runs(mode='sync', status='failed')` row, and is not
  retried.

The first run is bounded (`-30d…+365d`) instead of crawling the whole calendar.
Later runs use the stored cursor; a `410` clears it and re-syncs that bounded
window once. Export is capped at 100 inserts + 100 patches per pass; a deadline
exports as a 30-minute timed event (or a one-day all-day event if it ever
reaches the worker without a date), and an all-day event's Google end is the
next day because Google treats it as exclusive. Every exported event carries
`extendedProperties.private.unipilotSource`.

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

- `npm run test:gcal` — 12 mocked-HTTP worker tests: config gate, token refresh,
  revoked vs retryable errors, `410` handling, cancelled-event deletion,
  same-event re-sync (unique-key upsert, no duplicate), primary-ON/secondary-OFF
  upsert, export insert/patch, undated tasks staying local, loop guards, run
  row `mode='sync'`, heartbeat-started.
- `npm run mobile:typecheck`, `mobile:lint`, `mobile:test` — 181 Jest tests,
  including the snapshot parser, state→controls table, API client (Bearer
  header, toggle body, three sync outcomes, 401/500/network mapping), registry
  statuses and the Calendar/Tasks provenance mapping.
- `npm run db:lint` + the schema-check script on the local stack.
- **Web Playwright suite (2026-11-22):** the full run reported 601 passed,
  3 failed of the started 758 (62 skipped; the run bailed before 154). Two
  failures were this pass's own QA Google-connection residue (the route smoke
  left a `disconnected` row); after removing it, the affected
  `qa-whatsapp-jobs` project ran green: 199 passed, 3 skipped — including
  "an automatic run with a connected Google row enqueues ids-only push jobs".
  The third failure is the pre-existing Presenton engine dependency
  (`ECONNREFUSED ::1:5001`), unrelated to this work.
- **Bearer route smoke (2026-11-22):** signed in as the QA identity, the real
  Next routes answered `GET` 200 (`configured: true`, `status: not_connected`),
  `POST /connect` 200 with an
  `accounts.google.com/o/oauth2/v2/auth` URL carrying `state` and
  `access_type=offline`, `POST /sync` 200 `not_connected`, `POST /auto-export`
  200 and `POST /disconnect` 200 with the keep-your-events notice.
- **Local worker smoke (2026-11-22):** a QA identity connection with a bogus
  stored refresh token was enqueued through the real `enqueue_gcal_sync` RPC
  and processed by `worker:once`. Google's token endpoint really rejected it;
  the job settled `failed` (permanent), the connection became `error` with the
  reconnect copy, and one `integration_runs(mode='sync', status='failed')` row
  was written. This proves the handler registration, encrypted-credential read,
  real HTTP error mapping and settlement path (the live pass below covers the
  success path).

## Live verification status

**Verified against live Google on 2026-11-22** (local stack, Android emulator
`Pixel7_API36`, APK 108,277,629 bytes, signer `bc51cd50…`, cleartext on,
installed in place). Test identity: `lets.thryvee@gmail.com` (a Google Test
user; not the founder account).

- **Consent + connect:** the server-mediated flow reached Google's account
  picker, the unverified-app warning, and the three-scope consent; the callback
  exchanged the code, stored the refresh token encrypted, and returned through
  `unipilot://oauth/google`. The first attempt failed with
  `redirect_uri_mismatch` for `127.0.0.1`; setting
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000` made the callback use the
  registered `localhost` URI.
- **Calendar list + defaults:** the connection became `Connected`,
  `calendarList.list` mirrored two calendars, the primary started **Importing**
  and "Holidays in India" started **Off** with no cursor.
- **Inbound + cancellation:** a real event created 2026-11-23 10:00 UTC in the
  primary was imported by `gcal.sync` (`source='google_calendar'`,
  `source_ref` = Google id), rendered on the Calendar tab with an EVENT +
  **GOOGLE CALENDAR** pill and `Source: Google Calendar` in the sheet. Deleting
  the event in Google and syncing again removed the local row (0 matches for
  that `source_ref`).
- **Calendar toggle:** switching "Holidays in India" on persisted
  `is_active=true` with `activated_at`; the list re-sorted it above the primary.
  It was switched back off during cleanup (the UI tap and persistence are the
  evidence; cleanup used the service role).
- **Export:** enabling auto-export and syncing created the dedicated **UniPilot**
  calendar (`calendar.app.created`), exported the local deadline with
  `extendedProperties.private.unipilotSource=task:<id>`, and set
  `tasks.google_event_id`. The Tasks tab showed the **GOOGLE CALENDAR** pill and
  `Google Calendar: Exported`. A title edit followed by another sync PATCHed the
  same Google event id (summary updated, no duplicate). The calendar also
  exported four pre-existing local events in the same pass, which is the
  designed opt-in behavior.
- **Throttle:** tapping Sync Now within five minutes rendered
  "A sync just ran. Wait a few seconds and try again."
- **Disconnect:** the confirm sheet's Disconnect wiped the refresh token
  (credentials 0), the calendar rows/cursors (0), cleared
  `auto_export_to_gcal`/`export_calendar_id`/`last_synced_at`, and settled the
  connection as `disconnected`.
- **Mobile states:** the More row rendered **Not linked**, **Connected** (with
  relative sync time), and **Needs reconnect** in their real states; the screen
  rendered its not-linked, connected (preferences + calendars), and disconnect
  states. Dark mode and reduced motion (scales 0/0/0, cold start) showed every
  element.
- **Cold-start deep link:** `unipilot://oauth/google?status=connected` launched
  the dead process straight into the Google Calendar screen (the same Android
  launch-URL hazard as the auth callback).

**Not exercised live:** a recurring series instance, a real all-day event, and
calendar-list pagination. Their behavior is covered by the worker tests and the
recorded limits below. The exported test calendar and its events were deleted
after the pass, and local smoke rows/ids were cleared; no live Google data is
left behind.

Reproduce with: the local stack, `npm run dev:web`, `npm run worker`, a
registered Web-application client whose Test users include the account, and
`NEXT_PUBLIC_SITE_URL=http://localhost:3000` (or the matching registered
origin).

## Known gaps and risks

- A 403 is Google's answer for both a revoked grant and a missing scope; the
  worker correctly settles it as "needs reconnect", but a distinct
  "permission missing" copy would need the response body (deliberately not
  read). Re-consent is the fix in both cases.
- The local `127.0.0.1` callback must be registered on the Google client if
  that origin is used; the verified local setup builds `localhost` from
  `NEXT_PUBLIC_SITE_URL`.
- Google is not a stable test double: quota, consent-screen changes and
  verification status can change behavior without a code change.
- The export calendar is found by name (`UniPilot`) or by the stored id. If a
  user renames it and the stored id is lost (disconnect clears it), a new
  calendar is created on the next export.
- All-day Google events are date-only; UniPilot stores an instant. They are
  placed at noon UTC so the common profile zones keep the same calendar day;
  zones beyond +12 can still show the next day. A date-only column would be
  the structural fix.
- `singleEvents=true` expands recurring series into instances; `maxResults=2500`
  covers a normal student year in one page. `nextPageToken` is not followed, so
  a calendar/window with more than 2,500 instances would be truncated; a
  pagination loop is a future item. First-run window is `-30d…+365d`.
- Export is idempotent per row, but a Google-side deletion of an exported
  event is not detected; the next PATCH re-creates nothing and reports the
  missing event as a rejected request. A reconciliation pass is a future item.
- Disconnect does not delete already-exported Google events (approved).
