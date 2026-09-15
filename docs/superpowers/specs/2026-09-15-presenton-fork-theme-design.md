# Presenton UI fork — re-theme and surface — design

Date: 2026-09-15
Status: awaiting founder review. No code written; nothing committed.
Task refs: TASK.md `31.8` (slide editing) / `31.9` (reordering) get the fork path
as the interim delivery; the native-rebuild spec
(`docs/superpowers/specs/2026-09-15-presentation-ui-design.md`) stays parked as
the long-term track — this fork does not cancel it.
Rules: UniPilot app behaviour unchanged; only UniPilot fonts/colors/motion; the
fork lives outside UniPilot's git; no commits unless asked.

## 1. Summary

Fork Presenton's Next.js frontend (`presenton-main/servers/nextjs`) into a
git-ignored `presenton-ui/` at the repo root, with its own git repo. Re-theme
its shadcn/Tailwind v3 CSS-variable system to UniPilot's design tokens, port
UniPilot's Motion presets into it, keep the engine (Presenton on :5001) and all
editor internals (Redux/TipTap/Konva/dnd) as they are, then surface it from
UniPilot: first a link via a new server-only env var, then (optional) a
same-origin reverse proxy under `/presenton` with the editor iframed in UniPilot
chrome.

Why a fork: an iframe's interior is a separate origin and cannot be restyled;
forking is the only way to get the whole Presenton app in UniPilot's look
without the full native rebuild.

## 2. Goal / non-goals

Goal:

- The whole Presenton app (generate, outline, templates, viewer, editor,
  settings/onboarding) reads as UniPilot: Bricolage Grotesque headings/actions,
  Geist body, Geist Mono metadata; monochrome tokens; glass recipe; radius and
  elevation scales; UniPilot's motion vocabulary.
- Engine unchanged: the fork talks to Presenton on :5001 for every API and
  asset call; all generation/export/persistence stays the engine's.
- Surfaced from UniPilot with a minimal, reversible touchpoint.
- Divergence from upstream is documented and updatable.

Non-goals:

- No changes to UniPilot's app behaviour (only a new env var + the existing
  "Edit deck" target, plus an optional routing rewrite for phase 4).
- No Presenton source committed to UniPilot's git; the fork is git-ignored and
  keeps its own repo.
- No provider/admin UI changes, no Presenton Cloud contact, no analytics
  (Mixpanel disabled in the fork).
- No native editor rebuild in this program.

## 3. Decisions

- **D1 — Location.** `presenton-ui/` at the repo root, added to `.gitignore`
  as `/presenton-ui/` (mirrors the `/presenton-main/` precedent; one ignore
  line, easy local orchestration). The fork directory contains its own `.git`.
- **D2 — Fork repo.** `git init` inside `presenton-ui/`; commit 1 = pristine
  upstream snapshot of `servers/nextjs` (recorded: Next 16.2.6, checkout
  snapshot 2026-09-15); theme work on branch `unipilot-theme`. The UniPilot
  repo is never committed to; the nested repo is unreachable from the parent.
- **D3 — Theme-first strategy.** Remap the fork's HSL CSS variables in
  `app/globals.css` + extend `tailwind.config.ts` to UniPilot tokens; then a
  grep-driven class sweep for what tokens can't reach (hard-coded colors,
  gradients, radius/shadow outliers). Theme edits stay concentrated in
  identifiable files so upstream rebases are predictable.
- **D4 — Fonts.** Copy Bricolage Grotesque (variable TTF), Geist and Geist
  Mono (variable WOFF2) from `frontend/app/fonts/` into
  `presenton-ui/public/fonts/` with their OFL license files; define
  `@font-face` in the fork's globals; replace `font-syne`/`font-manrope`
  usages in app chrome with `font-heading`/`font-sans`/`font-mono` (77 files
  reference `font-syne`). Deck/slide preview rendering keeps its own deck
  fonts — the sweep is scoped to chrome, never slide content.
