# UniPilot — Project Context

> Snapshot written **2026-11-11**. This file is a map of the project as it
> actually exists in this checkout: what the product is, how the pieces fit,
> what is verified, what is still blocked, and where the authoritative
> documents live. When this file and a source document disagree, the source
> document wins — update this file from evidence, never from memory.

---

## 1. What UniPilot is

UniPilot is a **student productivity platform** built around one idea: a
single, trustworthy calendar. Events come from manual entry and from services
students already use — WhatsApp chats, Google Calendar, Outlook/Teams (and,
later, Gmail). The product also includes tasks, documents with search/RAG, an
AI assistant, and AI-generated presentations.

Core product surfaces (web):

| Area | Route | What it does |
| --- | --- | --- |
| Marketing / public | `frontend/app/(marketing)` | Landing, specimen, public pages |
| Auth | `frontend/app/(auth)` | Sign in, sign up, forgot password, email verification |
| Dashboard | `frontend/app/(app)/dashboard` | Overview |
| Calendar | `frontend/app/(app)/calendar` | Unified calendar; each row carries an honest source marker |
| Tasks | `frontend/app/(app)/tasks` | Task list/CRUD |
| Documents | `frontend/app/(app)/documents` | Upload, process, search documents |
| Integrations | `frontend/app/(app)/integrations` | WhatsApp, Google Calendar, (planned) Microsoft; sync history and candidate review |
| Tools | `frontend/app/(app)/tools` | Presentation generation (Presenton) |
| Assistant | `frontend/app/(app)/assistant` | Chat with RAG over documents and action engine |

The project is **local-first**: all development and QA run against a Supabase
stack inside WSL2. The hosted Supabase project has never been written to by the
recent work; its cutover is a reviewed operator event that waits on explicit
founder approval.

A native Android app (Expo/React Native) is being built in `mobile-app/` to
bring the calendar/tasks/auth experience to the phone. Its plan and phase
record live in `mobile-app/plan.md`.

---

## 2. Repository map

```
unipilot/
├── frontend/            Next.js 16 App Router web app
├── backend/             Supabase project + worker + docs
│   ├── supabase/        config.toml (git-ignored), migrations/, seed.sql,
│   │                    qa/, ops/, templates/, MIGRATIONS.md
│   ├── worker/          Node.js background-job runner
│   ├── DATABASE.md      schema contract, RLS matrix, jobs, integrations
│   └── EMAIL.md         auth email delivery contract
├── whatsapp/            Python service: export parser + live Selenium driver
├── mobile-app/          Expo/React Native Android app
│   ├── plan.md          M0–M7 plan + append-only §P phase record
│   └── README.md        local build/signing/device recipes
├── scripts/             root orchestration (start-env.mjs, WSL helpers)
├── docs/                integration and design specs
├── presenton-main/      Presenton engine checkout / data
├── presenton-ui/        optional re-themed Presenton frontend fork
├── TASK.md              historical task ledger (large; authoritative history)
├── DESIGN.md            design system (monochrome, fonts, radius, elevation)
├── MOTION.md            Motion.dev vocabulary and rules
├── AUTH_ARCHITECTURE.md authentication architecture
├── QA_SESSION.md        the permitted authenticated QA environment
├── AGENTS.md            monorepo agent rules
└── context.md           this file
```

Root `package.json` is an npm-workspaces orchestrator. There is **one root
lockfile**. `frontend` and `backend` are the original workspaces; `mobile-app`
was added for the native app.

---

## 3. Runtime architecture

### 3.1 Web frontend

- **Next.js 16.3.1**, React 19.2.8, App Router, TypeScript, Tailwind CSS v4.
- **Supabase** via `@supabase/ssr` `^0.12.4` and `@supabase/supabase-js`
  `^2.112.3`.
- **Motion** `^13.1.1` is the primary animation library (see §7).
- `frontend/proxy.ts` — Next 16 renamed `middleware.ts` to `proxy.ts`. It is
  the protected-route gate. There is no `middleware.ts`.
- Most data mutations are **Server Actions** under `frontend/lib/data/*Actions.ts`.
  This matters for mobile: Server Actions cannot be called from the device.
  App-facing capabilities must be explicit HTTP route handlers
  (`frontend/app/api/**`) with Bearer auth.
