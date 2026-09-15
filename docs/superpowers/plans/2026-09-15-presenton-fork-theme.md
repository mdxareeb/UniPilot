# Presenton fork + re-theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork Presenton's Next.js frontend into a git-ignored `presenton-ui/`, wire it to the existing Presenton engine, re-theme it to UniPilot's design system + Motion, and surface it from UniPilot — without touching UniPilot's app behaviour or committing anything to UniPilot's git.

**Architecture:** The fork is a copy of `presenton-main/servers/nextjs` with its own git repo at `presenton-ui/`. It runs on `:5002` (env `PORT`, default 5002); all engine traffic goes through its existing Next middleware (`proxy.ts`) using `FAST_API_INTERNAL_URL` (fed from `PRESENTON_ENGINE_URL`, default `http://localhost:5001`) — no next.config rewrites, no hardcoded URLs. Theming is token-first (HSL CSS vars in `app/globals.css` + `tailwind.config.ts`), then a chrome-only class sweep; Motion is ported as a pinned copy. UniPilot gains one env-driven edit-deck URL with an honest engine fallback.

**Tech Stack:** Next 16.2.6 / React 19.2.6 / Tailwind v3.4 / Radix / shadcn-style HSL tokens (fork); Motion (motion.dev) for the ported primitives; Playwright MCP (browser-qa skill) for evidence; PowerShell on Windows.

**Spec:** `docs/superpowers/specs/2026-09-15-presenton-fork-theme-design.md`

## Global Constraints

- **UniPilot repo: never commit.** Only the fork's own repo gets commits (approved for divergence tracking). Nothing in the fork is ever added to UniPilot's git: `.gitignore` gains `/presenton-ui/`.
- **Env-driven runtime:** `PRESENTON_ENGINE_URL` (default `http://localhost:5001`) is the single engine knob; `PORT` (default `5002`) is the fork port. Never hardcode either in `next.config.mjs` (it stays untouched).
- **Chrome-vs-slide-content rule:** never restyle deck/slide content or its fonts/colors. Slide/template rendering components keep their deck-driven styles. Scope every sweep edit to app chrome.
- **No new fonts/colors:** only Bricolage Grotesque, Geist, Geist Mono; only UniPilot's monochrome tokens (spec §5.1).
- **Evidence per phase:** real Chromium via Playwright MCP (or a real-Chromium probe if MCP is down); screenshots to `frontend/screenshots/<phase>-<surface>-<theme>-<width>.png`; console errors/warnings and failed requests inspected; responsive pass at 375/768/1280.
- **STOP rules:** if a task needs the founder (password, a manual service start, a provider/rate-limit decision, or a blocking ambiguity), stop and state exactly what to do. Never guess.
- **OneDrive contingency (pre-authorized):** if install/dev in OneDrive is painfully slow, move the fork to `C:\dev\presenton-ui`, update `PRESENTON_UI_URL`/`PRESENTON_ENGINE_URL` references, and record the chosen path in `DIVERGENCE.md`.
- **Legal/marketing pages are not rebranded** — chrome + page titles only.
- Verification is browser/command-based; the fork has no unit-test harness (upstream tests are `node --test` and stay untouched).

---

## File Structure (created / modified)

**UniPilot repo (working tree only, uncommitted):**

- `.gitignore` — add `/presenton-ui/`
- `frontend/lib/integrations/presentonConfig.ts` — add `presentonUiUrl()`
- `frontend/lib/integrations/presenton.ts` — add `resolveEditorUrl()`, keep `presentonEditUrl()` as the engine fallback
- `frontend/app/(app)/tools/presentation/page.tsx`, `[id]/edit/page.tsx` — use `resolveEditorUrl()`
- `frontend/.env.example`, `frontend/.env.development.local.example` — document `PRESENTON_UI_URL`
- `docs/integrations/presenton.md` — §3.6 update
- `scripts/start-env.mjs` — optional fork service (never fails the run)
- `docs/superpowers/plans/2026-09-15-presenton-fork-theme.md` — this plan

**Fork (`presenton-ui/`, git-ignored, own repo):**

- `presenton-ui/**` — upstream snapshot copy
- `presenton-ui/.gitignore` — node_modules, `.next-build`, env files, cypress artifacts
- `presenton-ui/scripts/dev.mjs` — PORT/engine env defaults + spawn Next
- `presenton-ui/package.json` — `"dev": "node scripts/dev.mjs"`, `motion` dependency
- `presenton-ui/app/globals.css` — fonts, tokens, motion CSS behaviours
- `presenton-ui/tailwind.config.ts` — colors/radius/shadow/fontSize/fonts
- `presenton-ui/app/layout.tsx` — MotionProvider
- `presenton-ui/components/motion/*` — pinned port of UniPilot's primitives
- `presenton-ui/components/ui/*` — re-themed primitives
- Screens: `app/(presentation-generator)/upload|outline|presentation|templates...`, `(dashboard)/*`
- `presenton-ui/utils/mixpanel.ts` — analytics off
- `presenton-ui/app/(presentation-generator)/presentation/components/PresentationHeader.tsx` — export delegates to the engine
- `presenton-ui/DIVERGENCE.md` — snapshot, baseline hash, changed files, update procedure

---

## P0 — Fork, wiring, baseline (no styling)

### Task P0.1: Snapshot the fork, ignore it, init its repo

**Files:**
- Create: `presenton-ui/**` (copy of `presenton-main/servers/nextjs`, excluding `.playwright-cli`)
- Create: `presenton-ui/.gitignore`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Produces: `presenton-ui/` (runnable app), baseline commit hash for `DIVERGENCE.md`.

- [ ] **Step 1: Copy the snapshot (exclude local tool artifacts)**

```powershell
robocopy "presenton-main\servers\nextjs" "presenton-ui" /E /XD ".playwright-cli" /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
```

- [ ] **Step 2: Write `presenton-ui/.gitignore`**

```gitignore
node_modules/
.next/
.next-build/
out/
.env
.env.local
.env*.local
*.tsbuildinfo
cypress/videos/
cypress/screenshots/
cypress/downloads/
```

- [ ] **Step 3: Add the fork to UniPilot's `.gitignore`**

Append after the `/presenton-main/` block:

```gitignore
# The forked Presenton UI (re-themed, git-ignored, own repo) — Task 31.x.
/presenton-ui/
```

- [ ] **Step 4: Init the fork repo and take the baseline commit**

```powershell
git -C presenton-ui init -b main
git -C presenton-ui add -A
git -C presenton-ui commit -m "upstream snapshot: presenton servers/nextjs (2026-09-15, next 16.2.6)"
git -C presenton-ui log --oneline -1
git -C presenton-ui rev-parse HEAD
```

- [ ] **Step 5: Verify the fork is invisible to UniPilot and present on disk**

```powershell
git check-ignore -v presenton-ui   # expect: .gitignore:NN:/presenton-ui/
git status --porcelain             # expect: only modified .gitignore, no presenton-ui files
Test-Path presenton-ui\app\layout.tsx   # expect: True
```

- [ ] **Step 6: Record the baseline hash**

Copy the `rev-parse HEAD` output into a scratch note; it goes into `DIVERGENCE.md` in P0.6.

### Task P0.2: Env-driven runtime, analytics off, install

**Files:**
- Create: `presenton-ui/scripts/dev.mjs`
- Modify: `presenton-ui/package.json` (scripts.dev)
- Modify: `presenton-ui/utils/mixpanel.ts` (token off)
- Run: `npm install` in `presenton-ui/`