- **D5 — Motion.** Add the `motion` dependency and port
  `frontend/components/motion/*` as a pinned copy into
  `presenton-ui/components/motion/` (provider + presets + CSS behaviours),
  then apply it to chrome surfaces during the screen sweep per MOTION.md's
  mapping. The copy is recorded in `DIVERGENCE.md` with its provenance date and
  a re-sync procedure (re-copy + re-apply the small adaptation patch).
- **D6 — Dark-first.** Fork defaults to dark (`next-themes`, matching
  UniPilot's server-rendered `.dark` behaviour); both token sets are defined
  so light mode is complete, but dark is the out-of-box state.
- **D7 — Surfacing.** Surfacing step P4a: new server-only env
  `PRESENTON_UI_URL`; the adapter's `presentonEditUrl()` returns it when set,
  so the tool page's "Edit deck" link and the existing wrapper iframe point at
  the fork. Proxy step P4b (optional): fork `basePath: '/presenton'` + a
  UniPilot rewrite proxy and same-origin iframe.
- **D8 — Export delegates to the engine.** The fork's bundled-export route is
  unusable locally (`presentation-export/` is absent from this checkout and
  the route needs `APP_DATA_DIRECTORY` + `@presenton/export-core`). The export
  button is rewired to the engine's
  `POST /api/v1/ppt/presentation/{id}/export` (already covered by the fork's
  rewrite), then downloads the returned `/app_data/...` path through the same
  proxy. The upstream route stays in the tree, unused, recorded in
  `DIVERGENCE.md`. Exported decks are rendered by the engine's bundled UI, so
  export output is unchanged.
- **D9 — Branding.** Swap Presenton wordmark/logo/splash strings on app chrome
  surfaces for UniPilot's wordmark; keep page titles honest ("Presentations —
  UniPilot"). Upstream's LICENSE/NOTICE stay in the fork (Apache-2.0; the
  fork is local and not redistributed). No new imagery or fonts.
- **D10 — Pin + update.** The fork pins the running snapshot (Next 16.2.6,
  image built 2026-09-08). Update procedure: fetch upstream
  `github.com/presenton/presenton` at the new tag/commit, diff
  `servers/nextjs` against the baseline commit, replay the theme commit,
  resolve conflicts inside the theme files (globals.css, tailwind config,
  `components/ui/*`, `components/motion/*`).

## 4. Fork setup and engine wiring

Step 0 (mechanical, verified before any styling):

1. Copy `presenton-main/servers/nextjs` → `presenton-ui/`; add `/presenton-ui/`
   to the repo `.gitignore`; `git init` + baseline commit inside the fork.
2. `npm install` in the fork (heavy deps: konva, mermaid, cypress,
   react-konva). If the Cypress binary download stalls, set
   `CYPRESS_INSTALL_BINARY=0` (not needed for dev).
3. Wiring:
   - `next.config.mjs` gains `rewrites()` — `beforeFiles` entries for
     `/api/v1/:path*`, `/api/v2/:path*`, `/static/:path*`, `/app_data/:path*`,
     `/vendor/:path*` → `http://localhost:5001/...` (the fork's own route
     handlers are all non-`/api/v1` paths, so nothing is shadowed).
   - `.env.local`: `FAST_API_INTERNAL_URL=http://localhost:5001` (server-side
     route handlers), `NEXT_PUBLIC_FAST_API` left unset (browser stays
     same-origin through the fork's rewrites).
   - Disable Mixpanel/telemetry and any cloud affordances at the config level
     where possible; otherwise neutralize the initializer (D9 rules).
4. Run `npm run dev -- -p 5002` (the fork keeps its own `next dev`;
   `allowedDevOrigins` already permits localhost). The engine stays on :5001,
   untouched.
5. Smoke every route in Chromium (Playwright MCP): `/`, `/upload`, `/outline`,
   `/presentation?id=…`, `/dashboard`, `/templates`, `/template-preview`,
   `/settings`; verify a real generate → viewer → export round-trip against
   the engine; capture baseline screenshots.

Known standalone differences to record: the fork's export delegates to the
engine (D8); `pdf-maker` is served by the engine's UI during export; auth is
the engine's (`DISABLE_AUTH=true` locally, the browser session cookie is
forwarded through the proxy when auth is on).

