# UniPilot Mobile — Plan and Phase Record

Originally written 2026-09-30 as the Phase 0 (M0) plan against `master` @ `a330534`;
approved the same day with founder decisions (a)–(h) (see §O). Sections 0–O are the
approved plan and change only by recorded amendment. §P is the append-only phase record.
Where §P and an earlier section disagree, §P is newer and wins.

## Status at a glance (updated 2026-11-18)

| Item | State |
| --- | --- |
| Current phase | **M2b** (PKCE Google sign-in + native onboarding). M0, M1, M2a complete. |
| Gate blocker | **None on the auth legs.** Legs A (WARM), B (CANCEL), C (COLD) and the **QA2 onboarding leg all PASS**; the native onboarding completion and the web row-for-row proof landed on 2026-11-18 (§P). Incidents from the leg (139 QA2 sessions deleted by a credential probe, the password-bearing Next dev log and its rotation, and a transient local `PGRST303`) are recorded in §P, not hidden. |
| Next action | **STOP for founder review of the M2b gate.** Nothing is in flight; the server-action logging fix and the QA2 password rotation are the only changes from this leg. |
| Then | M3 starts only after the gate closes. |
| Test environment | Android Studio emulator `Pixel7_API36` (`emulator-5554`), shut down after the leg; the Xiaomi phone is preserved and unplugged. The web proof used a temporary host TCP bridge on `54950` because `54937` is inside Windows' reserved `54841-54940` range (the known `winnat` constraint). |
| Pushed | `master` on `UniPilot`: mobile OAuth fix `46f2af8`, housekeeping through `cc685e0`, then the QA2 leg record and the server-action logging fix. |

Milestone map: M0 ✅ · M1 ✅ · M2a ✅ · **M2b 🔶** · M3–M7 pending (full table in §K).

Contents: 0 Method · A Framework · B Architecture boundary · C Calendar scope ·
D Server work · E Design language · F Auth · G Build & release · H QA ·
I Monorepo · J Honest limits · K Phases · L Future · M Env vars ·
N External dependencies · O Decisions · P Phase record · Q References

---

## 0. Method, evidence, machine preflight

### 0.1 What was read (sources of truth)

| Source | Used for |
| --- | --- |
| `AGENTS.md`, `frontend/AGENTS.md` | monorepo layout, Motion rule, QA session contract, Next.js-16 warning |
| `README.md` | root scripts, env invariant, WSL/Docker stack, one-command environment |
| `TASK.md` §0 (global rules), §0.17, §17/§22 (calendar), §46 (integrations + 46.11–46.30 records), §56–57, R7/R15/R17/R20 | task discipline, guest policy, the real integration history and blockers |
| `DESIGN.md` (incl. Task 3.13/3.14 amendments) | monochrome tokens, closed three-font set, radius/elevation/fill systems, backdrop stack |
| `MOTION.md` | duration/ease/stagger tokens, primitive vocabulary, safety rules |
| `AUTH_ARCHITECTURE.md` | Supabase Auth, PKCE/cookie posture, OAuth callback, redirect safety, guest browsing |
| `QA_SESSION.md` | QA identities, one-writer rule, screenshots convention, WhatsApp QA chain, `[!]` blockers |
| `backend/DATABASE.md`, `backend/supabase/MIGRATIONS.md` | 23-migration schema, RLS matrix, migration workflow/checklist |
| `whatsapp/README.md` | Python service contract, worker-host requirements, privacy/retention |
| `docs/integrations/presenton.md` | the service-over-HTTP integration pattern and honest-state posture |
| `frontend/lib/data/{events,eventValues,taskDates,tasks,taskValues,integrations,integrationValues,integrationActions,jobs,profileTime}.ts` | the real domain/validation/mapping layers |
| `frontend/app/api/**` (google callback, assistant turn, presentation routes) | existing route-handler patterns and auth |
| `frontend/app/(app)/{calendar,integrations}/**`, `frontend/components/{app,motion,ui}/**`, `frontend/app/globals.css`, `frontend/app/layout.tsx`, `frontend/.env.example` | UI shell, tokens, fonts, motion vocabulary |
| `backend/worker/{run,handlers,whatsappJobs,heartbeat}.mjs` | job protocol, retry/backoff, lease heartbeat |
| `backend/supabase/migrations/20260912120000_whatsapp_integration.sql` etc. | the exact event-provenance + integration schema and RPC pattern |

### 0.2 Repo facts this plan is grounded in (not generic)

- Workspaces: root `package.json` = `["frontend","backend"]`, one root lockfile, Node 24.18 / npm 11.16 on this machine.
- Frontend: Next 16.3.1, React 19.2.8, Tailwind v4, `motion` ^13.1.1, `@supabase/ssr` ^0.12.4, `@supabase/supabase-js` ^2.112.3, `lucide-react`.
- 23 versioned migrations. `events.source ∈ {manual, whatsapp}` with unique `(user_id, source, source_ref)` and a trigger forcing `manual` for every non-service-role write (46.12).
- Integration tables `integration_connections / integration_runs / integration_messages / integration_candidates`, owner-SELECT RLS, service-side writes only; `google_calendar_credentials` is deny-by-default (no grants to `anon`, `authenticated`, `service_role`) and reachable only through 8 service-role RPCs (`upsert/get/delete_google_credentials`, `rotate_google_token_key`, QR trio, `touch_job`).
- `integration_candidates` is WhatsApp-shaped: `run_id` NOT NULL, `message_sender`/`message_text` NOT NULL, `provider_event_id`, terminal rejection via unique `(user_id, fingerprint)`.
- Worker: `backend/worker/run.mjs` + `handlers.mjs`; kinds today `document.process`, `document.reindex`, `presentation.generate`, `presentation.export`, `whatsapp.connect|sync|push|disconnect`, `noop.test`. Claim→dispatch→settle with exponential backoff, `dead_letter`, 60 s `touch_job` lease heartbeat, ids-only payload rule, sanitized errors only.
- Existing app-facing HTTP surface: `GET /api/integrations/google/callback` (cookie+state, redirects to `/integrations?google=…`), `POST /api/assistant/turn` (SSE, cookie session), `GET /api/presentation/**` (cookie session). Everything else in the web app is Server Actions — **not callable from the device**.
- Pure, runtime-dependency-free modules suitable for reuse (type-only imports aside): `frontend/lib/data/taskDates.ts`, `eventValues.ts`, `integrationValues.ts`; types-only: `frontend/lib/supabase/database.types.ts`.
- Google Calendar OAuth (per-user, for push) is **implemented** (P7.1/P7.2) but **`[!]` blocked E2E** because `GOOGLE_OAUTH_CLIENT_ID/SECRET` are unset (46.17). WhatsApp live mode is **`[!]` blocked** (single-tenant host + phone QR, 46.16). Neither is unblocked by this project.
- Design: monochrome only; closed three-family set (Geist body / Geist Mono metadata / Bricolage Grotesque headings **and action labels**); 5-step radius scale (Frame 32/24 → Card 20/16 → Nested 12 → Control 8 → Pill); four elevation recipes; three fills (Glass/Solid/Inverted) with the rationing rule; fixed backdrop stack (base + ambient field + swappable motif); `font.spec.ts` enforces the font rules on the web.
- Motion: `--ease-out` `cubic-bezier(0.23,1,0.32,1)`, durations 140/160/180/220/150/400/380/260/380/90/140/720 ms, staggers 40/60/80 ms; `presets.ts` is the authoritative TS mirror; reduced motion zeroes everything; **animation never controls content existence**.
- QA: 33 Playwright specs; `npm run test` builds and owns a production server; QA1/QA2 identities; screenshots → `frontend/screenshots/` (git-ignored); one writer at a time.
- Local Supabase runs in WSL2 (`kali-linux`) and, on this host, the API port was moved to **54937** because of a Windows `winnat` reservation.

### 0.3 Machine preflight (this host, checked for this plan)

> **Snapshot from 2026-09-30.** Superseded by §P: JDK 17, Android SDK, CMake 3.30.5, NDK and an AVD are now installed (see the M1 "Toolchain" and M2b emulator entries), and a physical phone has been used for M1/M2a evidence. Kept as the original baseline.

| Tool | Found | Consequence |
| --- | --- | --- |
| Node 24.18.0 / npm 11.16.0 | ✅ | fine for Expo CLI + Metro |
| `adb` at `C:\Android\platform-tools\adb.exe` | ✅ (PATH not guaranteed) | device/emulator control possible |
| Android SDK / `sdkmanager` / `emulator.exe` / AVDs | ❌ none | **M1 gate item**: EAS Build is now primary (decision (g)); the local SDK+emulator path is the documented fallback |
| JDK | Java 26 (Temurin) | Gradle/AGP for the pinned RN may not support 26 → install Temurin 17/21 and point `JAVA_HOME` at it for Android builds; verify in M1 |
| Connected Android device | ❌ none | M1/M7 device evidence requires a **physical phone over adb** (decision (h)); no phone ⇒ M1 stops at preflight and reports honestly |
| WSL2 Supabase stack | available per QA_SESSION.md (host-specific) | mobile dev points at `127.0.0.1:54937` behind `adb reverse`/emulator `10.0.2.2` |

### 0.4 Working-tree note (honesty)

The tree is **not clean** (`git status`: many modified docs/tests, `backend/.env.development.local.example` deleted, etc. — pre-existing, not ours). Rule for this project: before M1 starts, the existing work is either committed by its owner or explicitly parked; mobile commits are scoped per phase (`feat(mobile): …`) and never include unrelated paths. No phase pushes a red tree.

---

## A. Decision — framework

**DECISION: React Native + Expo (TypeScript), in `mobile-app/`.**

Why (grounded, not preference):

1. **Language/type continuity.** The entire repo is TypeScript (frontend) / ESM JavaScript (worker). A native RN app can consume type-only artifacts from the web repo without modifying it — most importantly `frontend/lib/supabase/database.types.ts` — and the candidate pure modules in §A.3. Flutter would introduce a second language, a second type system, and a second domain model with zero mechanical reuse.
2. **Supabase native support.** `@supabase/supabase-js` is the supported client for React Native (PKCE flow, custom storage adapter, deep-link session exchange). The repo already pins `@supabase/supabase-js` ^2.112.3 at both workspaces; the mobile app pins the same line, so contract drift is a version number, not a rewrite.
3. **OAuth / deep links.** `expo-web-browser` (`openAuthSessionAsync`) + `expo-linking` + Android intent filters are the standard mechanism for both the provider OAuth round trip (our own callback → `unipilot://oauth/...`) and Supabase Auth PKCE (`unipilot://auth-callback`).
4. **Team maintainability (R20 — single maintainer).** One package manager, one lockfile, one language, one validation vocabulary, one design-token source. EAS or local Gradle builds keep the release path documented, not bespoke.
5. **Motion continuity.** Reanimated/Moti express the same primitives (bezier eases, durations, staggers) that `MOTION.md` and `presets.ts` already define; the mobile vocabulary is a port of an existing table, not a new animation system.

Flutter is rejected on the record above (no concrete repo-grounded reason to prefer it exists; the default stands).

### A.1 What cannot be reused — explicitly

- **100% of the UI.** React DOM components, Tailwind classes, CSS custom properties, `next/font`, the `(app)` shell, `bg-dotted-grid`, `backdrop-blur` glass, Motion.dev DOM primitives, the `Modal`/`Popover` implementations — none of it runs on RN. The *tokens and rules* are reused (§E); the *code* is not.
- **Server Actions.** `frontend/lib/data/*Actions.ts` are Next-only RPC entry points; a native app cannot invoke them. Every server capability the app needs must be (or become) an HTTP endpoint (§B, §D).
- **The Playwright test suite.** Browser-only; it will never test this app. Mobile gets its own gates (§H).
- Also not reusable: `@supabase/ssr` cookie clients, `proxy.ts` route protection, `getTrustedSiteOrigin()`'s `Host`-based logic (app endpoints use Bearer tokens and configured origins).

### A.2 What is reused as read-only types/logic (verified candidates)

| Artifact | Kind | Status |
| --- | --- | --- |
| `frontend/lib/supabase/database.types.ts` | types only | **Use** via tsconfig path (`@unipilot/db-types`). Never edited by mobile. |
| `frontend/lib/data/taskDates.ts` | pure runtime (`Intl` only) | **Candidate** — M1 spike proves Metro/tsc resolution; else mirror with a parity note. |
| `frontend/lib/data/eventValues.ts` | pure runtime (imports `./taskDates`; `Database` type-only) | same rule |
| `frontend/lib/data/taskValues.ts`, `integrationValues.ts` | pure runtime | same rule |
| `frontend/lib/auth/errors.ts` copy, `integrationErrors.ts` copy | constants | M3/M2 port the exact strings (copy on evidence, no drift-by-memory: paste from source, reference the file in a comment). |

Rule: if the spike fails, the fallback is an explicit mirror module with a header naming the source file and a parity checklist in the phase record — never a silent divergence. No file under `frontend/` is modified for reuse.

---

## B. Architecture boundary

The mobile app is a **client**. Two and only two channels:

1. **Direct Supabase** (auth + RLS-scoped reads/writes) with the user's own JWT. RLS is authoritative; the app never holds the service role key.
2. **The existing Next.js server** (`frontend/app/api/**`, existing or new) for anything needing provider secrets, OAuth exchanges, service-role writes, or long-running work (jobs).

Bearer auth for app-facing endpoints: `Authorization: Bearer <supabase access token>`, verified server-side with `supabase.auth.getUser(token)` + the onboarding gate. No cookies, no Server Actions, no request-Host-derived origins.

**Provider tokens never touch the device.** The app never calls Google/Microsoft APIs directly; it only sees connection status and calendar rows.

**No guest mode — approved product decision (2026-09-30).** 0.17 exists for the web's public surfaces; the mobile app is sign-in-first by design: it requires a session from launch, and there is no guest browsing mode. This is a recorded product decision, not an omission; guest browsing remains a web-only concern.

### B.1 Feature → channel map (exactly one of i / ii / iii)