**Interfaces:**
- Produces: `npm run dev` in the fork → Next on `PORT` (default 5002) with `FAST_API_INTERNAL_URL` derived from `PRESENTON_ENGINE_URL`.
- Consumes: nothing.

- [ ] **Step 1: Write `presenton-ui/scripts/dev.mjs`**

```js
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const port = process.env.PORT?.trim() || "5002";
const engineUrl = (process.env.PRESENTON_ENGINE_URL?.trim() || "http://localhost:5001").replace(/\/+$/, "");

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    PRESENTON_ENGINE_URL: engineUrl,
    FAST_API_INTERNAL_URL: engineUrl,
    DISABLE_AUTH: process.env.DISABLE_AUTH ?? "true",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
```

- [ ] **Step 2: Point the package script at it**

In `presenton-ui/package.json` replace `"dev": "next dev "` with:

```json
"dev": "node scripts/dev.mjs",
```

- [ ] **Step 3: Disable Mixpanel (no hosted contact)**

In `presenton-ui/utils/mixpanel.ts`, set the token to empty:

```ts
const MIXPANEL_TOKEN = '';
```

(`canUseMixpanel()` then returns false for every browser; the initializer becomes a no-op. Recorded in `DIVERGENCE.md`.)

- [ ] **Step 4: Install dependencies**

```powershell
$env:CYPRESS_INSTALL_BINARY = "0"
npm install --prefix presenton-ui
Remove-Item Env:\CYPRESS_INSTALL_BINARY
```

Time budget: if this exceeds ~10 minutes or the dev server is painfully slow afterwards, apply the OneDrive contingency (move to `C:\dev\presenton-ui`, move the nested `.git`, update references, record in `DIVERGENCE.md`) — pre-authorized by the founder. If install fails for another reason, STOP and report the exact error.

- [ ] **Step 5: Start the fork and verify the port + engine proxy**

```powershell
Start-Process npm.cmd -ArgumentList "run","dev" -WorkingDirectory "presenton-ui" -RedirectStandardOutput "C:\Users\moham\AppData\Local\Temp\opencode\presenton-ui-dev.log" -RedirectStandardError "C:\Users\moham\AppData\Local\Temp\opencode\presenton-ui-dev.err.log" -WindowStyle Hidden
Start-Sleep -Seconds 25
Invoke-WebRequest http://localhost:5002 -UseBasicParsing -TimeoutSec 10 | Select-Object StatusCode
Invoke-WebRequest "http://localhost:5002/api/v1/auth/status" -UseBasicParsing -TimeoutSec 10 | Select-Object -ExpandProperty Content
Invoke-WebRequest "http://localhost:5002/api/v1/ppt/template/all?default=true&page=1&page_size=1" -UseBasicParsing -TimeoutSec 15 | Select-Object -ExpandProperty Content
```

Expected: fork 200; auth status JSON from the engine (electron/admin); template list JSON with an `items` array. If the engine proxy fails, check `FAST_API_INTERNAL_URL` in the dev log (values only — never print secrets) and STOP with the exact log line if unresolved.

- [ ] **Step 6: Commit in the fork**

```powershell
git -C presenton-ui add scripts/dev.mjs package.json package-lock.json utils/mixpanel.ts .gitignore
git -C presenton-ui commit -m "wire env-driven dev runtime (PORT/PRESENTON_ENGINE_URL); disable analytics"
```

### Task P0.3: Delegate export to the engine

**Files:**
- Modify: `presenton-ui/app/(presentation-generator)/presentation/components/PresentationHeader.tsx`

**Interfaces:**
- Consumes: engine endpoint `POST /api/v1/ppt/presentation/{id}/export` body `{export_as}` → `{presentation_id, path, edit_path}` (path may be an absolute filesystem path or an `/app_data/...` URL).
- Produces: the browser branch of both export handlers fetches the engine through the fork proxy and downloads via the existing `downloadLink`.

- [ ] **Step 1: Add the path normalizer**

Near the other helpers at the top of `PresentationHeader.tsx`, add:

```ts
function normalizeEngineExportPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/");
  const idx = normalized.indexOf("/app_data/");
  return idx >= 0 ? normalized.slice(idx) : normalized;
}
```

- [ ] **Step 2: Rewire the PPTX browser branch**

Replace the `fetch("/api/export-presentation", ...)` block in `handleExportPptx` (currently lines ~253–271) with:

```ts
const response = await fetch(
  `/api/v1/ppt/presentation/${presentation_id}/export`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ export_as: "pptx" }),
  }
);

if (!response.ok) {
  throw new Error("Failed to export PPTX");
}

const { path: rawPptxPath } = await response.json();
if (!rawPptxPath) {
  throw new Error("No path returned from export");
}

downloadLink(normalizeEngineExportPath(rawPptxPath), safePptxFileName);
```

- [ ] **Step 3: Rewire the PDF browser branch**

Replace the `fetch("/api/export-presentation", ...)` block in `handleExportPdf` (currently lines ~335–352) with:

```ts
const response = await fetch(
  `/api/v1/ppt/presentation/${presentation_id}/export`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ export_as: "pdf" }),
  }
);

if (!response.ok) {
  throw new Error("Failed to export PDF");
}

const { path: rawPdfPath } = await response.json();
if (!rawPdfPath) {
  throw new Error("No path returned from export");
}

downloadLink(normalizeEngineExportPath(rawPdfPath), safePdfFileName);
```

- [ ] **Step 4: Typecheck**

```powershell
npx tsc --noEmit -p presenton-ui/tsconfig.json
```

Expected: no new errors (pre-existing upstream errors, if any, get listed in `DIVERGENCE.md`).

- [ ] **Step 5: Commit in the fork**

```powershell
git -C presenton-ui add "app/(presentation-generator)/presentation/components/PresentationHeader.tsx"
git -C presenton-ui commit -m "export via the engine's export endpoint (bundled runtime is absent locally)"
```

### Task P0.4: Chromium smoke of every route + baseline screenshots

**Files:**
- Create: `frontend/screenshots/p0-<route>-dark-<width>.png` (evidence only)

**Interfaces:**
- Consumes: fork running on :5002; Playwright MCP.
- Produces: baseline evidence set for all later before/after comparisons.

- [ ] **Step 1: Confirm MCP tooling**

Run `opencode mcp list`; expect `✓ playwright connected`. If not, STOP and report (fallback: a real-Chromium probe script under `frontend/.playwright/` — say so in the report).

- [ ] **Step 2: Smoke each route (1280×720, dark)**

For each route: `browser_navigate` → `browser_snapshot` → `browser_take_screenshot` (`frontend/screenshots/p0-<name>-dark-1280.png`) → `browser_console_messages level:error` and `level:warning` → `browser_network_requests` (flag failed/404 requests).

Routes and expected states:

| Route | Expected |
|---|---|
| `/` | redirects to `/upload` (configured engine) |
| `/upload` | generate wizard renders |
| `/outline` | empty-state ("No Presentation Found") without `id` |
| `/presentation` | empty/error state without `id` (or dashboard redirect — record actual) |
| `/dashboard` | deck list renders (may be empty) |
| `/templates` | built-in template cards render |
| `/template-preview?templateV2Id=general` | preview renders |
| `/settings` | settings page renders (admin or user variant — record) |
| `/custom-template` | wizard step 1 renders |
| `/documents-preview` | legacy content page renders |

- [ ] **Step 3: If the provider wizard gate appears**

Presenton validates provider settings and redirects app routes to its setup wizard when the model is missing. If any route lands on the wizard: STOP with the plain instruction — *"Open http://127.0.0.1:5001, complete/fix the provider settings (model field), then tell me to continue."* Do not guess or modify the engine's settings.