- Existing HTTP surface relevant to mobile:
  - `GET /api/integrations/google/callback` — cookie + OAuth state, redirects
    back to `/integrations?google=…`.
  - `POST /api/assistant/turn` — SSE, cookie session.
  - `GET /api/presentation/**` — cookie session.

### 3.2 Supabase backend

- Local stack: **Docker Engine inside the `kali-linux` WSL2 distro**, driven by
  the Supabase CLI. Host-specific API port is **54937** (Windows `winnat`
  reservation forced the move from 54321).
- `backend/supabase/config.toml` is **git-ignored** (CLI-generated). Local
  config has studio/realtime/edge-runtime/analytics disabled; **storage is
  enabled** (documents bucket).
- **23 versioned migrations** in `backend/supabase/migrations/`. Schema:
  profiles, subjects, tasks, events, documents/chunks, conversations/messages,
  jobs, usage ledger, integration_connections/runs/messages/candidates,
  google_calendar_credentials, assistant actions, presentations.
- **RLS is enabled on all 19 tables.** Owner-only policies for client reads;
  service-side writes only for integration tables and assistant messages.
  `google_calendar_credentials` is deny-by-default and reachable only through
  service-role RPCs.
- Storage buckets: `documents` (private, `{user_id}/{document_id}/…`) and
  `whatsapp-exports` (owner-folder RLS).
- Onboarding writes go through `complete_onboarding` (`security invoker`,
  EXECUTE granted to `authenticated`); validation rules are shared with the
  web and reused by mobile.
- **Never** run `supabase db push` against the hosted project. Hosted
  reconciliation is a documented runbook in `backend/DATABASE.md`.

### 3.3 Background worker

- `backend/worker/run.mjs` + `handlers.mjs`; Node ESM.
- Job protocol: claim → dispatch → settle, exponential backoff, dead-letter,
  60-second `touch_job` lease heartbeat, **ids-only payloads**, sanitized
  errors.
- Current job kinds:
  `document.process`, `document.reindex`, `presentation.generate`,
  `presentation.export`, `whatsapp.connect|sync|push|disconnect`, `noop.test`.
- Planned: `google.sync`, `microsoft.sync`, `google.push`, later `gmail.scan`.
- Enqueue is server-only (`frontend/lib/data/jobs.ts` via the service-role
  client).

### 3.4 WhatsApp service

- Python workspace in `whatsapp/`, spawned by `backend/worker/whatsappJobs.mjs`.
- Two paths:
  - **Export** (hosted path): parse a WhatsApp chat export, detect event-like
    messages, write runs/messages/candidates.
  - **Live** (self-host only): Selenium + WhatsApp Web + phone QR; single-tenant.
- Review modes: **manual** (default; candidates await review on
  `/integrations`) and **automatic** (re-detected pending candidates are
  settled into `events`, deduped by `source_ref` fingerprint).
- Preferences: `date_order` DMY/MDY (message text), `detect_relative_dates`
  (conservative opt-in).
- Limits: one active run per user, 20 runs / rolling 24 h, 5,000 messages and
  500 candidates per run. Raw messages purge after 30 days, read-triggered.
- The worker host needs Python ≥ 3.11 and `whatsapp/requirements.txt`
  (`requirements-google.txt` for push; `requirements-live.txt` only for live).

### 3.5 Presenton

- Presentation generation runs through Presenton (`presenton-main/`), reached
  over HTTP at `localhost:5001` with `DISABLE_AUTH=true`.
- `presenton-ui/` is an optional re-themed fork on port 5002; when absent or
  crashed, the editor falls back to the engine's own editor.
- `npm run dev` starts it idempotently; failure only warns, and the
  presentation tool keeps its honest blocked state.

---

## 4. Auth architecture

### 4.1 Web

- Supabase Auth (email/password + Google OAuth).
- Sessions are cookies managed by `@supabase/ssr`; no tokens in `localStorage`.
- `proxy.ts` refreshes the session and protects `(app)` routes.
- Email flows use Supabase Auth templates (confirm sign-up, recovery, email
  change). **Production SMTP is not configured** — the single blocker is a
  verified sending domain. See `backend/EMAIL.md`.
