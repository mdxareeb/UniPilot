# UniPilot Authentication Architecture

Status: **Tasks 12.1–12.10 and 12.12 implemented (architecture, email/password auth, Google OAuth, login, signup, forgot-password, email verification, protected-route proxy, logout, loading/error/auth-state handling, email templates). Task 12.11 is documented but not configured — a custom SMTP provider needs a verified sending domain the project does not own. See [backend/EMAIL.md](./backend/EMAIL.md).**

> **Next.js 16 note:** `middleware.ts` is deprecated and renamed to **`proxy.ts`** (root-level, Node.js runtime by default). This document uses "proxy" throughout; there is no `middleware.ts` in this project.

## Selected architecture

**Supabase Auth** using the official `@supabase/ssr` package, integrated with the Next.js App Router.

- Provider: Supabase (hosted Postgres + built-in Auth)
- Libraries (to be added in Task 12.2, not now): `@supabase/supabase-js`, `@supabase/ssr`
- Methods: email/password + Google OAuth, both handled by Supabase Auth
- Session storage: cookies managed by `@supabase/ssr` (no localStorage tokens in the browser). Note: the library's default cookie options are `SameSite=Lax` and **not** `HttpOnly`, so the session cookie is readable by the browser client. Verified in Stage 1 A.2; changing the posture is a security decision, not done here.

## Why Supabase Auth

1. **Phase 14 plans Supabase as the backend** (Task 20: project, database, RLS, storage). Using Supabase Auth means the same identity drives both authentication and row-level security — no separate user table sync, no custom session layer.
2. **Covers all Task 12 requirements out of the box:** email/password, Google OAuth, email verification, password reset, session refresh, and logout — without building custom credential handling.
3. **App Router compatible:** `@supabase/ssr` is designed for Next.js server components, server actions, route handlers, and the root proxy.
4. **Secure defaults:** JWTs in HTTP-only cookies, server-side token exchange, RLS enforcement per authenticated user.
5. **Minimal infrastructure:** no extra auth service, no self-hosted identity provider, no token plumbing to maintain.
6. **Transactional email (Task 12.11–12.12):** Supabase can send verification/reset emails via its built-in SMTP, or route auth emails through a custom SMTP provider (e.g. Resend/SendGrid) configured in the Supabase dashboard. App-level templates can be added later without changing this architecture.

Alternatives considered and rejected:

- **Auth.js (NextAuth):** adds a second identity system that would need syncing with Supabase users/RLS; more moving parts for the same outcome.
- **Custom JWT/session auth:** unnecessary security burden; duplicates what Supabase provides.
- **Clerk/Auth0:** external identity disconnected from the planned Supabase database; extra vendor and cost.

## Authentication flow overview

1. User submits credentials (login/signup page) → Server Action calls the Supabase server client (`signInWithPassword`, `signUp`, or `signInWithOAuth` for Google).
2. `@supabase/ssr` exchanges the code/token and writes the session into HTTP-only cookies.
3. The root proxy (`createServerClient` in `proxy.ts` via `frontend/lib/supabase/proxy-session.ts`) refreshes the session on matched requests, keeping cookies valid and enforcing protected routes.
4. Server components read the user via the server client (`auth.getUser()`) and query data scoped by RLS to that user.
5. Logout: Server Action calls `signOut()`, cookies are cleared, user redirected to `/login`.

## Server/client responsibilities

**Server (default):**
- All auth calls happen in Server Actions, server components, and route handlers via a `createClient()` helper (`frontend/lib/supabase/server.ts`) that reads/writes cookies through `next/headers`.
- Session user is fetched server-side; never trusted from client input.

**Client (minimal):**
- Form state only (inputs, validation errors, loading states) in client components.
- Optional `@supabase/ssr` browser client (`frontend/lib/supabase/client.ts`) only if real-time auth-state listeners are needed later; not required for the core flows.
- No secrets, no service-role key, ever in client code.

## Session strategy