- [ ] **Step 4: Responsive spot-check**

`browser_resize` 375×720 on `/upload`, `/dashboard`, `/presentation`; screenshot `p0-<name>-dark-375.png`; note overflow/console issues in the phase report.

- [ ] **Step 5: Emit the phase evidence notes**

Summary of: routes visited, console/network status per route, screenshot filenames, any route that needed a workaround. No commit (evidence lives in the git-ignored screenshots dir).

### Task P0.5: Real generate → viewer → export round-trip

**Files:**
- Create: `frontend/screenshots/p0-roundtrip-*.png`

**Interfaces:**
- Consumes: fork on :5002, engine on :5001, a working text provider (Gemini per TASK.md).
- Produces: proof the fork drives the engine end-to-end; the recorded engine export `path` shape.

- [ ] **Step 1: Generate through the fork UI**

`browser_navigate http://localhost:5002/upload` → type a prompt (e.g. "Photosynthesis overview, 5 slides") → submit → wait for the deck (`browser_wait_for` the presentation route or dashboard entry; generation takes minutes). Screenshot `p0-roundtrip-generate-running.png` and `p0-roundtrip-viewer.png`.

- [ ] **Step 2: Viewer check**

Deck opens at `/presentation?id=...`; thumbnails and the full-size slide render; console clean; no 404s for `/app_data` or `/static` assets (this proves the asset proxy). Screenshot `p0-roundtrip-viewer-slides.png`.

- [ ] **Step 3: Open the editor route**

Click into the editor (`/presentation?id=...` editor entry) and confirm the canvas renders with tools. No edits here (P0 is no-styling). Screenshot `p0-roundtrip-editor.png`.

- [ ] **Step 4: Export PDF via the rewired handler**

Header → Export → PDF. Expect the loading toast, then a downloaded file. Screenshot `p0-roundtrip-export.png`. Verify the download landed (Playwright download or `frontend/.playwright/` artifact) and is > 0 bytes.

- [ ] **Step 5: Record the engine path shape**

From the handler's response (browser network request `.../export` response body), record whether `path` is `/app_data/...` or an absolute filesystem path. Add this raw shape to `DIVERGENCE.md` (P0.6). If the download failed, capture the console/network error and STOP with the exact message.

- [ ] **Step 6: Provider failure handling**

If generation 429s repeatedly (Google free tier is documented as rate-limited): retry once; if it fails again, STOP and tell the founder plainly: *"Generation is rate-limited by the configured provider; I need you to either wait, switch the engine provider, or provide a key — then say continue."*

### Task P0.6: Start DIVERGENCE.md, commit, phase report

**Files:**
- Create: `presenton-ui/DIVERGENCE.md`

- [ ] **Step 1: Write `DIVERGENCE.md`**

