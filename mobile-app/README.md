# UniPilot mobile (`mobile-app/`)

The native Android client for UniPilot (React Native + Expo + TypeScript).
The single source of truth for its scope, decisions and rules is
[`plan.md`](./plan.md) — read it before changing anything here.

## Status (M1)

App skeleton + native design tokens + the first EAS preview APK. No auth, no
data reads, no provider sync — every surface renders an honest empty or
"not built yet" state. Auth lands in M2, the unified calendar in M3.

## Layout

| Path | What lives there |
| --- | --- |
| `src/app/` | expo-router routes: `(tabs)/` = Calendar (default) · Tasks · More; `specimen.tsx` = the design specimen (More → Design specimen) |
| `src/theme/` | The native mirror of the web tokens (`frontend/app/globals.css` is authoritative); see `src/theme/README.md` |
| `src/motion/` | The Motion vocabulary port (eases, durations, staggers from `MOTION.md`) with reduced-motion handled at the primitive level |
| `src/components/` | Shared primitives: Screen, Surface, AppText, Button, ListRow, EmptyState, Notice, Badge, Divider, PageHeading, Backdrop |
| `src/features/specimen/` | The specimen sections |
| `src/lib/supabase.ts` | The env-driven public client (anon key only; no persistence until M2's secure store) |

## Environment

Copy `.env.example` → `.env` (git-ignored). Everything is public by design —
`EXPO_PUBLIC_*` values are embedded in the bundle, so **a secret must never
live in one**; RLS is the authority.

| Variable | Meaning |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | The Supabase project URL (local stack on this host: `http://127.0.0.1:54937`; a device reaches it via `adb reverse` or a LAN address) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The public anon key (never the service-role key) |
| `EXPO_PUBLIC_ALLOW_CLEARTEXT` | Dev/preview only: allow HTTP to a local server; set by the `preview` EAS profile, unset for production |

## Commands (repo root)

| Script | Runs |
| --- | --- |
| `npm run mobile:start` | `expo start` |
| `npm run mobile:android` | `expo start --android` |
| `npm run mobile:lint` / `mobile:typecheck` / `mobile:test` | eslint / `tsc --noEmit` / jest |
| `npm run mobile:preview` | EAS `preview` Android build (APK) |

`npx expo-doctor` from this directory is part of the phase gate.

## Monorepo notes

- `mobile-app` is an npm workspace of the repo (one root lockfile, additions
  only for this workspace). Root `npm run test` stays the **web** Playwright
  suite.
- Metro watches the repo root and resolves from this workspace's
  `node_modules` then the root one; hierarchical lookup stays enabled so a
  dependency's own nested copy resolves (react-native-reanimated's `semver@7`
  next to the web toolchain's hoisted `semver@6`). See `metro.config.js`.
- React is duplicated across workspaces on purpose: React Native 0.86 pins
  `react@19.2.3` while the web app pins `19.2.8`. `expo-doctor` reports the
  duplicate; the EAS build + the device run are the real proof it does not
  break the app.
- `frontend/lib/supabase/database.types.ts` is consumed **type-only** as
  `@unipilot/db-types` (read-only; never edited from here).

## Building the APK (EAS)

```powershell
npx eas-cli login            # the founder's own Expo account
npm run mobile:preview       # from the repo root → EAS preview APK
```

- Signing lives in `credentials.json` + `credentials/` (both git-ignored,
  never committed); EAS uses them for the preview APK.
- Install on a device over adb:
  `C:\Android\platform-tools\adb.exe install -r <downloaded.apk>`
- The artifact is a **preview APK** (debug-signed, standalone-installable,
  not Play-uploadable). A store release needs a bundle + upload key — out of
  scope (see `plan.md` §G).

## Device connectivity (for later milestones)

- Physical device: `adb reverse tcp:3000 tcp:3000` (Next server) and
  `adb reverse tcp:54937 tcp:54937` (the local Supabase API on this host).
- Emulator: use `10.0.2.2` instead of `127.0.0.1`.
- M1 makes no network calls, so neither is required to run this milestone.

## QA

- `npm run mobile:test` (jest) covers the token mirror and the Supabase
  unconfigured state; `mobile:typecheck` and `mobile:lint` are the static
  gates; `expo export --platform android` proves the monorepo bundle.
- Device evidence screenshots go to `screenshots/` (git-ignored).
- **The web Playwright suite does not test this app** — and this app's tests
  are not evidence about the web.