## 5. Theme mapping

### 5.1 Tokens (exact HSL triplets for the fork's CSS vars)

The fork uses shadcn-style `hsl(var(--x))`; UniPilot's hex values convert 1:1.
Light values first, dark second:

| Fork var | Light | Dark |
|---|---|---|
| `--background` | `240 5% 96%` | `240 7% 8%` |
| `--foreground` | `180 4% 11%` | `180 3% 94%` |
| `--card` / `--card-foreground` | `0 0% 100%` / `180 4% 11%` | `240 6% 12%` / `180 3% 94%` |
| `--popover` / `--popover-foreground` | `0 0% 100%` / `180 4% 11%` | `240 6% 12%` / `180 3% 94%` |
| `--primary` / `--primary-foreground` | `0 0% 0%` / `0 0% 100%` | `0 0% 100%` / `240 5% 8%` |
| `--secondary` / `--secondary-foreground` | `0 0% 37%` / `0 0% 100%` | same |
| `--muted` / `--muted-foreground` | `240 4% 95%` / `351 5% 28%` | `240 7% 11%` / `350 3% 61%` |
| `--accent` / `--accent-foreground` | `0 0% 93%` / `180 4% 11%` | `240 5% 17%` / `180 3% 94%` |
| `--border` / `--input` / `--ring` | `0 0% 90%` / `0 0% 90%` / `0 0% 0%` | `240 5% 19%` / `240 5% 19%` / `0 0% 100%` |
| `--destructive` / `--destructive-foreground` | `0 75% 42%` / `0 0% 100%` | `358 75% 59%` / `0 0% 100%` |

Additions (new vars + Tailwind theme keys): `--surface`, `--surface-glass`,
`--surface-glass-strong`, `--surface-glass-subtle`, `--scrim`,
`--surface-inverted` + foreground/border, `--surface-cta` + foreground, and
the glass utilities (`bg-glass`, `bg-glass-strong`, `bg-glass-subtle`,
`bg-scrim`) with the fixed `backdrop-blur-md` + `1px border` recipe.

### 5.2 Radius and elevation

- Radius: `--radius-frame: 2rem`, `--radius-card: 1.25rem`,
  `--radius-nested: 0.75rem`, `--radius-base: 0.5rem`, pill = `9999px`;
  Tailwind keys `rounded-frame/card/nested/base/pill`. At <480px
  frame→1.5rem, card→1rem.
- Elevation: `shadow-subtle`, `shadow-raised`, `shadow-floating`,
  `shadow-overlay` copied from DESIGN.md; one level per surface; interactive
  surfaces step one level on hover.

### 5.3 Typography

- `font-heading` = Bricolage Grotesque (major headings **and** action labels:
  buttons, chips, segmented controls); `font-sans` = Geist (body, fields,
  nav); `font-mono` = Geist Mono (metadata, filenames, code).
- Type steps copied as Tailwind `fontSize` keys: `display`,
  `headline-lg(-mobile)`, `headline-md`, `body-lg`, `body-md`, `label-sm`,
  `label-caps`.
- Remove Syne/Manrope `@font-face` + Tailwind keys + the `/vendor/fonts`
  dependency for UI fonts; deck-rendered fonts are untouched.

### 5.4 Motion tokens

Port `--ease-out`, `--ease-in-out`, `--duration-*`, `--stagger-*`, and the
CSS behaviours (`press-feedback`, `hover-lift`, `action-arrow`, `icon-turn`,
`[data-enter]` ladder, `[data-collapsible]`) from UniPilot's `globals.css`;
port the `presets.ts` values verbatim so the two codebases share one
vocabulary.

## 6. Re-theme strategy and measured scope

Measured across 883 source files (excluding node_modules):