- Google identity and Google Calendar are **separate grants**: signing in with
  Google does not connect Google Calendar.

### 4.2 Mobile

- `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken: true`,
  `persistSession: true`.
- Session storage: **`expo-secure-store` only**, with a chunked adapter
  (session JSON can exceed the per-entry limit). Never AsyncStorage for tokens.
- Deep links: scheme `unipilot`.
  - Supabase PKCE callback: `unipilot://auth-callback`.
  - Provider OAuth return (calendar): `unipilot://oauth/google` /
    `unipilot://oauth/microsoft`, only from our server callback after the token
    exchange.
- Local allow-list: `backend/supabase/config.toml` must include
  `unipilot://**` in `additional_redirect_urls`; restart the stack after edits.
  The hosted project's allow-list is untouched.
- The app is **sign-in-first**: no guest mode (approved product decision).
- Provider secrets never touch the device; the app never calls Google/Microsoft
  APIs directly.

#### The PKCE flow-id bug (M2b)

`exchangeCodeForSession` resolves the PKCE verifier by a **flow id**. On the web
that id comes from `window.location`; React Native has no `window.location`. The
id only reaches the app when the Supabase client appends `sb_flow_id` to the
redirect — gated behind `experimental.appendPkceFlowIdToRedirects` — and the app
parses it and passes `{ flowId }` to the exchange.

The M2b fix (`bb90168`) enables the flag and parses `sb_flow_id` in both
callback paths (in-app browser result and deep-link route). This is an
**auth-js implementation detail, not a stable API**: any
`@supabase/supabase-js`/`auth-js` bump must re-run the OAuth device legs before
being trusted.

---

## 5. Design system (web)

Authoritative doc: `DESIGN.md`.

- **Monochrome only.** No accent colour system.
- **Closed three-family type set:**
  - **Bricolage Grotesque** — major headings **and all action labels**
    (buttons, chips, segmented controls).
  - **Geist** — body UI, fields, navigation links.
  - **Geist Mono** — metadata, eyebrows, timestamps, monospace labels.
- Type scale: display 72 / headline-lg 48 / headline-lg-mobile 32 /
  headline-md 24 / body-lg 18 / body-md 16 / label-caps 12 / label-sm 13, with
  fixed weights, line-heights and tracking.
- Radius scale: Frame 32/24 → Card 20/16 → Nested 12 → Control 8 → Pill ∞.
- Four elevation recipes: Raised, Floating, Overlay, Flush. One elevation per
  surface; nested surfaces separate by fill + radius, not shadow.
- Three fills: Glass, Solid, Inverted, with a rationing rule.
- Fixed backdrop stack: base + ambient field + swappable motif (dotted grid on
  the app shell).
- Web tokens live in `frontend/app/globals.css`; `font.spec.ts` enforces the
  font rules.
- Mobile mirrors tokens in `mobile-app/src/theme/tokens.ts` with the web as the
  authoritative source (`mobile-app/src/theme/README.md`).

---

## 6. Motion

Authoritative doc: `MOTION.md`; shared primitives in
`frontend/components/motion/`; token mirror in `presets.ts`.

Rule (applies to every new animation):

> Motion.dev is UniPilot's primary animation library.
>
> 1. Inspect existing shared Motion primitives.
> 2. Reuse existing variants/transitions.
> 3. Choose animation based on the UI's purpose.
> 4. Avoid fade-only animation when a more meaningful Motion interaction is
>    appropriate.
> 5. Preserve reduced-motion behaviour.
> 6. Ensure animation never controls content existence.
> 7. Verify the result in Chromium.

- Ease: `cubic-bezier(0.23, 1, 0.32, 1)` (`--ease-out`); drawer ease
  `cubic-bezier(0.32, 0.72, 0, 1)`.
- Durations: 140 / 160 / 180 / 220 / 150 / 400 / 380 / 260 / 380 / 90 / 140 /
  720 ms. Staggers: 40 / 60 / 80 ms.