- JWT session persisted in `SameSite=Lax` cookies by `@supabase/ssr` (`HttpOnly` is the library's default **off**; verified Stage 1 A.2).
- Automatic token refresh handled by the proxy on matched routes, and by the server client (`frontend/lib/supabase/server.ts`) inside server components and Server Actions.
- No session data in `localStorage`; no client-accessible tokens.

## Protected-route strategy

Implemented in Task 12.8 as root `proxy.ts` (Next.js 16 replacement for `middleware.ts`).

### Narrow matcher scope

The proxy uses a **narrow matcher** — it runs only on the routes that need it, not on every request:

```
/tasks, /calendar, /documents, /assistant, /dashboard   (+ nested /:path*)   — matched, guest-viewable
/onboarding                                             (+ nested /:path*)   — protected
/login, /signup
```

Everything else — all `(marketing)` routes, `/forgot-password`, `/auth/callback`, `/auth/confirm`, `/reset-password`, static assets — never reaches the proxy. Consequences of that choice:

- The public site performs **zero** Supabase network calls, so marketing pages stay fast and keep working even when Supabase is unreachable or unconfigured.
- Auth callback/confirm routes are excluded deliberately: both are reached *with* a fresh session and perform their own redirect, so gating them would race the session write.
- `matcher` values must be **static literals** (Next.js analyses them at build time and ignores variables), so the list is duplicated in `proxy.ts` and **is a superset of** `PROTECTED_PREFIXES` in `frontend/lib/auth/constants.ts`. **A protected route must be added to both.**
- Since guests can browse the workspace, `PROTECTED_PREFIXES` contains **only `/onboarding`**. `/dashboard`, `/tasks`, `/calendar`, `/documents` and `/assistant` are guest-viewable: `isProtectedPath` returns false for them, so the proxy passes them through to render their guest states. They stay in the matcher because `updateSession()` is the only place a rotated Supabase refresh token can be written back — the Server Component client in `frontend/lib/supabase/server.ts` cannot set cookies during render and swallows the attempt — so removing them would leave a returning user with an expired access token rendering as a guest.
- `/onboarding` lives in the `(auth)` route group but requires a session, so it is listed as protected. Route groups do not appear in URLs — the matcher targets real pathnames, not groups.

### Behaviour

| Request | Session | Result |
| --- | --- | --- |
| `/onboarding` (protected route) | none/invalid | `307` → `/login?next=<intended-path>` |
| `/onboarding` (protected route) | valid | pass through (refreshed cookies attached) |
| `/dashboard`, `/tasks`, `/calendar`, `/documents`, `/assistant` | none/invalid | pass through — the page renders its guest state (real shell, empty states, no data read); using a surface opens the skippable sign-in prompt |
| `/dashboard`, `/tasks`, `/calendar`, `/documents`, `/assistant` | valid | pass through (refreshed cookies attached); unfinished students are sent to `/onboarding` by the page gate |
| `/login` or `/signup` **with** `?next=` | valid | `307` → sanitized `?next=` destination |
| `/login` or `/signup` **without** `?next=` | valid | renders normally — a deliberate visit is not bounced, so a "Sign in" link is never a dead end |
| `/login` or `/signup` | none | pass through (never gated — this is what prevents loops) |
| Any matched route | Supabase env missing | `/onboarding` → `/login` (fail closed); guest-viewable routes render their guest state |

### Guest-viewable workspace (0.17, extended to the app routes)

`/dashboard` has always been reachable without a session, because it is where "Open App" points from the marketing header and a visitor who follows it should arrive in the workspace rather than at a login form. The guest-browsing feature extends that posture to `/tasks`, `/calendar`, `/documents` and `/assistant`: a visitor can see the real surfaces with honest empty states, but cannot use them.

- Each page reads `getWorkspaceAccess()` (`frontend/lib/onboarding/gate.ts`): no session → `null` (the guest render); signed in + onboarding incomplete → `/onboarding`; signed in + complete → the user, and the page loads real data exactly as before.
- A guest render calls **no data service at all**: `/dashboard` reads no profile, `/tasks` passes an empty list (its `?task=` detail resolver is skipped client-side), and the calendar/documents/assistant surfaces read nothing because there is nothing to read yet. The `anon` role is revoked, so a guest query would fail — the design never issues one.
- Using a surface opens one shared skippable prompt (`frontend/components/auth/SignInPrompt.tsx`, state in `SignInPromptProvider.tsx`, mounted once in `(app)/layout.tsx`): a short reason, primary "Sign in" → `/login?next=<current path>` (validated by `sanitizeRedirectPath`), secondary "Continue browsing" that closes. Escape, the close button and the backdrop dismiss it. Nothing is persisted and no redirect happens.
- The guest flag streams from a server boundary (`SignInPromptSession`, the `SidebarUser` shape) so the layout stays synchronous; every interactive control (`New task`, edit/delete/drag, calendar Add event, document upload, assistant send, global search/launcher) calls `requireAuth()` before acting and never invokes a mutation action for a guest.
- The hard server-side gate is unchanged: every task Server Action still calls `requireOnboardedUser` first, so the prompt is UX and the action remains the fallback. RLS stays the final layer.
- The workspace chrome reads the memoized viewer. The rail's plan panel renders nothing without a session (a tier is a claim about an account), and the user chip has three states: a name, signed-in-without-a-name, and `Guest` + "Not signed in" with sign-in in the slot sign-out occupies.
- `/dashboard` and the four workspace routes are consequently crawlable, which the site-wide robots configuration (Task 43.6) has to decide about.

### Redirect-destination safety

`sanitizeRedirectPath()` (`frontend/lib/auth/redirects.ts`) is the single validator used by both the proxy and the login page. A `next` value is accepted only if it is a single-slash relative path; anything else falls back to `/dashboard`:

- rejected: protocol-relative (`//evil.com`), backslashes (`\\evil.com`), absolute URLs, C0 control characters/DEL, non-string values
- rejected: any public auth path (`/login`, `/signup`, `/forgot-password`, `/auth/callback`, `/auth/confirm`, `/reset-password`) — this is what makes `?next=/login` unable to bounce

On successful **email** login the client honours that validated destination instead of always forcing `/dashboard`. Google OAuth still lands on `/auth/callback` → `/dashboard`; carrying `next` through the OAuth roundtrip is not implemented.

### Cookie preservation

`updateSession()` builds the response that carries any refreshed Supabase cookies. When the proxy redirects instead of continuing, `withSessionCookies()` copies those `Set-Cookie` headers onto the redirect response so a token refresh (or the clearing of an invalid token) is never lost.

### Defence in depth

The proxy is a UX guard and first line of defence only. Because Server Functions POST to the route where they are used, a matcher exclusion also skips them — so **every server component and Server Action must still verify the user server-side** before reading or writing data, with RLS as the final enforcement layer at the database.

### Server-side guard matrix (Task 14.11)

Every app surface was inventoried and probed against the running app. "Guard"
means the server check the surface performs itself, never the proxy.

| Surface | Class | Server guard |
| --- | --- | --- |
| `/tasks`, `/calendar`, `/documents`, `/assistant` | **Guest-viewable** (0.17 extended) | `getWorkspaceAccess()`: guest → real shell + empty states, **no data read**, actions open the shared skippable prompt; signed-in + incomplete → `/onboarding`; complete → real data as before |
| `/onboarding` | Protected (session, loop-free) | `requireUnfinishedOnboarding()`; completed → `/dashboard` |
| `/dashboard` | Authenticated, **public by design** (0.17) | `sessionUser()` (never throws/redirects); per-user reads behind RLS; guests render the guest state |
| `/login`, `/signup`, `/forgot-password` | Public by design | None. Inputs validated in the forms and in the actions; failures mapped to `frontend/lib/auth/errors.ts` copy |
| `/(auth)/auth/confirm` | Public by design | None — the token arrives in the email link and the client sets the session |
| `/(marketing)/*` and `/specimen` | Public by design | None; no Supabase import on the public site |
| `GET /auth/callback` | Public by design | `code` required; PKCE exchange via the SSR cookie client; opaque notice redirects only |
| `frontend/lib/auth/actions.ts` — `signInWithEmail`, `signUpWithEmail`, `requestPasswordReset`, `signInWithGoogle` | Public auth flows | Input validation + sanitized error mapping; absolute redirect targets from `getTrustedSiteOrigin()` |
| `frontend/lib/auth/actions.ts` — `signOut` | Authenticated, session-scoped | No `requireUser`: it clears only the caller's own cookies and redirects to `/login`; writes no application data |
| `frontend/lib/data/taskActions.ts` — task create/update/delete/status/detail | Mutating | `requireOnboardedUser("/tasks")` before the try block (so a guest or unfinished student cannot use an action as a side door); payload re-validated; RLS-scoped writes; sanitized failure copy |
| `frontend/lib/data/onboardingActions.ts` — `completeOnboardingAction` | Mutating | `requireUser` **before** the try block (so the redirect throws); payload re-validated/re-mapped; atomic RLS-scoped write; sanitized failure copy |

No other `"use server"` module and no other Route Handler exists (`frontend/app/auth/callback/route.ts` is the only one). The proxy matcher itself is guarded at module load: `assertMatcherCoversProtectedRoutes()` (`frontend/lib/auth/redirects.ts`) throws unless every `PROTECTED_PREFIXES` entry and its `/:path*` form is present in `proxy.ts`'s static matcher; `frontend/tests/qa/auth-guards.spec.ts` asserts it and proves it fails on a deliberate omission.

### Redirect-origin finding (Task 14.11)

- **Finding:** `frontend/app/auth/callback/route.ts` built every redirect as `${origin}${path}` with `origin = new URL(request.url).origin`, and the auth actions built Supabase redirect targets (signup confirmation, recovery, OAuth) from the request `Origin`/`Host` headers. Those are caller-controlled: a non-browser client can send any `Host`, and Next itself copies the incoming `Host` into `x-forwarded-host` (`base-server.js`), which URL construction reads in self-hosted/`next start` deployments. On an origin that did not normalize the header, that is an open-redirect and a token-phishing path (a confirmation link pointing at another host), fenced only by Supabase's redirect allow-list.
- **Observed on the local stack:** `curl -H "Host: evil.example" http://localhost:3000/auth/callback` returned the same-origin `Location` because the dev server derives `request.url` from its bind host; the code path still trusted a request-derived origin, so the fix is structural, not repro-dependent.
- **Fix 1 — callback:** redirects are now same-origin relative (`sameOriginRedirect`), so there is no origin to forge: the browser resolves `Location: /login?error=oauth` against the URL it requested. Verified: both `-H "Host: evil.example"` and `-H "X-Forwarded-Host: evil.example"` return `Location: /login?error=oauth`, and a browser follows it to the sanitized notice copy. Next merges the PKCE session cookies onto the returned response, so the exchange is unaffected.
- **Fix 2 — actions:** `frontend/lib/auth/origin.ts`'s `getTrustedSiteOrigin()` uses `NEXT_PUBLIC_SITE_URL` when configured, accepts a loopback Host only in local development, and otherwise throws — the action turns that into its sanitized failure and no mail is sent. `NEXT_PUBLIC_SITE_URL` is documented in `frontend/.env.example` and `frontend/.env.development.local.example`.
- **Proxy redirects were already safe:** `Location: /login?next=%2Ftasks` is emitted relative by Next for middleware redirects, forged Host included, so `/dashboard`/protected-route bounces never involve an origin.

### 14.11 verification (monorepo + MCP Chromium)

Re-audited after the app moved to `frontend/`, with the Playwright MCP
(Chromium, isolated) against the local stack and with the committed suite:

- **Unauthenticated, MCP:** `/tasks`, `/calendar`, `/documents`, `/assistant`,
  `/onboarding` and a nested probe (`/tasks/nested-probe`) each landed on
  `/login?next=<exact relative path>` — never an absolute or external target —
  with a snapshot and screenshot per state and
  `browser_console_messages level:error` empty on each.
- **Public surfaces, MCP:** `/dashboard` returned 200 and rendered the guest
  state (`GuestCallout` with "Create your workspace"); `/auth/callback`
  without `code` redirected to `/login?error=oauth` and rendered the sanitized
  "Google sign-in could not be completed." notice — no crash, no provider text.
- **Authenticated control, MCP:** a context restored from the committed QA
  storage state (`frontend/.playwright/qa-session.json`) reached `/tasks`,
  `/calendar`, `/documents` and `/assistant` (200, correct `h1`s) and was
  bounced from `/onboarding` to `/dashboard`; reruns were console-clean.
- **Committed suite:** `frontend/tests/qa/auth-guards.spec.ts` (6 tests) is the
  repeatable Chromium proof of the same matrix, including the matcher guard's
  deliberate break; `npm run test` from the root is 70/70, and
  typecheck/lint/build pass.
- **Observation (recorded, not a guard gap):** the first authenticated request
  in a fresh context after the storage-state access token had expired produced
  one fail-closed error-boundary render on `/tasks` (`getOnboardingState` read
  error while the session refreshed) — no data rendered, no redirect, nothing
  served to an unauthenticated caller. It did not reproduce (3/3 clean
  immediately after; the QA fixture's validation pass normally absorbs the
  expired-token case before the suite runs).

## Environment variables

Configured per environment; the committed templates are `frontend/.env.example` (hosted)
and `frontend/.env.development.local.example` (local stack). `.env*.local` stays
gitignored.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (safe for client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (safe for client; RLS enforces access) |
| `NEXT_PUBLIC_SITE_URL` | The app's own public origin (Task 14.11). Builds absolute Supabase redirect URLs without trusting request headers; required outside local development, optional on loopback |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin key (never exposed to client; used only by the QA seed/isolation spec) |

## Relation to future profile data

- `auth.users.id` (Supabase) is the single source of identity.
- The planned `profiles` table (Task 20.6) uses `id uuid references auth.users` as primary key, created via trigger or on first login/onboarding.
- All other tables (`subjects`, `tasks`, `events`, `documents`, `conversations`, `notifications`, `subscriptions`) reference `profiles.id` / `auth.users.id` and are locked down with RLS policies (`auth.uid() = user_id`).
- Onboarding data (Task 12.x / Phase 14) writes to `profiles` for the authenticated user only.

### Onboarding persistence (Task 13.10) — implemented

**Status: implemented (2026-09-11).** Onboarding's answers are persisted through
the `complete_onboarding` Postgres function (security invoker: atomic profile
upsert + subject replacement + completion stamp), called by
`completeOnboardingAction` in `frontend/lib/data/onboardingActions.ts`. `/tasks`,
`/calendar`, `/documents` and `/assistant` gate on
`profiles.onboarding_completed_at` via `frontend/lib/onboarding/gate.ts`, and
`/dashboard` reads the persisted profile + subjects for signed-in students.
`Skip for now` writes nothing and never stamps completion. The rest of this
section is the pre-20.6 analysis that proposed the mapping; its alternative
hosted shape (`full_name`, `preferences` jsonb) was resolved by Task 20.6's
ratified schema (backend/DATABASE.md), not adopted.

A `profiles` table **does** exist on the hosted project, with RLS enabled and a
trigger that provisions one row per `auth.users` entry (verified: 4 auth users, 4
matching rows, identical id sets). Its live columns are exactly:

```
id uuid PK · full_name text · college text · program text · semester text
timezone text (default 'UTC') · preferences jsonb · created_at · updated_at
```

That is not the architecture 13.10 requires. Verified read-only against the live
project — `42703 column does not exist` for each of `onboarding_completed_at`,
`academic_year`, `planning_style`, `reminder_lead`, with `semester` and
`preferences` returning `200` as controls:

- **No onboarding-completion marker** anywhere — not on any of the 9 tables, not in
  `preferences` (which is `{}` on every existing row), not in auth user/app
  metadata. This is 13.10's entire subject: "store completion status", "skip must
  not mark complete", and "future sessions can determine completion" are each
  unsatisfiable without it.
- **No home for `academicYear`**, which is a required, validated answer. A flow
  that refuses to advance past a field and then discards it would make the UI a lie.
- **No home for `planningStyle` / `reminderLead`** as modelled data.

The only zero-DDL path is inventing a `preferences` jsonb key convention. Task 20.6
lists `profiles` as a bare table name with **no columns specified**, so where
completion lives is a decision 20.6 still owns; settling it from a UI task would be
persistence that Phase 14 then replaces. DDL is also unreachable from the repo
environment: no `DATABASE_URL` or database password, no Supabase CLI/`psql`/Docker,
no `~/.supabase` token, and the Management API rejects both project JWTs.

Proposed mapping — **open questions, not settled schema.** 20.6 decides:

| Onboarding field | Proposed destination | Open question |
| --- | --- | --- |
| `firstName` + `lastName` | `full_name` | Lossy concat into one column. `frontend/lib/auth/displayName.ts` already reads "first word of a full name", but two separately validated fields cannot be recovered from it. Two columns may be better. |
| `institution` | `college` | Name mismatch only. |
| `courseProgram` | `program` | Name mismatch only. |
| `semester` | `semester` (`text`) | Store the display string (`"Semester 1"`) or a code? |
| `academicYear` | **undecided** — needs a 20.6 column | `text` or enum? |
| `planningStyle`, `reminderLead` | **undecided** | `preferences` jsonb is defensible for genuine preferences, but the key contract must be 20.6's to define. |
| `subjects` | `subjects` table (`user_id` → `profiles.id`) | Multi-row insert with no transaction primitive over PostgREST — decide partial-failure behaviour. |
| completion | **undecided** — proposed `onboarding_completed_at timestamptz null` | A nullable timestamp makes "skip" simply "stays `NULL`" and records *when*; a boolean records neither. |

Proposed DDL — **not applied. Recorded for Task 20.6, not authored by this task:**

```sql
-- PROPOSED for Task 20.6. NOT APPLIED to any environment.
alter table public.profiles
  add column onboarding_completed_at timestamptz,
  add column academic_year text,
  add column planning_style text,
  add column reminder_lead text;
-- Also confirm: RLS UPDATE policy on profiles (using/with check auth.uid() = id)
-- and an INSERT policy on subjects for user_id = auth.uid(). RLS is confirmed
-- ENABLED, but policies cannot be enumerated read-only, so "enabled with SELECT
-- only" and "enabled with no write policy" are indistinguishable from here.
```

Note this schema already defines six enums elsewhere, so choosing `text` for
`semester`/`academic_year` now means a later migration must *parse* stored display
strings rather than move them.

Because nothing persists yet, `finish()` and `skip()` in `OnboardingFlow.tsx` are
deliberately separate call sites that both reach `/dashboard` (Task 13.9). That seam
is where the two paths diverge once a completion marker exists: `finish` stamps it,
`skip` must not.

Task 14.1.1's optional-onboarding posture applied before a completion marker
existed. Task 13.10 superseded the no-gate decision: an unfinished signed-in
student is redirected into `/onboarding` from the workspace routes, and a
completed one who opens `/onboarding` is sent to `/dashboard`. Email signup,
`/auth/confirm` and `/auth/callback` still land on `/dashboard` (the guest-aware,
public route), and the sidebar's `frontend/components/app/WorkspaceSetupLink.tsx` plus
`/dashboard`'s `frontend/components/app/FinishSetupAffordance.tsx` are the visible ways
back into the flow; both hide themselves once the completion marker is set
(Task 14.10), so the offer exists exactly while it is true.

## Integration points for Tasks 12.2–12.12

| Task | Plan |
| --- | --- |
| 12.2 Email/password auth | Install `@supabase/supabase-js` + `@supabase/ssr`; create `frontend/lib/supabase/server.ts` and `client.ts`; Server Actions for `signUp`/`signInWithPassword` |
| 12.3 Google auth | **Done.** `signInWithGoogle` Server Action (`signInWithOAuth`, scopes `openid email profile`) + `/auth/callback` route handler exchanging the code for a session |
| 12.4 Login page | Build out existing placeholder `frontend/app/(auth)/login/page.tsx` |
| 12.5 Signup page | Build out existing placeholder `frontend/app/(auth)/signup/page.tsx` |
| 12.6 Forgot password | `resetPasswordForEmail` + reset route using Supabase recovery link |
| 12.7 Email verification | **Done.** Supabase confirmation email redirects to `/auth/confirm`, which handles both shapes a project can send: the implicit-flow `#access_token=` fragment (the hosted project's behaviour) is parsed on the client and passed to `setSession`; a PKCE `?code=` (the local stack's behaviour, and any project configured for PKCE) is forwarded to the server `/auth/callback` route, which owns the code exchange. Invalid/expired links show a clean error state. |
| 12.8 Protected-route proxy | **Done.** Root `proxy.ts` (Next 16 rename of `middleware.ts`) with a narrow matcher, `@supabase/ssr` session refresh, `?next=` preservation, and cookie forwarding on redirects |
| 12.9 Logout | **Done.** `signOut` Server Action (`supabase.auth.signOut()` → `revalidatePath("/", "layout")` → `redirect("/login")`); reusable `LogoutButton` mounted on `/dashboard` |
| 12.10 Loading/error/auth states | **Done.** Per-page `requireUser()` server checks on every protected route; `frontend/lib/auth/errors.ts` as the single copy source; `(auth)`/`(app)` error boundaries and an `(app)` loading fallback; pending-locked controls across every auth submission |
| 12.11 Transactional email provider | **Architecture documented, provider not configured.** See [backend/EMAIL.md](./backend/EMAIL.md). Blocked on a verified sending domain, which the project does not own; the hosted project still uses Supabase's default SMTP. No app-code change is required when the provider is added — custom SMTP is entered in the Supabase dashboard |
| 12.12 Email templates | **Done.** [`backend/supabase/templates/`](./backend/supabase/templates/) holds `confirmation.html` and `recovery.html` (installed in the dashboard, or via `content_path` in `backend/supabase/config.toml` locally) plus a `welcome.html` that nothing sends yet — Supabase Auth has no welcome template or trigger. See [backend/supabase/templates/README.md](./backend/supabase/templates/README.md) |

## Security considerations

- Service-role key only in server-only modules; never imported by client components or the proxy. The proxy uses the public anon key exclusively.
- RLS enabled on every table; policies scoped to `auth.uid()`.
- Session cookies are `SameSite=Lax` and — per `@supabase/ssr`'s default options — readable by the browser client (not `HttpOnly`); no tokens are kept in `localStorage`. Correcting the cookie to `HttpOnly` is an open security decision, deliberately not taken in the A.2 verification pass.
- Server Actions validate the session before any mutation.
- No redirect target is built from request headers (Task 14.11): the auth callback answers same-origin relative `Location`s and the auth actions use `getTrustedSiteOrigin()` (`NEXT_PUBLIC_SITE_URL`, loopback-only fallback) — see the 14.11 finding under *Defence in depth*.
- Every app route and Route Handler carries its own server-side guard (matrix above); the proxy's duplicated matcher is asserted against `PROTECTED_PREFIXES` when the module loads.
- Google OAuth redirect URLs allow-listed in Supabase dashboard.
- Rate limiting for auth endpoints provided by Supabase; add app-level validation (input sanitization, error message uniformity) in later tasks.
- Email verification enforced before granting full app access (decided in Task 12.7).

## Explicitly NOT implemented yet

- No custom email provider configured (12.11 documented the architecture and the blocking prerequisite; the 12.12 templates are written but are not installed on the hosted project)
- No welcome email send path — Supabase Auth has no welcome trigger, so `welcome.html` is a ready template with nothing sending it
- No password reset page (`/reset-password` route is planned; only the request flow exists — it is already listed as a public auth path so the proxy will not gate it once built)
- No `next` propagation through the Google OAuth roundtrip (OAuth always lands on `/dashboard`)
- No mock/fake auth state anywhere

## Implemented so far (Tasks 12.2–12.10, extended through 13.10/14.10/14.11)

- `frontend/lib/supabase/config.ts` — env access + `isSupabaseConfigured()` guard
- `frontend/lib/supabase/server.ts` — cookie-based server client (`@supabase/ssr` + `next/headers`)
- `frontend/lib/supabase/client.ts` — browser client (public credentials only)
- `frontend/lib/supabase/proxy-session.ts` — proxy session refresh (`updateSession()` → `getUser()` + cookie bridging) and `withSessionCookies()` for redirect responses; anon key only
- `frontend/lib/auth/constants.ts` — shared route constants (`/auth/callback`, `/auth/confirm`, `/dashboard`, `/reset-password`) plus the route lists `PROTECTED_PREFIXES`, `PUBLIC_AUTH_PATHS`, `AUTHENTICATED_REDIRECT_PATHS`, `REDIRECT_PARAM` (`next`), and the failure destinations `AUTH_ERROR_REDIRECT` / `VERIFICATION_ERROR_REDIRECT` (derived from the notice codes in `frontend/lib/auth/errors.ts`)
- `frontend/lib/auth/errors.ts` — single source of user-facing auth copy plus the opaque `?error=` notice codes (`oauth`, `verification`, `session`) and `authNoticeMessage()`; imported by the actions, the login page, the signup form and `/auth/confirm`, so one failure reads the same way everywhere and unknown codes render nothing. Deliberately free of `@supabase/supabase-js` imports so client components can use it without bundling the SDK
- `frontend/lib/auth/session.ts` — server-side session reads: `getSessionUser()` (never throws; distinguishes "no session" from "no verdict possible") and `requireUser(intendedPath)` (redirects to `/login?next=<sanitized>&error=session`)
- `frontend/lib/auth/viewer.ts` — `sessionViewer()`, the request-memoized read the workspace renders from: `{ signedIn, name? }` and nothing else, so a page or a piece of chrome never handles an id, an email or provider metadata. Composition of `getSessionUser()` and `sessionFirstName()`; used by `/dashboard`, the sidebar user chip and the plan panel, which resolve from one `getUser()` round trip
- `frontend/lib/auth/redirects.ts` — `isProtectedPath` / `isPublicAuthPath` / `isAuthenticatedRedirectPath` and `sanitizeRedirectPath()`, shared by the proxy and the login page
- `frontend/lib/auth/actions.ts` — Server Actions `signInWithEmail` / `signUpWithEmail` / `requestPasswordReset` with sanitized error mapping; `signInWithGoogle` (OAuth, scopes `openid email profile`, redirects to `/auth/callback`); `signOut` (clears the session, invalidates cached authenticated payloads, redirects to `/login`)
- `frontend/components/auth/LogoutButton.tsx` — reusable client control posting to `signOut` via a real `<form>`; shows a pending label and a sanitized failure message, mounted on `/dashboard` until the authenticated shell exists (Task 14.1)
- `proxy.ts` — root protected-route proxy with narrow static matcher (see Protected-route strategy)
- `frontend/app/auth/callback/route.ts` — exchanges OAuth PKCE code for session via existing SSR cookie client; success → `/dashboard`, failure → `/login?error=oauth` (or `?error=verification` for the signup flow). The provider's own error text is never forwarded
- `frontend/app/(auth)/auth/confirm/page.tsx` — email-verification landing page (implicit-flow fragment → `setSession` → `/dashboard`; invalid/expired → clean error state)
- `frontend/app/(auth)/error.tsx`, `frontend/app/(app)/error.tsx` — error boundaries rendering sanitized copy, a `retry()` action, and `error.digest` only (never `error.message`, a stack trace, or session detail)
- `frontend/app/(app)/loading.tsx` — streamed fallback while a page under `(app)` reads the session; the read lives per-page rather than in `(app)/layout.tsx` because runtime data read in a layout blocks navigation instead of showing this fallback
- The guest-viewable pages each run `getWorkspaceAccess()` as their own server guard: a guest renders the real shell with empty states and no data read, an unfinished signed-in student is redirected to `/onboarding`, a completed one loads data. `/onboarding` calls `requireUnfinishedOnboarding()`. The Server Actions keep `requireOnboardedUser` as the hard fallback, because Server Functions POST to the route they are used on and so bypass the proxy's matcher. `/dashboard` keeps its original public design
- `frontend/components/auth/SignInPromptProvider.tsx` + `SignInPrompt.tsx` + `SignInPromptSession.tsx` — the one shared skippable sign-in prompt and its streamed guest flag, mounted by `(app)/layout.tsx`; every guest action path calls `requireAuth()` before acting (New task, edit/delete/drag, calendar Add event, document upload, assistant send, search/launcher)
- `frontend/lib/onboarding/gate.ts` — `getWorkspaceAccess()` (guest-aware workspace gate), `requireOnboardedUser` / `requireUnfinishedOnboarding` (13.10, actions + /onboarding) and `sessionNeedsSetup()` (14.10), the single visibility condition for the persistent setup affordances
- `frontend/lib/data/onboarding.ts` + `frontend/lib/data/onboardingActions.ts` — the server-only read/save data layer and the mutating Server Action (`requireUser` before the try, validated payload, atomic RPC, sanitized errors)
- `frontend/lib/auth/origin.ts` — `getTrustedSiteOrigin()`: configured/loopback origin for absolute Supabase redirect URLs, never the request headers (14.11)
- `frontend/tests/qa/auth-guards.spec.ts` — the committed guard matrix: guest-viewable workspace routes, the `/onboarding` bounce, public dashboard, callback notices, authenticated control, and the proxy-matcher guard with a deliberate break. `frontend/tests/qa/guest-browsing.spec.ts` proves the guest states, the skippable prompt (Continue browsing / Sign in → `/login?next=`), and that a guest page issues no data read
- Auth UI: `/login`, `/signup`, `/forgot-password` under the shared `(auth)` layout; `/login` reads and validates `?next=` and passes it to `LoginForm` as `redirectTo`, and maps `?error=` to copy server-side so the client only receives finished strings
- Submission state: every auth form disables its controls and sets `aria-busy` while pending, and stays locked through the follow-up navigation. `AuthOptions` also cross-locks the two flows on a page — Google and email are separate forms, and two attempts in flight would race for the same session cookie
- Dependencies: `@supabase/supabase-js`, `@supabase/ssr`

### Google OAuth configuration (verified live)

- Google provider is enabled on the hosted Supabase project with valid Google Cloud credentials (configured in Supabase dashboard; no secrets in this repo). The **local** stack is configured too (2026-09-13): the authorize endpoint returns `302 → accounts.google.com`; see the local runbook below. The full consent roundtrip has still never been completed locally (it needs a consented test identity), so 12.3 remains `[~]` on that point.
- Supabase authorize endpoint accepts `http://localhost:3000/auth/callback` as redirect target.
- For production, add the deployed site's `https://<domain>/auth/callback` and `https://<domain>/auth/confirm` to the Supabase project's **Redirect URLs** allowlist.
- Post-auth destination is `/dashboard` (existing placeholder route; becomes the real authenticated landing in Phase 14).

#### Local Google OAuth — configured and provider-verified (2026-09-13)

The local GoTrue now serves the Google provider. `GET
/auth/v1/authorize?provider=google` (local anon key) returns `302` to
`https://accounts.google.com/o/oauth2/v2/auth` carrying the client id below,
`redirect_uri=http://127.0.0.1:54321/auth/v1/callback` and
`scope=email profile`; the recreated auth container reports
`GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`, `GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK=true`
and a non-empty secret (value never printed). Live browser check: `/login` →
Continue with Google reached Google's sign-in page with zero console errors and
no `redirect_uri_mismatch`.

```toml
# backend/supabase/config.toml (git-ignored, machine-local)
[auth.external.google]
enabled = true
client_id = "337856140334-52mvfgfihnkvd9itr93hbpp3qef6v160.apps.googleusercontent.com"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
# Required for local sign-in: GoTrue cannot validate the Google ID token's
# nonce while it is reached on 127.0.0.1. Hosted keeps the dashboard-managed
# provider and does not need this flag.
skip_nonce_check = true
```

- Secret provisioning: export `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the
  **same WSL shell** that runs `supabase stop && supabase start`; the CLI
  substitutes `env()` values from the process environment (or a git-ignored
  project env file) and fails fast when the variable is unset. `supabase start`
  on an already-running stack is a silent no-op — the stack must be stopped
  first or GoTrue never receives the provider.
- App-level redirect allow-list (already set in A.2): `site_url =
  "http://localhost:3000"` and `additional_redirect_urls` includes
  `http://localhost:3000/**` and `http://127.0.0.1:3000/**`, so the roundtrip
  returns to `/auth/callback` and the app lands on `/dashboard`.
- Google Cloud (on the OAuth client matching the id above): Authorized
  redirect URIs must include `http://127.0.0.1:54321/auth/v1/callback` and
  `http://localhost:54321/auth/v1/callback` alongside the hosted callback; the
  consent screen stays in **Testing** and the roundtrip account must be a Test
  user.
- Provider-only verification (repeatable):

```sh
curl -sS -D - -o /dev/null \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "http://127.0.0.1:54321/auth/v1/authorize?provider=google" | head -1
# expect: HTTP/1.1 302 Found
```

- End-to-end roundtrip: `[~]` — `/login` → Continue with Google reaches
  Google's sign-in/consent page (evidence:
  `frontend/screenshots/google-local-02-google-signin.png`), but no consented
  test identity is available to this agent, so Google → Supabase
  `/auth/v1/callback` → app `/auth/callback` → `/dashboard` has not been
  observed locally. Complete it once in a browser signed in as the test user;
  until then 12.3 stays `[~]` — do not mark it `[x]`.

### Email verification notes (verified live)

- The **hosted** project's email confirmation redirects with the **implicit flow** (`#access_token=...` fragment), even when signup is initiated from the PKCE server client. Fragments are never sent to the server, so verification lands on the client-side `/auth/confirm` page.
- The **local stack** sends the **PKCE** shape instead: the link redirects to `/auth/confirm?code=...`, which the page forwards to `/auth/callback` for the server-side exchange (Stage 1 A.2 verified this end-to-end: signup → Mailpit → `/auth/confirm` → `/dashboard` with a session).
- `signUpWithEmail` sets `emailRedirectTo` to `/auth/confirm`; the confirmation state on `/signup` remains unchanged.
- Email delivery still depends on Supabase's default SMTP (rate-limited on the free plan). A custom provider is architected but not configured — see [backend/EMAIL.md](./backend/EMAIL.md).

## Email delivery

Full configuration contract, provider settings, DNS requirements and template
variables live in **[backend/EMAIL.md](./backend/EMAIL.md)**. The essentials:

- **Never trigger real auth emails against the hosted project during development.** Its default SMTP is rate-limited and mail to invented addresses bounces. Run local Supabase, which catches all mail in its own inbox — no SMTP configuration needed, and no real email leaves the machine.
- **Two emails matter to this app today:** signup confirmation (`emailRedirectTo` → `/auth/confirm`) and password recovery (`redirectTo` → `/reset-password`, a route that does not exist yet).
- **Production is not configured.** The blocking prerequisite is a verified sending domain, which the project does not own. Custom SMTP goes in the Supabase dashboard, never in this repo — so no application code changes when it is added.
- **Environment separation:** `frontend/.env.local` → hosted Supabase; `frontend/.env.development.local` → local Supabase (`npm run dev` loads it first). Both are gitignored; only the `*.example` templates are tracked.