| Category | Files | Treatment |
|---|---|---|
| `font-syne` (brand font) | 77 | sweep to `font-heading`/`font-sans` in chrome; leave slide-content components |
| `font-manrope` | ~20 (97 combined) | body font → `font-sans` |
| Gradients | 54 | remove (no gradients in UniPilot except its page-background system, which the fork does not adopt) |
| Hard-coded `bg/text-white/black` | 129 | map to token utilities where they are chrome; leave inside slide-rendering components |
| Gray/neutral scale classes | 31 | map to `bg-muted`/`text-muted-foreground`/`border-border` |
| Shadows | 52 | map to the four elevation utilities |
| Radius (`xl/2xl/3xl/full`) | 86 | map to the five-step scale (pills stay pills) |

Order of work: token remap (one file) → `tailwind.config.ts` (one file) →
`components/ui/*` primitives (31 files) → app shell (sidebar/header/dashboard)
→ screens in the order generate, outline, templates, viewer, editor chrome,
settings/onboarding. Every change keeps slide/template **content** rendering
on its deck fonts/colors (only chrome is themed).

## 7. Motion port

Port these files from `frontend/components/motion/` (pinned copy, adapted for
Tailwind v3 — any v4-only utility names the primitives reference get
equivalents in the fork's theme):

`presets.ts`, `MotionProvider.tsx`, `MotionReveal.tsx`,
`MotionRevealGroup.tsx`, `MotionPopover.tsx`, `MotionMenu.tsx`,
`MotionListItem.tsx`, `MotionNotice.tsx`, `MotionBar.tsx`,
`MotionSelectionRing.tsx`, `Collapsible.tsx`, `RouteTransition.tsx`,
`stagger.ts`, `useRevealRepeat.ts`.

Application policy (MOTION.md mapping, chrome only): popovers/dropdowns/dialog
contents use `MotionPopover`; slide/document list rows use `MotionListItem`
inside `AnimatePresence`; selection (thumbnails, toolbar tools) uses
`MotionSelectionRing`; inline status/errors use `MotionNotice`; advanced
option groups use `Collapsible`; buttons keep `press-feedback`. Editor canvas
internals (Konva drag/resize, TipTap, dnd-kit) are not touched. Reduced motion:
`MotionProvider` sets `MotionConfig reducedMotion="user"`; verify once per
surface.

## 8. Surfacing from UniPilot

P4a — link/iframe to the fork origin (minimal, reversible):

- `frontend/lib/integrations/presentonConfig.ts` gains `presentonUiUrl()`
  (`PRESENTON_UI_URL`, server-only); `presentonEditUrl()` prefers it over
  `PRESENTON_PUBLIC_URL ?? PRESENTON_URL`.
- The tool page's "Edit deck" link and the wrapper iframe automatically point
  at the fork; no other UniPilot change. Env example + `docs/integrations/
  presenton.md` §3.6 get the new variable documented.
- Acceptance: the presentation tool page → Edit deck loads the themed fork;
  guests/unknown ids keep 404ing as today.

P4b — proxy (optional, per review): run the fork with `basePath: '/presenton'`;
add a rewrite in UniPilot's `next.config.ts` from `/presenton/:path*` to the
fork origin; iframe the fork from the tool page (same-origin, no cross-origin
caveats) and optionally offer "open full screen". Risks to verify: absolute
asset paths in the fork, Next dev HMR websockets (dev-time embedding uses the
direct origin; the proxy path is verified against a production build), deep
links, cookie scope on `localhost:3000` (Presenton session cookies would land
on UniPilot's origin when auth is enabled — harmless names, but recorded).

## 9. Divergence and upstream updates

`presenton-ui/DIVERGENCE.md` records:

1. **Snapshot**: source path, date, Next/React versions, engine image build
   the snapshot matches; baseline commit hash in the fork repo.
2. **Changed files** grouped by concern: wiring (next.config rewrites,
   `.env.local`, analytics off), theme (globals.css, tailwind.config.ts,
   `components/ui/*`, font files), motion (`components/motion/*`),
   branding, export delegation.
3. **Update procedure** (per new upstream release): fetch
   `github.com/presenton/presenton` (tag/commit), diff its `servers/nextjs`
   against the fork's baseline commit, `git rebase`/cherry-pick the theme
   branch, resolve conflicts in the theme files only, re-run the per-screen
   Chromium checklist, update the recorded hash.
4. **License note**: Apache-2.0 upstream, LICENSE/NOTICE kept; modifications
   listed (Apache-2.0 §4); fork is local, git-ignored, not redistributed.

## 10. Phases and evidence

Each phase is independently verifiable with real-Chromium evidence via the
browser-qa skill (Playwright MCP, console/network, 375/768/1280, screenshots
into `frontend/screenshots/`, no secrets in evidence). No commits unless
asked.

- **P0 — Fork + wiring.** §4. Evidence: baseline screenshots of every route;
  a real generate → viewer → export round-trip through the engine; console
  clean; `DIVERGENCE.md` started.
- **P1 — Foundation.** Fonts, tokens, radius/elevation/glass, dark-first,
  motion provider + presets + CSS tokens. Evidence: before/after on dashboard,
  upload and settings; computed font-family checks (Bricolage/Geist/Geist
  Mono only); reduced-motion smoke.
- **P2 — Primitives.** `components/ui/*` restyle. Evidence: per-primitive
  surfaces via real pages (buttons/cards/inputs/selects/menus/dialogs/tabs/
  tooltips/toasts), dark + light.
- **P3 — Screens.** generate → outline → templates → viewer → editor chrome →
  settings/onboarding. Evidence: per-screen before/after, motion applied per
  §7, console/network clean, responsive pass.
- **P4 — Surfacing.** P4a link/iframe wiring, then the optional P4b proxy.
  Evidence: UniPilot tool page → editor flow, fallback/honest states unchanged.
- **P5 — Divergence + updates.** Finish `DIVERGENCE.md`, dry-run the update
  procedure against upstream, optional `npm run dev` orchestration for the
  fork.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Class sweep breadth (883 files, 129 hard-coded colors, 54 gradients) | Token-first remap, grep-driven checklist, chrome-vs-deck-content scope rule, per-screen evidence |
| Motion port friction with Tailwind v3 utilities | Port the missing utilities into the fork's theme; verify each primitive in Chromium; keep the copied files close to upstream for re-sync |
| Export relies on the engine | Rewire export to the engine endpoint (D8) and prove it in P0 before theming |
| Fork dev + engine + Supabase on 7.7 GB RAM | Run the fork's dev server only while working on it; the engine stays containerized |
| Upstream drift | Pinned snapshot, fork repo with baseline + theme branch, documented rebase procedure and dry run |
| Proxy/basePath breaks assets or websockets | Defer to P4; verify against a production build; fall back to link-only if not clean |
| Theme edits touching slide content rendering | Explicit scope rule + review of changed files in `DIVERGENCE.md` |

## 12. Open questions

1. **Proxy timing (P4b)**: proxy + same-origin iframe after P3 (recommended),
   or skip the proxy and stay link/cross-origin iframe only?
2. **Settings/admin screens**: theme them in P3 (recommended, they are part of
   "the whole app") or leave functional/unthemed for a later pass?
3. **Branding depth**: app chrome + page titles only (recommended), or also
   rewrite marketing/legal pages the fork carries (`privacy-policy`, etc.)?
4. **Orchestration**: add the fork to `npm run dev` (start-env.mjs) in P5, or
   keep it a manual `npm run dev -- -p 5002` in `presenton-ui/`?

## 13. Out of scope / recorded gaps

- Native slide rendering/editing (parked spec); this fork is the interim.
- Presenton Cloud, analytics, provider onboarding rewrites.
- Upstream marketing site content, legal pages (unless Q3 says otherwise).
- Publishing or deploying the fork anywhere; it stays local and git-ignored.