- CSS-only behaviours stay CSS: `press-feedback`, `hover-lift`,
  `action-arrow`, `icon-turn`, `[data-enter]`, `[data-collapsible]`.
- Reduced motion zeroes durations/translations while keeping every state change
  instant and all content rendered.

Mobile motion mirrors the same numbers in `mobile-app/src/motion/presets.ts`
(Reanimated/Moti). No page-specific animation systems.

---

## 7. Testing and QA

### Web

- Playwright suite: 33 specs (`frontend/tests/qa/`), `npm run test` at the root.
- The suite **builds and owns a production server**; stop any manual
  `npm run dev` first.
- QA identities (the only sanctioned sessions):
  - **QA1** `qa.unipilot@unipilot.test` — browser flows.
  - **QA2** `qa2.unipilot@unipilot.test` — isolation/onboarding proof.
  - Seed: `npm run seed:qa`; refuses non-local targets.
- Storage state: `frontend/.playwright/qa-session.json` (git-ignored).
- The founder account is **never** used for QA.
- Screenshots: `frontend/screenshots/` (git-ignored).

### Mobile

- `mobile-app`: Jest + `@testing-library/react-native` for logic/components;
  35/35 tests at the M2b diagnostic commit.
- Gates: `tsc --noEmit`, `expo lint`, Jest, a successful APK build, and the
  phase's device flow.
- The web Playwright suite **does not test the mobile app**; mobile green is not
  web evidence, and vice versa. Each phase gate runs both where relevant.
- Device evidence lives in `mobile-app/screenshots/` (git-ignored), named
  `<phase>-<flow>-<state>.png`; no tokens, passwords, QR payloads or raw chat
  exports in any capture.

---

## 8. The native mobile app

Plan: `mobile-app/plan.md` (approved 2026-09-30). It is the authority for
milestones, decisions and phase records.

### 8.1 Stack and architecture

- **Expo SDK 57**, React Native 0.86.3, React 19.2.3 (nested; the web pins
  19.2.8), TypeScript ~6.0.3, Expo Router.
- Supabase JS pinned exactly `2.112.3` to avoid moving web lockfile entries.
- Reanimated 4.5.1, Moti/Reanimated vocabulary, `expo-secure-store`,
  `expo-web-browser`, `expo-linking`, `expo-crypto`.
- Two and only two channels:
  1. **Direct Supabase** (auth + RLS-scoped reads/writes) with the user's JWT.
  2. **The Next.js server** (`/api/**`, existing or new) for provider secrets,
     OAuth exchanges, service-role writes and long-running jobs.
- Bearer auth for app endpoints: `Authorization: Bearer <access token>`,
  verified with `supabase.auth.getUser(token)` plus the onboarding gate.
  No cookies, no Server Actions, no request-Host origins.
- No service-role key or provider token ever ships on the device.
- Tab IA: **Calendar (default) · Tasks · More**. More holds Integrations,
  Settings and later tools.

### 8.2 Milestones

| Phase | Deliverable | Status |
| --- | --- | --- |
| **M0** | This plan; founder decisions (a)–(h) | ✅ approved 2026-09-30 |
| **M1** | Expo skeleton, tokens/fonts/motion mirror, tab shell, first EAS preview APK installed on the phone | ✅ complete 2026-09-30 |
| **M2** | PKCE sign-in (email/password + Google), secure session storage, native onboarding, profile, sign-out | M2a complete; **M2b in progress** |
| **M3** | Unified read-only calendar with source markers and honest blocked states | pending |
| **M4** | Provider sync server-side (migrations, `google.sync`/`microsoft.sync`, cursors, "Sync now") | pending |
| **M5** | Native event create/edit/delete, candidate confirm/reject | pending |
| **M6** | Google Calendar one-way push from the app | pending |
| **M7** | Final build + full device verification | pending |

Deferred by design: iOS, Play Store release, push notifications, offline write
queue, native password reset, document upload, assistant on mobile, live
WhatsApp from mobile, Gmail scan (blocked on Google verification/CASA).

### 8.3 Code layout (`mobile-app/src`)

