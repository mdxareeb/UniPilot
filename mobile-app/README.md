# UniPilot mobile (`mobile-app/`)

The native Android client for UniPilot (React Native + Expo + TypeScript).
The single source of truth for its scope, decisions and rules is
[`plan.md`](./plan.md) — read it before changing anything here.

## Status (M2a)

Email/password auth against the LOCAL Supabase, sessions in
`expo-secure-store`, the owner-scoped profile read and sign-out are live and
device-verified (see `plan.md` §P). No data surfaces yet: the calendar/tasks
screens render their honest empty states; M2b adds PKCE +
`unipilot://auth-callback` deep links, M3 the unified calendar.

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

## Building the APK

Two proven paths. **Local is the default** (no queue); EAS is the fallback.

### Local build (PROVEN 2026-10-13 — use this recipe verbatim)

The main checkout lives under OneDrive, where `assembleRelease` fails with
`ninja: error: manifest 'build.ninja' still dirty after 100 tries` (the CMake
re-run loop; see `plan.md` §P). Build from a short, non-OneDrive worktree:

```powershell
# one-time setup
git worktree add --detach C:\dev\up-mobile HEAD
cd C:\dev\up-mobile; npm install

# every build
cd C:\dev\up-mobile\mobile-app
$env:JAVA_HOME='C:\Android\jdk-17'
$env:ANDROID_HOME='C:\Android\Sdk'; $env:ANDROID_SDK_ROOT='C:\Android\Sdk'
npx expo prebuild --platform android --no-install    # only when native config changed
cd android
C:\Android\gradle-9.3.1\bin\gradle.bat assembleRelease --no-watch-fs
# → app/build/outputs/apk/release/app-release.apk
```

Requirements (all outside the repo): JDK 17.0.20.1 at `C:\Android\jdk-17`;
SDK at `C:\Android\Sdk` (platform 36, build-tools 36.0.0, **CMake 3.30.5
only** — 3.22.1 was uninstalled because the failing ninja came from it —,
NDK 27.1.12297006); Gradle 9.3.1 extracted at `C:\Android\gradle-9.3.1`
(the wrapper's own CDN download fails on this network). To move the worktree
to a newer commit: `git -C C:\dev\up-mobile checkout --detach <sha>` and
re-run `npm install` if dependencies moved. **Signing — the permanent identity (2026-10-14):** the app's signing key is
the EAS-managed keystore, now adopted for local builds too: **EAS and local
builds sign identically** (cert SHA-256 `bc51cd50…`), so a local APK installs
in place over the EAS app (`adb install -r`, no uninstall). This is the app's
**permanent signing identity — the Play Store key**: back it up in **two**
places; never commit it, never paste it into a chat or tool call, and never
print it or its passwords. Files (both OUTSIDE the repo, by design):

- keystore: `C:\Android\keystores\unipilot-eas.jks`
- credentials: `C:\Android\keystores\unipilot-eas.properties`
  (`keystorePassword`, `keyAlias`, `keyPassword`)

Populate the build env from that properties file (values never printed):

```powershell
$props = @{}
Get-Content 'C:\Android\keystores\unipilot-eas.properties' | Where-Object { $_ -match '^\s*[A-Za-z]+\s*=\s*\S' } | ForEach-Object { $kv = $_.Split('=',2); $props[$kv[0].Trim()] = $kv[1].Trim() }
$env:UNIPILOT_KEYSTORE_PATH     = 'C:\Android\keystores\unipilot-eas.jks'
$env:UNIPILOT_KEYSTORE_PASSWORD = $props['keystorePassword']
$env:UNIPILOT_KEY_ALIAS         = $props['keyAlias']
$env:UNIPILOT_KEY_PASSWORD      = $props['keyPassword']
```

Gradle patch (re-apply after any `expo prebuild` — the file is CNG-generated):
add inside `signingConfigs` a conditional `release { storeFile
file(System.getenv("UNIPILOT_KEYSTORE_PATH")) … }` block, and in the `release`
buildType replace `signingConfig signingConfigs.debug` with
`signingConfig System.getenv("UNIPILOT_KEYSTORE_PATH") != null ?
signingConfigs.release : signingConfigs.debug`. The full blocks are in the
M2b phase record (§P).

Unused: the earlier `mobile-app/credentials/` keystore (`e8c27b15…`,
CN=UniPilot Preview) is no longer any build's identity — kept only as history
and still git-ignored.

Recorded identity of the proven artifact (2026-10-13): `app-release.apk`
contains the bundled JS (`assets/index.android.bundle`, ~5.3 MB) and **all
four ABIs** (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`); it was **not
installed on a device**. Installing it over an EAS build fails with a
signature mismatch (debug vs EAS key) and would require uninstalling the app —
**do not uninstall without the founder's decision**.

Delta vs the two failed runs — path (`C:\dev\up-mobile` worktree vs the
OneDrive checkout), fresh cache (no stale `.cxx`), cmake/3.22.1 uninstalled
(only 3.30.5 visible), `--no-watch-fs` — was **not isolated**: the build
**succeeded once, cause not confirmed**. Keep the whole recipe.

### EAS build (queue path)

```powershell
npx eas-cli login                                                    # the founder's own Expo account
npx eas-cli build -p android --profile preview --non-interactive --no-wait       # configured (local Supabase pair baked)
npx eas-cli build -p android --profile preview-noenv --non-interactive --no-wait  # no-env variant (unconfigured-state checks)
```

- The `preview` profile bakes the **public** local Supabase pair (eas.json
  env) so the APK reaches the local stack through `adb reverse`;
  `preview-noenv` bakes nothing (honest unconfigured state).
- Signing: the project keystore in `credentials.json` + `credentials/`
  (git-ignored, never committed).
- Install: `C:\Android\platform-tools\adb.exe install -r <downloaded.apk>`.
- Both artifacts are preview APKs (internal distribution, not
  Play-uploadable). A store release needs a bundle + upload key — out of
  scope (see `plan.md` §G).

## Device connectivity (local stack)

- After **every replug**: `adb devices` (authorise the prompt if it appears),
  then re-establish the tunnel:
  `C:\Android\platform-tools\adb.exe reverse tcp:54937 tcp:54937`
  (the app's env points at `http://127.0.0.1:54937`).
- The Next server (later milestones): `adb reverse tcp:3000 tcp:3000`.
- Emulator: use `10.0.2.2` instead of `127.0.0.1`.

## QA

- `npm run mobile:test` (jest) covers the token mirror and the Supabase
  unconfigured state; `mobile:typecheck` and `mobile:lint` are the static
  gates; `expo export --platform android` proves the monorepo bundle.
- Device evidence screenshots go to `screenshots/` (git-ignored).
- **The web Playwright suite does not test this app** — and this app's tests
  are not evidence about the web.