```markdown
# Fork divergence from upstream Presenton

## Snapshot
- Source: `presenton-main/servers/nextjs` (git-ignored checkout), copied 2026-09-15
- Next 16.2.6 / React 19.2.6; engine image `ghcr.io/presenton/presenton:latest` (built 2026-09-08)
- Baseline commit: <hash from P0.1>
- Location: `presenton-ui/` (git-ignored by UniPilot; own repo). OneDrive-synced folder —
  install/dev performance cost noted here; if moved outside OneDrive, record the new path
  and the matching `PRESENTON_UI_URL` here.

## Changed files (kept deliberately small for rebases)
- `scripts/dev.mjs`, `package.json` — env-driven PORT/PRESENTON_ENGINE_URL runtime
- `utils/mixpanel.ts` — analytics disabled (empty token)
- `app/(presentation-generator)/presentation/components/PresentationHeader.tsx` — export delegates to the engine's `POST /api/v1/ppt/presentation/{id}/export`; engine returns `path` as: <recorded shape>
- (theme/motion/branding files appended in P1–P3)

## Update procedure
1. Fetch upstream `github.com/presenton/presenton` at the target tag/commit.
2. Diff its `servers/nextjs` against the baseline commit (`git -C presenton-ui diff <baseline> --stat` for shape; upstream clone for the other side).
3. Replay the theme commits (`git -C presenton-ui rebase`/cherry-pick); resolve conflicts in `app/globals.css`, `tailwind.config.ts`, `components/ui/*`, `components/motion/*`, branding files only.
4. Re-run the per-screen Chromium checklist; update the recorded upstream hash.

## Legal
- Upstream Apache-2.0; `LICENSE`/`NOTICE` kept in the fork. Modifications are listed above (Apache-2.0 §4). The fork is local, git-ignored, not redistributed. Legal/marketing pages are not rebranded.
```

- [ ] **Step 2: Commit in the fork**

```powershell
git -C presenton-ui add DIVERGENCE.md
git -C presenton-ui commit -m "docs: divergence + update procedure baseline"
```

- [ ] **Step 3: STOP — P0 review**

Report: baseline hash, routes smoked, console/network status, round-trip proof (screenshots + export file size), engine path shape, install/OneDrive note, changed UniPilot files (only `.gitignore` so far). Wait for the founder's go-ahead before P1.

---

## P1 — Theme foundation

### Task P1.1: Fonts

**Files:**
- Create: `presenton-ui/public/fonts/unipilot/{BricolageGrotesque-Variable.ttf, Geist-Variable.woff2, GeistMono-Variable.woff2}`
- Modify: `presenton-ui/app/globals.css` (top `@font-face` block + body)
- Modify: `presenton-ui/tailwind.config.ts` (fontFamily)

**Interfaces:**
- Produces: `--font-heading` (Bricolage), `--font-sans` (Geist), `--font-mono` (Geist Mono); Tailwind keys `font-heading`/`font-sans`/`font-mono`; temporary bridge: existing `font-syne` → Bricolage, `font-manrope` → Geist (so the whole app switches immediately; class renames happen in P2.3).

- [ ] **Step 1: Copy the font files and any license files**

```powershell
New-Item -ItemType Directory -Force presenton-ui\public\fonts\unipilot | Out-Null
Copy-Item "frontend\app\fonts\Geist-Variable.woff2" "presenton-ui\public\fonts\unipilot\Geist-Variable.woff2"
Copy-Item "frontend\app\fonts\GeistMono-Variable.woff2" "presenton-ui\public\fonts\unipilot\GeistMono-Variable.woff2"
Copy-Item "frontend\app\fonts\BricolageGrotesque-VariableFont_opsz,wdth,wght.ttf" "presenton-ui\public\fonts\unipilot\BricolageGrotesque-Variable.ttf"
Get-ChildItem "frontend\app\fonts" -File | Where-Object { $_.Name -match 'LICENSE|OFL' } | Copy-Item -Destination presenton-ui\public\fonts\unipilot\
```

(If no license files exist in `frontend/app/fonts`, note it in `DIVERGENCE.md`; both families are OFL.)

- [ ] **Step 2: Replace the font-face block in `presenton-ui/app/globals.css`**

Delete the Manrope/Syne `@font-face` blocks and the `:root` font vars; replace with:

```css
@font-face {
  font-family: "Bricolage Grotesque";
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url("/fonts/unipilot/BricolageGrotesque-Variable.ttf") format("truetype");
}
@font-face {
  font-family: "Geist";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/fonts/unipilot/Geist-Variable.woff2") format("woff2");
}
@font-face {
  font-family: "Geist Mono";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/fonts/unipilot/GeistMono-Variable.woff2") format("woff2");
}

:root {
  --font-heading: "Bricolage Grotesque", Arial, sans-serif;
  --font-sans: "Geist", Arial, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}

body {
  font-family: var(--font-sans);
}
```

- [ ] **Step 3: Update `tailwind.config.ts` fontFamily**

```ts
fontFamily: {
  heading: ["var(--font-heading)"],
  sans: ["var(--font-sans)"],
  mono: ["var(--font-mono)"],
  syne: ["var(--font-heading)"],   // temporary bridge during the sweep
  manrope: ["var(--font-sans)"],   // temporary bridge during the sweep
},
```

- [ ] **Step 4: Verify fonts in Chromium**

`browser_navigate http://localhost:5002/dashboard` → `browser_evaluate`:

```js
(() => {
  const body = getComputedStyle(document.body).fontFamily;
  const heading = document.querySelector("h1,h2");
  const button = document.querySelector("button");
  return {
    body,
    heading: heading ? getComputedStyle(heading).fontFamily : null,
    button: button ? getComputedStyle(button).fontFamily : null,
    geist: document.fonts.check('16px "Geist"'),
    bricolage: document.fonts.check('16px "Bricolage Grotesque"'),
    mono: document.fonts.check('16px "Geist Mono"'),
  };
})()
```

Expected: body contains Geist; heading/button resolve to Bricolage (where upstream used `font-syne`); all three checks true. Console/network clean (no `/vendor/fonts` 404s for UI fonts).

- [ ] **Step 5: Commit in the fork**

```powershell
git -C presenton-ui add public/fonts app/globals.css tailwind.config.ts
git -C presenton-ui commit -m "theme: UniPilot fonts (Bricolage/Geist/Geist Mono)"
```

### Task P1.2: Tokens, radius, elevation, glass

**Files:**
- Modify: `presenton-ui/app/globals.css` (`:root`/`.dark` + additions; `::selection`)
- Modify: `presenton-ui/tailwind.config.ts`

**Interfaces:**
- Consumes: HSL table in spec §5.1 (verbatim below).
- Produces: token utilities `bg-glass`, `bg-glass-strong`, `bg-glass-subtle`, `bg-scrim`, `bg-surface-inverted`, `rounded-frame/card/nested/base/pill`, `shadow-subtle/raised/floating/overlay`.

- [ ] **Step 1: Replace the `:root` and `.dark` token blocks in `globals.css`**

```css
:root {
  --background: 240 5% 96%;
  --foreground: 180 4% 11%;
  --card: 0 0% 100%;
  --card-foreground: 180 4% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 180 4% 11%;
  --primary: 0 0% 0%;
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 37%;
  --secondary-foreground: 0 0% 100%;
  --muted: 240 4% 95%;
  --muted-foreground: 351 5% 28%;
  --accent: 0 0% 93%;
  --accent-foreground: 180 4% 11%;
  --destructive: 0 75% 42%;
  --destructive-foreground: 0 0% 100%;
  --border: 0 0% 90%;
  --input: 0 0% 90%;
  --ring: 0 0% 0%;
  --chart-1: 0 0% 11%;
  --chart-2: 0 0% 25%;
  --chart-3: 0 0% 40%;
  --chart-4: 0 0% 60%;
  --chart-5: 0 0% 78%;
  --radius: 0.75rem;
}

.dark {
  --background: 240 7% 8%;
  --foreground: 180 3% 94%;
  --card: 240 6% 12%;
  --card-foreground: 180 3% 94%;
  --popover: 240 6% 12%;
  --popover-foreground: 180 3% 94%;
  --primary: 0 0% 100%;
  --primary-foreground: 240 5% 8%;
  --secondary: 0 0% 37%;
  --secondary-foreground: 0 0% 100%;
  --muted: 240 7% 11%;
  --muted-foreground: 350 3% 61%;
  --accent: 240 5% 17%;
  --accent-foreground: 180 3% 94%;
  --destructive: 358 75% 59%;
  --destructive-foreground: 0 0% 100%;
  --border: 240 5% 19%;
  --input: 240 5% 19%;
  --ring: 0 0% 100%;
  --chart-1: 0 0% 94%;
  --chart-2: 0 0% 80%;
  --chart-3: 0 0% 64%;
  --chart-4: 0 0% 48%;
  --chart-5: 0 0% 32%;
}
```

Also replace the `::selection` rule's `hsl(var(--chart-1))` background with `hsl(var(--primary))` and `color: hsl(var(--primary-foreground))`.

- [ ] **Step 2: Append the added tokens (glass/inverted) and keep them theme-aware**

```css
@layer base {
  :root {
    --surface: 0 0% 98%;
    --surface-glass: 240 4% 95% / 0.6;
    --surface-glass-strong: 240 4% 95% / 0.8;
    --surface-glass-subtle: 240 4% 95% / 0.3;
    --scrim: 0 0% 0% / 0.4;
    --surface-inverted: 180 4% 11%;
    --surface-inverted-foreground: 180 3% 94%;
    --border-inverted: 0 0% 23%;
  }
  .dark {
    --surface: 240 6% 10%;
    --surface-glass: 240 7% 11% / 0.7;
    --surface-glass-strong: 240 7% 11% / 0.88;
    --surface-glass-subtle: 240 7% 11% / 0.4;
    --scrim: 0 0% 0% / 0.55;
    --surface-inverted: 180 3% 94%;
    --surface-inverted-foreground: 240 5% 8%;
    --border-inverted: 0 0% 82%;
  }
}
```

- [ ] **Step 3: Extend `tailwind.config.ts`**

```ts
colors: {
  // ...existing keys unchanged...
  surface: {
    DEFAULT: "hsl(var(--surface))",
    glass: "hsl(var(--surface-glass))",
    "glass-strong": "hsl(var(--surface-glass-strong))",
    "glass-subtle": "hsl(var(--surface-glass-subtle))",
    inverted: "hsl(var(--surface-inverted))",
    "inverted-foreground": "hsl(var(--surface-inverted-foreground))",
  },
  scrim: "hsl(var(--scrim))",
},
borderRadius: {
  frame: "2rem",
  card: "1.25rem",
  nested: "0.75rem",
  base: "0.5rem",
  pill: "9999px",
  lg: "var(--radius)",
  md: "calc(var(--radius) - 2px)",
  sm: "calc(var(--radius) - 4px)",
},
boxShadow: {
  subtle: "0 2px 8px rgba(0,0,0,0.03)",
  raised: "0 4px 16px rgba(0,0,0,0.06)",
  floating: "0 8px 32px rgba(0,0,0,0.08)",
  overlay: "0 12px 40px rgba(0,0,0,0.12)",
},
fontSize: {
  display: ["72px", { lineHeight: "1", letterSpacing: "-0.045em", fontWeight: "800" }],
  "headline-lg": ["48px", { lineHeight: "1.05", fontWeight: "700" }],
  "headline-lg-mobile": ["32px", { lineHeight: "1.1", fontWeight: "700" }],
  "headline-md": ["24px", { lineHeight: "1.2", fontWeight: "600" }],
  "body-lg": ["18px", { lineHeight: "1.5" }],
  "body-md": ["16px", { lineHeight: "1.5" }],
  "label-sm": ["13px", { lineHeight: "1.3", fontWeight: "500" }],
  "label-caps": ["12px", { lineHeight: "1.2", letterSpacing: "0.1em", fontWeight: "600" }],
},
```

Note: dark-mode elevation values differ in DESIGN.md; keep the light values as the base and add `.dark` overrides where a surface needs them (do this only where a screenshot shows the shadow is too weak in dark).

- [ ] **Step 3b: Ensure dark is the default theme**

`presenton-ui/app/providers.tsx` (or wherever `next-themes` is configured) — set `defaultTheme="dark"` and `attribute="class"` if not already. Verify with `browser_evaluate "document.documentElement.className"` → contains `dark`.

- [ ] **Step 4: Evidence pass**

Dashboard, upload, settings: `browser_navigate` → screenshot `p1-<surface>-dark-1280.png` → console/network clean. Compare against `p0-*` screenshots for token/font change. Responsive 375 spot-check on upload.

- [ ] **Step 5: Commit in the fork**

```powershell
git -C presenton-ui add app/globals.css tailwind.config.ts app/providers.tsx
git -C presenton-ui commit -m "theme: UniPilot tokens, radius, elevation, glass, dark-first"
```

### Task P1.3: Motion port

**Files:**
- Create: `presenton-ui/components/motion/*` (14 files copied from `frontend/components/motion/`)
- Modify: `presenton-ui/app/layout.tsx`, `presenton-ui/app/globals.css`, `presenton-ui/package.json`

**Interfaces:**
- Consumes: UniPilot's `frontend/components/motion/` working tree (2026-09-15).
- Produces: `MotionProvider`, `presets.ts` tokens/variants, `MotionPopover`, `MotionListItem`, `MotionNotice`, `MotionSelectionRing`, `Collapsible`, `RouteTransition`, `motionIndex` — available to P2/P3.

- [ ] **Step 1: Copy the primitives**

```powershell
New-Item -ItemType Directory -Force presenton-ui\components\motion | Out-Null
Copy-Item "frontend\components\motion\presets.ts","frontend\components\motion\MotionProvider.tsx","frontend\components\motion\MotionReveal.tsx","frontend\components\motion\MotionRevealGroup.tsx","frontend\components\motion\MotionPopover.tsx","frontend\components\motion\MotionMenu.tsx","frontend\components\motion\MotionListItem.tsx","frontend\components\motion\MotionNotice.tsx","frontend\components\motion\MotionBar.tsx","frontend\components\motion\MotionSelectionRing.tsx","frontend\components\motion\Collapsible.tsx","frontend\components\motion\RouteTransition.tsx","frontend\components\motion\stagger.ts","frontend\components\motion\useRevealRepeat.ts" presenton-ui\components\motion\
```

- [ ] **Step 2: Add the dependency**

```powershell
npm install --prefix presenton-ui motion@^13.1.1
```

- [ ] **Step 3: Port the CSS motion tokens + behaviours**

Append to `presenton-ui/app/globals.css` (values from UniPilot's `globals.css`, verbatim):

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  --duration-press: 140ms;
  --duration-hover: 160ms;
  --duration-popover: 180ms;
  --duration-panel: 220ms;
  --duration-panel-exit: 150ms;
  --duration-entrance: 400ms;
  --duration-reveal: 380ms;
  --duration-reveal-exit: 260ms;
  --stagger-sm: 40ms;
  --stagger-md: 60ms;
  --stagger-lg: 80ms;
}
.press-feedback { transition: transform var(--duration-hover) var(--ease-out), color var(--duration-hover) var(--ease-out); }
.press-feedback:active { transform: scale(0.97); transition-duration: var(--duration-press); }
.hover-lift { transition: transform var(--duration-hover) var(--ease-out); }
@media (hover: hover) and (pointer: fine) { .hover-lift:hover { transform: translateY(-2px); } }
.action-arrow { transition: color var(--duration-popover) var(--ease-out); }
.action-arrow svg, .action-arrow .arrow { transition: transform var(--duration-popover) var(--ease-out); }
.action-arrow:hover svg, .action-arrow:hover .arrow { transform: translateX(3px); }
.icon-turn { transition: rotate var(--duration-popover) var(--ease-out), transform var(--duration-popover) var(--ease-out); }
[data-enter] { animation: motion-enter var(--duration-entrance) var(--ease-out) both; animation-delay: calc(var(--motion-index, 0) * var(--stagger-md)); }
[data-enter="scale"] { animation-name: motion-enter-scale; }
[data-enter="left"] { animation-name: motion-enter-left; }
[data-enter="right"] { animation-name: motion-enter-right; }
@keyframes motion-enter { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes motion-enter-scale { from { opacity: 0; transform: scale(0.97) translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes motion-enter-left { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: none; } }
@keyframes motion-enter-right { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  [data-enter] { animation: none; opacity: 1; transform: none; }
  .press-feedback, .hover-lift, .icon-turn, .action-arrow svg, .action-arrow .arrow { transition: none; }
}
```

- [ ] **Step 4: Mount `MotionProvider` in `app/layout.tsx`**

Wrap the existing `Providers` content:

```tsx
<Providers>
  <MotionProvider>
    <MixpanelInitializer>{children}</MixpanelInitializer>
  </MotionProvider>
</Providers>
```

Add the import: `import { MotionProvider } from "@/components/motion/MotionProvider";`

- [ ] **Step 5: Adapt compile errors**

Run `npx tsc --noEmit -p presenton-ui/tsconfig.json`. The copied primitives may reference UniPilot utility classes that don't exist in Tailwind v3 (e.g. `rounded-card`, `bg-glass`, `text-label-sm`). For each missing utility: if P1.2 already defined it, no change; otherwise add the minimal utility to `tailwind.config.ts`/globals (token-based, never a literal new color). Re-run until clean.

- [ ] **Step 6: Verify in Chromium**

`browser_navigate http://localhost:5002/dashboard` → open an interactive popover/menu (e.g. profile/dashboard menu) → confirm it animates (Motion now drives it if the component was rewired; otherwise only confirm no console errors and reduced-motion CSS). `browser_evaluate` with reduced-motion emulation is not available via MCP; record reduced-motion verification as verified-by-code (the CSS block above) plus a manual `prefers-reduced-motion` probe script if needed.

- [ ] **Step 7: Commit in the fork**

```powershell
git -C presenton-ui add components/motion app/globals.css app/layout.tsx package.json package-lock.json
git -C presenton-ui commit -m "motion: pinned port of UniPilot motion primitives + CSS tokens"
```

### Task P1.4: Foundation phase report

- [ ] **Step 1: Emit the P1 evidence summary** (surfaces compared, font checks, console/network, responsive notes, files changed). Commit if anything is uncommitted. Do not stop; continue to P2 unless a STOP condition fired.

---

## P2 — Primitives

### Task P2.1: Controls

**Files:**
- Modify: `presenton-ui/components/ui/{button.tsx,input.tsx,textarea.tsx,select.tsx,label.tsx,switch.tsx,slider.tsx,progress.tsx,toggle.tsx}`

**Interfaces:**
- Consumes: token utilities from P1.2.
- Produces: controls that read as UniPilot's: pill primary buttons in `font-heading`, solid input fills, token borders/rings, `rounded-base`/`rounded-nested` per hierarchy.

- [ ] **Step 1: Apply the control mapping** (exact rules, per file)

- `button.tsx`: default and primary variants → `rounded-pill font-heading text-label-sm press-feedback`; keep variant names/API; outline variant → `border-border bg-transparent` (solid fill only on hover); destructive unchanged in shape, `bg-destructive text-destructive-foreground`.
- `input.tsx` / `textarea.tsx`: `rounded-base border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring`.
- `select.tsx`: trigger same as input; menu content `rounded-nested border-border bg-popover shadow-overlay`.
- `switch.tsx` / `slider.tsx`: thumb/track in `bg-primary`/`bg-muted`; no new colors.
- `label.tsx`: `text-label-sm text-muted-foreground`.

- [ ] **Step 2: Verify on real pages**

`/upload` (inputs, selects, textarea, buttons), `/dashboard` (buttons/menus), `/settings` (switches/sliders/selects). Screenshots `p2-controls-<surface>-dark-1280.png`; console/network clean; 375 check on upload.

- [ ] **Step 3: Commit in the fork**

```powershell
git -C presenton-ui add components/ui/button.tsx components/ui/input.tsx components/ui/textarea.tsx components/ui/select.tsx components/ui/label.tsx components/ui/switch.tsx components/ui/slider.tsx components/ui/progress.tsx components/ui/toggle.tsx
git -C presenton-ui commit -m "theme: UniPilot-styled controls"
```

### Task P2.2: Surfaces and overlays

**Files:**
- Modify: `presenton-ui/components/ui/{card.tsx,dialog.tsx,sheet.tsx,popover.tsx,dropdown-menu.tsx,tabs.tsx,tooltip.tsx,accordion.tsx,command.tsx,scroll-area.tsx}`

- [ ] **Step 1: Apply the surface mapping**

- `card.tsx`: `rounded-card border-border bg-glass backdrop-blur-md shadow-raised` for the default; keep variant names.
- `dialog.tsx` / `sheet.tsx` / `popover.tsx` / `dropdown-menu.tsx`: panel `rounded-card bg-glass backdrop-blur-md shadow-overlay`; overlay `bg-scrim backdrop-blur-md`; menu items `rounded-base text-label-sm` (headings/filters Bricolage where they are action labels).
- `tabs.tsx`: active tab = inverted pill (`bg-surface-inverted text-surface-inverted-foreground rounded-pill font-heading`), inactive muted; list background `bg-muted rounded-pill p-1`.
- `tooltip.tsx`: `rounded-base bg-primary text-primary-foreground text-label-sm`.
- `accordion.tsx`: trigger `font-heading text-body-md`; content `text-muted-foreground`.
- `command.tsx`: `rounded-card bg-glass shadow-overlay`; items `rounded-base`.

- [ ] **Step 2: Apply Motion where MOTION.md specifies** (P1.3 primitives required)

- Popover/menu content: wrap the content element with `MotionPopover` using the trigger's direction (`down` for header menus, `up` for footer menus) — keep Radix focus/positioning behaviour; only the entrance/exit visual changes.
- Dialogs: keep the native/Radix open state; wrap panel content with `MotionPopover direction="center"`.
- If a component's animation is currently CSS-only via `tailwindcss-animate` data-state classes, replace those classes with the Motion wrapper.

- [ ] **Step 3: Verify**

Open menus (dashboard header), dialogs (delete/confirm flows), tabs (settings/templates), tooltips (buttons), command palette (search). Screenshots `p2-overlays-<surface>-dark-1280.png`; console/network clean.

- [ ] **Step 4: Commit in the fork**

```powershell
git -C presenton-ui add components/ui
git -C presenton-ui commit -m "theme: UniPilot-styled surfaces, overlays, tabs; Motion on popovers/dialogs"
```

### Task P2.3: Feedback + chrome font-class sweep

**Files:**
- Modify: `presenton-ui/components/ui/{loader.tsx,overlay-loader.tsx,skeleton.tsx,sonner.tsx,separator.tsx,table.tsx,progress-bar.tsx}`
- Sweep: chrome files only (see rule below) — replace `font-syne` → `font-heading`, `font-manrope` → `font-sans`

- [ ] **Step 1: Feedback components**

- `skeleton.tsx`: `bg-muted motion-safe:animate-pulse rounded-nested`.
- `sonner.tsx`: toast `rounded-card bg-glass backdrop-blur-md shadow-overlay text-label-sm`.
- `loader.tsx` / `overlay-loader.tsx` / `progress-bar.tsx`: token colors only; keep sizes.
- `separator.tsx`/`table.tsx`: `border-border`; table headers `text-label-sm text-muted-foreground font-heading`.

- [ ] **Step 2: Chrome font-class sweep (exact scope rule)**

Sweep only files under app chrome directories (sidebar/header/dashboard/templates/settings/upload/outline/presentation **chrome** components, `components/ui/**`), **never** files under `components/slide-editor/**` or template/slide **content** renderers. Command (inventory first, then apply):

```powershell
Get-ChildItem presenton-ui -Recurse -File -Include *.tsx,*.ts |
  Where-Object { $_.FullName -notmatch '\\components\\slide-editor\\' -and $_.FullName -notmatch '\\node_modules\\' } |
  Select-String -Pattern 'font-syne|font-manrope' -List |
  ForEach-Object { $_.Path }
```

Review the list, exclude slide-content renderers, then apply per file:

```powershell
# per reviewed file (no BOM: TSX files must stay BOM-free):
$text = Get-Content -LiteralPath $file -Raw
$text = $text -replace 'font-syne', 'font-heading' -replace 'font-manrope', 'font-sans'
[System.IO.File]::WriteAllText((Resolve-Path $file), $text, (New-Object System.Text.UTF8Encoding($false)))
```

Record the final swept-file list in `DIVERGENCE.md`.

- [ ] **Step 3: Remove the temporary bridge**

After the sweep, delete the `syne`/`manrope` keys from `tailwind.config.ts` and verify no references remain (grep). Keep `--font-*` CSS vars.

- [ ] **Step 4: Verify**

`/dashboard`, `/upload`, `/settings`, `/templates` — screenshots `p2-feedback-<surface>-dark-1280.png`; console/network clean; spot-check 768.

- [ ] **Step 5: Commit in the fork**

```powershell
git -C presenton-ui add -A
git -C presenton-ui commit -m "theme: feedback primitives + chrome font sweep (Bricolage/Geist anywhere visible)"
```

---

## P3 — Screens (chrome only)

### Task P3.1: Generate + documents-preview

**Files:** `presenton-ui/app/(presentation-generator)/upload/**`, `presenton-ui/app/(presentation-generator)/documents-preview/**`

- [ ] **Step 1: Restyle** wizard layout/hero/config pill/prompt box/attachments/mode dialog/advanced settings to tokens: glass cards, `rounded-frame` outer panel, `font-heading` action labels, `Collapsible variant="scale"` for advanced options, `MotionNotice` for inline errors, `press-feedback` buttons.
- [ ] **Step 2: Verify** `/upload` and `/documents-preview`: before/after screenshots `p3-generate-*`, console/network clean, 375/768/1280.
- [ ] **Step 3: Commit in the fork** (`git -C presenton-ui add -A; git -C presenton-ui commit -m "theme: generate wizard"`)

### Task P3.2: Outline

**Files:** `presenton-ui/app/(presentation-generator)/outline/**`

- [ ] **Step 1: Restyle** template-selection cards, staged headers, streamed outline cards (`MotionListItem` in `AnimatePresence`), add-slide affordances, AI sidebar shell (chrome only), bottom continue bar.
- [ ] **Step 2: Verify** `/outline` (empty state without `id`; with a generated deck's id if available): screenshots `p3-outline-*`, console/network, responsive.
- [ ] **Step 3: Commit in the fork** (`git -C presenton-ui commit -am "theme: outline screen"`)

### Task P3.3: Templates + template preview

**Files:** `presenton-ui/app/(presentation-generator)/(dashboard)/templates/**`, `presenton-ui/app/(presentation-generator)/template-preview/**`

- [ ] **Step 1: Restyle** tab switcher (inverted pill active state), template cards, create-custom entry card, preview editor chrome (left layouts panel, header, side panel shells) — the slide canvas itself is content and stays untouched.
- [ ] **Step 2: Custom-template studio**: theme only where cheap (step headers/progress/buttons); record any deferred surfaces in `DIVERGENCE.md`.
- [ ] **Step 3: Verify** `/templates`, `/template-preview?templateV2Id=general`, `/custom-template`: screenshots `p3-templates-*`, console/network, responsive.
- [ ] **Step 4: Commit in the fork** (`git -C presenton-ui commit -am "theme: templates + preview chrome"`)

### Task P3.4: Viewer + present mode

**Files:** `presenton-ui/app/(presentation-generator)/presentation/components/{PresentationPage,PresentationHeader,SidePanel,SlideThumbnailCard,PresentationMode,...}.tsx` (chrome components only; `SlideContent`/renderers untouched)

- [ ] **Step 1: Restyle** header controls pill (buttons/menus via Motion), thumbnail rail (glass rail, `MotionSelectionRing` on the selected slide, `MotionListItem` for reorder), slide action bar, present-mode chrome (progress, layout grid, speaker-note panel, exit control) — stage/canvas untouched.
- [ ] **Step 2: Verify** open a real deck: viewer, rail selection/reorder visuals, present mode (keys, grid, notes). Screenshots `p3-viewer-*`, console/network, responsive.
- [ ] **Step 3: Commit in the fork** (`git -C presenton-ui commit -am "theme: deck viewer + present mode chrome"`)

### Task P3.5: Editor chrome

**Files:** `presenton-ui/app/(presentation-generator)/presentation/components/PresentationActions.tsx` and the editor panel/toolbar/palette **DOM** shells (not `components/slide-editor/**` canvas internals)

- [ ] **Step 1: Restyle** the insertion palette, toolbars' containers, AI chat panel chrome, dialogs/modals, toasts — all in tokens; apply `MotionPopover` to panels/toolbars and `Collapsible` to option groups. Do not touch Konva/TipTap/dnd behaviour or slide canvas rendering.
- [ ] **Step 2: Verify** open a deck's editor: palette, a text toolbar, the AI panel, an image dialog. Screenshots `p3-editor-*`, console/network. Confirm the slide canvas still renders identically to P0.
- [ ] **Step 3: Commit in the fork** (`git -C presenton-ui commit -am "theme: editor chrome"`)

### Task P3.6: Settings + onboarding (+ admin if cheap)

**Files:** `presenton-ui/app/(presentation-generator)/(dashboard)/settings/**`, `presenton-ui/app/(presentation-generator)/OnBoarding/**`, `app/(presentation-generator)/(dashboard)/admin/**` (only if user-facing and cheap)

- [ ] **Step 1: Restyle** settings sidebar/sections/forms; onboarding steps; admin only if it appears for the current user and the change is contained — otherwise record as deferred.
- [ ] **Step 2: Verify** `/settings`, onboarding (if reachable; otherwise verify by code + note), `/admin` if visited. Screenshots `p3-settings-*`, console/network, responsive.
- [ ] **Step 3: Commit in the fork** (`git -C presenton-ui commit -am "theme: settings + onboarding"`)

### Task P3.7: P3 evidence + STOP

- [ ] **Step 1: Full sweep check** — every P0 baseline route re-shot as `p3-<route>-dark-{375,768,1280}.png`; console/network clean on all; note any remaining upstream-colored surface.
- [ ] **Step 2: Update `DIVERGENCE.md`** with the full theme file list.
- [ ] **Step 3: Commit and STOP — P3 review.** Report screenshots, remaining gaps, and the P4 plan confirmation (proxy or link-only).

---

## P4 — Surfacing from UniPilot

### Task P4a.1: Env-driven edit URL with honest fallback

**Files:**
- Modify: `frontend/lib/integrations/presentonConfig.ts`
- Modify: `frontend/lib/integrations/presenton.ts`
- Modify: `frontend/app/(app)/tools/presentation/page.tsx`, `frontend/app/(app)/tools/presentation/[id]/edit/page.tsx`
- Modify: `frontend/.env.example`, `frontend/.env.development.local.example`, `docs/integrations/presenton.md`

**Interfaces:**
- Produces: `presentonUiUrl(): string | null`; `resolveEditorUrl(presentationId: string): Promise<string | null>` — preferred fork URL when reachable, else today's engine URL, else `null`.
- Consumes: `PRESENTON_UI_URL` (server-only), existing `presentonEditUrl()`.

- [ ] **Step 1: Add the env reader** in `presentonConfig.ts`:

```ts
export function presentonUiUrl(): string | null {
  const value = process.env.PRESENTON_UI_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}
```

- [ ] **Step 2: Add the resolver** in `presenton.ts`:

```ts
export async function resolveEditorUrl(
  presentationId: string,
): Promise<string | null> {
  const engineUrl = presentonEditUrl(presentationId);
  const uiUrl = presentonUiUrl();
  if (!uiUrl) return engineUrl;

  try {
    const response = await fetch(`${uiUrl}/api/v1/auth/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return engineUrl;
    return `${uiUrl}/presentation?id=${encodeURIComponent(presentationId)}`;
  } catch {
    return engineUrl;
  }
}
```

- [ ] **Step 3: Use it in both pages** — replace the `presentonEditUrl(...)` calls with `await resolveEditorUrl(...)`; no other behaviour changes (guests/unknown ids keep 404ing; the wrapper keeps its unavailable state).

- [ ] **Step 4: Docs + env examples** — document `PRESENTON_UI_URL` in both `.env*.example` files and `docs/integrations/presenton.md` §3.6 (server-only; when set and reachable, the Edit deck link/iframe uses the fork; when unset/unreachable, the embedded engine editor is used — never a dead link).

- [ ] **Step 5: Verify both branches** — with the fork running: tool page HTML contains the `:5002` URL; stop the fork (`taskkill` the dev process), reload the tool page: HTML contains the engine URL. Screenshots `p4a-editlink-fork.png`, `p4a-editlink-fallback.png`. If the user is not authenticated, verify via the server-rendered page response or an authenticated MCP session per `QA_SESSION.md` (STOP if the QA session is unavailable).

- [ ] **Step 6: No commit** (UniPilot repo; working tree only).

### Task P4a.2: P4a evidence report (no stop unless blocked)

### Task P4b (optional, only after P3 review confirms): proxy + same-origin iframe

- [ ] **Step 1:** Make the fork's `basePath` env-driven (`process.env.PRESENTON_UI_BASE_PATH ?? ""`) — never a literal.
- [ ] **Step 2:** Add the UniPilot rewrite `/presenton/:path*` → `${PRESENTON_UI_INTERNAL_URL}/presenton/:path*` in `frontend/next.config.ts`, env-driven with a default.
- [ ] **Step 3:** Point the wrapper iframe at the proxy path; verify assets, deep links, and a production build (dev HMR websockets do not traverse the proxy — document using the direct origin for dev).
- [ ] **Step 4:** Evidence + docs; if anything is not clean, revert to link-only and record the reason.

---

## P5 — Optional orchestration + update drill

### Task P5.1: Optional fork service in the dev orchestrator

**Files:** `scripts/start-env.mjs` (UniPilot; working tree only); `DIVERGENCE.md` (fork)

- [ ] **Step 1:** Add a warn-only `ensurePresentonUi()` step: if `presenton-ui/package.json` exists and nothing serves `http://127.0.0.1:${PRESENTON_UI_PORT ?? 5002}`, spawn `npm run dev` there with the engine URL env; on any failure log a warning and continue (never fail the run).
- [ ] **Step 2:** Document the manual command in `DIVERGENCE.md`: `cd presenton-ui && npm run dev` (PORT/PRESENTON_ENGINE_URL overridable).
- [ ] **Step 3:** Verify `npm run dev` still starts with the fork absent (rename test: temporarily move `presenton-ui` — or simply confirm by code path — then restore) and with it present.

### Task P5.2: Upstream update drill + final DIVERGENCE.md

- [ ] **Step 1:** Fetch upstream `github.com/presenton/presenton` `servers/nextjs` into a temp dir (shallow); run the recorded diff procedure against the baseline commit; confirm the changed-file list matches `DIVERGENCE.md` and note any drift.
- [ ] **Step 2:** Finalize `DIVERGENCE.md` (full changed-file list, update procedure validated, OneDrive note/path, legal note) and commit in the fork.

### Task P5.3: Final report

- [ ] **Step 1:** Summarize phases, evidence, remaining gaps, and what changed in UniPilot's working tree (files only; nothing committed).

---

## Self-Review

- **Spec coverage:** D1 location/ignore → P0.1; D2 fork repo → P0.1; D3 token-first → P1.2/P2/P3; D4 fonts → P1.1; D5 motion → P1.3/P2.2; D6 dark-first → P1.2 step 3b; D7 surfacing + fallback → P4a; D8 export delegation → P0.3; D9 branding → P3 chrome + legal note in DIVERGENCE.md; D10 pin/update → P0.6/P5.2. Refinements: env-driven URL/port → P0.2; honest fallback → P4a; OneDrive note → P0.2/P0.6; legal pages → global constraints; settings/onboarding in P3 → P3.6; admin-if-cheap → P3.6; optional orchestrator → P5.1.
- **Placeholders:** none intentionally left; uncertainty (engine export path shape, auth gate) is handled with explicit record-and-STOP steps, not guesses.
- **Type consistency:** `presentonUiUrl()` / `resolveEditorUrl()` used consistently in P4a; fork env knobs `PORT`/`PRESENTON_ENGINE_URL` consistent across P0.2/P5.1.

---

## Execution log

### P0 — completed 2026-09-15 (except a founder-gated provider fix)

- **P0.1** done. Fork at `presenton-ui/` (864 files), git-ignored
  (`.gitignore:71`), own repo; baseline commit
  `3f1ce2aa6be9947ceaee4b995997cd5689ce357b`.
- **P0.2** done with one addition discovered while smoking: `scripts/dev.mjs`
  now also wires `USER_CONFIG_PATH` to `../presenton-main/app_data/userConfig.json`
  (env-overridable `PRESENTON_USER_CONFIG_PATH`). Without it the fork's
  `runtime-config` reports `configured:false` and upstream's
  `ConfigurationInitializer` revalidation redirects every app route to
  `/upload` (an upstream race the container hides because its config path
  exists). Recorded in `DIVERGENCE.md`.
- **P0.3** done: both export handlers delegate to
  `POST /api/v1/ppt/presentation/{id}/export`; typecheck clean; committed
  `4fd5fa8`.
- **P0.4** done: all 10 routes smoked in real Chromium — 0 console errors
  everywhere (only upstream `404.svg`/`card_bg.svg` preload warnings);
  screenshots `frontend/screenshots/p0-*.png`; 375 px spot-checks done.
  Recorded upstream behaviours: `/` → `/upload`; `/presentation` without id →
  `/upload`; `/outline` empty state renders.
- **P0.5** complete (with two recorded caveats). After the founder's provider
  fixes (`LLM_REASONING_MODE=disabled`, `LLM_MAX_OUTPUT_TOKENS=1000`):
  generate → prepare → live slide stream → persisted deck → viewer all work
  through the fork (real content: "The Early Invention" slide with generated
  images; 17 assets loaded, 0 console errors). Export proven for both formats:
  PDF 911,303 bytes (existing deck) and PPTX 10,151 bytes (new deck, valid
  21-entry OOXML). Caveats recorded in `DIVERGENCE.md`: (a) the 1000-token cap
  truncates the outline → 1-slide decks (provider/tier tradeoff, not the
  fork); (b) the fork's **dev-server** long SSE stream disconnected at ~4–5
  min twice — the engine cancelled the LLM stream and the client stayed in
  "streaming" until reload; a fresh `stream=true` **resumed from persisted
  slides** and completed. Production-build streaming is the first mitigation
  to try in P5 (or a fork runtime timeout patch); UniPilot's worker path is
  unaffected.
- **P0.6** done: `DIVERGENCE.md` written and committed (`6a73499`,
  `c2d5bb7`). Fork commits: `3f1ce2a` baseline → `9afe101` runtime →
  `d92b7c3` hygiene → `4fd5fa8` export → `6a73499` divergence → `c2d5bb7`
  config path.

**UniPilot working-tree changes so far:** `.gitignore` (one ignore block) plus
the new spec/plan docs. No app behaviour touched, nothing committed.

**P0 review gate:** awaiting founder review + the provider fix before P1.

### P1 — completed 2026-09-15

- Fonts (`37ed375`): Bricolage/Geist/Geist Mono copied to `public/fonts/unipilot/`
  (+ Bricolage OFL), `@font-face` + body font swapped, tailwind font keys
  added with a temporary `syne`/`manrope` bridge. Verified in Chromium:
  body Geist, headings/buttons Bricolage, all three faces load.
- Tokens (`7ae677c`): full HSL remap (light + dark), glass/scrim/inverted vars,
  radius/elevation/type scales, `class="dark"` server-rendered; verified live
  values + dark body.
- Motion (`dfb7921`): 14 primitives copied verbatim (no adaptation patches
  needed), `motion@13.1.1`, CSS tokens/behaviours, `MotionProvider` mounted;
  verified `press-feedback`/`hover-lift` transitions, reduced-motion block,
  typecheck clean.
- Evidence: `frontend/screenshots/p1-*.png` (dashboard fonts/tokens, upload,
  settings), 0 console errors throughout.

### P2 — completed 2026-09-15

- Controls (`c0e3f90`), surfaces/overlays (`458bd59`, plus the flat `bg-glass`
  key fix), feedback + 54-file chrome font sweep (`219a22e`). Verified with
  live computed styles: pill Bricolage buttons, glass Export popover
  (12px radius / 687ms glass / blur), themed dialog geometry; caller-level
  hard-coded overrides identified as P3 work.

### P3 — completed (bulk pass), paused for review

- Two scripted token-mapping passes over chrome files (79 + 13 editor-chrome,
  ~1,563 literals) — commit `0047226`. Verified screens with 0 console errors:
  generate, dashboard, templates, settings, viewer/editor (canvas intact).
- Remaining tail recorded in `DIVERGENCE.md`: ~246 literals, 5 gradients,
  content-adjacent areas on the bridge, present-mode/editor-palette dedicated
  pass pending (P3 cont.), settings switch caller override.
- Screenshots: `frontend/screenshots/p3-*.png`.

### P3 tail — completed

- Generalized + palette-family sweep across chrome and the 12 slide-editor
  chrome files; gradients replaced with solid tokens. Final census: 0 hex
  classes / 0 gradients in scope; 1 content-file residual (`SlideContent.tsx`).
- Verification: dark screens (generate/dashboard/templates/settings/outline/
  editor at 1280; generate/dashboard at 375; editor at 768), light probe
  (body `#f4f4f5`, glass `rgba(242,242,243,.6)`), reduced-motion emulation
  (transition `0s/none`, `[data-enter]` animation `none`), console clean on
  navigations. Screenshots `frontend/screenshots/p3-tail-*.png`.
- Frozen content scope recorded in `DIVERGENCE.md` (slide-editor canvas/data
  editors, template/custom previews, SlideContent/V1ContentRender/PresentationMode
  stage, pdf-maker/runtime, slide-theme deck cards); `syne`/`manrope` bridge
  retained for those files only.