```
app/                 Expo Router routes
  (auth)/sign-in.tsx
  (tabs)/index.tsx   Calendar
  (tabs)/tasks.tsx
  (tabs)/more.tsx
  auth-callback.tsx  PKCE deep-link callback
  onboarding.tsx
  specimen.tsx
auth/                AuthProvider, oauth.ts, authErrors.ts (+ tests)
components/          AppText, Button, Input, Surface, Notice, EmptyState, …
features/onboarding/ completeOnboarding.ts, OnboardingForm.tsx, validation.ts
features/specimen/   design-system specimen sections
lib/                 supabase.ts, secureStorage.ts, cryptoPolyfill.ts (+ tests)
motion/              presets.ts, MotionEnter, MotionNotice, pressFeedback,
                     useReduceMotion
theme/               tokens.ts, fonts.ts, ThemeProvider
```

### 8.4 Build and signing

- **EAS-managed keystore is the permanent app identity.** Certificate SHA-256
  begins `bc51cd50…`. Local builds can be signed identically when the keystore
  properties are supplied; the values are never printed or committed.
- The earlier local release APK was debug-signed (`CN=Android Debug`, SHA-256
  `fac61745…`) and therefore cannot be installed over an EAS build without
  uninstalling. The phone's installed app is never uninstalled; use
  `adb install -r` only with a matching signer.
- **EAS Build** is the primary path:
  `eas build -p android --profile preview` (`buildType: apk`).
- **Local Gradle** is the proven iteration path. Full recipe:
  - Worktree at the short, non-OneDrive path `C:\dev\up-mobile` (main checkout
    is under OneDrive; building there hit an endless CMake/ninja regeneration
    loop).
  - `JAVA_HOME=C:\Android\jdk-17`, `ANDROID_HOME=C:\Android\Sdk`.
  - CMake **3.30.5 only** (uninstall 3.22.1); NDK 27.1.12297006; Gradle 9.3.1.
  - Fresh `npm install`, purge `.cxx`/build dirs, build with `--no-watch-fs`.
  - `.\gradlew.bat assembleRelease` → `android/app/build/outputs/apk/release/`.
  - `eas build --local` is unsupported on Windows.
- Package id `com.unipilot.app`, scheme `unipilot://` — still **provisional**
  until the founder finalises the distribution identity (alternative
  `app.woid.mobile` / `woid://` remains available).
- `expo-doctor` passes 20/21; the one finding is the expected duplicate React
  (RN pins React 19.2.3 while the web pins 19.2.8). Metro resolves correctly;
  the EAS build and device runs are the proof.

### 8.5 M2b — current state (as of 2026-11-11)

M2b implements PKCE Google OAuth, the `unipilot://auth-callback` deep link, and
native onboarding. Code is committed (`6d7f20e`), the flow-id fix is
`bb90168`, and a **temporary diagnostic build** is `4f4ff51`
(`describeUrlParamNames` in `oauth.ts`, `[UNIPILOT_AUTH_DEBUG]` logs, and the
callback screen showing received parameter **names only**). Typecheck, lint and
35/35 Jest tests are green.

Device verification is a four-leg matrix:

| Leg | Scenario | State |
| --- | --- | --- |
| **A — WARM** | Fresh launch, app kept warm → browser sheet → account → consent → callback → session | **blocked / in progress** |
| **B — CANCEL** | User cancels the browser sheet | pending |
| **C — COLD** | App killed before the deep-link callback returns | pending |
| **Onboarding** | Fresh QA2 identity completes onboarding natively | pending |

**Evidence so far:**

- First phone attempt failed client-side: GoTrue never received `/token`. Root
  cause was the missing `sb_flow_id` (see §4.2), fixed in `bb90168`.
- Second phone attempt (fixed build) still failed: GoTrue `/authorize` carried
  `sb_flow_id`, but each attempt produced **two `/callback` hits** — one success
  and one `400: State has already been used` — with **no `/token` exchange**.
  `auth.sessions`/`refresh_tokens` for `lets.thryvee@gmail.com` stayed 0;
  `auth.flow_state` held 3 consumed PKCE flows, all with a code_challenge.
