# whatsapp-bridge

A long-running, **read-only** Baileys listener for UniPilot's WhatsApp group
live sync (Stage 1). A student links WhatsApp once by scanning a QR code,
switches on the college groups they want, and the bridge captures messages and
attached course files from those groups only. A separate worker step (Gemini)
turns them into tasks, events and course materials.

> **Local-only for now.** The bridge is a persistent process with one socket per
> linked user, so it does not fit serverless hosting. Where it runs in
> production is a later decision.

## Risk: Baileys is unofficial

Baileys speaks the WhatsApp Web protocol without WhatsApp's permission.
**An account can be restricted or banned even when the client is passive.** The
bridge reduces the exposure (it never sends, never marks read, never announces
presence) but cannot remove it. For live testing use a **throwaway number and a
test group**, never a personal account. Users should be told this plainly
before linking.

## What "read-only" means here

- The application code never holds the raw socket. `src/socket/readOnly.ts`
  hands it an **allowlist** wrapper (`ev`, `user`, `groupFetchAllParticipating`,
  `logout`, `end`); any other member throws `ReadOnlyViolationError`.
- `test/readOnly.test.ts` scans `src/` and fails the build if a send / receipt /
  presence / group-write API is referenced, or if `makeWASocket` is imported
  anywhere but `src/socket/factory.ts`.
- `markOnlineOnConnect: false`, no outbound link previews, and Baileys 7.x no
  longer sends delivery acknowledgements.
- **Not suppressible:** the protocol traffic Baileys needs to remain a valid
  linked device (keep-alives, pre-key uploads, retry requests for messages it
  cannot decrypt, app-state sync). That is part of being linked at all.
- `logout` is allowed because it is the user's own "Disconnect": it unlinks the
  device and the bridge forgets every secret.

## How it fits together

```
web app (Server Action) ──writes──▶ whatsapp_sessions.desired_state
                                           │  polled every 3 s (Realtime is off locally)
                                           ▼
                              SessionManager ── one SessionRunner per user
                                           │
          encrypted RPCs ◀──────── DB-backed auth state, QR, status, heartbeat
```

- `desired_state` is the command channel; the bridge reconciles `status`
  (`disconnected` / `qr_ready` / `connected`) toward it and bumps
  `bridge_heartbeat_at`, so the UI can say "bridge not running" honestly.
- Credentials, signal keys and the live QR are stored **pgcrypto-encrypted** in
  tables that no API role can read; the bridge reaches them only through the
  service-role RPCs in `backend/supabase/migrations/20261118155450_*`
  (`UNIPILOT_INTEGRATIONS_KEY`, never stored).
- A linked session survives bridge restarts without a new scan. Stopping the
  bridge keeps links; a user's Disconnect (or WhatsApp unlinking the device)
  clears them.
- Failure copy written to `whatsapp_sessions.last_error` is fixed, sanitized
  text (`SESSION_MESSAGES` in `src/session/runner.ts`). QR payloads,
  credentials, message text, file names and phone numbers are never logged.

## Run it (local)

Prerequisites: the local Supabase stack up with the group-sync migrations
applied, Node >= 20.

Add to `backend/.env` (names in `backend/.env.example`): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` and **`UNIPILOT_INTEGRATIONS_KEY`** (the same value
the web app uses). Then, from the repo root:

```powershell
npm run bridge                 # starts the bridge (loads backend/.env)
npm run bridge:typecheck
npm run bridge:test            # unit tests (fakes; the live DB test is skipped)
```

Optional environment: `WHATSAPP_BRIDGE_POLL_MS` (default 3000, min 500),
`WHATSAPP_BRIDGE_HEARTBEAT_MS` (default 10000), `WHATSAPP_BRIDGE_LOG_LEVEL`.

### Verifying against the real local database

```powershell
# live store test: real RPC argument shapes + pgcrypto (local URL only)
$env:UNIPILOT_BRIDGE_DB_TEST = "1"; npm run bridge:test

# link smoke: needs the bridge running in another terminal; creates a
# throwaway user, waits for qr_ready, proves the QR is only readable through the
# RPC with the key, disconnects, deletes the user. No phone involved.
npm run smoke -w whatsapp-bridge
```

Both refuse any non-local `SUPABASE_URL`.

### Windows host note (winnat)

Windows can reserve the port range that contains the local API port
(`netsh interface ipv4 show excludedportrange protocol=tcp`), after which
`127.0.0.1:<port>` stops reaching the stack running inside WSL2 even though it
is healthy (see QA_SESSION.md, "WSL2 port-forwarding workaround"). If the
bridge cannot reach Supabase, apply that documented fix (move the API port, or
free the range). The bridge needs nothing beyond a reachable `SUPABASE_URL`.

## Live verification (needs a phone)

The automated tests use fakes and prove the logic, not WhatsApp itself. The
real path (scan, link, group capture, a file arriving) can only be checked with
a real device:

1. Use a spare WhatsApp number and a test group.
2. Start the bridge and request a connection from the UI; scan the QR from
   WhatsApp → Linked devices.
3. Switch the test group on, send a text message and a file, and confirm they
   appear (see the Stage 1 runbook in `whatsapp/README.md`).

Until that has been done, live end-to-end is **`[!]` unverified** and nothing in
the UI or docs claims otherwise.

## Notes

- Baileys is pinned exactly to `7.0.0-rc14` (a release candidate; the stable
  line is not yet published). Bumps must re-run the smoke test and the live
  checklist above.
- Baileys 7.x is ESM-only and identifies people by LID as well as phone number;
  the auth store is generic over key types, so `lid-mapping`, `device-list` and
  `tctoken` keys persist like any other.
- On-demand history fetch for a group switched on later is unreliable in
  Baileys and was deliberately **not built**. Turning a group on captures
  messages from that moment forward; history for groups that are already active
  (for example after a re-link) is ingested.