| Feature | Channel | Detail |
| --- | --- | --- |
| Sign up / sign in / sign out / session refresh | **(i)** | Supabase Auth SDK, PKCE, secure storage |
| Profile read/update (name, timezone) | **(i)** | `profiles` owner SELECT/UPDATE RLS |
| Onboarding state read | **(i)** | `profiles.onboarding_completed_at` |
| Onboarding completion (**native, in M2**) | **(i)** | `complete_onboarding` RPC — `security invoker`, EXECUTE granted to `authenticated` (verified in the migration); the app reuses the same validation rules (one logic source) and offers an honest fallback deep link to the web only if the RPC fails |
| Subjects list | **(i)** | `subjects` owner RLS |
| Tasks list/create/update/delete | **(i)** | `tasks` owner RLS; DB CHECKs are the backstop |
| Events list/create/update/delete | **(i)** | `events` owner RLS; provenance trigger keeps `source='manual'` for client writes |
| Unified calendar read (all sources) | **(i)** | `events` + `subjects` owner RLS |
| Provider connection status (Google/Microsoft/WhatsApp) | **(i)** | `integration_connections` owner SELECT |
| Sync history / candidate queue | **(i)** | `integration_runs` / `integration_candidates` owner SELECT |
| Google Calendar connect/disconnect | **(iii)** + (ii) | new `POST /api/integrations/google/start|disconnect`; **existing** `GET /api/integrations/google/callback` extended for app return (§D3) |
| Microsoft connect/disconnect | **(iii)** | new `POST /api/integrations/microsoft/start|disconnect`, `GET /api/integrations/microsoft/callback` |
| Trigger a provider sync/scan | **(iii)** | new `POST /api/integrations/sync` (throttled, enqueues ids-only jobs) |
| WhatsApp export upload | (i) + (iii) | reserve/finalize/abort via new endpoints (service writes + job enqueue); the file itself uploads **directly to Storage** under the user's JWT (`whatsapp-exports` owner-folder RLS) |
| WhatsApp candidate confirm/reject | **(iii)** | new endpoints over the existing service functions (`confirmCandidate`, `rejectCandidate`) |
| WhatsApp live QR/status | **(iii)**, deferred | service-only QR RPC; self-host-gated; post-M7 |
| Google Calendar push of an app event (M6) | **(iii)** | new `POST /api/integrations/google/push { eventId }` → ids-only job |
| Assistant / presentation tools | **(ii)** existing, deferred | `/api/assistant/turn` (needs Bearer support → a listed web change if and when enabled); presentation routes are desktop-shaped, out of scope |
| Documents list/upload | (i) direct read; upload deferred | `documents` owner RLS; Storage direct upload is a later milestone |
| Anything billing/admin/usage | **(iii)** later | not in this project's scope |

### B.2 Web-app changes this project is allowed to make (complete list)

Everything else in `frontend/` stays untouched. Each listed change is behaviour-preserving or additive, and is verified by the existing Playwright suite.

1. New route handlers under `frontend/app/api/integrations/**` (§D3).
2. Extension of `GET /api/integrations/google/callback` to accept app-mode state rows and answer `302 → unipilot://…` instead of the `/integrations?…` redirect. The web path (cookie-bound state) keeps its exact behaviour.
3. Small extraction of logic currently inline in `integrationActions.ts` into `frontend/lib/data/integrations.ts` service functions (disconnect-google, confirm+push, reject, reserve/finalize/abort) so actions and routes share one body.
4. `frontend/lib/auth/apiAuth.ts` (new): Bearer verification + onboarding gate for route handlers.
5. `frontend/lib/supabase/schema-contract.ts`: add the new tables/columns to the compile-time contract.
6. `frontend/lib/supabase/database.types.ts`: regenerated by `db:types` (generated file, never hand-edited).
7. Root/workspace docs: `README.md`, root `AGENTS.md`, `.gitignore`, root `package.json` scripts (§I).

---

## C. Calendar scope (the "now" milestone)

One unified calendar screen reading **one** owner-scoped `events` set. Each row carries a visible provider marker derived from `(source, source_meta)` — never a fabricated status.

| Source | Marker | Origin pipeline | Status today |
| --- | --- | --- | --- |
| `manual` | none (plain) | app/web user | live |
| `whatsapp` | chat icon + "From WhatsApp" | export upload → `wa_service` extractor → `integration_candidates` → confirm/auto → `events` | live (export); live mode `[!]` blocked |
| `google` | "Google Calendar" | Google Calendar API `events.list` on the stored OAuth credential (`calendar.events` scope already covers reads) | OAuth code exists; E2E `[!]` blocked (no client pair) |
| `outlook` | "Outlook Calendar" | Microsoft Graph `/me/calendarView` | **new** (Azure registration required) |
| `outlook` + `source_meta.onlineMeeting` | "Teams" | Graph `isOnlineMeeting`/`onlineMeeting` metadata on the same event | **new** (same pipeline) |
| `gmail` | "Gmail" | Gmail API scan → heuristic detection → candidates → confirm/auto | **deferred past the first calendar milestone** (approved decision (f): `gmail.readonly` is a restricted scope requiring Google verification/CASA). The app renders the honest "Gmail isn't connected yet" state; the pipeline below stays specified so the Gmail milestone is additive. |

### C.1 Data model