- Leading hypothesis: the browser (Brave on the phone) replays the GoTrue
  callback on app switch/resume, consuming/voiding the flow; the app then
  processes a parameterless callback. The diagnostic build exists to
  distinguish this from a verifier-storage bug.
- The decision rule for Leg A (recorded in the working plan):
  1. parameterless/error callback → implement the no-interception
     `openBrowserAsync` guard (ignore parameterless callbacks after a code was
     handled);
  2. code + state arrived but the exchange threw → verifier storage/lookup bug;
     do **not** implement that guard;
  3. Chrome single callback vs Brave double callback → Brave-specific replay;
     record it, still add the guard, note Brave as a known-replay environment.
- **No blind retries.** On failure, capture logcat parameter names only, GoTrue
  `/callback` and `/token` lines, and app state; record in `plan.md` §P; stop
  and report.

The current test environment is the **Android Studio emulator**, chosen after
the phone environment was swapped out:

- AVD `Pixel7_API36` — Pixel 7 profile, Android 16 / API 36
  (`google_apis_playstore`, x86_64), WHPX acceleration.
- Boot: `C:\Android\Sdk\emulator\emulator.exe -avd Pixel7_API36`; device id
  `emulator-5554`.
- After every boot: `adb -s emulator-5554 reverse tcp:54937 tcp:54937`; the app
  env points at `http://127.0.0.1:54937`.
- Chrome is the browser control; Play Store is present. Leg A needs the founder
  to sign in to the emulator's Play Store as `lets.thryvee@gmail.com` (the
  founder types the password; it is never echoed).
- The signed universal APK is installed and the app was confirmed signed out
  (`mobile-app/screenshots/m2b-emu-signed-out.png`,
  `m2b-emu-ready-nov4.png`). The environment was last verified 2026-11-04 and
  may need re-bring-up (stack, emulator, tunnel) before the next leg.

Phone environment (preserved, currently unplugged): Xiaomi M2101K6P
(`sweetin`, Redmi Note 10 Pro), Android 16 / SDK 36, MIUI. The diagnostic build
stays installed; **never uninstall** `com.unipilot.app`. MIUI killed the app in
the background; `RUN_ANY_IN_BACKGROUND allow` was set. Chrome was made the
default browser via adb role commands; **restore Brave** when returning to the
phone.

---

## 9. Local operations (this machine)

### Start the environment

```powershell
# One command from the repo root (WSL/Docker → Presenton → Supabase → worker → Next)
npm run dev

# Or manually:
wsl -d kali-linux -u root -e supabase start     # from backend/
npm run seed:qa                                  # QA1 + QA2
curl http://127.0.0.1:54937/auth/v1/health       # health probe (local anon key)
```

- `npm run dev` runs in PowerShell on the Windows host; from inside WSL the
  Linux `node_modules`/networking assumptions differ.
- Presenton: `http://localhost:5001` (`DISABLE_AUTH=true`).
- Next dev: `http://localhost:3000`.
- `npm run dev:web` starts Next alone (Windows host).

### WSL/Docker recovery

`Stop-Service WSLService` **deadlocks**. If WSL/Docker wedges:

```powershell
# kill the stuck invocation, then:
taskkill /F /IM wslservice.exe
Start-Service WSLService
```

The distro then boots with a harmless NAT → "Consomme" fallback warning. A
recorded recovery script lives at
`C:\Users\moham\AppData\Local\Temp\opencode\wsl-recover2.ps1`.

The Windows `winnat` reservation can stop port forwarding while the stack stays
healthy; check `netsh interface ipv4 show excludedportrange protocol=tcp` in an
elevated shell. That is why the API port is 54937. WSL2 MTU mismatches can stall
large responses — compare `ip link show eth0` / `docker0` before pinning Docker's
MTU.

### Inspect the local database

```powershell
wsl -d kali-linux -u root -e docker exec supabase_db_unipilot psql -U postgres -d postgres -t -A -c "select ..."
```

`auth.refresh_tokens.user_id` needs a `::text` cast in ad-hoc queries.

Local users include QA1, QA2, the founder's own `mdxareeb@gmail.com` (Google,
predates the mobile work; cleanup **held**, recommended keep), and the OAuth
test user `lets.thryvee@gmail.com`.

### Android device/emulator

