# Auth email delivery

Supabase Auth sends every transactional email this app relies on. This document
is the configuration contract for that delivery: which emails exist, where they
go in development, what production needs, and what is still missing.

> **Status — production SMTP is NOT configured.**
> The hosted project still sends auth email through Supabase's default shared
> SMTP. The single blocking prerequisite is a **verified sending domain**, which
> the project does not own yet. Nothing in this document has been proven by a
> delivered production email. See [Blocking prerequisites](#blocking-prerequisites).

Supabase Auth remains the authentication system throughout. A transactional
provider only carries the message — it never issues, validates or stores a
token, and no part of this setup introduces a second auth system.

## What Supabase actually sends for this app

Three templates are reachable from the implemented flows:

| Email | Triggered by | Lands on |
| --- | --- | --- |
| Confirm sign up | `signUpWithEmail` → `supabase.auth.signUp({ options: { emailRedirectTo } })` | `/auth/confirm` |
| Reset password | `requestPasswordReset` → `supabase.auth.resetPasswordForEmail({ redirectTo })` | `/reset-password` — **route not built yet** |
| Change email address | Not wired to any UI yet; Supabase sends it if an email change is ever requested | — |

Supabase also ships `invite`, `magic_link` and `reauthentication` templates plus
a set of security-notification templates. None of them are used by any
implemented flow, so none needs styling or configuration for this phase.

**There is no Supabase "Welcome" template.** The supported authentication
template names are `invite`, `confirmation`, `recovery`, `magic_link`,
`email_change` and `reauthentication`. A welcome email therefore has no Supabase
Auth send path — it would need an application-level send through the provider's
own API after a user confirms, which is not built.

## Development: local Supabase, no real email

**Never trigger auth emails against the hosted project during development.** Its
default SMTP is rate-limited and mail to invented addresses bounces, which
damages sender reputation. Local Supabase catches everything instead.

```
Next.js (npm run dev)
  → Local Supabase (supabase start)
    → Local Auth (GoTrue)
      → Local mail catcher
        → Local inbox (web UI, http://localhost:54324)
```

The CLI stack includes its own mail catcher, configured under `[inbucket]` in
`backend/supabase/config.toml`. Nothing is delivered externally — mail is intercepted and
read in the web UI. Documented defaults:

| Key | Default | Purpose |
| --- | --- | --- |
| `enabled` | `true` | Runs the local mail service |
| `port` | `54324` | Web UI for reading captured mail |
| `smtp_port` | `54325` | SMTP listener |
| `pop3_port` | `54326` | POP3 listener |
| `admin_email` | `admin@email.com` | Sender address for local mail |
| `sender_name` | `Admin` | Sender display name |

Because that catcher is the default target, **local development needs no
`[auth.email.smtp]` block at all**. Two things do need setting, since the
defaults work against us:

```toml
[auth.email]
# Defaults to false locally, which would skip the confirmation email entirely.
enable_confirmations = true
# Defaults to 1m between email requests; lower it only if it blocks testing.
max_frequency = "1m"
```

Do not disable email confirmation to make testing easier — enabling it locally
is the whole point of running the stack.

### Pointing at a separately-run Mailpit instead

If you prefer Mailpit's UI, run it alongside and redirect Auth to it. This is the
only reason to add an SMTP block in development:

```bash
docker run -d --name mailpit -p 8025:8025 -p 1025:1025 axllent/mailpit
```

```toml
[auth.email.smtp]
enabled = true
host = "host.docker.internal"   # Auth runs in Docker; this reaches the Windows host
port = 1025
admin_email = "dev@unipilot.local"
sender_name = "UniPilot Dev"
```

Inbox at `http://localhost:8025`. Either catcher satisfies the rule that no real
email leaves the machine in development.

### Prerequisites and start-up

- **Docker Desktop for Windows** (WSL2 backend) — required by `supabase start`
- **Supabase CLI** — `winget install Supabase.CLI` (or `npm i -g supabase`)
- `supabase init` once per repo — this generates `backend/supabase/config.toml`

`backend/supabase/config.toml` is **not** committed to this repo, and it is not
hand-written: the CLI generates a version-matched file, and a partial one
written without the CLI installed is likely to be rejected. Run `supabase init`,
then paste the blocks above into the generated file.

Restart with `supabase stop && supabase start` after any config edit. Local Auth
enforces the same redirect allow-list as any project: `site_url` plus
`additional_redirect_urls` must include the origin the app is served from (the
repo's local config lists `http://localhost:3000/**` and
`http://127.0.0.1:3000/**`). An unlisted destination is silently replaced with
`site_url`, which reads as a broken link. Verified Stage 1 A.2.

### Environment separation

| File | Used by | Points at |
| --- | --- | --- |
| `frontend/.env.local` | production builds / default | **hosted** Supabase |
| `frontend/.env.development.local` | `npm run dev` only — Next.js loads it ahead of `frontend/.env.local` in development | **local** Supabase |

Copy `frontend/.env.development.local.example` to `frontend/.env.development.local` once local
Supabase is running. Both live files are gitignored. Hosted credentials are never
overwritten and local credentials are never committed.

### Local testing checklist

1. `/signup` → confirmation email appears in the local inbox
2. Open the link → `/auth/confirm` → session → `/dashboard` (the local stack
   sends a PKCE `?code=`, which the page forwards to `/auth/callback`; the
   hosted project's implicit fragment is handled on the page itself)
3. `/forgot-password` → recovery email appears in the local inbox; the link
   still lands on `/reset-password`, which does not exist yet (404)
4. Google OAuth is not exercised locally (hosted-project provider only; the
   local authorize endpoint returns `400 Unsupported provider`)

## Production: hosted Supabase Auth → custom SMTP

```
Next.js → Hosted Supabase Auth → Custom SMTP provider → User inbox
```

Custom SMTP is configured **in the Supabase dashboard**, not in this repo:
**Authentication → Emails (under Notifications) → SMTP Settings**. That keeps the
provider credential inside Supabase's own encrypted configuration, so it never
reaches a Next.js environment variable, a build artifact or a browser bundle.

For Resend, the documented settings are:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | an address on a **verified** domain (e.g. `support@unipilot.app`) |
| Sender name | e.g. `UniPilot` |

Sender email and name are both mandatory. The sender address must sit on a domain
already verified with the provider — which is exactly what is missing today.

`support@unipilot.app` is already published on the FAQ page, so `unipilot.app`
is the natural sending domain **if and when it is owned and verified**. It is not
verified now, and nothing here should be read as a claim that it is.

## Domain and DNS requirements

A sending domain must be added to the provider and verified before a single
production email can be trusted. The record set:

| Record | Purpose |
| --- | --- |
| `TXT` (DKIM) | Cryptographically signs outbound mail so receivers can verify it |
| `TXT` (SPF) | Authorises the provider's servers to send for the domain |
| `MX` (return path) | Bounce/return-path handling — the provider's default host is `send.<domain>` |
| `TXT` (DMARC) | Publishes a policy for handling failures. Added **after** the domain verifies |

**The literal record values are domain-specific and only come from the provider's
dashboard** (Domains → Records) once the domain is added. They must match exactly.
Any values written here from memory would be wrong, so none are.

Sending from a subdomain (`mail.unipilot.app`, `account.unipilot.app`) rather
than the root is recommended: it isolates sending reputation from the root
domain. Verification typically completes within ~15 minutes of the records going
live, though DNS propagation can take considerably longer.

## Redirect URL allowlist

Email links carry `redirect_to`, and Supabase only honours destinations on the
project's allowlist. `frontend/lib/auth/actions.ts` derives the origin from the request
headers, so every origin the app is served from must be listed under
**Authentication → URL Configuration**:

- **Site URL** — the canonical production origin
- **Redirect URLs** — `https://<domain>/auth/confirm`,
  `https://<domain>/auth/callback`, `https://<domain>/reset-password`, plus the
  `http://localhost:3000` equivalents for local work against the hosted project

An unlisted destination is silently dropped back to the Site URL, which reads as
a broken email link. This allowlist is also what stops a spoofed `Origin` header
from redirecting a confirmation link somewhere else.

## Rate limits

| Limit | Default | Note |
| --- | --- | --- |
| Supabase default (shared) SMTP | Low, project-wide | The reason development must not use it |
| `auth.rate_limit.email_sent` | 2 per hour | Requires `auth.email.smtp` to be enabled |
| `auth.email.max_frequency` | `1m` | Minimum gap between email requests |

Raise `auth.rate_limit.email_sent` once a real provider is in place; 2/hour is
not a usable production signup rate.

## Secrets

- The provider API key lives **only** in Supabase's dashboard SMTP configuration.
- It never appears in this repo, in `frontend/.env.local`, in a `NEXT_PUBLIC_*` variable,
  or in any file that reaches the client bundle.
- In `backend/supabase/config.toml`, secrets use environment interpolation —
  `pass = "env(SUPABASE_AUTH_SMTP_PASS)"` — never a literal.
- `.env*` files carrying real values stay gitignored; only `*.example`
  templates, which contain no secrets, are tracked.
- Never log an API key, an SMTP password, a generated auth link, a token or a
  password. `frontend/lib/auth/*` currently logs none of these.

## Template variables

The values Supabase substitutes into email templates. Use these exact spellings —
an invented name renders empty.

| Variable | Contains |
| --- | --- |
| `{{ .ConfirmationURL }}` | The full generated action link, including `redirect_to` |
| `{{ .Token }}` | A numeric one-time code, an alternative to the link |
| `{{ .TokenHash }}` | Hashed token, for hand-built links verified with `verifyOtp` |
| `{{ .SiteURL }}` | The project's configured Site URL |
| `{{ .RedirectTo }}` | The redirect passed to the originating auth call |
| `{{ .Email }}` | The user's email address |
| `{{ .NewEmail }}` | Change-email template only |
| `{{ .Data }}` | `auth.users.user_metadata`, for personalisation |

Templates are Go templates, so conditionals work.

**This app must use `{{ .ConfirmationURL }}` for both confirmation and
recovery.** Supabase documents an alternative SSR pattern — a
`token_hash`/`verifyOtp` route handler — but this project was verified live to
receive the implicit-flow fragment (`#access_token=…`) on `/auth/confirm`, and it
handles that on the client. Switching to `token_hash` would require a route
handler at a path already occupied by a page, i.e. rewiring authentication. Out
of scope, and unnecessary.

One caveat worth knowing: link-prefetching security scanners can consume a
confirmation URL before the user clicks it, producing "token has expired or is
invalid". The documented mitigations are to send `{{ .Token }}` for manual entry,
or to put the link behind a required button click.

### Where templates live

| Environment | Location |
| --- | --- |
| Hosted | Dashboard → Authentication → Email Templates |
| Local / CLI | `backend/supabase/config.toml` + HTML files; the dashboard editor does not apply |

```toml
[auth.email.template.confirmation]
subject = "Confirm your UniPilot email"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your UniPilot password"
content_path = "./supabase/templates/recovery.html"
```

Supported template names: `invite`, `confirmation`, `recovery`, `magic_link`,
`email_change`, `reauthentication`.

The HTML now exists at [`backend/supabase/templates/`](./supabase/templates/) —
`confirmation.html`, `recovery.html` and a `welcome.html` that Supabase cannot
send (there is no welcome template name). Installation steps, the shared layout
and the editing rules are in
[backend/supabase/templates/README.md](./supabase/templates/README.md).

## Blocking prerequisites

Production email delivery cannot be configured — let alone verified — until all
of these are true. None of them can be faked from inside this repo.

1. **Own a sending domain.** Not owned today.
2. **Create a provider account** (Resend or equivalent) and add that domain.
3. **Publish the generated DKIM/SPF/MX records** and wait for verification.
4. **Add DMARC** once verified.
5. **Enter the SMTP settings** in the Supabase dashboard, API key included.
6. **Extend the Redirect URLs allowlist** to the production origin.
7. **Raise `auth.rate_limit.email_sent`** above the 2/hour default.
8. **Send one real test email** to an address you control and confirm inbox
   placement. Deliverability is unproven until this happens.

## Known gaps

- **`/reset-password` does not exist.** `requestPasswordReset` sets `redirectTo`
  to it, so a recovery email's link currently lands on a 404. The route is
  already listed in `PUBLIC_AUTH_PATHS`, so the proxy will not gate it once
  built — but any recovery email is a dead end until then.
- **No welcome email send path.** Supabase Auth has no welcome template; sending
  one requires an application-level provider call that does not exist.
- **No local stack on this machine.** Docker, the Supabase CLI and
  `backend/supabase/config.toml` are all absent, so no email has been rendered or
  captured. All verification so far is structural.
  - Superseded: the local stack is now installed and running (QA_SESSION.md,
    Task 20.10), and Stage 1 A.2 verified signup-confirmation and recovery
    delivery end-to-end through the local mail catcher.