- `events.source` CHECK is extended to `manual | whatsapp | google | outlook | gmail`; existing rows are untouched.
- `events.source_meta jsonb` (new, nullable) carries provider metadata: `{ "onlineMeeting": true, "joinUrl": "…" }`, `{ "calendarId": "primary" }`, `{ "account": "…" }`. It is locked by the same provenance trigger: a non-service caller writes `NULL` (extended trigger, one migration).
- Dedupe **within a provider**: `source_ref` is the provider's own stable id (Google/Graph event id) or the derived fingerprint for heuristic sources; the existing unique index `events_user_source_ref_key (user_id, source, source_ref)` + `on conflict … ignore duplicates` is the only dedupe mechanism. Re-sync = upsert; a re-detected candidate never duplicates an event (the WhatsApp proof from 46.22 is the reference behaviour).
- Gmail fingerprint: mirror `wa_service`'s fingerprint approach — `sha256(sender|subject|normalized-date|normalized-title|start-time)` truncated to 32 hex, prefixed `gm-` so heuristic fingerprints can never collide with WhatsApp's bare 32-hex values (the candidates table's unique key is `(user_id, fingerprint)` — prefixes keep provider namespaces disjoint without a schema change).
- Candidates are reused for the two heuristic sources only (WhatsApp, Gmail): `integration_candidates` gets a `provider` column (default `whatsapp`) and `integration_runs` gets `provider` + a shared `sync` mode (§D1). Outlook/Google never produce candidates — they are already calendar events, imported directly.
- Sync state lives on the connection row: `sync_cursor text` (Google `syncToken` / Graph `deltaLink` / Gmail `historyId`), `last_synced_at timestamptz`. `last_error` already exists.
- **Deletion reconciliation is out of scope** for M3–M4: import is upsert-only. A provider-side deleted event therefore lingers until a later reconciliation design (recorded in §J). No fake "removed" states.

### C.2 Duplicates across providers (honest boundary)

Two providers can hold the same real-world event (an Outlook invite mirrored into Google). Automatic cross-provider merging is **not** built: the app shows both rows, each honestly attributed. A later, optional "possible duplicate" heuristic (same start instant ±0, same normalized title) can badge overlaps without merging; recorded in §L, not in M3–M4.

### C.3 States the calendar and each source must render

- Calendar: loading skeleton, empty month ("Nothing on your calendar yet" + the one action that makes sense), error with retry (sanitized copy), and per-event markers.
- Provider card/status in `More → Integrations` (M3/M5): `connected`, `not_connected`, `not_configured on this server`, `error`, `blocked: verification/host missing` — exact strings modelled on `GoogleCalendarPanel`'s state machine, with the app's equivalent of `data-google-status`.
- Gmail: `not_configured`, `connected_without_gmail_scope` (the honest "reconnect to grant Gmail access" state), `blocked: Google verification`, `error`.
- Never an invented event, sync, count, or progress.

---

## D. Server-side work this milestone requires (in the existing repo)

### D1. Migrations (four files, one logical change each, per `MIGRATIONS.md`)

1. `20XXXXXXXXXX_events_provider_sources.sql`
   - `events.source` CHECK → `manual | whatsapp | google | outlook | gmail`.
   - `events.source_meta jsonb` nullable + comment; extend `lock_event_provenance()` to reset `source_meta` for non-service callers.
2. `20XXXXXXXXXX_integration_sync.sql`
   - `integration_connections.provider` CHECK → `whatsapp | google | microsoft`.
   - `integration_connections.sync_cursor text`, `last_synced_at timestamptz`.
   - `integration_runs.provider text not null default 'whatsapp'` CHECK `whatsapp | google | microsoft`; `mode` vocabulary += `sync`; the input CHECK gets a third arm (`mode='sync'` ⇒ `storage_path is null and chat_name is null`).
   - `integration_candidates.provider text not null default 'whatsapp'` CHECK; index `(user_id, provider, status)` added; existing `(user_id, status)` kept or replaced with a forward-only note.
3. `20XXXXXXXXXX_microsoft_credentials.sql`
   - `microsoft_calendar_credentials` mirroring `google_calendar_credentials`: `user_id` PK → `auth.users` cascade, `refresh_token_enc bytea not null`, `scope text`, `tenant text`, `account_ref text`, `connected_at`, `updated_at`; RLS enabled, **no policies, no grants to `anon`/`authenticated`/`service_role`**; RPCs `upsert_microsoft_credentials`, `get_microsoft_credentials`, `delete_microsoft_credentials` — `security definer`, `search_path=''`, EXECUTE revoked from `public`/`anon`/`authenticated` then granted to `service_role` only (the 29.1 default-grant trap), rollback note at the end.
4. `20XXXXXXXXXX_oauth_states.sql`
   - `oauth_states` service-only table: `state_hash text PK`, `user_id → auth.users` cascade, `provider text` CHECK `google | microsoft`, `return_scheme text` CHECK `unipilot`, `expires_at timestamptz not null`, `consumed_at timestamptz`, `created_at`; RLS enabled, no policies, zero API-role grants; index on `expires_at`; comment recording the single-use contract.

Gate for every migration: `npm run db:reset` clean, `npm run db:lint` clean, `npm run db:types` regenerated and committed, `npm run db:check-types` matches, `schema-contract.ts` extended (so a future regeneration that loses a new column fails `tsc`). No generator key in the client; `UNIPILOT_INTEGRATIONS_KEY` continues to gate the pgcrypto RPCs.

### D2. Worker job kinds

Registered in `backend/worker/handlers.mjs`, implemented in one new module family:

| Kind | Payload (ids only) | Handler behaviour |
| --- | --- | --- |
| `google.sync` | `{ connectionId }` | refresh access token from `google_calendar_credentials`; `events.list` (time window −30 d…+365 d, `singleEvents=true`); upsert `events` with `source='google'`, `source_ref=<event id>`, `source_meta={calendarId}`; store `syncToken`/`last_synced_at`; update connection status/`last_error` |
| `microsoft.sync` | `{ connectionId }` | refresh from `microsoft_calendar_credentials`; Graph `GET /me/calendarView` (same window, `Prefer: outlook.timezone="UTC"`); upsert `source='outlook'` (+ `source_meta.onlineMeeting` when the event carries it); store `deltaLink` |
| `gmail.scan` | `{ connectionId }` | **deferred past the first calendar milestone** (decision (f)) — specified here so the Gmail milestone is purely additive. refresh token; `users.messages.list` with the recorded `q` filter and `historyId` cursor; heuristic detection (date/time phrases + academic keywords, mirroring `wa_service`'s extractor discipline); insert `integration_candidates` rows (`provider='gmail'`, `gm-<hash>` fingerprint, `run_id` of the `sync` run) |

Rules carried over verbatim: payloads ids-only; `touch_job` heartbeat for long scans; 401/403 → non-retryable + connection `error` with sanitized copy; 429/5xx/timeout → retryable with the runner's backoff; provider response bodies never logged or surfaced; no token, body or message text in logs; jobs carried by the same `jobs` table/lease protocol (no second runner).

### D3. App-facing HTTP endpoints (`frontend/app/api/**`) 

All Bearer-authenticated (`Authorization: Bearer <access token>`), all returning JSON with sanitized error strings, all calling the same service functions the web actions call.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/integrations/oauth/start` | POST | Body `{ provider: "google" \| "microsoft" }`. Creates a single-use state row (random 32-byte token, SHA-256 stored, TTL 10 min, `return_scheme='unipilot'`), returns the provider consent URL. No cookie required (native has no session cookie). |
| `/api/integrations/google/callback` | GET | **Existing, extended**: if `state` matches an unconsumed `oauth_states` row → token exchange, `upsert_google_credentials`, connection `connected`, best-effort `backfillGooglePushes`, then `302 → unipilot://oauth/google?status=connected`. The cookie-bound web path is unchanged. |
| `/api/integrations/microsoft/callback` | GET | Same shape for Microsoft: code exchange with client id/secret, `upsert_microsoft_credentials`, connection `connected`, `302 → unipilot://oauth/microsoft?status=…`. |
| `/api/integrations/{google,microsoft}/disconnect` | POST | Clears credentials through the service RPC + marks the connection `disconnected` (extracted from the existing action bodies). |
| `/api/integrations/sync` | POST | Body `{ provider: "google" \| "microsoft" }` (Gmail rides the `google` connection in its later milestone). Server-side throttle (per user+provider, ≥ 5 min between runs, recorded as a constant — the foreground-refresh / "Sync now" guard); reserves an `integration_runs` row (`mode='sync'`, `provider`) and enqueues the ids-only job; answers `{ accepted: true \| false, reason: "throttled" \| "active" \| "not_connected" }`. |
| `/api/integrations/whatsapp/runs` | POST | Export reserve — same guard/contract as `createExportRunAction`. |
| `/api/integrations/whatsapp/runs/{id}/finalize` | POST | Verify object + enqueue `whatsapp.sync`. |
| `/api/integrations/whatsapp/runs/{id}/abort` | POST | Discard object + row. |
| `/api/integrations/whatsapp/candidates/{id}/confirm` \| `/reject` | POST | Existing service pair; confirm enqueues `whatsapp.push` only when Google is connected (unchanged rule). |
| `/api/integrations/google/push` | POST | M6: ids-only push of one owned app event. |

Not built now: a general mobile "assistant" endpoint (the existing SSE route stays cookie-only until a later task converts it to Bearer; listed in §B.2 as a future web change).

### D4. Subscribe/watch vs scheduled polling — decision

**Decision (approved 2026-09-30, decision (e)): foreground refresh + an explicit "Sync now" in M4/M5 — no aggressive background polling. Webhooks deferred.**

- M4/M5 ship: a refresh on app foreground (server-side throttle ≥ 5 min per user+provider, the `sync` endpoint's guard) and a visible "Sync now" affordance with the same guard. Any background cadence (a 30–60-minute platform-scheduler wake) lands **after** M5 and must ship throttling-aware (provider quota) and battery-aware (OS scheduler, no wake-locks, back-off after failures).
- Graph change notifications and Gmail `users.watch` both require a public HTTPS endpoint, subscription lifecycle management (create/renew ≤ 4230 min, validate notification URLs, handle expiry), plus, for Gmail, a GCP project + Pub/Sub topic + IAM. On this repo's local-only environment (WSL2, no public ingress) none of that is buildable *or verifiable* today, and shipping unverifiable plumbing would violate §0.9.
- Polling tradeoff, stated plainly: freshness is bounded by the foreground trigger / explicit sync, and each poll costs provider quota. The worker already provides retry/backoff/leases, and per-user throttling bounds API usage (the same discipline as D13's 1-active/20-per-day guard).
- Deferred, with the seam already designed: connection `sync_cursor` and the ids-only job kinds make a future `POST /api/webhooks/{microsoft,gmail}` a pure additive step (verify notification → enqueue the same sync/scan job), and the mobile app needs no change because it always reads the same `events` rows. Recorded in §L.

### D5. Rate limits and guards

- Sync runs reuse the `integration_runs` history + a per-user+provider minimum interval; a second request while one is `queued`/`running` answers `active` (mirrors `WHATSAPP_ACTIVE_RUN_LIMIT`).
- Provider quotas: Graph 429 + `Retry-After` honoured by the retryable path; Google quota errors map to the same retryable class; a hard provider error marks the connection `error` with sanitized copy and stops further enqueues until a manual reconnect (no silent loop).
- Gmail scan caps (when the Gmail milestone lands) mirror the WhatsApp posture: message cap per run and candidate cap per run, both constants in the mobile/server contract copy.

---

## E. Design language — token mapping web → native

Source of truth stays `frontend/app/globals.css` + `DESIGN.md`. Mobile mirrors it in `mobile-app/src/theme/tokens.ts`; no new colour, no new font, no new radius, no new duration. Dark is the default, same as the web; the app also supports light.

### E.1 Colour

| Web token | Light | Dark | Native name | Notes |
| --- | --- | --- | --- | --- |
| `--background` | `#f4f4f5` | `#131316` | `background` | the base floor under the backdrop |
| `--foreground` | `#1a1c1c` | `#f0f1f1` | `foreground` | |
| `--primary` / `--primary-foreground` | `#000000` / `#ffffff` | `#ffffff` / `#131315` | `primary` / `onPrimary` | black/white inversion, no brand colour |
| `--card` | `#ffffff` | `#1d1d21` | `card` | solid fill |
| `--muted` | `#f3f3f4` | `#1b1b1f` | `muted` | |
| `--muted-foreground` | `#4c4546` | `#9e9899` | `mutedForeground` | metadata/secondary text |
| `--border` | `#e5e5e5` | `#2e2e33` | `border` | 1px hairlines only |
| `--surface-glass` | `muted @ 60%` | `muted @ 70%` | `glass` | + blur (§E.4) |
| `--surface-inverted` / `-foreground` / `--border-inverted` / `-nested` | `#1a1c1c` / `#f0f1f1` / `#3a3a3a` / `#2e2e2f` | `#f0f1f1` / `#131315` / `#d0d1d1` / `#dcdedf` | `inverted*` | rationed: ≤1 dominant + ≤1 group per view |
| `--scrim` | `rgba(0,0,0,.4)` | `rgba(0,0,0,.55)` | `scrim` | modal backdrops only |
| `--destructive` | `#ba1a1a` | `#e5484d` | `destructive` | the one functional colour, as shipped on web |
| `--surface-cta` | `#1d1d21` | `#1d1d21` | `cta` | theme-stable charcoal |
| motif (`--motif-color/-scale/-spacing`) | `#d4d4d4`, 1px, 32px | `#3c3c41`, 1px, 32px | `motif*` | see backdrop note |

Backdrop on native: a fixed three-layer stack is reproduced with (1) a base `View`, (2) one very-low-contrast neutral luminance field (linear gradient, ±1.5% lightness — the same narrow permission as `DESIGN.md` §3.13), (3) the dot motif painted as a repeating SVG/Canvas pattern at `--motif-spacing`. No `backdrop-filter`; glass surfaces use `expo-blur` where supported and fall back to the translucent fill alone — the web's own honest-degradation rule.

### E.2 Typography

| Role (unchanged rules) | Family | Web | Native |
| --- | --- | --- | --- |
| Major headings + all action labels (buttons, chips, segmented controls) | **Bricolage Grotesque** | `--font-heading` | `heading` |
| Body UI, fields, navigation links | **Geist** | `--font-sans` | `body` |
| Metadata, eyebrows, timestamps, monospace labels | **Geist Mono** | `--font-mono` | `mono` |

Scale (same numbers; RN converts `em` tracking to points: `letterSpacingPx = em × fontSize`):

| Token | Size / weight / lineHeight / tracking web | Native tracking |
| --- | --- | --- |
| display | 72 / 700 / 1.1 / −0.04em | −2.88 |
| headline-lg | 48 / 700 / 1.2 / −0.03em | −1.44 |
| headline-lg-mobile | 32 / 700 / 1.2 / −0.02em | −0.64 |
| headline-md | 24 / 600 / 1.3 / −0.01em | −0.24 |
| body-lg | 18 / 400 / 1.6 / 0 | 0 |
| body-md | 16 / 400 / 1.6 / 0 | 0 |
| label-caps | 12 / 600 / 1.0 / 0.1em | 1.2 |
| label-sm | 13 / 500 / 1.4 / 0 | 0 |

Sourcing and licences: Geist + Geist Mono (SIL OFL 1.1, `vercel/geist-font`) and Bricolage Grotesque (SIL OFL 1.1). The web ships Bricolage as a variable TTF at `frontend/public/fonts/BricolageGrotesque-VariableFont_opsz,wdth,wght.ttf`; mobile vendors its own copies under `mobile-app/assets/fonts/` (Geist/Mono TTFs taken from the pinned upstream release) with the OFL licence files and a `PROVENANCE.md` recording source URL + SHA-256 per file. Loading via `expo-font`; if variable-face weight selection misbehaves on the pinned RN/Android versions, the M1 spike falls back to static instances of exactly the weights the scale uses (400/500/600/700/800) — no new family, no synthesised weights.

### E.3 Spacing, radius, elevation

| Web | Value | Native |
| --- | --- | --- |
| spacing unit | 4px | `space[1] = 4` … step scale |
| mobile margin | 20px | `layout.margin = 20` |
| Frame / Card at ≤375px | 32→24px / 20→16px | `radius.frame = 24`, `radius.card = 16` (responsive token step, not per-component) |
| Nested / Control / Pill | 12 / 8 / ∞ | same |
| Raised | `0 4px 16px rgba(0,0,0,.06)` | `shadows.raised` |
| Floating | `0 8px 32px rgba(0,0,0,.08)` | `shadows.floating` |
| Overlay | `0 12px 40px rgba(0,0,0,.12)` | `shadows.overlay` |
| Flush | none | `shadows.flush` |

Native shadows are expressed as RN `boxShadow` strings (New Architecture) with the exact recipes; the M1 spike verifies Android rendering and records the fallback (platform `shadow*`/`elevation` approximation) if not. One elevation per surface; no tinted or heavy shadows; nested surfaces separate by fill + radius step, never shadow.

### E.4 Motion vocabulary (native)

| Web primitive | Native mechanism | Values |
| --- | --- | --- |
| `presets.ts` tokens | `src/motion/presets.ts` mirror | `EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)`; `EASE_DRAWER = bezier(0.32, 0.72, 0, 1)`; durations 140/160/180/220/150/400/380/260/380/90/140/720 ms; staggers 40/60/80 ms — byte-identical numbers |
| `[data-enter]` entrance ladder | Reanimated entering + `Animated.View` with the same slot convention (header slot 0, sections 1..n, `motionIndex`) | rise/scale/left/right variants, 60 ms slot stagger |
| `MotionPopover` | Moti/Reanimated popover variants | fade + 8px directional translate + `scale(0.97)`; open 220 / close 150; origin-aware |
| `MotionMenu` (drawer) | same, parent drop + child stagger 40 ms | |
| `MotionListItem` | Reanimated layout + fade/slide | 6px in; 150 ms out |
| `MotionNotice` | enter-only, no delay, `accessibilityLiveRegion`/`role` equivalent | 180 ms |
| `MotionSelectionRing` | animated fill/indicator on the selected surface (no `layoutId` clone semantics on native) | `softSpring`-equivalent spring |
| `MotionBar` | `scaleX` from origin-left clip | 720 ms |
| `press-feedback` / `icon-turn` | `Pressable` scale 0.97 @140 ms; chevron rotation @160 ms | |
| `RouteTransition` | Expo Router screen enter | opacity + 6px rise, 220 ms, enter-only |

Rules (unchanged from `MOTION.md`): motion never controls content existence — content is always structurally rendered and only opacity/transform animate; reduced motion via `AccessibilityInfo.isReduceMotionEnabled()` + Reanimated's reduce-motion config zeroes every duration and removes translate/scale while keeping state changes instant; no `width/height/margin/padding/top/left` animation; no page-specific animation systems — every new animation extends `presets.ts` or this table first. Verification: M1 includes a motion spike that records the exact primitive mapping against the pinned Reanimated/Moti versions before any screen motion is written.

---

## F. Auth

- **Supabase Auth in the app**, `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken: true`, `persistSession: true`.
- **Session storage: `expo-secure-store` only** (Android Keystore / iOS Keychain). Never AsyncStorage for tokens. Because session JSON can exceed a single secure-store entry limit on some devices, the M2 implementation uses the standard chunked storage adapter (split + reconstruct), and M2's test proves sign-out and re-login across an app restart with the store inspected for no plaintext leftovers.
- **Deep links**: app scheme `unipilot`.
  - Supabase Auth PKCE callback: `unipilot://auth-callback` (Google sign-in and, later, email confirmation). Requires the redirect to be allow-listed: locally in `backend/supabase/config.toml` `additional_redirect_urls` (machine-local, git-ignored) + restart; on the hosted project it would be a dashboard change — **not performed** by this project (documented for later).
  - Provider OAuth (calendar): `unipilot://oauth/google` / `unipilot://oauth/microsoft`, reached only from **our own** callback endpoint (§D3) after the server-side token exchange. The provider consoles register the *server* redirect URI, never the deep link.
- **PKCE flow id (amendment, M2b `bb90168`).** React Native has no `window.location`, so `exchangeCodeForSession` needs the flow id passed explicitly. The client enables `experimental.appendPkceFlowIdToRedirects`, and both callback paths (in-app browser result, deep-link route) parse `sb_flow_id` and pass `{ flowId }`. This is an auth-js implementation detail, not a stable API: any `@supabase/supabase-js` bump must re-run the OAuth device legs (A, B, C) before it is trusted.
- **Cleartext HTTP (amendment, M2b 2026-11-16).** Android API 28+ blocks cleartext unless the app opts in. Any build that points at local `http://127.0.0.1:54937` must set `EXPO_PUBLIC_ALLOW_CLEARTEXT=1`. Missing it makes the first app-side request (the `/token` POST) fail before a socket opens, with no server log line and generic error copy.
- **Email/password**: direct `signInWithPassword`; sign-up in-app deferred (the app can point a completion email at the web `/auth/confirm`); password reset deferred to the backlog.
- **Session lifecycle**: start/stop auto-refresh with `AppState`; cold-start reads the stored session and validates with `getUser()`; a 401 anywhere clears the session and returns to sign-in.
- **Google identity vs Google Calendar are two different grants.** Supabase Auth Google (openid/email/profile) and the Calendar OAuth (calendar.events) remain separate connections with separate scopes; the app's UI never conflates "signed in with Google" with "Google Calendar connected".
- **Never on the device**: service role key, provider client secrets, refresh/access tokens for calendar providers, QR payloads. Logs and analytics carry ids only; screenshots must not show tokens (§H).
- RLS stays authoritative: every direct read/write is owner-scoped by policy; the app's client-side gates (onboarding, sign-in) are UX, not enforcement.

---

## G. Build & release

- **Expo config (CNG)**: `app.json`/`app.config.ts` is the source of truth. Android package id **`com.unipilot.app`**; `scheme: unipilot` — **provisional (decision (a), 2026-09-30)**: the identifiers stay UniPilot unless the founder confirms the alternative `app.woid.mobile` / `woid://`. The package id must be finalised **before the first EAS build** (it is the app's distribution identity) and every `unipilot://` below reads as "the app scheme". `versionCode` starts at 1; `userInterfaceStyle: automatic` with dark as the default to mirror the web; intent filters for the scheme; cleartext HTTP enabled **only in dev/preview profiles** (needed for local Supabase/Next over `http://`; production stays HTTPS-only).
- **Native project generation**: `expo prebuild` (Continuous Native Generation). `mobile-app/android/` is generated and git-ignored; nothing hand-edited there.
- **Build paths (decision (g), approved 2026-09-30): EAS Build is the primary APK path** while this host lacks an Android SDK; **local Gradle stays the documented fallback.**
  1. **EAS Build (primary)** — an Expo account/project (external dependency, §N) and `eas build -p android --profile preview` with `buildType: apk`, producing an installable, standalone **preview APK**. This is the M1 artifact.
  2. **Local Gradle (fallback)** — `npx expo run:android --variant release`, producing a standalone APK (requires the Android SDK + a Gradle-supported JDK). Signing: a dedicated **upload keystore** generated once (`keytool`), stored git-ignored at `mobile-app/android/keystore/` with its passwords in `mobile-app/.env` (never committed), wired through `gradle.properties`. `assembleDebug` exists for fast iteration but is not the deliverable.
- **Proven local recipe (amendment, M2a/M2b).** The main checkout sits under OneDrive, and building there hit an endless CMake/ninja regeneration loop. The working path is a git worktree at `C:\dev\up-mobile` with JDK 17 (`C:\Android\jdk-17`), only CMake 3.30.5 visible, NDK 27.1.12297006, Gradle 9.3.1, a fresh `npm install` with `.cxx`/build dirs purged, and `--no-watch-fs`. Cause of the original failure was never isolated, so keep the whole recipe. Local builds must also export `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` (§F) and re-apply the README's Gradle signing patch after every `expo prebuild`. The permanent app identity is the EAS keystore (certificate SHA-256 begins `bc51cd50…`); the earlier debug-signed local APK cannot be installed over it without uninstalling, and the installed app is never uninstalled.
- **Expected artifact**: the EAS `preview` APK (the build URL + the downloaded file — proposed local path `mobile-app/build/mobile-preview.apk`, git-ignored — recorded in the phase record). Local-Gradle fallback artifact: `mobile-app/android/app/build/outputs/apk/release/app-release.apk`.
- **Debug vs release, plainly**:
  - a **debug APK** is debug-signed, installable via `adb install`, but not distributable, not Play-uploadable, and (plain `assembleDebug`) expects a Metro dev server;
  - the **EAS `preview` APK** is debug-signed by EAS and standalone-installable via `adb install` — the M1 artifact and the device-QA vehicle; it is explicitly **not** a Play-uploadable release;
  - a **locally built release APK** signed with the project keystore remains the documented fallback deliverable; the **Play Store** needs an AAB and an upload key registered with Google — out of scope. Sideloading is the distribution model for this project.
- **M1 preflight (first work item, decision (h))**: (1) create/log in to the Expo account and link the project; (2) run the first EAS `preview` build; (3) verify a **physical Android phone** with `adb devices` and install the APK there — Expo Go / a dev build may serve while developing, but a phone is required for the milestone's device evidence. **If no phone is available, M1 stops at preflight and reports honestly**; no screenshots, install or flow verification are claimed. The local-Gradle path (Android SDK cmdline tools + platform + build-tools, an AVD, and a Gradle-supported JDK — Java 26 on this host is suspect; Temurin 17/21 if needed) is pursued only if EAS fails or the founder asks.

---

## H. QA

- **Unit + component tests (replaces Playwright's role at the logic level)**: Jest + `@testing-library/react-native` for pure logic (date/validation reuse, token parity, fetch clients with mocked HTTP), component states (empty/loading/error/blocked), and the auth storage adapter. Provider API clients are tested against mocked HTTP payloads only — clearly labelled mocks, never presented as live-provider evidence (the same discipline as the pytest-mocked Google push).
- **Device flows (replaces Playwright's role at the interaction level)**: **Maestro** (YAML flows, runs against a **physical Android phone over adb** (decision (h)); an emulator is acceptable only if one is provisioned; screenshots per step; tolerant of RN without Detox's build complexity). Flows for M2–M7: sign-in → calendar renders; provider card states; sign-out; the milestone's critical path. If Maestro cannot be installed on this host, the fallback is scripted `adb` interaction + `adb exec-out screencap`, stated as such.
- **Device-leg protocol (amendment, M2b).** One attempt per leg. On failure, capture only logcat parameter names, the GoTrue `/callback` and `/token` lines, and app state, record them in §P, and stop for the founder. No blind retries. A run that never reaches the app (for example a browser crash) is recorded as "no verdict", not as a pass or a fail of the code under test. Credentials are typed by the founder on the device and never pass through a shell, tool call, log or screenshot.
- **Environments in use**: the physical Xiaomi phone (M1, M2a) and the `Pixel7_API36` emulator (M2b from 2026-11-16). After every emulator boot, re-add `adb -s emulator-5554 reverse tcp:54937 …`; the mapping does not survive a reboot.
- **Evidence**: screenshots captured on the physical phone over adb (decision (h); an emulator only if provisioned) under **`mobile-app/screenshots/`** (git-ignored, mirroring the web's `frontend/screenshots/` convention), named `<phase>-<flow>-<state>.png`. No screenshot may contain a token, password, QR payload, or raw chat export; the QA password rule from `QA_SESSION.md` applies unchanged.
- **Honest statement, restated where it matters**: `npm run test` (Playwright) tests the web app only; **it does not test this app and its green result is not evidence about the mobile app**. Mobile's own gate is `mobile:typecheck`, `mobile:lint`, `mobile:test`, a successful APK build, and the phase's device flow. The web suite still runs on every phase gate for the touched server code (the new endpoints and migrations are inside its blast radius).
- **Phase gate (all must be green before the next phase starts)**: mobile typecheck + lint + unit/component tests; APK builds; the phase's device flow exercised and screenshotted; the web suite still green; `db:lint`/`db:check-types` green when migrations changed; `plan.md` §P record written.

---

## I. Monorepo integration

- **Workspaces**: root `package.json` gains `"mobile-app"` in `workspaces`. One lockfile stays the rule; `npm install` at the root installs all three. Expected lockfile change: **additions only** — the phase gate checks the diff and fails the phase if any existing package version moves.
- **Metro + hoisting** (`mobile-app/metro.config.js`): the standard monorepo config —
  `watchFolders: [monorepoRoot]`,
  `resolver.nodeModulesPaths: [projectRoot/node_modules, monorepoRoot/node_modules]`,
  `resolver.disableHierarchicalLookup: true`,
  asset extensions cover fonts.
  `expo-doctor` runs at every phase gate. Known risk: RN's React version and the frontend's pinned `19.2.8` will nest (`mobile-app/node_modules/react`), not collide; `npm ls react react-native` output is recorded in the M1 phase record and re-checked when Expo is upgraded. If hoisting proves unstable, the documented fallback is keeping `mobile-app` out of `workspaces` with its own lockfile — a decision recorded in §P, not taken silently.
- **Scripts (root)**: `mobile:start`, `mobile:android`, `mobile:apk`, `mobile:lint`, `mobile:typecheck`, `mobile:test`. The root `test` script stays exactly `npm run test -w frontend` — the web suite's meaning never changes.
- **`.gitignore` additions**: `mobile-app/node_modules/`, `mobile-app/.expo/`, `mobile-app/android/` (generated), `mobile-app/.env*` (templates excepted, same two-file discipline as the rest of the repo), `mobile-app/screenshots/`, `mobile-app/test-results/`, keystore files.
- **Docs**: `README.md` gains the `mobile-app/` layout row + the mobile scripts; root `AGENTS.md` gains the mobile workspace paragraph (motion rule, gate, screenshot convention, and the "Playwright does not test the app" statement). `mobile-app/README.md` (new) documents setup, env, build and QA. The design/token mirror gets `mobile-app/src/theme/README.md` listing the web as authoritative.
- **What must not change**: `frontend`'s scripts, `playwright.config.ts`, the two env files' semantics, and the root `db:*`/`worker` scripts.
- **Env files**: `mobile-app/.env.example` tracked (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`, optional `EXPO_PUBLIC_USE_ADB_REVERSE`); real values in `mobile-app/.env` (git-ignored). Server-side new vars documented in `frontend/.env.example`: `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT` (default `common`). The local-network facts are documented in `mobile-app/README.md`: emulator → `10.0.2.2`, device → `adb reverse tcp:3000 tcp:3000` (+ the same for the Supabase port), WSL2 stack caveat included.

---

## J. Honest limits (this project, this environment)

1. **Gmail detection is heuristic — and deferred** (decision (f)): it does not block the first calendar milestone. When it lands, "event-like email" is a keyword/date rule over subject+snippet (modelled on but separate from the WhatsApp extractor); false positives and misses are expected, which is why Gmail always funnels through review candidates (or the user's explicit automatic mode) — never straight to the calendar.
2. **External approvals, unavoidable**: Microsoft Azure app registration (+ tenant consent for some organisations); Google OAuth client for Calendar (already missing — 46.17 stays `[!]`); Gmail's restricted scope requires Google verification + a CASA security assessment for anything beyond Testing/test users. Until each exists, the corresponding feature renders its truthful blocked state ("Not configured on this server" / "Verification pending") and no E2E run is claimed.
3. **Google Calendar `[!]` status does not change** because of this project: the OAuth client pair is still unset in `frontend/.env`; the app can display and manage the connection state, but the live round trip remains blocked at the same exact dependency recorded in TASK.md 46.17.
4. **Polling, not push** (§D4): bounded freshness and quota cost; webhooks deferred.
5. **Import is upsert-only** for M3–M4: provider-side deletions don't propagate; edits to provider-sourced rows aren't written back (read-only import direction). The two-way decision (TASK 46.10) stays open and is the M6 design input for the app→Google direction.
6. **No cross-provider dedupe** (§C.2).
7. **Device/build reality on this host**: no Android SDK, no emulator, no connected device, and Java 26 may be unsupported by the pinned Gradle. Resolved as far as the build goes by making **EAS Build the primary path** (decision (g)); device verification still requires a **physical phone over adb** (decision (h)). If no phone can be provided, M1 stops at preflight and reports honestly, and M7's device claims are `[!]` with the exact missing dependency, per §0.13 — never fabricated.
8. **Deferred by design**: iOS, Play Store release, push notifications, offline write queue, native onboarding flow, assistant/tools/documents surfaces, live WhatsApp mode on mobile, watch/webhook subscriptions, cross-provider merge, native password reset.
9. **The web suite's green is not mobile evidence** (§H), and the mobile suite's green is not web evidence; each phase gate runs both.
10. **No hosted Supabase writes, ever**, and no QR payload, token, or raw export in any artifact (§0.14, `whatsapp/README.md`).

---

## K. Phases (each ends with a review gate; one writer; a green gate before the next starts)

| Phase | Deliverable | Exit evidence |
| --- | --- | --- |
| **M0 — this plan** ✅ approved 2026-09-30 | `mobile-app/plan.md` | founder approval; no code |
| **M1 — app skeleton + tokens + APK** ✅ complete 2026-09-30 | EAS account + project, Expo app in the workspace, Metro/monorepo config verified, token/type/font mirror, motion spike, tab shell (`Calendar` default · `Tasks` · `More`) with honest placeholder states, M1 preflight, first **EAS preview APK installed on the phone** | `expo-doctor` clean; mobile typecheck/lint/tests; APK build URL + `adb install` proof on the phone; lockfile diff has no version churn; `npm ls react` recorded; web typecheck/build still green. **No phone ⇒ stop at preflight and report honestly.** |
| **M2 — auth + profile + onboarding (native)** (M2a ✅ email/password, session, profile, sign-out · **M2b 🔶 Google PKCE + onboarding, Leg A open**) | PKCE sign-in (email/password + Google), secure session storage with chunking, **native onboarding reusing `complete_onboarding` and the same validation rules** (web fallback deep link only if the RPC fails), profile read/update (name, timezone), sign-out | device flow: sign-in → restart → still signed in → sign-out; a fresh identity completes onboarding natively and the web sees the same rows; no plaintext token in store; screenshots; unit tests for the storage adapter; web suite green |
| **M3 — unified calendar (read-only)** | month/week calendar bound to `events` with source markers, real empty/error states, provider status cards with blocked states, **Gmail's honest "isn't connected yet" state** | device flow with real local rows (manual + WhatsApp); markers verified; blocked provider states verified honestly; `npm run test` green |
| **M4 — provider sync (server-side)** | 4 migrations applied locally, `google.sync` + `microsoft.sync` worker kinds registered, sync endpoints, **foreground refresh + explicit "Sync now"** with cursors, types regenerated (`gmail.scan` stays specified but deferred) | `db:reset`/`db:lint`/`db:check-types` green; worker tests for retry/backoff/dead-letter + 401/429 mapping with mocked HTTP; app shows real imported rows where credentials exist, honest blocks where not |
| **M5 — create/edit + confirmation** | native event create/edit/delete with the web's validation vocabulary, source markers on provider rows, "possible duplicate" badge if cheap, review/automatic mode handling where candidates exist (WhatsApp) | device flow: create → edit → delete; WhatsApp candidate confirm/reject regression stays green; no fabricated counts; screenshots |
| **M6 — Google Calendar push from the app** | push endpoint + `google.push` job, one-way semantics and copy identical to the web's `GOOGLE_ONE_WAY_NOTE`, honest state when unconnected/unconfigured | mocked-HTTP worker tests; device flow shows the truthful state; live E2E only if the OAuth client exists (else `[!]` with the exact dependency) |
| **M7 — build + device verification** | final EAS APK, full pass across the calendar with each provider connected **or** honestly blocked, screenshots, `plan.md` §P record | every claim in the record has a screenshot or a test output behind it; anything missing is `[!]` with the exact missing dependency |
| **Gmail milestone (post-M7, unscheduled)** | `gmail.scan` worker kind + Gmail scope request/consent state + the candidates review queue, behind Google verification/CASA; until then the app keeps the honest "Gmail isn't connected yet" state | only runs when the external dependency exists; mocked-HTTP tests until then; no fabricated connection |

Ordering note: M3 (UI) precedes M4 (sync) deliberately — the read surface and its honest states are verified against real local rows first, and M4 then fills the same surface with provider rows without a UI rewrite.

---

## L. Future features (to be specified by the founder)

Placeholder section. The architectural seams already in place for later tools and features:

- **Provider adapters.** One server-side module per provider exposing `start/refresh/scan/cursor` against `integration_connections` + credentials tables; a new provider is a new module + a CHECK value + a card, never a new pattern.
- **Source registry.** `source` vocabulary + `source_meta` jsonb + marker mapping in one mobile module (`src/features/calendar/sources.ts`), so a new source is one entry.
- **Jobs.** Any new long-running tool is a `handlers.mjs` entry with an ids-only payload and the existing retry/lease protocol.
- **Endpoints.** The Bearer API prefix (`/api/integrations/**`) and `apiAuth.ts` are the template for any future mobile-facing server capability (assistant Bearer upgrade, documents, tools, notifications).
- **Notifications seam.** `notifications` table + jobs exist; a push-notification transport (Expo Notifications or FCM) is additive and requires an external credential — record when specified.
- **Offline queue seam.** Direct Supabase writes go through one mobile data layer (`src/data/**`), so a later outbox/retry layer wraps that module without touching screens.
- Candidate backlog items to be specified: the **Gmail milestone** (post-M7; `gmail.scan` + the candidates review queue, blocked on Google verification/CASA), **background sync cadence** (30–60 min platform-scheduler wake, throttling- and battery-aware), iOS build, password reset, document upload, assistant on mobile, live WhatsApp from mobile, webhook subscriptions, cross-provider duplicate heuristics, Calendar two-way sync, widget/deep-link entries, Play Store release.

---

## M. Environment variables

| File | Variable | Kind |
| --- | --- | --- |
| `mobile-app/.env.example` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | public by design; RLS is the guard |
| | `EXPO_PUBLIC_API_BASE_URL` (Next server origin as reachable from the device) | public |
| `mobile-app/.env` (git-ignored, build-time) | `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` for any build that talks to local `http://` Supabase | public; required for local Gradle builds, set by the EAS `preview` profile |
| `frontend/.env.example` (additions documented, values unset) | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT` | server-only |
| `backend/.env.example` | the same Microsoft pair (the worker refreshes Microsoft tokens) + no new secrets beyond what exists | server-only |
| Local Supabase | `additional_redirect_urls` += `unipilot://**` | machine-local config, git-ignored |
| Existing | `GOOGLE_OAUTH_CLIENT_ID/SECRET` (still unset → Google blocked), `UNIPILOT_INTEGRATIONS_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | unchanged |

No secret is ever placed in an `EXPO_PUBLIC_*` variable — the same rule as `NEXT_PUBLIC_*`.

---

## N. External dependencies & approvals (blockers with exact owners)

| Dependency | Needed for | Status today |
| --- | --- | --- |
| **Physical Android phone (over adb)** | installing the EAS APK + device QA (decision (h)) | ✅ Xiaomi M2101K6P used for M1/M2a; currently unplugged, emulator is the active M2b environment |
| **Expo account / EAS project** | **primary APK build path (decision (g))** | ✅ linked in M1 (project slug `areeb`; rename or re-identify is an open item) |
| Android SDK + AVD + Gradle-supported JDK | local-Gradle path | ✅ installed (JDK 17, SDK 36, NDK 27.1, CMake 3.30.5, AVD `Pixel7_API36`); local build proven from `C:\dev\up-mobile` |
| Azure app registration + tenant consent | Microsoft calendar/Teams sync | ❌ must be created by the founder; app shows the honest blocked state until then |
| Google Cloud OAuth client (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) | Google Calendar read/push | ❌ already recorded as `[!]` in TASK.md 46.17 |
| Google verification + CASA (restricted Gmail scope) | Gmail scan beyond Test users | ❌ external approval; the feature is **deferred (decision (f))** and does not block M3–M5 |
| Supabase hosted project config (redirect allow-list) | production app | not touched by this project; documented for later |
| Supabase local `config.toml` redirect allow-list (`unipilot://**`) | M2 deep links locally | machine-local edit + stack restart |

---

## O. Open questions for the M0 review gate

Resolved at the M0 gate (2026-09-30):

1. **Package id / scheme — provisional.** UniPilot identifiers are kept (`com.unipilot.app`, `unipilot://`) unless the founder confirms the alternative `app.woid.mobile` / `woid://`. The package id must be finalised before the first EAS build (it is the app's distribution identity).
2. **Tab IA — approved:** `Calendar` (default) · `Tasks` · `More`; More holds Integrations, Settings and later tools.
3. **No guest mode — approved** as a product decision (sign-in from launch; guest browsing stays a web-only concern).
4. **Native onboarding — approved for M2**, reusing `complete_onboarding` and the same validation rules; a web deep link only as the honest RPC-failure fallback.
5. **Polling — resolved:** foreground refresh + explicit "Sync now" in M4/M5; a 30–60-minute platform-scheduler cadence after that, throttling- and battery-aware.
6. **Gmail — resolved:** out of the first calendar milestone; stays specified behind the verification/CASA dependency and renders the honest not-connected state.
7. **EAS — resolved:** account created and EAS Build is the primary APK path; local Gradle documented as fallback; the M1 artifact is a preview APK.
8. **Web edits (§B.2) — remains open** at the founder's convenience; nothing in M1 depends on it (the first server endpoints arrive in M4).

Operational question for M1: **is a physical Android phone available for adb install/QA?** No phone ⇒ M1 stops at preflight with an honest report (decision (h)).

---

## P. Phase record (append-only; one entry per phase gate)

> **M0 — 2026-09-30.** Plan written against `a330534`. Repo read: AGENTS/README/TASK/DESIGN/MOTION/AUTH_ARCHITECTURE/QA_SESSION/DATABASE/MIGRATIONS/presenton; code: data layer, integrations, worker, migrations, route handlers, design tokens. Machine preflight: Node 24.18 / npm 11.16 / Java 26 / `adb` present; **no Android SDK, emulator, AVD or device**; WSL2 stack API port moved 54321 → 54937 on this host (Windows `winnat` reservation, noted in `QA_SESSION.md`). No implementation performed. Awaiting approval.

> **M0 gate — approved 2026-09-30.** Founder decisions (a)–(h) applied to this document: identifiers kept as `com.unipilot.app` / `unipilot://` **provisional** (the `app.woid.mobile` / `woid://` alternative stays available until the first EAS build); tab IA `Calendar` · `Tasks` · `More` approved; no-guest posture approved as a product decision; onboarding native in M2 via `complete_onboarding`; polling = foreground refresh + "Sync now" with the background cadence deferred; Gmail deferred past the first calendar milestone (verification/CASA) with an honest not-connected state; EAS Build is the primary APK path (preview APK = M1 artifact; local Gradle fallback); device verification on a physical phone over adb — **no phone ⇒ M1 stops at preflight and reports honestly**. No implementation performed; M1 awaits the explicit "go".

> **M1 preflight — 2026-09-30 — STOPPED (preconditions unmet).**
> `npx eas-cli whoami` → **`Not logged in`** (no authenticated Expo account; the CLI was fetched into the npx cache only to run the check — no credentials touched). `adb devices` → **empty** (no physical Android phone detected; USB debugging/authorisation unverifiable without a device). `git status` → 47 pre-existing modified/deleted paths left untouched; the only new path is `mobile-app/` (this plan). Per the M1 gate: **no scaffolding, no APK, no device claims.** Resumes when (1) the founder logs in to their own Expo account (`npx eas-cli login`) and (2) a physical Android phone is connected with USB debugging enabled and this machine authorised (`C:\Android\platform-tools\adb.exe devices` lists it).

> **M1 — 2026-09-30 — COMPLETE (gate result below).**
> Commits: `6088f66` (skeleton/tokens/specimen), `606e797` (EAS link), final record commit. Screenshots are git-ignored by convention (see Evidence).
> **Build / artifact.** EAS build `26e49566-464b-4ac0-b7f3-d90cb87651c6` — Android, `preview` profile, SDK 57, versionName 0.1.0 / versionCode 1; ~56 min queue, ~19 min build. Artifact: `https://expo.dev/artifacts/eas/Ob4OsaHO25ururtv9nz_QPHgwwGQ8ghfvmHmPo7S9Wk.apk` (102.8 MB), downloaded to `mobile-app/build/m1-preview.apk` (git-ignored). `adb install -r` → Success; cold launch via `monkey` → pid confirmed live.
> **Device.** Xiaomi **M2101K6P** (`sweetin`, Redmi Note 10 Pro), **Android 16 / SDK 36**. Toggles, read from the device: dark set captured with `cmd uimode night` = **yes**; light set with **no** (restored to yes afterwards); reduced-motion set captured with `animator/transition/window` scales = **0/0/0**, restored to **1/1/1** (all six values re-read from the device after each change; `svc power stayon` restored to false).
> **Verified on the device.** (1) **Calendar is the default tab** after a cold launch; (2) **Calendar · Tasks · More navigate** with real taps (Tasks and More each render their own honest empty states — "Nothing to do yet / NOT BUILT YET", "Not connected yet / Arrives with M2" — no fake rows anywhere), and the **Specimen** opens from More; (3) **light and dark both render** for Calendar, Tasks, More and Specimen (fonts, dotted backdrop, cards, tab bar all correct in both); (4) **reduced motion**: with the scales at 0 the specimen reports `Reduced motion: on` with every section and slot rendered, and a cold start renders the full Calendar — **no content is hidden**; restoring the scales to 1 flipped the readout to `off` **live** and the device values were re-read as 1/1/1.
> **Evidence.** `mobile-app/screenshots/`: `m1-calendar-{dark,light,reduced-motion}.png`, `m1-tasks-{dark,light}.png`, `m1-more-{dark,light}.png`, `m1-specimen-{dark,light,reduced-motion,motion-restored}.png` (+ `m1-specimen-dark-scrolled.png`).
> **Not verified / honest limits.** No auth, no data reads, no provider connections: the preview build carries no Supabase env, so More reports "Not configured" and every integration surface says "Not connected yet". The app icon is still the Expo template placeholder (branding is a later item). `expo-doctor` passes **20/21** — the one finding is the expected duplicate React (RN 0.86 pins 19.2.3 while the web pins 19.2.8); Metro resolves correctly and the EAS build + device run are the proof it is harmless here. The **web Playwright suite was not run** during this gate (no web code path changed beyond the additive workspace entry): frontend `npm run build` was green after the workspace install, and the web app's direct dependencies are unchanged (see below).
> **Deviations from the plan (recorded, with reasons).** (1) The EAS project slug is **`areeb`** — the founder-provisioned project id; app name, package id and scheme remain UniPilot (revisit: rename the Expo project, or switch identifiers via the §O.1 decision). (2) `metro.config.js` keeps Metro's **hierarchical lookup enabled**: disabling it broke bundling because `react-native-reanimated` carries its own `semver@7` next to the web toolchain's hoisted `semver@6`. (3) The lockfile diff is **additions-only (765 entries added, 0 removed, 0 version changes)**; `mobile-app` pins `@supabase/supabase-js` exactly `2.112.3` so no web entry moves (749 lines of the lockfile text diff are re-serialisation, verified entry-level).
> **Toolchain (Task A, outside the repo).** JDK **17.0.20.1** at `C:\Android\jdk-17`; SDK at `C:\Android\Sdk` with `platform-tools 37.0.1`, `platforms/android-36 2.0.0`, `build-tools/36.0.0`, `cmake/3.30.5`, `ndk/27.1.12297006`, `cmdline-tools/latest 23.0.0` — read back via `sdkmanager --list_installed`; `ANDROID_HOME`/`ANDROID_SDK_ROOT` set at user scope. Local-build proof command (provisioned but **not yet executed end-to-end** — the local APK path remains unproven): `$env:JAVA_HOME='C:\Android\jdk-17'; $env:ANDROID_HOME='C:\Android\Sdk'; npx expo prebuild --platform android; cd android; .\gradlew.bat assembleRelease` → `android/app/build/outputs/apk/release/`. `eas build --local` is unsupported on Windows, so this is the Windows path.

> **M2a — 2026-09-30 → 2026-10-01 — COMPLETE (device gate below).**
> Commits: `db78d6d` (auth layer + tests), `97e501f` (the `preview-noenv` profile), the final record commit. Builds: EAS `93b0d18f-4234-9424` (`preview`, commit `db78d6d`, the public local Supabase pair baked via eas.json) and `81e367b9-4524` (`preview-noenv`, commit `97e501f`, no env); a duplicate submission `ea4bf286…` was cancelled.
> **Device (M2101K6P / `sweetin`, Android 16 / SDK 36) — all verified on-device, captures in `mobile-app/screenshots/`:** (1) **sign-in form** `m2a-signin-{dark,light,reduced-motion,filled}` — the configured build renders the real form (no guest mode: the app opens on auth); (2) **signed in** `m2a-signed-in-dark`, `m2a-calendar-light`, `m2a-more-light` — the root `Stack.Protected` guard swapped `(auth)`→`(tabs)`, Calendar the default tab; (3) **kill+relaunch persistence** `m2a-persist-dark` — a full `am force-stop` + relaunch restored the session from expo-secure-store (chunked adapter) and stayed signed in; (4) **profile read (owner RLS)** `m2a-more-profile-dark` — real row: Name "QA One", Timezone UTC, Onboarding Complete; (5) **sign-out** `m2a-more-signout-dark` + `m2a-signed-out-dark`; (6) **wrong password** `m2a-wrong-password-dark` — sanitized "That email and password don't match."; (7) **unreachable Supabase** `m2a-unreachable-dark` — reverse tunnel removed + fresh process, sanitized "Couldn't reach the local Supabase. Check the stack is running and adb reverse is connected.", tunnel restored after; (8) **unconfigured env** `m2a-unconfigured-{dark,light}` — the no-env APK renders "This build has no Supabase configuration. Add the public env pair and rebuild." with no form; the configured APK was then reinstalled and normal behaviour confirmed (`m2a-restored-configured-dark`). Reduced motion: cold launch under animation scales 0 rendered everything in final position (`m2a-signin-reduced-motion`); scales restored to 1/1/1 and re-read from the device. One invalid capture (a concurrent Instagram frame during the first "light" attempt) was discarded and replaced by a controlled re-capture.
> **Discarded attempt (recorded):** the first unreachable test was inconclusive — the app unexpectedly ended up signed in (most plausibly a pooled okhttp connection surviving `adb reverse --remove`, possibly compounded by concurrent manual re-entry). It was discarded and redone under clean control (sign-out → tunnel removal → force-stop + fresh process); the clean capture is the evidence above.
> **Unconfigured-state path choice (recorded):** a packaged rebuild was genuinely required — the local toolchain was unproven at decision time and no dev-client/Metro session exists, so clearing `.env` and reloading was unavailable; hence EAS `preview-noenv`.
> **Secrets:** the QA password was typed on the device by the founder only (never through a shell, tool call, log or screenshot); the wrong-password evidence used a throwaway string.
> **Not verified / limits:** the incomplete-onboarding state is code-pathed and honestly rendered but was **not exercised on-device** (QA1 is complete; QA2 unused this gate); M2b (PKCE + `unipilot://auth-callback` deep links) not started; the Google-identity OAuth path untouched.
> **Local build — fix pass PROVEN (was an open task during the gate; see the failure record).** Two `assembleRelease` attempts in the main checkout failed with `C/C++: ninja: error: manifest 'build.ninja' still dirty after 100 tries` (an endless `Re-running CMake… Configuring done / Generating done` loop) in `:expo-modules-core:buildCMakeRelWithDebInfo[armeabi-v7a]` and `:react-native-reanimated:buildCMakeRelWithDebInfo[arm64-v8a]`, with CMake object-path warnings at 189–219/250 chars. Version matrix: Gradle 9.3.1 (global extract at `C:\Android\gradle-9.3.1`; the wrapper's own CDN download failed), CMake — the SDK had 3.22.1 *and* 3.30.5 with the failing ninja coming from **3.22.1** while RN 0.86 declares 3.30.5 (3.22.1 now uninstalled at SDK level), NDK 27.1.12297006, JDK 17.0.20.1 (pinned via `JAVA_HOME`), Node 24.18.0. Hypotheses recorded: the repo path under the OneDrive sync scope vs path length vs the CMake 3.22.1/ninja combination — **not isolated** (the working build differs from the failed runs in path AND visible CMake version), so later phases build from the proven recipe rather than retrying in the main checkout.
> **Fix pass verdict — PROVEN.** Combination: git worktree at the short non-OneDrive path `C:\dev\up-mobile` (detached at `97e501f`; the worktree registration is the only main-checkout change), fresh `npm install` with every `.cxx`/build dir purged, cmake/3.22.1 removed so only 3.30.5 is visible, `--no-watch-fs`. First run: interrupted mid-build by an agent-server restart (~30 min in; its log was truncated — no verdict), then resumed with the identical combination. **`BUILD SUCCESSFUL in 14m 42s` at 2026-10-13 21:56:47 (exit 0; 118 executed + 494 up-to-date; the APK's write time, the log mtime and the shell record's `exit: 0 after 14:43` all agree; no java/gradle processes remained after exit)** → `C:\dev\up-mobile\mobile-app\android\app\build\outputs\apk\release\app-release.apk` (**103 MB**), signed with this machine's **Android debug keystore** (`CN=Android Debug, OU=Android, O=Unknown…`, SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`) — the RN template's release default, **not** the EAS upload key, so installing it over an EAS build requires uninstalling first. Install-on-device of this specific APK was **not re-verified** (the phone was unplugged at verdict time); the recipe is recorded in `mobile-app/README.md` and every later phase builds from it.
> **Fix-pass delta (recorded; cause NOT conclusively identified).** Four variables changed together between the failed runs and the successful one: (1) **path** — `…\OneDrive\Desktop\…` (main checkout) → `C:\dev\up-mobile` (short, non-OneDrive worktree); (2) **cache state** — the main checkout carried stale `.cxx`/build trees from both failures, while the worktree was a fresh `npm install` + prebuild with no `.cxx` at all; (3) **CMake pin** — 3.22.1 and 3.30.5 were both visible and the failing ninja was 3.22.1's, now 3.22.1 is uninstalled so only 3.30.5 is visible; (4) **VFS watch** — default daemon watching → `--no-watch-fs`. The build therefore **succeeded once, cause not confirmed**; the (path, CMake-version) pair is the leading candidate but was not isolated, so later builds must keep the full recipe rather than assume any single change is the fix.
> **Proven APK identity (2026-10-13):** `app-release.apk` (103 MB) contains the bundled JS (`assets/index.android.bundle`, ~5.3 MB) and **all four ABIs** (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`); it is signed with this machine's Android **debug** keystore — **not** the EAS release key. It was **not installed on any device**; installing it over an EAS-built app would fail with a signature mismatch and require uninstalling first, which was deliberately **not done** without the founder's decision.

> **M2b — 2026-10-14 — device matrix restarted from a clean state (results appended per leg).**
> **Restart reason: wrong account.** The first WARM attempt was retired after it selected an unapproved identity in the Google picker: `mdxareeb@gmail.com` (provider `google`) — the founder's personal account — which is a LOCAL-stack user (count 3: QA1, QA2, and it). Whether it was tapped accidentally or auto-selected by the browser session is unverified. The founder requested a full reset of the device-evidence sequence; the M2b code (`6d7f20e`) and all M2a results stand.
> **Superseded evidence (kept, not deleted):** `m2b-oauth-warm-tab.png` (the Google account picker from the interrupted attempt) is SUPERSEDED — it documents the chooser opening, not the flow.
> **Local users involved — cleanup HELD pending founder decision (nothing deleted):** `qa.unipilot@unipilot.test` (email), `qa2.unipilot@unipilot.test` (email), `mdxareeb@gmail.com` (google). Verified before any deletion: the mdxareeb account **predates the mobile work** — created 2026-09-28 with a completed local profile, one `assistant_turn` usage event, one "hello" conversation, and two terminal `presentation.generate` jobs (failed / dead_letter) from Sep 28–29. It is the founder's own local account, not attempt residue; the requested cleanup was stopped for their decision because deleting it would destroy their local data. No row attributable to the interrupted attempt was created (an earlier record line claiming it was "created 2026-10-14 during the attempt" was wrong and is corrected here).
> **Reset preconditions (verified 2026-10-14):** one authorised device; `adb reverse tcp:54937` live; GoTrue HTTP 200; the **installed** APK's signer SHA-256 = `bc51cd50…` (pulled from the phone's own `base.apk` — the in-place install landed); app force-stopped, browser sessions closed; the app launches to the sign-in form (no stored session). OAuth test-user confirmation: **`lets.thryvee@gmail.com` is on the OAuth client's Test users list** (founder-confirmed; record of the address only — no credential is ever recorded or typed by the agent). QA2 credentials are founder-provided at the onboarding leg. The mdxareeb cleanup question stays **held**: no deletion performed (founder did not instruct otherwise; the account remains their own real local data).
> **Leg A — first attempt FAILED, diagnosed and fixed in `bb90168`.** Evidence chain: the Google→GoTrue leg **succeeded** (`lets.thryvee@gmail.com` exists as a local user, created at the time of the attempt) yet the app showed the generic "Google sign-in couldn't be completed." copy and GoTrue's log contains **no `/token` exchange line** for the attempt — so the failure was client-side, before any request. Root cause (read from the installed `@supabase/auth-js`): `exchangeCodeForSession` resolves the PKCE verifier by a **flow id** — on web from `window.location`, which React Native lacks; the id only reaches the app when the client appends it to the redirect as `sb_flow_id`, gated behind `experimental.appendPkceFlowIdToRedirects`, and neither the flag nor the parsing existed in the M2b code. Fix: enable the flag on the client, parse `sb_flow_id` in both callback paths (in-app browser result and the deep-link route), and pass `{ flowId }` into the exchange; parser tests extended, typecheck/lint green, **35/35 tests**. The fix commit also carried the earlier README signing update and this §P block (recorded for scoping).
> **Dependency note (version-sensitive):** the flow-id handling — `experimental.appendPkceFlowIdToRedirects` and the `sb_flow_id` parameter name — is an auth-js implementation detail, not a stable API. An `@supabase/supabase-js`/`auth-js` upgrade may change or remove it and silently re-break OAuth; **any version bump must re-run Leg A** (and the B/C legs) before being trusted.
> **Leg A — second attempt (fixed build) FAILED; new evidence (2026-10-14).** The fix took effect — GoTrue's `/authorize` log line carries `unipilot://auth-callback?sb_flow_id=…` — but each attempt produced **two `/callback` hits** (one success, one `400: State has already been used`; 2 replays across the retry's two taps) and **no `/token` exchange ever reached the server**. Server-side: `auth.sessions`/`refresh_tokens` for `lets.thryvee@gmail.com` are **0**, its identity exists, and `auth.flow_state` holds **3 consumed PKCE flows, all with a code_challenge** (one per attempt). The app rendered the auth-callback route's generic failure copy, which covers both "no code arrived" and "the exchange threw client-side" — so the discriminating fact is **which URL the app actually received**, unknown without instrumentation. Leading hypothesis: the browser replays the GoTrue callback on app-switch/resume (the replay consumes/voids the flow) and the app ends up processing a parameterless callback redirect. **No blind retries: stopped for a founder decision** on the one-shot diagnostic (render the received URL's parameter *names* on the callback screen — one build, one attempt) or an alternative (drop the `openAuthSessionAsync` interception for the plain deep-link pattern; or test with Chrome instead of Brave).
> **Leg A — emulator run (2026-11-16) — FAILED; root cause found: the local build blocks cleartext HTTP.** Environment (founder-approved "Emulator now"): AVD `Pixel7_API36` (Android 16 / API 36, x86_64, Play Store image), `emulator-5554`; local stack healthy (GoTrue v2.196.0, `/auth/v1/health` 200). Host port: `winnat` again reserved `54841–54940`, so the host's `127.0.0.1:54937` is unreachable; the device tunnel is `adb reverse tcp:54937 → 127.0.0.1:54999` → host Node proxy → WSL `172.28.168.155:54937`, verified end-to-end from **Chrome on the emulator** (`m2b-emu-health-check.png` renders the health JSON). App: 0.1.0 / versionCode 1, signed out; sign-in screen `m2b-emu-nov16-ready.png`; account `lets.thryvee@gmail.com` present (`dumpsys account`); the installed `base.apk` is **byte-identical** to the worktree artifact (SHA-256 `CCA90C25…`, 108,093,965 bytes) — i.e. the `4f4ff51` diagnostic build.
> **The run (one attempt, WARM).** Fresh process → "Continue with Google" → account picker → consent (`m2b-emu-warm-consent.png`) → app callback (`m2b-emu-warm-result.png`: "Google sign-in couldn't be completed. Try again.", `callback params: code,sb_flow_id`). Infrastructure caveat, not a new attempt: the custom tab's first load hit `ERR_CONNECTION_REFUSED` because the `adb reverse` mapping had vanished after boot; the mapping was re-added and the **same** authorize page reloaded — one flow, one `/callback`.
> **Evidence.** Logcat, parameter NAMES only: `route params=code,sb_flow_id`; `deep link params=code,sb_flow_id`; `browser session type=success url params=code,sb_flow_id`. GoTrue: `/authorize` 302 at `2026-11-16T15:13:17Z` (referer `unipilot://auth-callback?sb_flow_id=…`); **one** `/callback` 302 at `15:13:58Z` with the `login` event for `lets.thryvee@gmail.com`; **no `/token`**. DB: `auth.sessions` = 0, `auth.refresh_tokens` = 0, `auth.flow_state` = 8 (cumulative). Chrome, single callback — no Brave replay pattern. Classified **case 2** (code + flow id arrived; the exchange threw before any request) → per the rule the `openBrowserAsync` guard is **not** implemented.
> **Root cause (confirmed 2026-11-16).** The installed APK's manifest has `targetSdkVersion=36` and **neither `android:usesCleartextTraffic` nor a network-security config** (aapt2 over the pulled `base.apk`), while its bundle resolves Supabase at `http://127.0.0.1:54937` (single occurrence in `assets/index.android.bundle`). Since API 28 the platform denies cleartext unless the app opts in, so the **first app-side HTTP call of the flow — the PKCE `/token` POST — is rejected before a socket opens**: no GoTrue line, no session, generic copy. It is a **build-path regression, not an auth-code bug**: EAS `preview` sets `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` (why M2a device sign-in worked), but the local Gradle recipe in `mobile-app/README.md` never exports it. This also fully explains the phone's 2026-10-14 "fixed build" attempts (local builds, no `/token`); the Brave double-callback was real but secondary, and that record's "parameterless callback" leading hypothesis is **superseded** by this cause (kept, not deleted).
> **Fix (proposed; awaiting the founder's go).** Set `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` in `C:\dev\up-mobile\mobile-app\.env`, re-run `npx expo prebuild --platform android --no-install` (native config changed), **re-apply the README's Gradle signing patch**, rebuild, `adb install -r`, then re-run **Leg A once**. No `src/**` change. The verifier-storage question stays open until the request actually reaches GoTrue.
> **Rebuild on the cleartext fix (2026-11-16).** Rebuilt from `C:\dev\up-mobile` with `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` (`.env`), `expo prebuild` (android regenerated) and the README's signing patch re-applied; APK verified before install: `android:usesCleartextTraffic=true`, `targetSdkVersion=36`, signer SHA-256 `bc51cd50…` (the permanent identity), versionName 0.1.0 / versionCode 1. Installed with `adb install -r` (no uninstall).
> **Leg A — emulator re-run on the fixed build (2026-11-16) — NO VERDICT: Chrome's renderer died before the deep link.** One attempt: "Continue with Google" → GoTrue `/authorize` 302 at `16:11:29Z` (flow id present) → Google login → `/callback` 302 at `16:12:05Z` (login event for `lets.thryvee@gmail.com`). The custom tab stayed blank the whole time and logcat records its sandboxed renderer dying (`Child process died (type=6)`); **no `unipilot://` VIEW intent reached the app**, no `[UNIPILOT_AUTH_DEBUG]` lines, no `/token`, `auth.sessions` = 0. Closing the tab produced the honest "Google sign-in was cancelled." screen. The auth code was consumed server-side; this run says nothing about whether the cleartext fix works. **No retry performed — awaiting the founder's decision.**
> **Diagnostic build:** still installed and unchanged; nothing uninstalled. **Gate: Leg A not passed → STOP for the founder's decision.**
> **Leg A — retry on the fixed build (2026-11-16) — PASSED (emulator).** Founder approved "Retry once, fresh Chrome". The emulator process itself had died while force-stopping Chrome (it came back only with `-memory 4096`), so the AVD was cold-booted, `adb reverse tcp:54937 tcp:54999` re-added, proxy health 200, app signed out. One fresh flow — tap `16:55:05Z` → `/authorize` 302 `16:55:16Z` (`sb_flow_id` in the referer) → Google login → `/callback` 302 `16:55:19Z` (**login** event, `lets.thryvee@gmail.com`) → `unipilot://auth-callback?...` VIEW intent `22:25:18` local (`code,sb_flow_id`) → **`/token` 200 twice at `16:55:54Z`** (`grant_type=pkce`, both success) → the app lands on the native **SETUP** onboarding screen (`m2b-emu-leg-a-onboarding.png`). **Persistence:** force-stop + relaunch still lands on SETUP — the session is in secure storage. **Cleartext fix confirmed:** the same flow that previously died with no `/token` now completes; the manifest flag is the only change. Per the rule, the `openBrowserAsync` guard stays **not implemented**, and the "parameterless callback" hypothesis is superseded (kept, not deleted).
> **New defect found by the pass — duplicate code exchange.** One authorize/callback pair produced **two `/token` 200 exchanges of the same code** (same second) and therefore **two sessions**: `auth.sessions` = **2**, `auth.refresh_tokens` = **2** (one orphaned — the app stores only one), `auth.flow_state` = 9 (one new flow). The app has **two independent exchange sites** — the deep-link handler (`AuthProvider.completeAuthCallback`) and the in-app browser result (`startGoogleSignIn` → `exchangeAuthCode`), plus the `auth-callback` route rendering — so the same code is submitted twice; GoTrue accepts both under the race. Cosmetic state is correct (single stored session, onboarding shown) but the server now carries a dangling session. **Must be fixed before M2b closure.** Fix direction: exactly one exchange path (deep link is the authoritative return; the browser result only reports cancellation) or a code-keyed single-flight guard shared by every path. Requires a rebuild and **one Leg A re-run** to prove `sessions` = 1.
> **Dedupe fix implemented and verified (2026-11-16).** `exchangeAuthCode` is now single-flight keyed by the code: concurrent and repeated submissions of the same code share one `/token` call and one result (success is retained for re-deliveries; a failure is not cached, so a re-delivery can retry), and a different code always starts a fresh exchange. Both call sites (callback route and in-app browser result) are kept for platform coverage, but they can no longer race. The temporary Leg A diagnostics are removed, and `mobile-app/README.md` now documents the mandatory `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` prebuild env plus the cleartext verification step. Tests: 4 new cases in `src/auth/__tests__/oauth.test.ts` (concurrent dedupe, later re-delivery, new code, uncached failure) — `npx jest` 39/39 pass; `tsc --noEmit` and `expo lint` clean.
> **Clean build + dedupe re-verification (2026-11-16) — PASSED.** Incremental build `BUILD SUCCESSFUL in 3m 40s`; APK 108,093,125 bytes, `android:usesCleartextTraffic=true`, `targetSdkVersion=36`, signer SHA-256 `bc51cd50…`, versionName 0.1.0 / versionCode 1; the bundle contains **0** `UNIPILOT_AUTH_DEBUG` markers (diagnostics gone). `adb install -r` → Success; nothing uninstalled.
> **Sign-out (fixture maneuver, documented).** The onboarding gate has no sign-out control, so to reach the More tab the test profile's `onboarding_completed_at` was set to `now()` in the **local** DB only, the app relaunched into the tabs, and the real **More → Sign out** was tapped at `17:18:16Z` — sign-in screen, `auth.sessions` = 0, `auth.refresh_tokens` = 0 (global sign-out also cleared the orphaned duplicate session). `onboarding_completed_at` was reset to NULL immediately after, so the SETUP gate stays testable. No other profile field touched.
> **Leg A re-run on the clean build (one attempt) — PASSED with a single exchange.** Tap `17:19:26Z` → `/authorize` 302 `17:19:31Z` (flow id in the referer) → `/callback` 302 `17:19:32Z` (login) → **exactly one `/token` 200** at `17:19:33Z` → **`auth.sessions` = 1**, `auth.refresh_tokens` = 1 → native **SETUP** (`m2b-emu-dedupe-step1.png`); force-stop + relaunch → SETUP (`m2b-emu-dedupe-persisted.png`). Note: Android autofill repopulates the onboarding inputs with earlier test values (Areeb / Khan / UniPilot Test University); the profile row stays NULL in the DB — cosmetic, unrelated to auth.
> **Leg B — CANCEL (2026-11-16) — PASSED on the clean build.** Setup: signed out via the documented fixture maneuver; `auth.sessions` = 0, `auth.refresh_tokens` = 0; sign-in screen.
> **Attempt 1 (invalid — superseded, kept).** Tap `17:32:43Z`; the custom tab auto-completed the already-consented Google flow before any dismissal was possible (tap → `/authorize` 302 `17:33:04Z` → `/callback` 302 `17:33:08Z` → exactly one `/token` 200 `17:33:27Z`, sessions = 1). **No cancel action was performed**, so attempt 1 does not test Leg B; it is kept only as a second real-flow proof of the dedupe guard (`m2b-emu-leg-b-invalid-attempt1-{launching,signedin}.png`).
> **Attempt 2 (valid).** Tap `17:36:23Z` → Chrome top `17:36:27Z` → **back pressed `17:36:31Z`**, dismissing the tab before Google's callback. The app returned to sign-in and rendered the honest **"Google sign-in was cancelled."** banner (`m2b-emu-leg-b-browser-before-cancel.png`, `m2b-emu-leg-b-cancelled.png`). GoTrue: `/authorize` 302 `17:36:39Z` (a request Chrome finished after the dismissal) and **no `/callback`, no `/token`**; **no `unipilot://` VIEW intent**; `auth.sessions` = 0, `auth.refresh_tokens` = 0. No spinner, no fake success.
> **Diagnostic build:** replaced by the clean build; nothing uninstalled, no fake state.
> **Leg C — COLD (process-death callback) (2026-11-16) — NO VERDICT (emulator infrastructure); stopped, no retry.** Procedure approved by the founder: start Google sign-in, confirm the custom tab, force-stop **only** `com.unipilot.app`, let the flow finish, and require the `unipilot://auth-callback` deep link to cold-start the app and exchange once.
> **Attempt 1 (invalid).** The app was killed after 18 s of polling, but this cold boot's Chrome had not reached the foreground yet — no `/authorize`, no flow, nothing to return to (`sessions` = 0). Superseded; no evidence kept.
> **Attempt 2 (no verdict).** Chrome top at `17:54:31Z`; the custom tab did **survive** the app kill (`am force-stop` at `17:54:36Z`, app pid gone; `CustomTabActivity` remained top). GoTrue: `/authorize` 302 `17:54:38Z` (`sb_flow_id` present), then **`/callback` 504 `request_timeout` at `17:54:54Z`** (`context deadline exceeded`, 14.2 s) while Chrome was already throwing "Chrome isn't responding". **No code was issued, no `unipilot://` VIEW intent, no `/token`, the app never cold-started, `sessions` = 0.** The failure is server/browser-side (GoTrue's callback timed out under the ANR'd emulator), not the app's cold-start code — the one thing this run proves is that the custom tab outlives the force-stop. Evidence: `m2b-emu-leg-c-tab-open-before-kill.png`, `m2b-emu-leg-c-callback-504.png`. **No retry performed — STOP for the founder's decision.**
> **Leg C — COLD (process-death callback) — retry on a clean emulator boot (2026-11-16) — FAILED: the cold-start deep link is dropped by the app.** Founder approved the retry. The ANR'd emulator was killed and cold-booted (`-no-snapshot-load -memory 4096`; device uptime 47 s when checked), `adb reverse tcp:54937 tcp:54999` re-added, proxy health 200, the clean APK reinstalled in place (`adb install -r` → Success), app signed out; `auth.sessions` = 0, `auth.refresh_tokens` = 0.
> **Procedure deviation (recorded).** The kill used `am kill` (verified: pid 3528 gone, then pid 4101) instead of `am force-stop`: force-stop marks the package *stopped*, and Android withholds implicit deep-link intents from stopped packages — that would test Android's stopped-state rule, not the app's cold-start handling. The approved process-death condition is unchanged.
> **One attempt.** Tap `18:02:06Z` → Chrome top `18:02:09Z` → app process killed `18:02:11.874Z` (logcat: `Killing 3528:com.unipilot.app ... kill background`), Chrome stayed top. GoTrue: `/authorize` 302 `18:02:13Z` (flow id present) → `/callback` 302 `18:02:14Z` (**login**). The `unipilot://auth-callback?...` VIEW intent `18:02:14.499Z` **cold-started the app** (`Start proc 4101 ... for next-top-activity` at `.524`), so the callback did arrive at a dead process and Android launched the app — **but the app never mounted the callback route**: no `/token` at all, `auth.sessions` = 0, `auth.refresh_tokens` = 0, and the UI is the plain sign-in screen with no error. Evidence: `m2b-emu-leg-c-retry-tab-open-before-kill.png`, `m2b-emu-leg-c-retry-after-deeplink.png`.
> **Root cause (hypothesis, source-confirmed).** expo-router on Android resolves the launch URL through RN `Linking.getInitialURL()` inside a **150 ms `Promise.race`** (`expo-router/build/fork/useLinking.native.js` → `getInitialURLWithTimeout`) and does not fall back to expo-linking's native `getLinkingURL()` (`expo-router/build/link/linking.js` carries the TODO for Android interop). On this cold start JS began ~1.5 s after the intent, so the URL was missed; the `onURLReceived` event had already fired before JS subscribed. The callback route therefore never ran. **Warm delivery is unaffected** (Leg A): a dummy-code deep link delivered while the app was alive mounted the route and rendered the sanitized error UI (diagnostic only — fake code, no session, no `/token`).
> **Disposition:** Leg C is **not passed**; the gate cannot close yet. The fix direction is an app-level cold-start handler that reads expo-linking's `getLinkingURL()` once the navigator is ready and routes to `/auth-callback` with the parsed params (the existing route + single-flight exchange do the rest), then one rebuild and **one** Leg C re-run. **Founder held on 2026-11-16; resumed on 2026-11-17 ("retry from where we left off"). Fix implemented:** `authCallbackParams()` in `src/auth/oauth.ts` (URL → the four route params, scheme/host checked) and a one-shot effect in `src/app/_layout.tsx` gated on `status !== "loading"` + `rootNavigationKey` that reads `Linking.getLinkingURL()`, clears it, and routes to `/auth-callback` unless already there. Tests: 4 new `authCallbackParams` cases — `npx jest` **43/43**, `tsc --noEmit` and `expo lint` clean. Rebuild + `adb install -r` + one Leg C re-run in progress; the result is recorded below when it lands.
> **Leg C - COLD (process-death callback) - re-run on the fixed build (2026-11-17) - PASSED.** Environment restored after the machine restart: WSL Supabase up, host proxy on 54999 restarted (health 200), AVD `Pixel7_API36` cold-booted (`-no-snapshot-load -memory 4096`), `adb reverse tcp:54937 tcp:54999` re-added, app signed out (`sessions` = 0, `onboarding_completed_at` = NULL). Build: the final status-gated `_layout.tsx` was copied to `C:\dev\up-mobile` (hash match) and rebuilt - `BUILD SUCCESSFUL in 3m 25s`; APK 108,091,725 bytes, signer SHA-256 `bc51cd50…`, `android:usesCleartextTraffic=true`, `targetSdkVersion=36`, versionName 0.1.0 / versionCode 1, and the bundle contains `authCallbackParams` + `clearInitialURL` (the new JS is in the artifact). `adb install -r` -> Success; nothing uninstalled.
> **Infrastructure (recorded, not an app failure).** After each of the two cold boots the first app launch surfaced a System UI / system ANR dialog; both were dismissed with the dialog's "Wait" and the app process stayed healthy. Caused by the emulator settling after boot; only the dialogs were interacted with - no app force-stop, no Chrome force-stop.
> **Invalid attempts (kept, superseded; not Leg C verdicts).** (1) `14:38Z`: the host-side `am kill` ran in a separate command after detecting Chrome; the callback returned first, the app was warm, the kill was skipped, and the flow produced one `/token` at `14:39:09Z` / `sessions` = 1 (another warm-delivery + dedupe proof). (2) `14:42Z`: a single command with 900 ms host polling still lost the race - `/authorize` `14:42:56Z` -> `/callback` `14:42:58Z`; the kill at `14:42:57.860Z` arrived as the app was already resuming, so it was skipped; one `/token` `14:43:12Z`, `sessions` = 1. Screenshots for both are kept as `m2b-emu-leg-c2-invalid-attempt1-*`.
> **Valid run (one attempt).** Fixture reset by the documented maneuver (temporary `onboarding_completed_at = now()` in the local DB -> tabs -> More -> Sign out -> flag back to NULL; `sessions` = 0, `refresh_tokens` = 0, app force-stopped). Tap "Continue with Google" `14:46:33.148Z`; an **on-device kill loop** (`am kill` every ~150 ms until `pidof` is empty; no host round-trip) killed the app after ~5.4 s, and Chrome stayed on top. GoTrue: `/authorize` 302 `14:46:36Z` (flow id `f31052b5…`) -> `/callback` 302 `14:46:39Z` (**login**, `lets.thryvee@gmail.com`). The `unipilot://auth-callback/...` VIEW intent at `20:16:39.712` local (device UTC+5:30) **cold-started the app**: `Start proc 8200 ... for next-top-activity` at `.782`, `Displayed ... +3s373ms`. The app mounted the callback route and completed **exactly one `/token` 200** at `14:46:43Z` (`grant_type=pkce`), then landed on native **SETUP** (`m2b-emu-leg-c2-after-deeplink.png`). DB: `auth.sessions` = 1, `auth.refresh_tokens` = 1.
> **Verdict: Leg C PASSED.** The cold-start handler works under real process death: the launch URL is read from expo-linking once the navigator is ready, the callback route mounts, the single-flight exchange runs once, and the UI lands on onboarding. Note for any future re-run: a warm Chrome flow completes in ~2 s, so the kill must run from the on-device loop; host-side polling loses the race (both invalid attempts above).
> **M2b evidence pass (2026-11-17).** The sign-in screen (with the M2b Google button) was captured in **light** (`m2b-signin-light.png`, `cmd uimode night no`) and **dark** (`m2b-signin-dark.png`, `cmd uimode night yes`); reduced motion was set with `animator/transition/window` scales **0/0/0** (all three re-read from the device), the app cold-started, and the full form rendered in its final position (`m2b-signin-reduced-motion.png`) - no content hidden. All three scales were restored to **1** and re-read; night mode was restored to the found state (`no`). The onboarding screen's dark rendering is already in `m2b-emu-leg-c2-after-deeplink.png`; its light rendering was not captured because the founder deferred signing in.
> **QA2 onboarding leg - DEFERRED by the founder (2026-11-17).** After the Leg C pass the founder instructed: skip the QA2 sign-in for now and move on. No credential was typed, no QA2 session was created, and no QA2 profile field was written; the fixture remains fresh (`onboarding_completed_at` = NULL, no name/institution), and its **139 pre-existing web-suite sessions were not deleted**. **Consequence (recorded, not hidden):** the M2 exit evidence "a fresh identity completes onboarding natively and the web sees the same rows" was **not exercised this gate**. The native onboarding screen rendered on every signed-in leg (including the Leg C cold start, `m2b-emu-leg-c2-after-deeplink.png`) but its completion was not submitted. This leg stays a tracked follow-up.
> **Emulator infrastructure (2026-11-17, recorded).** The AVD crashed once between legs while idle; the host had ~2 GB free of 7.7 GB with a 4 GB guest, and the guest had already produced System UI/system ANR dialogs after boot. It was cold-booted with `-memory 3072` and `-no-boot-anim`, the tunnel re-added, and the sign-out maneuver completed before the QA2 deferral. These are emulator/host conditions, not app failures; the Leg C verdict above was obtained before the crash.
> **Legs:** A WARM - **PASSED and re-verified on the clean build** (single session) · B CANCEL - **PASSED on the clean build** · C COLD - **PASSED on 2026-11-17** (process-death deep link cold-starts the app, mounts the callback route, one `/token`, one session, SETUP).
> **QA2 onboarding leg - PASSED (2026-11-18), with the web row-for-row proof.** This supersedes the 2026-11-17 deferral entry above: the leg is no longer deferred, and the 139 sessions the earlier entry said were kept were in fact deleted by a credential probe (Incident 1). The founder authorised the agent to sign in with QA2 ("can you just sign in and move forward"). Identity `qa2.unipilot@unipilot.test`, signed in through the native **email/password** form (not Google, avoiding the account-picker risk); local stack only. Pre-state re-verified: profile all NULL, `onboarding_completed_at` NULL, 0 tasks/events. Native sign-in produced one `/token` login event and one session.
> **Native onboarding.** Submitted `QA` / `Two` / `UniPilot Test University` / `Computer Science` / Year 2 / Semester 1 / Balanced / 3 days before / `Linear Algebra`; the real `complete_onboarding` RPC landed at `2026-11-18 14:45:22.228073+00`. DB after: `onboarding_completed_at` set, profile exactly those values, subject `Linear Algebra`; the More tab shows `QA Two`, timezone `UTC`, `Onboarding: Complete`. Evidence (all `mobile-app/screenshots/`, git-ignored): `qa2-pre-signin.png`, `qa2-ready-signin.png`, `qa2-onboarding-screen.png`, `qa2-year2.png`, `qa2-choices.png`, `qa2-subject-added.png`, `qa2-after-finish.png`, `qa2-more.png`. Negative/ANR/superseded shots are kept and labelled: `qa2-retry-signin.png`, `qa2-720-signin.png`, `qa2-focus-check.png`, `qa2-focus-check2.png`, `qa2-after-wait.png`, `qa2-lean-signin.png`, `qa2-after-signin.png`, `qa2-signin-result.png`, `qa2-now.png`, plus the bridge checks `qa2-health-check.png` / `qa2-health-check2.png`.
> **Web proof (same rows).** The host's `127.0.0.1:54937` is inside the Windows-reserved `54841-54940` range already recorded for the device legs, so a temporary host TCP bridge on `54950` -> WSL `172.28.168.155:54937` was used and both git-ignored env files pointed at it for the run; both were restored to `54937` afterward. A temporary Playwright script drove the real `/login` flow (Continue with Email -> `#email`/`#password` -> Sign in), reached `/dashboard`, and the rendered page showed `Welcome to UniPilot, QA.`, `Computer Science at UniPilot Test University · Year 2 · Semester 1`, and `Your subjects: Linear Algebra` - the same rows the native flow wrote. Evidence: `qa2-web-dashboard.png` (full page) and `qa2-web-dashboard-header.png` (legible header). The script was deleted after the run; no faked state and no token/cookie is recorded.
> **Incident 1 - QA2's 139 historical sessions deleted by a credential probe (recorded, not hidden).** Before the UI flow, a password-grant probe verified the env password against GoTrue and then called `/auth/v1/logout` without a scope; GoTrue defaults to **global**, deleting QA2's 139 pre-existing web-suite sessions and refresh tokens. QA2 had no application data at the time (profile all NULL, 0 tasks/events); the founder's `mdxareeb@gmail.com` (2 sessions / 6 refresh tokens) and QA1 were untouched, re-verified after the deletion. The probe's purpose was correct; the scope was not. Future probes must pass `?scope=local`.
> **Incident 2 - QA2 password printed in the Next dev log; fixed and rotated.** The first web attempt could not reach the stack, and the Next dev log then showed `signInWithEmail("qa2…", "<password>")` because Next logs Server Function arguments by default in development. Fix: `logging.serverFunctions: false` in `frontend/next.config.ts` (the documented Next 16 key), with `npm run typecheck` and `npm run lint` clean; the affected dev log was deleted. The QA2 password was rotated through the GoTrue Admin API: old password `400`, new password `200`, both git-ignored env files updated in-process (the value was never printed), and the verification session revoked with `?scope=local` (`204`). **Deviation from the earlier assumption:** the Admin API password update also revoked the native session (`auth.sessions` 1 -> 0), so the device will require a fresh sign-in next time; the onboarding rows and the native evidence are unaffected.
> **Incident 3 - intermittent `PGRST303 "JWT issued at future"` on the first dashboard read (local stack).** Some first reads after a fresh web sign-in render the honest error boundary instead of the rows; one **Try again** renders all three lines. Observed 3 times in 9 completed dashboard sign-ins; the captured session token's `iat` was current (`iat - now` 0), direct PostgREST reads with the same token passed (including 14 back-to-back reads from 1 ms after mint), and the anon key has no `iat` (it returns a permission error, not PGRST303). Classed as a sub-second validation/clock transient in the local stack, not an app-logic or RLS failure; no app code was changed for it, and the error boundary already offers the recovery. If it recurs at review, reload once.
> **Incident 4 - emulator infrastructure (recorded, not an app failure).** The 3 GB and 2.5 GB guest boots produced System UI/app ANRs under host memory pressure (~700-855 MB free of 7.7 GB). Mitigations: cold boot at 2 GB, Chrome kept closed, 720x1600 display override, animations off, autofill disabled only while typing. Display size, density, animation scales, autofill service and IME were restored and the emulator was shut down; no device is attached. Input races (taps landing in the wrong field when the keyboard covered the form) were handled by verifying focus before typing, not by blind retries.
> **Verdict:** the M2 exit evidence "a fresh identity completes onboarding natively and the web sees the same rows" is now **exercised and PASSED**. All M2b legs are green. QA2 is left onboarded with one subject, **0 sessions**, and no other application data; the 13 proof sessions were revoked globally at the end, and the founder/QA1 counts are unchanged. **Gate: STOP for the founder's M2b review; M3 does not start without a go.**

> **M3-type work approved, with M2b Leg A still open - 2026-11-19.** The founder approved starting M3-type work now (read-only Tasks and Calendar surfaces) together with the WhatsApp group sync screen under More, accepting that M2b Leg A (Google PKCE on device) is unresolved. This does NOT close M2b: legs A, B, C and the QA2 onboarding leg stay pending, and email/password sign-in (verified in M2a) is what these screens rely on. Scope chosen: (1) a WhatsApp groups screen under More (link, group on/off toggles, review of suggestions); (2) read-only Tasks and Calendar lists with a From WhatsApp marker. Linking uses WhatsApp's PAIRING CODE, not a QR, because a QR shown on the phone cannot be scanned by the same phone; the user enters their number, the app shows an 8-character code with a Copy Code button, and the user enters it under WhatsApp > Linked devices > Link with phone number. The phone number is sanitised to digits-only E.164 before use and stored encrypted next to the session secrets. All server-secret actions (link, disconnect, pairing code read, approve/dismiss a suggestion) go through new Bearer-authenticated routes under /api/integrations/whatsapp-groups/** (plan section B.1 channel iii); group toggles and the read-only lists use direct Supabase under the user's JWT (channel i). Design and server-side details: docs/integrations/whatsapp-group-sync.md.

*(M1–M7 entries to follow, each with: date, writer, what shipped, exact evidence paths, what was verified on device, what is `[!]` and why, web-suite result, migration/type gate results, and any deviation from this plan with its reason.)*

---

## Q. References

- `AGENTS.md` (root), `frontend/AGENTS.md`, `README.md`, `TASK.md` §0/§17/§22/§46, `DESIGN.md`, `MOTION.md`, `AUTH_ARCHITECTURE.md`, `QA_SESSION.md`
- `backend/DATABASE.md`, `backend/supabase/MIGRATIONS.md`, `backend/worker/*.mjs`
- `frontend/lib/data/*`, `frontend/lib/supabase/{database.types,schema-contract,service}.ts`, `frontend/app/api/**`, `frontend/app/(app)/{calendar,integrations}/**`, `frontend/app/globals.css`
- `whatsapp/README.md`, `docs/integrations/presenton.md`

> **M3-type work built (WhatsApp groups screen, read-only Tasks and Calendar) - 2026-11-19. Code complete; NOT verified on a device.** Built under the approval recorded above; M2b Leg A is still open and this does not close it.
>
> **What was added.**
> - `src/app/whatsapp-groups.tsx` (reached from More > WhatsApp groups) and `src/features/whatsappGroups/`: phone entry, pairing code card with countdown and a one-tap **Copy Code** (`expo-clipboard`, added as `~57.0.2`; this needs a NEW native build, an OTA/JS reload is not enough), group on/off switches, suggestion review (Add / Dismiss with an in-place confirm), disconnect/cancel with a confirm. A state table (`stateView.ts`) decides which controls each link state may show.
> - Tasks and Calendar tabs now read the student's own rows from Supabase under their JWT (channel i) and show a **From WhatsApp** marker where `source = 'whatsapp_group'`. Read-only: nothing writes.
> - Channels (plan B.1): group switches and the lists go direct to Supabase (RLS plus the `is_active` column grant). Link, disconnect, the pairing code read and Add/Dismiss go through the Bearer routes under `/api/integrations/whatsapp-groups/**` (channel iii). Web side: `lib/auth/bearer.ts`, `lib/auth/apiAuth.ts`, four route files; the QR is never sent to a Bearer caller.
> - New env: `EXPO_PUBLIC_API_BASE_URL` (public URL, in `.env.example` and the README). Unset, the screen says it is not connected. Locally it needs `adb reverse tcp:3000 tcp:3000` plus cleartext.
> - The phone number is cleaned to digits-only E.164 (`919876543210`, no `+`, spaces or dashes) on the device for instant feedback, and again in the API, the database and the bridge; it is stored encrypted next to the session secrets and deleted when the attempt ends. The app keeps no copy.
>
> **Verified here (host).** `tsc --noEmit`, `expo lint` and `jest` all clean (127 tests, 12 suites). New tests cover: the phone sanitizer against the web one on 24 shared inputs (drift fails the test), the API client (header shape, error mapping, snapshot validation), the state-to-controls table, the countdown and Copy Code (live copies the raw code, expired refuses, a clipboard failure is reported), the group toggle (reverts on failure), Add/Dismiss (404 clears the item, other failures keep it) and the agenda mapping (profile-timezone dates, ordering, markers). Server side: the Bearer API spec and the group-sync UI spec pass together (40 passed, one worker, local stack).
>
> **NOT verified.**
> - Nothing was run on a device or emulator: layout, the real clipboard, the keyboard type, the switch feel, reduced-motion behaviour, light/dark rendering and Hermes `Intl` time-zone formatting are unchecked.
> - There is no component-render test: the project has no React Native renderer and Jest only matches `.test.ts`. UI logic lives in pure modules so it is tested; the JSX around it is not.
> - A pairing code from real WhatsApp has never been produced. `requestPairingCode` is unexercised against WhatsApp, and Gemini is unexercised, because no spare number or key exists yet.
> - A new APK build with `expo-clipboard` has not been made.
>
> **Open.** M2b Leg A, B, C and the QA2 onboarding leg. Device checks for this work should be added to the M2b/M3 device protocol (section K).

> **WhatsApp group sync mobile UI - device-verified (2026-11-22).** Built from the proven worktree recipe at the heartbeat commit (which contains the group-sync baseline plus the two follow-up mobile commits below); APK 108,192,773 bytes, `android:usesCleartextTraffic=true`, signer SHA-256 `bc51cd50…` (permanent identity), installed with `adb install -r` (nothing uninstalled).
>
> **Identity deviation (recorded).** The authenticated session on the emulator resolved to the OAuth test user `lets.thryvee@gmail.com`, not QA2: the sign-in step used Google rather than the QA2 email/password form. It is not the founder account; the seeded fixture rows were reassigned to it. Fixture: two subjects with code + tag slugs, two groups, three raw messages, two tasks, two events, two candidates, two documents (one real PDF in Storage), and a DB-only mocked bridge heartbeat (no WhatsApp connection). QA2 and QA1 were left untouched.
>
> **What was added before the device pass.** `feat(mobile)`: subject tag slugs shown as a subtle neutral dot + tag (name-only fallback) and a tappable From WhatsApp marker that reads the original `raw_messages` row (owner RLS) with honest 30-day-purge copy; and a Course materials screen under More (web-matching type/size/status vocabulary, AI summary, topic tags, subject filter, open via 60 s signed URL). `fix(worker)`: the `whatsapp.extract` job now runs the shared `touch_job` heartbeat. Gates at the time: mobile 139/139 Jest, tsc, lint; extraction 123/123; bridge 114/114.
>
> **Device legs - all PASS on the emulator (`Pixel7_API36`).** Calendar and Tasks read live rows with subject tags and From WhatsApp badges; tapping the badge revealed sender, sent time and the full original text (both tabs). The mocked `code_ready` session rendered the pairing card with a live countdown and DEMO-1234; Copy Code reached the "Copied" state. The connected state rendered both groups with Capturing/Off; an inactive group's switch persisted (`is_active`, `activated_at` stamped). Two suggestions were approved from the review queue: the proposed course "Advanced Databases" was created only on approval and the guest lecture appeared on the Calendar; the undated quiz became a task. Course materials showed the summary, tags, subject filter, the honest "File unavailable" failed row, and opened the seeded PDF in Chrome via the user-signed URL (Storage returned 200 `application/pdf`). Dark rendering and reduced motion (scales 0/0/0, cold start) both showed every element.
>
> **Evidence** (`mobile-app/screenshots/`): `wg-m4-calendar-tags.png`, `wg-m4-calendar-original-message.png`, `wg-m4-tasks-markers.png`, `wg-m4-tasks-original-message.png`, `wg-m4-pairing-code.png`, `wg-m4-pairing-code-copied.png`, `wg-m4-groups-connected.png`, `wg-m4-groups-both-active.png`, `wg-m4-review-added.png`, `wg-m4-review-empty.png`, `wg-m4-tasks-after-approvals.png`, `wg-m4-calendar-after-approvals.png`, `wg-m4-materials.png`, `wg-m4-materials-filter.png`, `wg-m4-materials-open-pdf.png`, `wg-m4-materials-dark.png`, `wg-m4-groups-dark.png`, `wg-m4-calendar-reduced-motion.png`.
>
> **Incidents (recorded, not app failures).** The host was memory-starved (~437 MB free) and the emulator produced ANR dialogs and dropped taps; it was restarted with 2 GB. `uiautomator dump` then returned "could not get idle state" and left the previous XML in place, which looked like a frozen app and was actually a stale read; verification moved to screenshots + Windows OCR. PowerShell `>` corrupts binary screenshots (UTF-16); captures now use `cmd /c "adb exec-out screencap -p > file.png"`. Device settings were restored: animation scales 1/1/1, night mode `no`.
>
> **Live WhatsApp verified (2026-11-22, spare number).** Paired from the app with the 8-character code; the first attempt ended 408 (expired/replaced code) and the fixes in `188e1d8` (standard browser tuple, 515 credential flush, clean retry state) were then exercised: 46 groups discovered, a live `Submit COA Assignment 3 by next Friday 11:59 PM` message scored 0.80 and was approved into a task with `source = whatsapp_group` plus the proposed course "Computer Organization and Architecture", and an `OS M2.docx` was captured, summarised with seven tags and indexed. A bridge restart reconnected from stored credentials in ~2 s with no new code. Not exercised: the web QR path, repeat-send dedupe, a deliberate OFF-group live drop, and disconnecting the link. Live Gemini extraction was verified separately (2026-11-22, `gemini-3.1-flash-lite`); see `docs/integrations/whatsapp-group-sync.md`. Final web gates (flag-off groups spec, worker-dependent specs, Chromium visual pass, `db:reset`) remain as recorded there.