```powershell
C:\Android\platform-tools\adb.exe devices
adb -s emulator-5554 reverse tcp:54937 tcp:54937
adb install -r <apk>          # installs over a matching signer
adb exec-out screencap -p > screenshot.png
```

Emulator quirks: Pixel Launcher may ANR ("isn't responding") — tap Wait/Close,
the app is unaffected. Snapshot quick-boot restores the app warm; the pid may
persist across sessions.

---

## 10. Known limits and external blockers

| Dependency | Affects | Status |
| --- | --- | --- |
| Verified sending domain + production SMTP | Auth email delivery | ❌ not configured; Supabase default shared SMTP |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | Google Calendar read/push, web + mobile | ❌ unset; honest blocked states |
| Azure app registration + tenant consent | Microsoft calendar/Teams sync | ❌ not created |
| Google verification + CASA | Gmail restricted scope | ❌ deferred; Gmail stays "not connected" |
| Hosted Supabase cutover | Production database | ⏸ prepared locally, not executed |
| Physical phone availability | M1–M7 device evidence | phone exists but is currently unplugged; emulator is the active environment |
| Final package id / scheme | First distribution build | ⏸ provisional `com.unipilot.app` / `unipilot://` |

Product limits by design: import is upsert-only (provider deletions don't
propagate); no cross-provider dedupe (rows shown with honest attribution);
polling/foreground refresh rather than webhooks; mobile is sign-in-first with
no guest mode.

---

## 11. Git and commit discipline

- Branch `master` is ahead of `origin` by roughly a dozen commits; **nothing has
  been pushed**.
- Mobile commits are scoped to `mobile-app/` (plus minimal root additions) and
  verified with a pathspec before committing. Unrelated dirty paths in the
  working tree are pre-existing and are never swept into a mobile commit.
- Current mobile history:
  - `6088f66` / `606e797` — M1 skeleton and EAS link
  - `db78d6d` / `97e501f` — M2a auth layer and no-env profile
  - `6d7f20e` — M2b PKCE OAuth, deep-link callback, native onboarding
  - `bb90168` — PKCE flow-id fix
  - `4f4ff51` — temporary callback parameter-name diagnostic
- The diagnostic build is temporary and must be removed in the build after
  Leg A; the removal is its own commit.

---

## 12. Open decisions / next actions

1. **M2b Leg A on the emulator** — the immediate blocker. Founder signs the
   emulator's Play Store in as `lets.thryvee@gmail.com`, then says "done".
   Re-bring-up the stack/emulator/tunnel first if needed.
2. Apply the 1/2/3 decision rule to Leg A evidence; record in `plan.md` §P;
   stop before implementing anything beyond the rule.
3. Then Legs B (CANCEL), C (COLD), and the QA2 onboarding leg — one at a time,
   founder go-between.
4. Remove the diagnostic build, capture light/dark + reduced-motion evidence,
   write the §P record, scoped commit, **stop for review**; M3 does not start
   without the founder's go.
5. Restore Brave as the default browser on the phone when phone work resumes.
6. Decide keep/delete for the founder's local `mdxareeb@gmail.com` account
   (recommendation: keep — it predates the mobile work and holds real data).
7. Finalise the package id / scheme before the first distribution build.

---

## 13. Where to read more

| Topic | Document |
| --- | --- |
| Product task history and rules | `TASK.md` |
| Design tokens, fonts, radius, elevation | `DESIGN.md` |
| Motion vocabulary and rules | `MOTION.md` |
| Web auth architecture | `AUTH_ARCHITECTURE.md` |
| Authenticated QA environment | `QA_SESSION.md` |
| Database schema, RLS, jobs, integrations | `backend/DATABASE.md` |
| Migration workflow | `backend/supabase/MIGRATIONS.md` |
| Auth email delivery | `backend/EMAIL.md` |
| WhatsApp service contract | `whatsapp/README.md` |
| Mobile plan, decisions, phase records | `mobile-app/plan.md` |
| Mobile build/signing/device recipes | `mobile-app/README.md` |
| Monorepo and environment operations | `README.md`, `AGENTS.md` |
| This snapshot | `context.md` |
