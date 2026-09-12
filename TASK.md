# UniPilot — Master Build Plan

## Purpose

Single source of truth for building UniPilot into a production-ready academic workspace and AI productivity platform.

This file governs:
- scope
- dependency order
- implementation state
- architectural constraints
- verification requirements
- launch readiness

Task IDs are permanent. Never renumber an existing task.

Execution order is controlled by the **Execution Order** section, not by numeric task ID.

---

# 0. GLOBAL RULES

## 0.1 — Inspect before changing

- Read `TASK.md`, `AGENTS.md`, `DESIGN.md`, `MOTION.md` and relevant files before implementation.
- Never assume the repository is empty.
- Never rebuild an existing feature without first determining whether it already exists.
- If functionality already exists, refine or verify it instead of duplicating it.

## 0.2 — One task at a time

- Implement exactly one requested task per prompt.
- Do not silently implement future tasks.
- If a dependency is missing, report the dependency and stop.
- Do not work around blockers with temporary architecture.

## 0.3 — Preserve UniPilot's visual system

The established product language is:
- monochrome black / white / gray
- Geist for body UI
- Bricolage Grotesque for major headings
- Geist Mono for metadata / technical labels
- translucent glass surfaces
- fixed dotted background canvas
- thin gray borders
- restrained shadows
- rounded cards
- compact controls
- pill CTAs where appropriate
- existing spacing/radius tokens
- no random gradients
- no arbitrary color accents

Do not replace the design with a generic SaaS template.

## 0.4 — Maintainable architecture

- TypeScript throughout.
- Reusable components over duplicated markup.
- Marketing UI remains separate from app UI.
- Presentation remains separate from data/business logic.
- AI logic remains separate from UI.
- Database access remains separate from presentational components.
- Avoid giant page/component/utility files.
- Prefer server components for server-owned data.
- Use client components only when interaction requires them.

## 0.5 — Definition of Done

A task is complete only when:
1. Implementation/refinement is complete.
2. `npm run typecheck` passes.
3. `npm run lint` passes.
4. `npm run build` passes.
5. Relevant browser behavior is verified.
6. Responsive behavior is checked when UI changes.
7. Reduced-motion behavior is checked when animation changes.
8. No new hydration errors exist.
9. No unrequested fake data/functionality exists.
10. A final summary is written.

If something cannot be verified because credentials/provider access is unavailable:
- mark `[~]` partially verified
- state exactly why
- do not falsely mark `[x]`.

## 0.6 — Browser verification

For UI tasks, use the configured **Playwright MCP with Chromium** for live verification.

Do not rely solely on:
- source inspection
- computed CSS
- screenshots generated without browser interaction
- static reasoning

At minimum, verify the relevant interaction in a real Chromium session.

## 0.7 — Focused QA, not excessive QA

Do not waste time running massive regression suites for every small UI task.

For each task:
- test the task-specific critical path
- test relevant responsive widths
- check console/hydration
- run typecheck/lint/build

The comprehensive full-product QA pass happens later in Phase 55–61.

## 0.8 — Final comprehensive QA

The final launch QA is the authoritative full regression pass.

Do not repeatedly perform the complete launch suite while individual features are still under construction.

## 0.9 — No fabrication

Never invent:
- benchmark numbers
- usage metrics
- task counts
- document counts
- workload scores
- calendar events
- AI recommendations
- AI confidence
- processing results
- testimonials
- integration status
- security claims

If functionality is not implemented:
- show `Planned` where appropriate
- or omit the action
- never pretend it works.

## 0.10 — No throwaway persistence

Never use `localStorage`, `sessionStorage`, custom cookies, or URL parameters as substitutes for server state.

Client storage is permitted only for genuine UI preferences.

Do not invent persistence just to unblock a UI task.

## 0.11 — Feature registry

All tools must ultimately use one shared registry containing at minimum:
- id
- name
- family
- tier
- state
- route
- icon
- description

State values:
- `live`
- `planned`
- `disabled`

UI must read this state rather than hardcoding availability.

## 0.12 — Tool registry single source of truth

Tool names, families, states and destinations must not be duplicated manually across:
- homepage
- `/features`
- Dashboard
- tool hub
- Quick Actions
- future navigation

A registry update should propagate throughout the UI.

## 0.13 — Blocked-task protocol

If the task cannot be honestly completed:

```text
[!] BLOCKED BY <task id>
```

State:
- what is missing
- why it is required
- what must happen first

Do not implement a workaround and do not mark the task complete.

## 0.14 — Secrets

- No secrets in client bundles.
- No secret in `NEXT_PUBLIC_*`.
- Server-only keys remain server-only.
- `frontend/.env.example` must be updated whenever a new environment variable is introduced.

## 0.15 — Database changes

All database schema changes must be versioned migrations.

Never make production schema changes only through a dashboard console.

Required sequence:

migration
→ local/staging verification
→ production application

## 0.16 — Real data architecture

Prefer:

```text
Server page/component
        ↓
service/data-access layer
        ↓
presentational component
```

Do not put business/database logic directly inside visual cards.

## 0.17 — Guest Dashboard policy

`/dashboard` is intentionally accessible to logged-out users.

Guest Dashboard:
- remains fully rendered
- uses the same dashboard structure
- shows no private data
- uses safe empty states
- uses `/login?next=...` for protected destinations

Other account-specific app routes remain protected.

Do not accidentally make `/dashboard` protected again.

**Founder note (guest browsing, 2026-09-11).** The 0.17 posture now covers the
whole workspace: `/dashboard`, `/tasks`, `/calendar`, `/documents` and
`/assistant` are all guest-viewable with the same rules — fully rendered with
the real structure, no private data, safe empty states. A guest who tries to
*use* a surface (New task, task edit/delete/drag, calendar Add event, document
upload, assistant send, global search/launcher) gets one shared, skippable
sign-in prompt — no redirect, no persistence — and its "Sign in" carries the
current path through `/login?next=...`. Guest renders issue **zero data reads**
(the `anon` role is revoked, so no query is ever attempted). The Server Actions
keep the hard `requireOnboardedUser` gate as the fallback, and a signed-in
student who has not finished onboarding is still sent to `/onboarding`.
`/onboarding` is now the only protected route in `PROTECTED_PREFIXES`; the four
workspace routes stay in `proxy.ts`'s matcher for session refresh only.

---

# 1. MOTION SYSTEM

## 1.1 — Motion.dev is the primary animation library

Motion.dev is UniPilot's primary animation library.

Use:

```ts
import { motion } from "motion/react";
```

Do not introduce another animation library unless there is a demonstrated technical need.

## 1.2 — Existing Motion architecture

Reuse the established shared Motion layer:
- shared variants
- shared transitions
- `MotionReveal`
- `MotionPopover`
- `MotionMenu`
- `MotionMenuItem`
- `MotionBar`
- `RouteTransition`
- shared Motion configuration
- shared motion presets

Do not create page-specific animation systems.

## 1.3 — Animation quality

Do NOT make the website:

```text
fade
fade
fade
fade
```

Avoid opacity-only animation when a better interaction is appropriate.

Use purposeful combinations such as:
- translate + opacity
- scale + translate
- directional entrance
- spring movement
- stagger
- layout animation
- shared selected-state movement
- icon/arrow micro-motion
- controlled expansion
- origin-aware popovers
- card depth/hover movement
- list movement/reordering

Animations should feel:
- premium
- dimensional
- calm
- tactile
- intentional

Avoid:
- excessive bounce
- elastic everything
- huge translations
- continuous floating
- spinning UI
- slow transitions
- generic template animations

## 1.4 — Animation must never control content existence

Animation failure must never cause content to disappear.

Never leave important content permanently at:
- opacity: 0
- visibility: hidden
- display: none

because an observer or animation failed.

## 1.5 — Page entry vs viewport reveal

Use page-entry animation for:
- initial page composition
- above-the-fold content
- primary dashboard structure

Use viewport reveals for:
- genuinely below-fold sections
- long marketing pages
- content that should reveal as it enters view

Do not hide the core Dashboard behind a fragile observer.

## 1.6 — Reduced motion

Always respect:

`prefers-reduced-motion: reduce`

Reduced motion must:
- remove unnecessary transforms
- remove unnecessary delays
- show content immediately
- preserve functionality.

## 1.7 — Chromium animation verification

For animation changes, Chromium must be used to verify:
- actual entrance
- actual exit
- actual interaction
- no stuck-hidden state
- no layout jump

Do not claim "animation works" because a Motion component exists.

---

# PART I — FOUNDATION

# 2. Repository / Project Foundation

- [x] 2.1 Repository inspection and project structure
- [x] 2.2 TypeScript / lint / conventions
- [x] 2.3 Core application architecture
- [x] 2.4 Lucide / foundational UI dependencies

---

# 3. Design System

- [x] 3.1 Color tokens
- [x] 3.2 Typography
- [x] 3.3 Spacing
- [x] 3.4 Radii
- [x] 3.5 Fixed dotted-grid background
- [x] 3.6 Elevation rules
- [x] 3.7 Glass-surface system
- [x] 3.8 Responsive grid rules

### Motion

- [x] 3.9 Motion.dev global animation architecture
- [x] 3.10 Live authenticated-route Motion verification
  - Guest/public surfaces are verified.
  - Authenticated Motion pass complete (Stage 1 A.4, QA fixture/local stack):
    RouteTransition enter (opacity 0 + 6px) settles ~160–175ms after mount on
    sidebar navigation, back/forward and refresh; reduced motion mounts at
    opacity 1 with no transform. All four MotionPopover surfaces verified for
    direction/origin (Notifications down/top-right, ProfileMenu up/bottom,
    GlobalSearch center/center + Ctrl+K, Assistant up/bottom-right), ~180ms
    open, ~165ms close-to-unmount, Escape + focus return, outside press closes,
    never two open. Drawer drops with a measured ~40ms item stagger, unmounts
    and returns focus; the rail `workspace-nav-active`, calendar
    `calendar-view-active` and task `task-status-filter-active` indicators all
    travel continuously on softSpring (~34–41 distinct positions) and settle
    aligned, one mounted each. Five routes × 375/768/1280 (320 for overflow) ×
    light/dark settle at opacity 1 with zero stuck-hidden content and zero
    overflow; no Motion/layoutId console warnings; mutation probes show
    style-only writes during enter (no per-frame React re-render) and popover
    geometry constant through the fade.
  - Limitation (0.9): the QA identity has no application data, so MotionListItem
    add/remove is not exercised — no authenticated surface uses it yet (only
    onboarding's SubjectsStep); Collapsible and MotionSelectionRing are also
    outside the workspace (auth/FAQ and marketing plan cards). Not simulated.
  - Found and fixed in the pass: the mobile bar's right control cluster
    overflowed the layout viewport by 8px at 320 (padding/gaps compacted below
    `sm`); a stale AssistantLauncher selector in `fonts.spec.ts` (renamed
    control) repaired; `structure.spec.ts`'s overflow guard now measures
    against `clientWidth` instead of the window width (it had masked overflow
    under the classic scrollbar gutter). 49/49 QA specs pass.
  - 3.11 note: the token-conformance half of this task's inherited visual debt
    is closed (entrances/reduced-motion re-verified authenticated on all
    three surfaces, 31/31 structural+motion assertions in
    frontend/tests/qa/structure.spec.ts); the pixel-judgement half remains owed to a
    human reviewer over the design-* screenshots.
- [x] 3.11 Authenticated design-conformance audit and refinement loop
  - Oracle built from DESIGN.md (`frontend/.playwright/design-oracle.json`) with the
    implemented token layer cross-checked first; all 15 surface×width
    combinations measured from computed styles authenticated against the
    empty local stack (empty-state baseline, honestly stated), plus the
    calendar week view at all five widths after a measurement gap was found.
  - Triage (`frontend/.playwright/triage-3-11.json`): 1 REAL_DRIFT — `text-body-sm`
    was an invalid utility (no --text-body-sm in the theme) rendering by
    inheritance on the calendar date numbers; repaired at call-site level
    (CalendarGrid.tsx, WeekGrid.tsx → `sm:text-body-md`), attempt 1/3,
    rendered values unchanged (13px mobile / 16px desktop, now via real
    tokens). 3 INTENTIONAL (glass 60/80/30 recipe, 16px card radius,
    shadow-subtle — each cited), 1 FALSE_POSITIVE (oklab value proven =
    #4c4546@60% by live probe), 8 CONFORMS. Re-measured after repair: zero
    REAL_DRIFT; 17.13's assertions ported to committed
    frontend/tests/qa/structure.spec.ts (they were git-ignored one-offs) — 31/31
    pass; typecheck/lint/build pass.
  - DESIGN.md_GAPs reported, not resolved: glass alphas, 16px card-radius
    role, card-padding prose (32/40px vs workspace 16/20/24px ladder),
    2px spacing sub-step, shadow-subtle in §Elevation, DESIGN.md's Geist
    display fontFamily vs TASK.md §0.3's Bricolage rule, 1.02x lift prose.
    Contrast finding for Phase 51: spillover dates (#4c4546@60% over white,
    3.19:1 at 13px).
- [x] 3.12 Sitewide font integrity — find the fourth typeface and eliminate it
  - Founder report "a new font appeared" confirmed and decomposed by
    measurement (CDP `CSS.getPlatformFontsForNode` on 75 surface×width
    combos — marketing + app, guest + authenticated): the fourth typeface
    was THREE defects. (1) BROKEN_REFERENCE sitewide: Geist and Geist Mono
    never rendered — the next/font/google modules were generated during a
    failed Google fetch (reproduced in an isolated offline build: the module
    emits only a `local(Arial)` "Geist Fallback" face) and Turbopack's
    persistent dev cache kept serving the broken module, so every body,
    control and metadata slot silently rendered Arial — a font lost
    presenting as a font gained. (2) INTRUDER: `Bitcount Single` — a fourth
    @font-face family in globals.css used on the homepage hero span
    ("organized"), never named in DESIGN.md. (3) WRONG_ROLE sitewide on
    marketing: the `.marketing` wrapper class set Bricolage Grotesque as the
    default family for entire marketing subtrees, rendering body copy,
    control labels and chat-mock text in the heading font.
  - Repairs (loader/token level, attempt ≤2 each): frontend/app/layout.tsx now loads
    Geist + Geist Mono via `next/font/local` from `frontend/app/fonts/` (full
    variable faces from the official geist package — the Google-subset cuts
    omit U+2192 →, which the file-converter labels use; full faces are the
    §5 subset-widening); the Bitcount @font-face, `font-bitcount` utility
    and ttf asset removed (hero span renders Bricolage — its role); the
    `.marketing` font-family rule removed (headings keep Bricolage via the
    h1–h3 base rule; the class survives for section padding). No literal
    family name added to any component; no copy, size or layout changed.
  - Convergence measured: 3,644 CDP probes across 15 surfaces × 5 widths ×
    guest/auth — zero unauthorized family renderings, zero per-glyph
    fallback nodes, h1=Bricolage / body=Geist / mono=Geist Mono on every
    surface (one founder question: the devs-note pull-quote renders
    Bricolage on a `p` — display text, left as-is). §21 layout: 0 overflow,
    0 clipped labels on 75 combos. Motion/structure: 31/31 committed spec
    still passing. Guard: frontend/tests/qa/fonts.spec.ts (committed, reuses the
    20.10 fixture, reads DESIGN.md's closed set) — 19/19, and proven to
    fail on a deliberate fourth-family injection (18/19 with the violation,
    19/19 after revert). typecheck/lint/build pass. 32 screenshots in one
    `fonts-<surface>-<state>-<width>.png` convention.
  - DESIGN.md amended (typography section only): the three-family set is now
    stated as explicitly closed, with roles, required coverage, the
    prohibited entry vectors enumerated, and a pointer to the guard. No
    family, size, weight, letterspacing or line-height value changed.

- [~] 3.13 Visual foundation — re-tokenize the design system against the new
  direction (tokens and shared primitives only; no surface rebuilds)
  - LOOP 0 audit complete: the token layer is singular (`frontend/app/globals.css`
    only — no tailwind.config); the 18 shared primitives hardcode NO color,
    shadow or hex (the only hardcoded geometry: GlobalSearch's
    rounded-[20px]/[10px], now mapped to card/nested tokens); 5 distinct
    radii, 2 shadow tokens, no named elevation scale, glass = muted@60/80/30
    color-mix + per-surface backdrop-blur-md (12px, untokenized); dotted
    canvas = fixed ::before radial-gradient pattern, 3 layout mounts + shell
    mounts; icons one family (Lucide), zero stroke overrides; §18 counts:
    97 label-caps eyebrows, 15 `·` meta strings, 67 font-mono uses, 40
    ArrowRight CTAs, uniform non-inverted card grids; CPL@1280: home ~81,
    features up to ~130 (34 paragraphs over 80), pricing 81.
  - LOOP 1 specification in `frontend/.playwright/design-313/LOOP1-SPECIFICATION.md`
    (token table, blast radius, §18 proposals, open questions). DESIGN.md
    amended: backdrop system (§0.3 gradient ban narrowly amended — one
    neutral low-contrast ambient field, fixed backdrop ONLY), five-step
    radius scale (frame 32/card 20/nested 12/control 8/pill, responsive
    step below 480px), four-level elevation scale (flush/raised/floating/
    overlay), three surface fills (glass/solid/inverted), inverted-card
    rationing rule, nested-surfaces rule (fill step not shadow), bento
    composition rule, two-level nav active state, display treatment (no
    fourth font), two type scales, icon rule, metric pattern, ghost
    surface. What it supersedes is recorded in the amendment. Fonts,
    monochrome, motion and a11y posture untouched.
  - LOOP 2 tokens: --background #f4f4f5, ambient field + motif layers in the
    one bg-dotted-grid utility (motif dots|grid|diagonal, token-swappable),
    radius scale + responsive step, shadow-raised retuned 0 4px 16px
    rgba(0,0,0,0.06), floating + overlay + inverted family (surface/border/
    ring/nested) + blur-glass + display-xl (96/800/−0.05em/1.0) tokens.
    Display step: 72/800/−0.045em/1.05.
  - LOOP 3 primitives: Card variants inverted/inverted-nested/ghost;
    IconButton outline-inverted variant (ring-inverted + offset against the
    inverted fill — measured 15.13:1); nav primary-active = inverted pill on
    the existing Motion layoutId element (state change, not a new
    animation); shell surfaces re-leveled (modal/popover/drawers → overlay,
    rail → floating, launcher → floating); GlobalSearch hardcoded radii →
    tokens; NEW BentoGrid/BentoItem + Metric/MetricRow primitives (built,
    exercised on specimen, adopted nowhere). No route file touched.
  - LOOP 4 evidence: dev-only specimen at /specimen (env-guarded:
    UNIPILOT_SPECIMEN in git-ignored frontend/.env.development.local only; proven
    404 + content-absent on a clean production build/start; noindex;
    linked nowhere; no sitemap exists yet to exclude it from — Task 58.5
    must keep it out). Placeholder-only content (§26). Before/after sets:
    7 surfaces × 375/1280 in frontend/.playwright/design-313/{before,after}/.
    Verified: 0 horizontal overflow at 320/375/768/1024/1280 (home +
    authenticated dashboard), motion 0 stuck-hidden + reduced-motion clean
    on all three app routes, 49/49 committed specs pass, backdrop-filter
    count on the heaviest surface: 1 (hidden mobile bar), 0 image requests
    (motif is pure CSS), fixed canvas survives 400px scroll.
  - Contrast measured (specimen probes): body on solid 8.50, muted-on-solid
    17.12, body on glass (composited) 15.57, inverted title/sub 15.13,
    nested-in-inverted 9.35, disabled-on-inverted 5.18 (disabled-on-light
    1.00 — WCAG-exempt state, noted), focus ring light 19.11 vs backdrop,
    ring-inverted on inverted fill 15.13 (rendered + measured via real Tab
    focus), placeholder 9.35. No ratio was lowered for appearance.
  - Outstanding founder decisions (GATE 2 — nothing proceeds until they
    land): backdrop motif choice (dots / grid / diagonal — presented on the
    specimen, no recommendation), §18 restriction rules (counts in the LOOP
    1 spec), metric numeral font role (body default vs mono), base-value
    confirmation (#f4f4f5), display-weight 800 confirmation, dead-token
    cleanup (--accent, --spacing-card*) — and per-surface adoption order.
  - Verified empty-only surfaces (honest limitation): /tasks and /calendar
    render empty states locally — TaskCard populated, TaskBoard columns,
    calendar event blocks, WorkloadCard figures and RecentDocumentsCard
    rows could NOT be observed with real data; those components' new-token
    rendering is unproven until Phase 21/22 data exists.
  - Environment note: WSL tears the Supabase stack down between commands —
    the QA_SESSION.md long-lived-keeper step is now REQUIRED on this machine
    (`wsl -d kali-linux --exec sleep 2147483647`).

- [x] 3.14 Action-label typography — every text-bearing button renders
  Bricolage Grotesque
  - Shared primitives (the main change): `font-heading` joined `baseClasses` in
    `frontend/components/ui/Button.tsx`, so `Button` and `ButtonLink` carry the
    heading family in every variant and size — marketing nav/hero/closing CTAs,
    pricing buttons, the auth Google + email buttons, Quick Actions, dialog
    actions and the closing CTA bands. Weights and sizes unchanged (`label-sm`
    500, `label-caps` 600); only the family moved, and it reads correctly at the
    small sizes — no weight tuning was needed.
  - Custom button-styled controls audited and matched (no `buttonClasses`):
    `TaskBoard` status filter chips; the `CalendarWorkspace` Week/Month
    segmented control; the assistant launcher bar and its starter chips.
    Quick-action chips already flow through `ButtonLink`, so they inherit the
    primitive. Deliberately unchanged: nav links and jump pills, menu/navigation
    items, form fields (Input/Select/textarea and the onboarding ChoiceField),
    metadata/eyebrow labels, and content-like interactive text (TaskCard title,
    calendar event blocks/chips, the ProfileMenu identity chip — the latter
    marked `data-fontprobe-role="content"`), plus icon-only `IconButton`s.
  - Guard (`frontend/tests/qa/fonts.spec.ts`): a button role assertion now
    requires every text-bearing `<button>` to render Bricolage unless its text
    is content-marked; the probe collector reads the mark. Proven able to fail
    RED first (`pricing: button "Start free" … got Geist`; `login: button
    "Continue with Google" … got Geist`), then GREEN. Full `npm run test`
    **110/110** (`frontend/.playwright/action-label-fonts-green-2.log`; the
    first attempt's `tasks-ui` pointer-drag failure was a settle race under a
    concurrent session — it passed on re-run and in isolation);
    typecheck/lint/build pass.
  - Real-Chromium evidence (MCP, 1280/375, light + dark): computed families
    measured — every Button/ButtonLink (pricing Start free/Start Pro/See team
    plans, hero CTAs, navbar `Open App`, Google/email/Sign in, Quick Actions,
    dialog add/save/cancel, TaskBoard chips, calendar Week/Month, launcher bar +
    starter chips) renders `"Bricolage Grotesque"`; inputs and nav links still
    `geistSans`; zero horizontal overflow at every checked route; consoles clean
    with a live dev server (only dev-server-restart HMR refusal noise, verified
    absent on a fresh server). Screenshots: `fonts-{pricing,login}-{light,dark}-
    {1280,375}-after.png`, `fonts-tasks-chips-*`, `fonts-calendar-segmented-*`,
    `fonts-assistant-chips-dark-375-after.png`, plus the pre-change
    `baseline-pricing-*` pair.
  - Docs: DESIGN.md §Typography amended — the Bricolage role is now major
    headings **and action labels**, with the rationale, the unchanged
    weights/sizes and the enforced boundary; the closed three-family set and the
    prohibited-entry list are untouched (no new family).


---

# 4. Core UI Components

- [x] 4.1 Container
- [x] 4.2 Section
- [x] 4.3 Button
- [x] 4.4 ButtonLink
- [x] 4.5 IconButton
- [x] 4.6 Card
- [x] 4.7 Badge / Chip
- [x] 4.8 Input
- [x] 4.9 Divider
- [x] 4.10 SectionHeader
- [x] 4.11 Modal
- [x] 4.12 Tooltip
- [x] 4.13 EmptyState
- [x] 4.14 LoadingState
- [x] 4.15 Status indicators
- [x] 4.16 Select
- [~] 4.17 Remaining shared form primitive audit
- [ ] 4.18 Toast / notification primitive
- [ ] 4.19 Textarea
- [ ] 4.20 Checkbox / Radio standardization
- [ ] 4.21 Table primitive

---

# PART II — MARKETING

# 5. Homepage `/`

- [x] 5.7 Expand homepage feature ecosystem
  - Ratified against the formalized registry (Stage 1 item 6).
  - Four families: the workspace cards (Academic Workspace) plus the registry's
    Create / Edit / Convert / Study families — the registry groups edit and
    convert are presented on the homepage by the one "Create, edit & study"
    card and the two-row marquee. Note this task's "Edit & Convert" bundles the
    registry's `edit` and `convert` groups; no drift.
  - Tier 3 tools excluded (decision): the marquee now reads the registry's
    `OFFERABLE_TOOLS`, so the 3 `disabled` entries no longer render at all.
    Previously they were carded with a "Research" label, which contradicted
    this task's own "Tier 3 tools excluded" and TASK.md Part X ("must NOT be
    advertised as launch functionality"); exclusion is the registry's own
    semantics, so no surface decides it. The "Research" status word is no
    longer rendered on the homepage (`TOOL_STATUS_LABEL` still defines it for
    any surface that needs to name a disabled entry).
  - Planned tools remain visibly Planned: per-tool words come from
    `toolStatusLabel`; the aggregate badge, note and "Planned" meta gate on
    `HAS_LIVE_TOOL`.
  - Live tools get real destinations: every registry href targets an existing
    /features anchor today (no live tools exist); a `live` entry whose href is
    not a real route now fails the registry's module-load invariant.
  - Drift fixed: the Tasks card's action pointed at `/features#dashboard` (the
    connected-workspace alias) instead of its own `/features#tasks` section;
    the alias now serves only the "Connected workspace" card.
  - Workspace cards vs `frontend/components/app/workspaceNav.ts` and the /features
    `academic-workspace` part: all destinations resolve (#documents, #tasks,
    #calendar, #assistant, #workload, #dashboard alias); the workspace is not a
    registry concern, so names stay the surfaces' own marketing copy.
  - Evidence: Playwright MCP clicked every homepage /features action at
    375/768/1280 — 12/12 land on the expected path+anchor with the target
    present; guard tests in frontend/tests/qa/tool-registry.spec.ts (marquee =
    OFFERABLE_TOOLS, no Tier-3 name, no hardcoded status) pass.

Previously completed:
- [x] 5.1 Hero
- [x] 5.2 Feature grid
- [x] 5.3 How-it-works preview
- [x] 5.4 Closing CTA
- [x] 5.5 Micro-interactions
- [x] 5.6 Visual QA

---

# 6. Features `/features`

- [x] 6.9 Expand feature ecosystem
  - Ratified as registry-driven (Stage 1 item 7): every catalogue card's name,
    sentence, action label and status word resolve from `toolCatalog`; the
    presentation and converter section eyebrows read registry names.
  - Stable anchors resolved: `#create`, `#edit`, `#study` are the part ids;
    `#workspace` exists as the "Connected academic workspace" detail section
    (with the `#dashboard` alias used by the homepage card); `#document-tools`
    is FileConvertersSection, which is how the `convert` family resolves per
    `TOOL_GROUPS`. Every registry href and every jump-nav pill targets an
    element that renders — no dead anchors, none documented that 404.
  - Jump-nav integrity: all five "Jump to a part" pills
    (#academic-workspace, #create, #edit, #study, #ai-assistant) target
    rendered sections.
  - Tier 3 excluded: `toolsInGroup` filters `disabled`, so no Tier-3 card
    renders; the three entries stay catalogue-only.
  - Evidence: new committed guard tests (registry destinations resolve on
    /features, jump pills target real sections, homepage links resolve) plus
    Playwright MCP anchor/pill clicks at 375/768/1280; console clean.

Previously completed:
- [x] 6.1 Header
- [x] 6.2 Tasks
- [x] 6.3 Calendar
- [x] 6.4 Documents
- [x] 6.5 Assistant
- [x] 6.6 Dashboard section
- [x] 6.7 CTA
- [x] 6.8 Responsive QA

---

# 7. How It Works `/how-it-works`

- [x] 7.1–7.9 Existing approved design
- [x] 7.10 Motion and responsive verification

---

# 8. Pricing `/pricing`

- [x] 8.1–8.7 Existing pricing UI
- [ ] 8.8 Reconcile advertised features with entitlement matrix
  - Nothing may be advertised as live unless implemented.
  - Planned functionality must be clearly labelled.
  - Team plan must remain deferred unless seat management becomes real.

---

# 9. Benchmarks `/benchmarks`

- [x] 9.1–9.6 Existing benchmark page
- [~] 9.7 Replace placeholder benchmark data with real measured evidence
  - Evidence must originate from real test sets.
  - No fabricated performance claims.
  - Page must be unpublished or clearly reframed until evidence exists.
  - A.1 audit (Stage 1) confirms every figure on the page and on the homepage
    benchmark section is explicitly labelled illustrative or measurement-planned.
  - Remaining dependency: real measurements have not been run, so no figure can
    be published as evidence yet.

---

# 10. FAQ `/faq`

- [x] 10.1–10.10 Existing FAQ
- [ ] 10.11 Re-audit claims about:
  - privacy
  - OCR
  - Calendar integration
  - Canvas
  - AI behavior

Only describe behavior actually implemented.

---

# 11. Dev's Note `/devs-note`

- [x] 11.1–11.8 Existing page

---

# PART III — AUTHENTICATION

# 12. Authentication

- [x] 12.1 Auth architecture
- [x] 12.2 Email/password full provider verification
  - Verified end-to-end on the local stack + Mailpit (Stage 1 A.2):
    signup → confirmation mail → `/auth/confirm` → session → `/dashboard`;
    sign-in; reload and navigation persistence; sign-out; protected-route
    re-gating; wrong password; unconfirmed user; duplicate signup; malformed
    email — each negative path shows the sanitized copy from
    `frontend/lib/auth/errors.ts`; `?next=` propagates to the gated route and
    `?next=//evil.com` sanitizes to `/dashboard`.
  - Fixed during verification: `ConfirmEmail` now forwards a PKCE `?code=`
    confirmation to `/auth/callback` instead of only reading implicit-flow
    fragments; the local stack's `site_url`/redirect allow-list was corrected
    to the app's `http://localhost:3000` origin.
  - Recorded finding: the session cookie is `SameSite=Lax` and not `HttpOnly`
    (the `@supabase/ssr` default). `AUTH_ARCHITECTURE.md` has been corrected;
    the cookie posture itself was not changed here.
  - Production SMTP delivery remains tracked by 12.11.
- [~] 12.3 Google OAuth full provider verification
  - Verified: `signInWithGoogle` redirects to the Supabase authorize endpoint
    with `provider=google`, scopes `openid email profile`, the allow-listed
    `/auth/callback` and a PKCE challenge; `/auth/callback` error branches
    land on the sanitized `/login?error=oauth` copy (or `?error=verification`
    for a signup flow).
  - Blocked on: a sanctioned Google test identity and a provider-enabled
    project reachable for QA. The local stack has no Google provider
    (authorize returns 400 "Unsupported provider: provider is not enabled")
    and the hosted project is excluded by the environment rules.
- [x] 12.4 Login
- [x] 12.5 Signup
- [~] 12.6 Forgot password
- [~] 12.7 Email verification
- [x] 12.8 Protected routes
- [x] 12.9 Logout
- [x] 12.10 Loading/error states
- [~] 12.11 Transactional email provider verification
- [~] 12.12 Welcome / verification / reset templates
- [ ] 12.13 Session refresh, expiry and multi-tab behavior
- [ ] 12.14 Rate limiting for auth endpoints

---

# PART IV — BACKEND FOUNDATION

# 20. Supabase / Database Foundation

## Status

The hosted project contains existing live schema/auth infrastructure, but the schema is not fully ratified against this roadmap.

Do not infer completeness from task checkboxes alone.

- [x] 20.1 Supabase environments verified
  - Ratified by 20.10: exactly one hosted environment exists (production —
    4 auth users, verified live read-only) and a LOCAL stack is now
    provisioned (Docker in `kali-linux` WSL, GoTrue v2.196.0 matching hosted,
    trimmed config, `backend/supabase/config.toml` machine-local per backend/EMAIL.md).
    `frontend/.env.local` → hosted; `frontend/.env.development.local` → local. No staging or
    second hosted project exists.
- [x] 20.2 Environment configuration audited
  - Ratified by 20.10: full env surface is `NEXT_PUBLIC_SUPABASE_URL` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public, consumed in
    `frontend/lib/supabase/config.ts`), `SUPABASE_SERVICE_ROLE_KEY` (secret;
    consumed only by `backend/supabase/qa/seed-qa-identity.mjs` since 20.10), and
    `UNIPILOT_QA_PASSWORD` (secret, non-production only). No secret is
    exposed under `NEXT_PUBLIC_*` (grep-verified). Both `*.example` templates
    document every variable.
- [~] 20.3 Server/client database access architecture audited
- [~] 20.4 Auth provider/redirect configuration audited
- [~] 20.5 Storage architecture audited
- [x] 20.6 Define and ratify database schema
  - One versioned migration: `backend/supabase/migrations/20260911011824_init_schema.sql`
    (renamed from `20260911064824` by 20.7 to its true UTC stamp, pre-hosted)
    (12 tables: profiles, subjects, tasks, events, documents, document_chunks,
    conversations, messages, tool_runs, notifications, subscriptions,
    usage_events). Contract: **backend/DATABASE.md**.
  - Decisions: `first_name`/`last_name` columns (onboarding's two separately
    validated fields; a full_name cannot recover them);
    `onboarding_completed_at` timestamptz nullable (NULL = incomplete, "skip"
    never stamps it, supports 14.10); `academic_year` smallint 1–5 and
    `semester` smallint 1–2 (closed ordinal sets, display strings stay in the
    UI); one vocabulary policy everywhere — text + named CHECK constraints for
    closed vocabularies, with enums and lookup tables rejected for migration
    flexibility, and open taxonomies (`usage_events.kind`,
    `subscriptions.provider`) documented as unconstrained text; embeddings
    deferred to 25.x (the dimension is 25.x's model choice — boundary stated);
    profiles rows provisioned by an `auth.users` insert trigger (security
    definer, id only) so the 1:1 invariant holds from user creation, while
    onboarding persistence remains 13.10's.
  - Ownership FKs from `auth.users` all cascade; `source_document_id`
    provenance refs SET NULL so deleting a file cannot silently delete a task.
    RLS enabled on all 12 tables with 40 owner-only policies (child tables
    `document_chunks`/`messages` inherit via EXISTS on their parent); `anon`
    revoked outright; subscriptions writes, usage-ledger history and
    notification inserts deliberately have no client policy (service role).
  - Evidence: `supabase db reset` applied the migration cleanly **twice**;
    psql verification — 12/12 tables, `relrowsecurity = true` on each, 40
    policies, 13 triggers (12 updated_at + on_auth_user_created), 29 indexes,
    zero `anon` grants; QA identity re-seeded after reset — 1 auth user → 1
    trigger-provisioned empty profile, every application table empty; RLS smoke
    (anon permission denied; foreign sub sees 0 profiles; owner sub sees 1).
    No hosted contact: not linked (`backend/supabase/.temp` has no `project-ref`), no
    `--linked` used. typecheck/lint/build pass.
  - NOTE for 20.7: hosted already has a differently-shaped `profiles` table
    and its own provisioner — reconcile before applying hosted.
- [~] 20.7 Versioned migration workflow
  - Formalized: `backend/supabase/MIGRATIONS.md` (rules: UTC `<timestamp>_<snake>`
    names generated by `supabase migration new`, never edit an applied
    migration, one logical change per file, forward-only with a rollback note,
    no data in migrations, intentionally-empty `seed.sql`, QA identity only
    via 20.10's seed) plus the per-migration review checklist
    (RLS+policies, ownership FK cascade, indexes, updated_at trigger,
    server-only ops without policies, no fabricated data, no type generation).
    `backend/DATABASE.md` gained the workflow summary and the hosted runbook.
  - The init migration was normalized from local wall time to its true UTC
    timestamp (`20260911064824` → `20260911011824`, local-only, pre-hosted)
    and now carries a rollback note; two migrations then demonstrate the
    workflow: `20260911020548_add_profile_timezone.sql` (ratified `timezone`,
    R15: IANA names, not offsets) and
    `20260911020549_backfill_legacy_profiles.sql` (guarded no-op locally).
  - Local evidence: `supabase db reset` applied all three cleanly; `supabase
    migration list --local` shows the three versions; `supabase db lint` →
    "No schema errors found".
  - Hosted reconciliation prepared and validated locally, NOT executed:
    `backend/supabase/ops/reconcile-legacy-profiles-preflight.sql` (rename legacy
    profiles, drop the legacy auth.users provisioner) + the guarded backfill +
    the full runbook in backend/DATABASE.md (backup → migration list --linked →
    preflight → migration up --linked → verify → dump rollback). Validated in a
    disposable `reconcile_scratch` database with the legacy shape + three
    synthetic rows (`backend/supabase/qa/reconcile-scratch-fixture.sql`): all mappings
    asserted (name split incl. mononym/multi-word, semester text → smallint
    with unmapped NULL, preferences → planning_style/reminder_lead default,
    timezone blank → UTC, completion NULL), legacy table dropped, RLS on,
    12 tables / 40 policies, new trigger present; scratch DB then dropped.
  - Remaining gap (exact): **hosted rollout pending founder approval.** The
    hosted project was never contacted (CLI not linked, no access token, no
    `--linked` command run); no `db push` will happen without explicit
    approval and the runbook.
- [x] 20.8 Typed database types
  - Generated from the LOCAL schema (never hosted) with
    `supabase gen types typescript --local`, committed at
    `frontend/lib/supabase/database.types.ts` (single generated file, never
    hand-edited; lint passes without needing an exclusion).
  - The `Database` generic is wired into every client:
    `frontend/lib/supabase/server.ts`, `frontend/lib/supabase/client.ts` and
    `frontend/lib/supabase/proxy-session.ts` (anon-key-only preserved there).
  - Proof it reflects the ratified schema: the generated `profiles` row
    includes `timezone` plus every 20.6 column, and all 12 tables are present.
    `frontend/lib/supabase/schema-contract.ts` is a types-only compile-time smoke —
    renaming a key (`timezone` → `timezone_gone`) fails `tsc` with
    `Type 'false' does not satisfy the constraint 'true'`, verified then
    reverted; a missing table fails the same way.
  - Workflow: `backend/supabase/ops/generate-types.sh` regenerates from local (WSL,
    relative paths, no hardcoded Windows path), `check-types.sh` regenerates
    and diffs as a manual drift check; both use `--local` (20.7's finding);
    `backend/supabase/MIGRATIONS.md` documents the step after migration → local verify
    and adds it to the review checklist; `backend/DATABASE.md` records the typed layer.
    Wrapped by the root scripts `npm run db:types` / `db:check-types`; the WSL
    distro name is machine-specific and hardcoded in `backend/package.json`.
  - Evidence: generation run produced a stable file (second run: no diff;
    `check-types.sh` → "matches the local schema"); typecheck/lint/build pass;
    `npx playwright test` 54/54 (typing is compile-time only). No queries or
    data-access code added (Stage 3), no seeds, no hosted contact.
- [x] 20.9 Automated two-user RLS isolation test
  - Second identity added: `qa2.unipilot@unipilot.test` ("QA 2"), password in
    `UNIPILOT_QA2_PASSWORD` (local-only, git-ignored; both `*.example`
    templates updated). `backend/supabase/qa/seed-qa-identity.mjs` now seeds both
    idempotently, refuses non-local targets before any network call, covers
    both identities in `--reset` and in its failure messages; `--reset` proven
    to purge historical addresses for both. QA_SESSION.md carries the
    two-identity contract.
  - `frontend/tests/qa/rls-isolation.spec.ts` (Playwright; `@supabase/supabase-js`, no
    new dependency) signs in QA1 and QA2 with real passwords, uses a
    service-role client only for seeding/teardown, and proves the backend/DATABASE.md
    matrix: anon denied every read and write; own-row reads for 8 owned tables
    and `profiles`; cross-user reads empty; cross-user update/delete affect 0
    rows both directions; `tool_runs` history not deletable; child tables
    (`document_chunks`, `messages`) isolated through their parent; subscriptions
    / notifications / usage_events inserts denied to authenticated clients.
    Teardown deletes every seeded row and the spec asserts only the two
    trigger-provisioned `profiles` rows remain (repeatable, order-independent,
    local-only with a URL guard).
  - Policy correction: migration `20260911032752_lock_usage_ledger.sql` drops
    `usage_events_insert_own` so the R5 cost ledger is server-write-only (the
    task's stated boundary); backend/DATABASE.md's matrix now says so and cites the
    spec as proof.
  - Evidence: spec green in ~1.3s; proven able to fail — relaxing
    `tasks_select_own` to `using (true)` made it fail with
    `QA1 must not read QA2's tasks`, then the policy was restored to
    `(auth.uid() = user_id)` and the spec went green again. Full suite 55/55;
    typecheck/lint/build pass. No app data access added; hosted never
    contacted.
- [x] 20.10 Permitted QA authentication session
  - Local stack + seeded QA identity (`qa.unipilot@unipilot.test`,
    email-confirmed via Admin API, zero application data) + reusable
    authenticated Playwright fixture (`npx playwright test` →
    `frontend/.playwright/qa-session.json`). Real session through the real login UI —
    no forged tokens. Seed is idempotent and refuses non-local targets.
    Contract: **QA_SESSION.md**.
  - Newly unblocked (still their own tasks, boxes not checked here):
    3.10, 12.2, 12.3, 16.12, 16.13, 17.13, and every future authenticated
    verification. 14.10/14.11 and the two-user passes additionally wait on
    20.6.

## 20.6 schema must define

### `profiles`

At minimum:
- canonical name
- institution
- program/course
- academic year
- semester
- planning style
- reminder lead
- `onboarding_completed_at`

Explicit decisions required:
- timestamp vs boolean
- year/semester type
- enum vs lookup
- name mapping

### `subjects`

- ownership
- CRUD
- RLS

### Core product data

Define:
- tasks
- events
- documents
- document_chunks
- conversations
- messages
- tool_runs
- notifications
- subscriptions
- usage_events

All tables:
- user ownership
- deny-by-default RLS
- written policies
- appropriate indexes

---

# 13. STUDENT ONBOARDING

- [x] 13.1 Onboarding shell
- [x] 13.2 Profile
- [x] 13.3 Institution
- [x] 13.4 Course/program
- [x] 13.5 Academic year/semester
- [x] 13.6 Preferences
- [x] 13.7 Subjects
- [x] 13.8 Initial Dashboard
- [x] 13.9 Skippable onboarding

### 13.10

- [x] Onboarding persistence
  - Data layer: `frontend/lib/data/onboarding.ts` (server-only, typed against the
    generated `Database`) reads a student's profile+subjects and writes through
    `complete_onboarding`; the UI-string ↔ schema-value mapping lives in
    `frontend/lib/data/onboardingValues.ts`, imported by both the steps and the data
    layer, so labels and codes cannot drift. No component queries a table and
    no client storage is used.
  - Atomic + idempotent: migration
    `20260911034901_complete_onboarding.sql` adds a security-invoker Postgres
    function that upserts `profiles`, replaces the `subjects` set and stamps
    `onboarding_completed_at` in ONE transaction (the stamp is `coalesce`d, so
    a repeat submission never moves it; the subject set is replaced, so repeats
    cannot duplicate rows). EXECUTE is authenticated-only; RLS owner policies
    remain the enforcement layer.
  - Server Action `frontend/lib/data/onboardingActions.ts` (`completeOnboardingAction`):
    `requireUser` first, then server-side validation/re-mapping
    (`parseOnboardingPayload`: required answers, closed vocabularies, trimmed
    and de-duplicated subjects, bounded lengths), then the atomic write.
    Failures return the shared sanitized copy (`ONBOARDING_SAVE_ERROR`); the
    flow stays on the last step, shows it via `role="alert"` and can retry.
    Wired to `OnboardingFlow.finish`; the double-submit guard is kept.
  - Skip semantics: `Skip for now` writes nothing (documented decision —
    columns are nullable, but writing nothing keeps the flow's only write the
    atomic completion-bearing one). `onboarding_completed_at` stays NULL.
  - Redirect gate `frontend/lib/onboarding/gate.ts`: `requireOnboardedUser` on /tasks,
    /calendar, /documents, /assistant sends unfinished students to
    /onboarding; `requireUnfinishedOnboarding` sends completed ones from
    /onboarding to /dashboard. /dashboard stays public (guest state intact;
    14.10's finish-setup affordance deliberately NOT built).
  - Dashboard read: `/dashboard` builds the full `DashboardStudent` from the
    persisted profile+subjects (codes mapped back to display strings); the
    greeting renders name, programme/institution, year/semester and subjects;
    guests keep the guest state. Nothing is fabricated.
  - QA (real local stack, real UI): `frontend/tests/qa/onboarding.spec.ts` — QA1
    completes through the flow (profile fields, two subjects, completion
    stamped; /dashboard renders them; /onboarding then redirects to /dashboard;
    /tasks renders); QA2 skips (nothing persisted, completion NULL, /tasks
    redirects back into /onboarding with no loop); forced failure (profile row
    removed → sanitized error, no stamp, no subjects, retry after restore
    succeeds); duplicate writes (direct RPC twice → no duplicate subjects, no
    re-stamp); two-user isolation (QA2 sees none of QA1's onboarding rows).
    `rls-isolation.spec.ts` now tears down by its own seeded ids (never by
    user_id, so it cannot destroy 13.10 data), snapshots counts, and asserts
    QA2 cannot read QA1's persisted subjects plus anon cannot execute
    `complete_onboarding`.
  - Evidence: migration applied from scratch with `supabase db reset` (five
    migrations), `supabase db lint` clean, types regenerated from local
    (`complete_onboarding` present), `npm run typecheck`/`lint`/`build` pass,
    full `npx playwright test` 60/60. No hosted contact; no staging or commits.

---

# 14. AUTHENTICATED APP SHELL

- [x] 14.1 App layout
- [x] 14.1.1 Signup skippability
- [x] 14.2 Desktop navigation
- [x] 14.2.1 Global AI Assistant launcher
- [x] 14.3 Mobile navigation
- [x] 14.4 Profile menu
- [x] 14.5 Notification entry point
- [x] 14.6 Global search entry point
- [x] 14.7 Page-header pattern
- [x] 14.8 Route transitions
- [x] 14.9 Route protection

- [x] 14.10 Persistent "Finish setup" affordance
  - One visibility condition: `sessionNeedsSetup()` in `frontend/lib/onboarding/gate.ts`
    — signed in AND `onboarding_completed_at` NULL; false for a guest and false
    when the state cannot be read (an offer, not a gate: it never throws and
    never strips the page).
  - `frontend/components/app/WorkspaceSetupLink.tsx` is now a completion-aware async
    server component: hidden for a completed student and for a guest, still
    present in both the rail and the mobile drawer (the drawer receives the
    server node; its read streams inside the caller's Suspense boundary).
  - `frontend/components/app/FinishSetupAffordance.tsx` (new) is the /dashboard banner:
    a compact `Card` at `GuestCallout`'s weight in the same slot, one eyebrow
    ("Setup incomplete"), one line naming the routes finishing opens, one
    `ButtonLink` "Finish setup" → /onboarding. Returns null for a completed
    student and a guest; no dismissals, no client storage — the persisted
    marker is the whole state.
  - Streaming: the completion read sits behind its own `Suspense` boundary
    (null fallback) in the rail, the `(app)/layout.tsx` drawer node and the
    dashboard page, so the layout stays synchronous. `sessionUser`
    (`frontend/lib/auth/session.ts`) is the new request-scoped memoized session read
    that `sessionViewer` composes over, and `getOnboardingState` is memoized
    per request, so the dashboard banner reuses the page's own read and
    nothing shifts or flashes.
  - Visuals/motion: existing primitives only (`Card`, `ButtonLink`,
    `WorkspaceAction`, `data-enter` + `motionIndex`, current tokens). The
    dashboard entrance lives inside `prefers-reduced-motion: no-preference`,
    so reduced motion shows the banner immediately.
  - QA: `frontend/tests/qa/finish-setup.spec.ts` (4 tests) — QA2 incomplete (banner in
    the first response, rail link, drawer link, click → /onboarding,
    persistent after navigating away and back, main-content layout shift
    < 0.05); QA1 complete (no banner, no rail/drawer link, neither string in
    the HTML); guest (`GuestCallout` only, never a setup offer); reduced motion
    (immediately visible, `animation-name: none`). Console/pageerror clean in
    every test. Full `npx playwright test` 64/64; typecheck/lint/build pass.
    No client storage; no hosted contact.

- [x] 14.11 Server-side auth guard audit
  - Inventory (verified against the tree, not assumed): protected `/tasks`,
    `/calendar`, `/documents`, `/assistant` (`requireOnboardedUser`);
    `/onboarding` (`requireUnfinishedOnboarding`); authenticated-public
    `/dashboard` (`sessionUser`, RLS reads, guest state); public-by-design
    `/login`, `/signup`, `/forgot-password`, `/auth/confirm`, all
    `(marketing)/*` and `GET /auth/callback`; mutating
    `completeOnboardingAction` (`requireUser` before the try so the redirect
    throws); the auth actions validate input and sanitize every failure;
    `signOut` is session-scoped and writes no application data. No other
    Route Handler and no other `"use server"` module exists (verified).
  - Proxy: matcher confirmed a static-literal superset of
    `PROTECTED_PREFIXES`; `/dashboard` matched for session refresh but not
    protected (0.17); marketing/auth-public paths absent. The duplication
    footgun is now guarded — `assertMatcherCoversProtectedRoutes()`
    (`frontend/lib/auth/redirects.ts`) runs when `proxy.ts` loads, and the spec proves
    a deliberate omission throws.
  - Finding + fix (host-header / open redirect): the callback built redirects
    from `new URL(request.url).origin`, and the auth actions from the request
    `Origin`/`Host` — both caller-controlled (Next copies `Host` into
    `x-forwarded-host`). Fixed: same-origin relative callback redirects
    (`sameOriginRedirect`; Next still merges the PKCE session cookies), and
    `frontend/lib/auth/origin.ts`'s `getTrustedSiteOrigin()` (`NEXT_PUBLIC_SITE_URL`
    first, loopback-only local fallback, otherwise refuses). `NEXT_PUBLIC_SITE_URL`
    added to both env templates (0.14). Verified on the wire: forged
    `Host`/`X-Forwarded-Host` probes return `Location: /login?error=oauth`
    (relative); proxy bounces were already relative.
  - Evidence: `frontend/tests/qa/auth-guards.spec.ts` (6 tests) — matcher guard incl.
    the deliberate break, every protected route 307 → sanitized same-origin
    `?next=`, public guest `/dashboard` 200 + protected bounce, `/onboarding`
    guest → login and completed → dashboard, authenticated control for all
    four gated routes, callback sanitized notices with no provider-text or
    forged-host leak. Manual curl probes recorded in AUTH_ARCHITECTURE.md
    (Server-side guard matrix, Redirect-origin finding). typecheck/lint/build
    pass; full `npx playwright test` 70/70. No hosted contact.
  - Re-audited after the app moved to `frontend/` with the Playwright MCP
    (Chromium): each unauthenticated protected route landed on
    `/login?next=<exact relative path>` with an empty error console,
    `/dashboard` rendered the guest state at 200, `/auth/callback` without a
    code showed the sanitized oauth notice, and a context restored from the QA
    storage state reached all four gated routes (bounced from `/onboarding` to
    `/dashboard`). One transient first-request read error was observed and
    recorded (fail-closed, non-reproducible) — see AUTH_ARCHITECTURE.md
    §14.11 verification.

- [x] 14.12 Workspace tools route `/tools`
  - New `frontend/app/(app)/tools/page.tsx` — the registry-driven catalogue built
    on the canonical `toolRegistry` API: the four families
    (`toolRegistry.groups`) and every offerable tool a family carries
    (`toolRegistry.inGroup`; Tier-3 `disabled` entries are excluded by the
    registry itself) render through the shared `ToolCard`. Names, icons,
    one-line descriptions, status words and destinations are the registry's —
    nothing is restated on the page, and no card can say "Open".
  - Honesty is structural: card actions read `toolRegistry.actionLabel`
    ("How it will work" while planned) and link to each entry's registry `href`
    (the /features anchors); the aggregate "None of these are built yet" note
    is gated on `toolRegistry.hasLiveTool`, so it disappears by itself the day
    a tool ships.
  - Motion/layout reuse the workspace system only: `PageHeader` owns slot 0,
    the aggregate note slot 1, each family a pair of `data-enter` slots, and
    the cards use the dashboard hub's `data-enter` (not a scroll reveal). No
    new visual language; existing Card/Divider/typography tokens throughout.
  - Guest-aware like every workspace route (`getWorkspaceAccess`): a guest and
    a completed student render the same catalogue, an unfinished student is
    sent to /onboarding, and the route reads no user data (the registry is
    static).
  - Nav/routing: appended to `WORKSPACE_NAV` after Assistant (Wrench icon) so
    the rail and the mobile drawer update from the one list; the travelling
    `layoutId` active state works on the new row; `proxy.ts`'s static matcher
    gained `/tools` + `/tools/:path*` for session refresh only (not in
    `PROTECTED_PREFIXES`); the dashboard hub's "See every tool" now points at
    `/tools`; the stale "five workspace surfaces" comments in
    `components/app/workspaceNav.ts` and `app/(app)/layout.tsx` were rewritten.
  - Evidence: `frontend/tests/qa/structure.spec.ts` renders/overflow/motion rows
    for `/tools` plus rail + drawer link assertions; `tool-registry.spec.ts`'s
    new "workspace catalogue" test proves every offerable tool by family with
    its registry action, status word and href, and Tier-3 absence;
    `auth-guards.spec.ts` and `guest-browsing.spec.ts` cover the guest render,
    matcher membership and zero data reads. MCP/real-Chromium pass: guest and
    QA1 at 1280/375, light + dark, reduced motion; console clean, no horizontal
    overflow, zero `/rest/v1` reads, a card action lands on its /features
    anchor, and the active highlight travels from Tools to Integrations.
    typecheck/lint/build pass.

- [x] 14.13 Workspace integrations route `/integrations`
  - New `frontend/app/(app)/integrations/page.tsx` with `_components/`: two
    honest coming-soon cards — WhatsApp and Gmail — each carrying its official
    brand mark inlined (`BrandMarks.tsx`; no external asset, CDN or dependency),
    the sanctioned second exception to DESIGN.md's Icon Rule (recorded there
    beside the Google sign-in mark) and scoped to this page.
  - Each card states "Coming soon" / "Not connected" and nothing else: no
    Connect control, no connected or sync claim, no session-dependent copy. The
    header line says integrations are planned and nothing is wired yet. The
    marks are `aria-hidden`, sized on one axis so they cannot distort, and the
    route reads no user data.
  - Guest-aware exactly like /tools (`getWorkspaceAccess`); `proxy.ts`'s
    matcher gained `/integrations` + `/integrations/:path*` for session refresh
    only. Motion reuses the page ladder (`PageHeader` slot 0, grid slot 1); the
    cards are deliberately non-interactive, so nothing lifts on hover.
  - Evidence: new `frontend/tests/qa/integrations.spec.ts` (authenticated and
    guest) asserts both cards, exact mark aspect ratios (WhatsApp 1.0, Gmail
    88:66), the honest lead line, the absence of any connect/connected/sync
    claim and a clean console; `structure.spec.ts`, `auth-guards.spec.ts` and
    `guest-browsing.spec.ts` include the route. MCP/real-Chromium pass at
    1280/375, light + dark, guest + QA1; console clean, no horizontal overflow,
    zero data reads.

---

# PART V — DASHBOARD

# 15. Dashboard `/dashboard`

- [x] 15.1 Greeting + current date
- [x] 15.2 Upcoming deadlines
- [x] 15.3 Workload-risk indicator
- [x] 15.4 Quick stats
- [x] 15.5 Recent documents
- [x] 15.6 Upcoming classes/events
- [x] 15.7 AI insight
- [x] 15.8 Quick actions
- [x] 15.8-R Quick Actions moved to top of Dashboard

### 15.9

- [-] 15.9 — Superseded by Phase 45
- Keep the ID permanently.
- Do not implement separately.

### 15.10

- [x] 15.10 — Final Dashboard responsive QA
  - 320
  - 375
  - 768
  - 1024
  - 1280
  - Guest
  - authenticated where possible
  - no overflow
  - no stuck content
  - no hydration errors

### 15.11

- [x] 15.11 — Create with UniPilot tool hub
  - registry-driven
  - families:
    - Create
    - Edit
    - Convert
    - Study
  - sidebar remains limited to core workspace navigation

### 15.12

- [x] 15.12 — New-account zero-state Dashboard
  - no fake metrics
  - no fabricated deadlines
  - no fabricated documents
  - no fabricated AI results
  - all core empty states intentional

---

# 16. TASKS `/tasks`

UI (bound to the real 21.x service — Stage 3 item 16):
- [x] 16.1 Header
- [x] 16.2 Quick-add (real create: `QuickAddTask` opens the shared form dialog; submit runs `createTaskAction` with pending/`aria-busy`/double-submit guard, inserts the card optimistically and reconciles with the settled row; sanitized retry on failure)
- [x] 16.3 Filters (status only — the one dimension the task model carries; local board state, derived and preserved across every mutation)
- [x] 16.4 Kanban (three columns over the real dataset; counts appear only when they count; the no-tasks state is the board's own honest copy, not a placeholder)
- [x] 16.5 Task cards (title opens 16.10's detail; real edit/delete triggers; dueDate/priority render only when the service supplies them; subject stays absent — no column)
- [x] 16.6 Create modal (saving is real now: title/due-date/priority write through `createTaskAction`; the old "saved nowhere" copy and the dashed storage note are deleted)
- [x] 16.7 Task editing
  - Real edit trigger on `TaskCard` (`IconButton`, accessible name "Edit <title>"),
    the same `TaskFormModal` as create (one Modal + validation system),
    pre-populated from the task's machine values (`dueDateValue`/`priorityValue`);
    `updateTaskAction` with pending state, optimistic card update, filter
    preserved. `parseTaskPatch` now carries `priority`, so the field persists.
- [x] 16.8 Task deletion
  - `IconButton` delete trigger and a confirmation `Modal` in the SkipOnboarding
    pattern (identified by title, Cancel first, one destructive button, never
    single-click). `deleteTaskAction`, optimistic removal, re-insert at its old
    position on failure with sanitized copy; column empty states and filter
    preserved. No undo promised — the model has no restore.
- [x] 16.9 Task drag-and-drop
  - Pointer drag between columns plus a keyboard path (ArrowLeft/ArrowRight on
    a focused card), both calling `setTaskStatusAction` through the workspace's
    optimistic/rollback move. Cards are `MotionListItem`s with
    `layout`/`layoutId`, so a move animates across columns; drop targets
    highlight only while dragging; focus follows a keyboard move; a polite live
    region announces it and a hint names the keys. A task moved outside the
    active filter leaves the visible set (filter preserved).
- [x] 16.10 Task detail view
  - URL-driven compact `Modal` (`?task=<id>`) resolved through
    `getTaskAction`; own task → fields in the Kanban's monochrome treatment
    (status/due/priority); foreign, fabricated or altered id → "Task not
    found" (ownership server-side, RLS authoritative). Edit/Delete open their
    real dialogs; shared popover motion + focus return.
- [x] 16.11 Real-service binding
  - `tasks/page.tsx` keeps `requireOnboardedUser` and loads
    `listTasks(user.id)` server-side; `TasksWorkspace` is the client boundary
    owning the live list and every mutation, and the page keeps the
    header/`QuickAddTask` seam. `TaskBoard`/`TaskCard` stay presentational, and
    the single `TaskItem` contract (owned by `frontend/lib/data/taskValues.ts`)
    is imported by the board — the duplicate definition is gone.
- [x] 16.12 Accessibility + rollback audit
  - A11y: shared `Modal` (native focus trap, Escape, focus return), named icon
    controls, focus-follows-move with polite announcements, `aria-busy` pending
    controls. Rollback: verified end-to-end — a forced action failure rolls the
    optimistic delete back and shows the sanitized copy ("We couldn't delete
    that task. Please try again.") in both the committed flow and the MCP pass.
- [x] 16.13 Responsive QA
  - Authenticated pass at 375 and 1280, light and dark, with the QA fixture
    (MCP Chromium): board, dialogs, detail and drag all render with zero
    horizontal overflow and clean consoles; screenshots recorded. 3.11's note
    stands: token conformance is verified, the pixel-judgement half remains a
    human-review item.

---

# 17. CALENDAR `/calendar`

- [x] 17.1 Header (shared PageHeader; inert Add-event button replaced with the honest "Event creation coming soon" badge — the 16.1 convention; real button returns with 17.9)
- [x] 17.2 Week/month toggle (real UI state via segmented control + traveling indicator; honest view-aware surface — no fabricated grid/events; the 17.3 grid inherits the state)
- [x] 17.3 Calendar grid (real UTC date math — 23/23 edge-case checks: leap Feb 2024/2026, 4–6-row months, spillover, Monday-start weeks; server ISO anchor; `data-date` event seam; no fabricated events; live grid view itself auth-gated — see 17.13 for the authenticated pass)
- [x] 17.4 Time labels (Week-only hour gutter — single-table row rhythm, `H:MM AM/PM`, full-day 00–23; 10/10 correctness checks; month view untouched; authenticated visual pass lands with 17.13)
- [x] 17.5 Calendar class event blocks
  - `ClassEventBlock` is a presentation component positioned by the
    established seam: `startDate` → column, profile-zone `startTime`/`endTime`
    → vertical offset + height on the hour rows (`calendarEvents.ts`
    `timedPlacement`, minute precision, multi-hour spill, 20-minute legibility
    floor, point events at 30 minutes). Monochrome, title-dominant with
    metadata demoted by duration. Loaded once at the page level
    (`listEventsForDates`) — never a query per block. Overlap stays the
    documented single-column fallback until a design defines side-by-side
    layout. Proven in `frontend/tests/qa/calendar-ui.spec.ts` (pure placement
    maths + real create→week flow).
- [x] 17.6 Exam blocks
  - `ExamEventBlock`, the same `EventBlock` frame under `eventKind`'s dispatch
    with its own icon; accessible names carry "Exam: …" and the legend names
    it. Typed flow proven in calendar-ui.spec.ts.
- [x] 17.7 Deadline blocks
  - `DeadlineEventBlock`, same dispatch; an all-day deadline rides the week
    header's chip band and every covered month date. Proven in
    calendar-ui.spec.ts.
- [x] 17.8 Legend
  - `EventLegend`: the three canonical entries with the exact icons the blocks
    render, so type is learnable without hovering and never colour-only.
- [x] 17.9 Add-event modal
  - Real `AddEventButton` in the header replaces the "coming soon" badge;
    `EventFormModal` collects type/title/course (real subjects, field absent
    when there are none)/start/end/all-day/location, with the profile-zone
    wall-clock shapes the service parses, validated client- and server-side,
    pending/`aria-busy`, optimistic insert positioned at once, sanitized retry
    on failure. New read: `lib/data/subjects.ts` (`listSubjects`, ids + names).
- [x] 17.10 Edit/delete
  - URL-driven detail (`?event=<id>` via `getEventAction`; foreign, altered or
    fabricated ids answer "Event not found"), the shared `EventFormModal` for
    edit (pre-populated, moment-optimistic update) and the `SkipOnboarding`
    confirm for delete (never single-click, optimistic removal, old-position
    re-insert on failure). Email/description field rule unchanged: only
    supported fields render.
- [x] 17.11 Bind to Calendar service
  - `calendar/page.tsx` loads one server-side range — the month grid's
    first–last date (a superset of the anchor's week) through the new
    `listEventsForDates(userId, { firstDate, lastDate })`, which resolves the
    boundary dates to instants in the profile's zone inside the data layer
    (R15). `CalendarWorkspace` is the client boundary owning the live list and
    every mutation; `CalendarGrid`/`WeekGrid` stay presentational and import
    the one `EventItem` contract. `endDateValue` + `durationMinutes` were
    added to that contract (pinned in events-data.spec.ts).
- [~] 17.12 External integrations
  - Still deferred: Google Calendar / Canvas have no provider work, credentials
    or API scope in this tree, and nothing is faked. Tracked as 46.x; the
    marketing FAQ states the absence honestly.
- [x] 17.13 Responsive QA
  - Verified in real Chromium against the QA fixture (Task 20.10) with the
    environment's genuinely-empty local stack — the intended data-free
    baseline. Authenticated sweeps: Dashboard (structure, identity, zero-state
    honesty, zero-state guest-comparison), Tasks (filters + aria-pressed,
    traveling indicator, Quick Add dialog incl. validation + Escape + focus
    return), Calendar (month/week toggle, Monday-first grid, today marker,
    hour gutter responsive), shared shell (desktop rail + mobile drawer,
    popovers, profile menu, assistant), navigation loop
    (Dashboard↔Tasks↔Calendar + back/forward/refresh/scroll), width battery
    320/375/768/1024/1280 with zero horizontal overflow, motion variety
    (no fade-only), reduced-motion emulation. Console: zero errors; no failed
    requests; nothing stuck at opacity 0.
  - The event-block slice is now delivered: 17.5–17.11 landed and the QA1 MCP
    pass rendered real typed blocks at 1280/375, light + dark (block-in-cell
    geometry checked), zero horizontal overflow, clean console/network; then
    the rows were deleted through the UI so the fixture stays data-free. The
    committed `frontend/tests/qa/calendar-ui.spec.ts` re-runs the flows
    (positioning, all-day band, typing, legend, detail/edit/delete, rollback,
    reduced motion) as part of `npm run test` (110/110).
  - 3.11 note: the token-conformance half of the visual debt 17.3/17.4/17.13
    inherited is closed — computed styles verified against DESIGN.md on
    /calendar (month + week views) at all five widths; one REAL_DRIFT
    repaired (dead text-body-sm utility on date numbers → text-body-md
    token, identical rendered values). Pixel-judgement half remains owed to
    a human reviewer over design-* screenshots. 17.13's assertion scripts now
    live as committed, re-runnable frontend/tests/qa/structure.spec.ts
    (31/31 passing after the repair).
- [x] 17.14 UTC storage + profile timezone + DST strategy
  - Storage half delivered by 22.x: all event instants are stored in UTC
    (`timestamptz`), every date/time value resolves in the profile's IANA
    zone, and the DST-safe wall-clock ↔ instant maths lives in
    `frontend/lib/data/taskDates.ts` — a gap time resolves forward
    (02:30 spring-forward → 03:30), an ambiguous time takes its first
    occurrence, and ordinary times round-trip exactly. Pinned in
    `frontend/tests/qa/events-data.spec.ts`.
  - UI half delivered by 17.5–17.11: the grid columns and block geometry come
    from the profile-zone `startDate`/`startTime`/`endTime` values the data
    layer maps, display strings (`dateLabel`/`timeLabel`) are formatted in the
    same zone server-side, the visible window is resolved to instants in that
    zone inside `listEventsForDates` (never in a component), and optimistic
    rows reuse the same conversion (`eventItemFromLocal`). No client ever
    re-derives a clock; pinned by calendar-ui.spec.ts's placement maths.

---

# 18. DOCUMENTS `/documents`

- [ ] 18.1 Header
- [ ] 18.2 Search
- [ ] 18.3 Filter pills
- [ ] 18.4 Upload button
- [ ] 18.5 Drag-and-drop
- [ ] 18.6 Document cards
- [ ] 18.7 Uploading
- [ ] 18.8 Parsing
- [ ] 18.9 Indexed
- [ ] 18.10 Searchable state
- [ ] 18.11 Preview
- [ ] 18.12 Delete/rename
- [ ] 18.13 Pixel-dissolve parsing → indexed transition
- [ ] 18.14 Real upload pipeline
- [ ] 18.15 Failed-state UX
- [ ] 18.16 Quota-exceeded UX
- [ ] 18.17 Responsive/accessibility QA

---

# 19. ASSISTANT `/assistant`

- [ ] 19.1 Conversation sidebar
- [ ] 19.2 New conversation
- [ ] 19.3 Active conversation
- [ ] 19.4 User bubble
- [ ] 19.5 AI bubble
- [ ] 19.6 Avatar
- [ ] 19.7 Action chips
- [ ] 19.8 Input
- [ ] 19.9 Send
- [ ] 19.10 Streaming
- [ ] 19.11 Source references
- [ ] 19.12 Empty state
- [ ] 19.13 Local development fixtures
- [ ] 19.14 Real backend binding
- [ ] 19.15 Responsive QA
- [ ] 19.16 Global launcher shares the same chat architecture

IMPORTANT:

There is ONE Assistant architecture.

Do not build a separate chat system for the global bubble.

---

# PART VI — DATA SERVICES

# 21. TASK DATA

- [x] 21.1 CRUD service
  - `frontend/lib/data/tasks.ts`: server-only, typed against the generated
    `Database`, request-scoped cookie client (never the service role), every
    query also scoped by `user_id` with owner-only RLS as the enforcement
    layer; mutations return the settled row mapped to the 16.5 display
    contract or null/false for a zero-row write (never a fabricated success).
- [x] 21.2 Load
  - `listTasks` (due_date asc nulls last → created_at → id, deterministic)
    and `getTask` by immutable id, both scoped to the caller and mapped to
    `TaskItem`.
- [x] 21.3 Create
  - `createTask`: server-validated title (trim, non-empty, 80-char cap
    matching QuickAddTask), optional description/effort/due date, status
    defaults `todo`.
- [x] 21.4 Update
  - `updateTask`: title/description/due date/effort patch; absent leaves the
    value, null (or "") clears it; an empty patch is rejected.
- [x] 21.5 Delete
  - `deleteTask`: true only when an owned row was removed; cross-user ids
    affect zero rows.
- [x] 21.6 Status
  - `setTaskStatus`: `todo | in_progress | done`, mapped to the card's
    hyphenated `in-progress` display value.
- [x] 21.7 Priority
  - Migration `20260911151733_add_task_priority.sql`: nullable
    `tasks.priority` text + named `tasks_priority_check` (`low` · `medium` ·
    `high`). NULL = no priority; no `none` sentinel, no fourth level, no
    scale. Applied with `npm run db:reset` (6 migrations, `db lint` clean),
    types regenerated (`db:check-types` matches); DATABASE.md and
    `backend/supabase/MIGRATIONS.md` updated.
- [x] 21.8 Due dates
  - `frontend/lib/data/taskDates.ts`: date-only ("YYYY-MM-DD") ↔ the instant
    of 00:00 in the profile's IANA timezone (R15), display-formatted
    server-side as "Wed, Sep 2". No client ever re-derives the clock.
- [~] 21.9 Optimistic updates + rollback
  - Server half only, deliberately: every mutation returns the settled row or
    a sanitized failure, which is the contract an optimistic UI needs to
    reconcile or roll back. The optimistic UI itself is UI-owned and lands
    with 16.x — not faked here.
- [x] 21.10 Error handling
  - `frontend/lib/data/taskActions.ts` (gate before the try, server-side
    parse/validate, service call, `revalidatePath("/tasks")`) and
    `frontend/lib/data/taskErrors.ts` (sanitized copy). No Supabase/Postgres
    message ever reaches the client.
- [x] 21.11 Two-user isolation test
  - `frontend/tests/qa/tasks-data.spec.ts`: pure validation/date tests plus
    QA1/QA2 real-session isolation of create/list/get/update/delete/status/
    priority, CHECK rejections, and an id-scoped residue-free teardown.
    It runs as its own Playwright project dependency so transient task rows
    can never race `rls-isolation.spec.ts`. Full `npm run test` 72/72.

The UI binding is the next Stage 3 step (16.11/16.x); this task deliberately
stopped at the service.

---

# 22. CALENDAR DATA

- [x] 22.1 CRUD
  - `frontend/lib/data/events.ts`: server-only, typed against the generated
    `Database`, request-scoped cookie client (never the service role), every
    query also scoped by `user_id` with owner-only RLS as the enforcement
    layer; writes return the settled row mapped to the calendar contract, or
    null/false for a zero-row write.
- [x] 22.2 Load
  - `listEvents(userId, { start, end })` reads the half-open window
    `[start, end)`: an event overlaps when it starts before the window ends
    and either ends at/after the window start or has no end (a point event);
    ordered soonest-first with an id tiebreak. `getEvent` resolves one owned
    row by immutable id.
- [x] 22.3 Create
  - `createEvent`: server-validated title (trim, 120-char cap), optional type
    and course, required start, optional end (≥ start), all-day spans, and
    location/description bounds. The validated *local* draft is resolved to
    UTC instants in the profile's zone by the service (R15) before the write.
- [x] 22.4 Update
  - `updateEvent`: the edit form owns the whole event, so the validated draft
    replaces every editable field — no sparse-patch ambiguity around
    `all_day` and the derived end.
- [x] 22.5 Delete
  - `deleteEvent`: true only when an owned row was removed; cross-user ids
    affect zero rows.
- [x] 22.6 Event type
  - Migration `20260911164426_add_events_type.sql`: nullable `events.type`
    text + named `events_type_check` (`class` · `exam` · `deadline`). NULL = a
    plain event, no `other` sentinel. Applied with `npm run db:reset`
    (8 migrations, `db lint` clean); types regenerated (`db:check-types`
    matches); DATABASE.md and `backend/supabase/MIGRATIONS.md` updated.
  - Course (17.5's optional "course?"): migration
    `20260911164428_add_events_subject.sql` adds nullable
    `events.subject_id` → `subjects` with `ON DELETE SET NULL` (classification,
    not ownership) plus the `ensure_event_subject_owner` trigger, which
    rejects a subject belonging to another user — a plain FK would accept a
    foreign id while RLS only guards the event owner.
- [~] 22.7 Limited recurring events — deferred
  - Deliberately not shipped. A minimal `recurrence none|weekly` +
    `recurrence_until` column pair would force the UI to decide series
    semantics before it can: how an occurrence is identified (series id +
    occurrence start), and whether edit/delete acts on one occurrence or the
    whole series (17.10 is the edit/delete owner). Storage without those
    decisions either leaks series semantics into the UI or needs a follow-up
    migration, and the calendar UI is not bound yet. The exact remaining work:
    the recurrence columns + expanded `listEvents` and the 17.10 series
    interaction decision — recorded, not faked.
- [x] 22.8 Isolation test
  - `frontend/tests/qa/events-data.spec.ts`: pure validation, DST/timezone and
    row→display tests, plus QA1/QA2 real-session isolation of
    list/get/create/update/delete, the range window returning only
    overlapping rows, the type/end-order CHECK rejections, the same-user
    subject guard, and an id-scoped residue-free teardown. It runs as its own
    Playwright project dependency (`qa-events-data`) so transient event rows
    cannot race the other residue counts.
  - Storage half of 17.14 delivered here: instants are stored in UTC, all
    date/time values resolve in the profile's IANA zone, and
    `taskDates.ts` gained the DST-safe wall-clock ↔ instant conversions rather
    than a second date system. UI rendering remains 17.x's.

---

# 23. DOCUMENT STORAGE

- [x] 23.1 Secure private bucket
  - Migration `20260912053249_documents_storage_bucket.sql`: private
    `documents` bucket (`public = false`, 25 MiB cap, PDF/DOCX/PNG/JPEG
    allowlist) plus four owner-folder RLS policies on `storage.objects`
    (`bucket_id = 'documents' and (storage.foldername(name))[1] =
    auth.uid()::text` for select/insert/update/delete, `to authenticated`);
    `anon` has no policy → denied. Path convention
    `{user_id}/{document_id}/{sanitized-name}`. Local Storage enabled in the
    git-ignored `config.toml`; hosted untouched. DATABASE.md documents the
    bucket; the live checks are in documents-data/ui.spec.ts.
- [x] 23.2 Upload
  - Reserve → direct browser→Storage upload → finalize (one pipeline in
    `frontend/app/(app)/documents/_components/DocumentsUploadProvider.tsx`):
    `reserveDocumentAction` validates, applies the quota guard and writes the
    row + path; the browser PUTs the bytes to that path with the user's
    session; `finalizeDocumentAction` verifies the object exists in the
    caller's folder, re-reads its real size and magic bytes, and settles the
    row. Any failure after the reservation discards object + row.
- [x] 23.3 Drag/drop
  - The drop target and the header button share the one pipeline (the
    provider); dragging highlights the target, dropping hands the file to the
    same `upload()` the picker uses.
- [x] 23.4 Server-side type validation
  - `documentValues.ts` allowlist (PDF/DOCX/PNG/JPEG) enforced at reserve via
    `parseDocumentUpload` and again at finalize by reading the object's
    leading bytes (`magicBytesMatch`), so a renamed non-PDF is rejected and
    cleaned up. The bucket's `allowed_mime_types` is the fast first gate.
- [x] 23.5 Size validation
  - 25 MiB, documented in `documentValues.ts` and pinned as the bucket's
    `file_size_limit`; the client pre-check is convenience, the reserve parse
    and the finalize object read are authoritative.
- [x] 23.6 Database record
  - `frontend/lib/data/documents.ts` writes the `documents` row through the
    request-scoped, RLS-enforced client (`listDocuments`, `getDocument`,
    `reserveDocument`, `finalizeDocument`, `renameDocument`, `deleteDocument`,
    `getDocumentUsage`); `documentRowToItem` maps the display contract, and
    finalize keeps `size_bytes` equal to the object Storage actually holds.
- [x] 23.7 Upload progress
  - Real XHR progress against the Storage REST endpoint
    (`putObjectWithProgress`, session access token used per request, never
    logged); the surface renders a `role="progressbar"` with live
    `aria-valuenow` and the percent text. No fake percentage.
- [x] 23.8 Failure handling
  - Sanitized copy in `documentErrors.ts`; failed reserve/upload/finalize all
    run the abort path (object best-effort, then row), a failed delete keeps
    the row (object first, then row), and a rejected object never leaves a
    readable record. The UI keeps the last good document visible on failure.
- [x] 23.9 Delete storage + row + chunks
  - `deleteDocument` removes the object first, then the row;
    `document_chunks` cascades. UI: confirmation `Modal` (never single-click),
    optimistic-none removal after success; proven object + row + chunk
    removal in documents-ui.spec.ts.
- [x] 23.10 Rename
  - `renameDocument` updates the display name only; `storage_path` is stable
    (asserted before/after in documents-ui.spec.ts). UI: inline rename on the
    settled row.
- [x] 23.11 Access-control verification
  - `frontend/tests/qa/documents-data.spec.ts`: two real users (QA1/QA2) —
    own upload/download/list/remove work; cross-user read, write and delete
    denied; `anon` denied; bucket MIME/size rejections leave no objects; row
    delete cascades chunks. Own Playwright project (`qa-documents-data`, after
    the existing data projects and their UI consumers). `documents-ui.spec.ts`
    covers the browser pipeline + guest prompt.
- [~] 23.12 Per-plan quotas
  - Server-side guard shipped with the documented default free-tier limit
    (50 documents or 250 MiB total, enforced in `reserveDocument`; over-limit
    answers the sanitized quota copy). Plan-driven entitlements remain `[~]`:
    billing (49.x) owns the plan matrix, and no plan numbers are invented
    here.
- [x] 23.13 Malware/abuse posture
  - Recorded in this task: no surface renders or executes file content yet
    (preview is 18.11, which must decide served Content-Disposition/types
    before it exposes downloads), the bucket is private with a closed
    type/size allowlist enforced at three layers (bucket constraint, reserve
    parse, finalize magic bytes), magic bytes are a fast reject — not a virus
    guarantee — and scanning + takedown remain deferred post-launch per R13
    (no scanner is faked; R13's full policy is a launch-readiness item).

---

# 24. DOCUMENT PROCESSING / OCR

- [x] 24.1 Supported types
  - The 23.x bucket allowlist is the processing contract: PDF, DOCX, PNG,
    JPEG. Anything else is rejected at reserve/finalize before a job exists;
    the handler additionally fails an unknown MIME permanently.
- [x] 24.2 Background job architecture
  - `document.process` is registered in the 29.1 worker registry
    (`backend/worker/handlers.mjs` → `documentProcessing.mjs`); the 23.x
    finalize action enqueues it (service-role `enqueueJob`) and flips the
    document to `indexing` in the same hand-off, so the UI never shows a
    settled upload that silently isn't queued. The generic runner's
    claim/backoff/dead-letter machinery is the scheduler — no new one.
- [x] 24.3 PDF text extraction
  - pdfjs-dist (legacy Node build) in the worker; one text unit per page,
    `page_count` from the document. Parse failures are a permanent
    "unreadable" failure with sanitized copy.
- [x] 24.4 DOCX
  - mammoth in the worker; one text unit (DOCX has no layout pages, so
    `page_count` stays NULL); parse failures fail permanently.
- [!] 24.5 Image documents — BLOCKED (no OCR provider)
  - [!] BLOCKED BY 24.5/24.6 dependency: an OCR provider + credential
    (Tesseract in the worker image or a hosted OCR API key) does not exist in
    this environment. The seam is implemented and wired
    (`backend/worker/extract/ocr.mjs`, `OCR_DEPENDENCY`), and images fail with
    the honest sanitized copy ("isn't available yet") and a permanent job —
    no OCR text is ever faked. Removing [!] is a provider-registration task
    that changes only `ocr.mjs`.
- [!] 24.6 OCR fallback — BLOCKED (same dependency as 24.5)
  - PDFs with no text layer (fewer than 4 non-space characters after
    normalization) are detected as scans and routed to the same blocked
    seam: permanent failure with the OCR-unavailable copy rather than an
    empty "indexed" document.
- [x] 24.7 Normalization
  - `extract/text.mjs`: NFKC, CRLF→LF, de-hyphenation across line breaks,
    horizontal-whitespace collapse, blank-run collapse — conservative, so the
    text 25.x embeds is the author's words with extraction artefacts removed.
  - A heuristic bug found in verification (a thin but real text PDF was
    classified as a scan under a 24-character threshold) was fixed at the
    source: the threshold is now 4 non-space characters — "no text layer",
    not "little text".
- [x] 24.8 Page/section detection
  - The page is the unit: PDFs store one ordered `document_chunks` row per
    page (chunk_index = page order); DOCX stores one unit for the document.
    This is deliberately the minimum that is honest — 25.x owns the real
    chunking strategy for embeddings, and re-chunking is a `document_chunks`
    rewrite, not a schema change.
- [x] 24.9 Metadata
  - Extraction writes `page_count` and clears `error_message` on success;
    `mime_type`/`size_bytes`/`name` come from 23.x. No invented metadata.
- [x] 24.10 Status machine
  - Schema migration `20260912072153_documents_failed_state.sql` extends the
    documents vocabulary with `failed`; the handler drives
    `uploaded → indexing → indexed` and `failed` (with sanitized
    `error_message`) on permanent failure or while a retry backs off, and
    flips back to `indexing` when a retry actually runs.
- [x] 24.11 Retry/backoff/dead-letter
  - The 29.1 protocol is used unchanged; a retryable processing failure
    records the transient copy, lets the job back off, and the last attempt
    (or a non-retryable failure) records the terminal copy. Only the worker
    holding the lease may write the row.
- [x] 24.12 User-facing errors
  - All processing copy lives in `documentProcessing.mjs`
    (`PROCESSING_COPY`) and is the only thing written to `error_message`;
    library/Postgres messages stay in worker logs behind ids. The documents
    surface renders the sanitized copy verbatim in the failed state.
- [x] 24.13 Page/cost limits
  - Documented per-document limits in the handler: 200 pages and 2,000,000
    characters; over-limit is a permanent failure with its own sanitized copy
    and no partial chunks. (R5's spend caps/rate limits remain 29.6/29.7.)
- [~] 24.14 Accuracy benchmark set
  - `backend/worker/benchmark.mjs` + `benchmark-fixtures/`: pairs
    `<name>.pdf|.docx` with `<name>.expected.txt`, reports the Dice
    similarity over normalized character bigrams, and exits non-zero when no
    fixtures exist (a benchmark that ran nothing is not success). Marked [~]
    until a real, human-checked test set exists — no accuracy numbers are
    recorded anywhere from the harness's own math.

Step 0 (ACL audit) result, recorded here and in DATABASE.md: every public
table carried the Supabase bootstrap's `MAINTAIN`, `REFERENCES`, `TRIGGER`
and `TRUNCATE` grants for `authenticated` (`TRUNCATE` bypasses RLS — the
critical find); five tables carried write grants with no policy
(`usage_events`, `subscriptions`, `notifications` INSERT, `profiles`/
`tool_runs` DELETE); four functions carried client EXECUTE (`complete_onboarding`
for `anon`; the three trigger functions for both roles). Migration
`20260912072133_acl_least_privilege.sql` revokes all of it; the live ACLs now
match the DATABASE.md matrix exactly, and `rls-isolation.spec.ts` was updated
to assert the stronger privilege-level denial where grants were removed.

---

# 25. SEARCH / EMBEDDINGS

- [ ] 25.1 Chunking strategy
- [ ] 25.2 Chunking
- [ ] 25.3 Embeddings
- [ ] 25.4 pgvector
- [ ] 25.5 Vector index
- [ ] 25.6 Semantic search
- [ ] 25.7 Keyword/metadata filtering
- [ ] 25.8 Hybrid retrieval
- [ ] 25.9 Page references
- [ ] 25.10 Search result UI
- [ ] 25.11 Retrieval quality test set
- [ ] 25.12 Re-embedding/backfill path

---

# 26. ASSISTANT BACKEND

- [ ] 26.1 Provider abstraction
- [ ] 26.2 Chat service
- [ ] 26.3 Conversation persistence
- [ ] 26.4 Message persistence
- [ ] 26.5 RAG
- [ ] 26.6 Context assembly + token budget
- [ ] 26.7 Source references
- [ ] 26.8 Streaming
- [ ] 26.9 Structured tool outputs
- [ ] 26.10 Rate limits
- [ ] 26.11 Usage tracking
- [ ] 26.12 Failure/timeout handling
- [ ] 26.13 Cross-user leakage test
- [ ] 26.14 Empty retrieval behavior
- [ ] 26.15 Spend caps
- [ ] 26.16 Prompt-injection protection

---

# 27. AI ACTION ENGINE

- [ ] 27.1 Action schema
- [ ] 27.2 Add task
- [ ] 27.3 Add reminder
- [ ] 27.4 Create event
- [ ] 27.5 Related notes
- [ ] 27.6 Confirmation before persistence
- [ ] 27.7 Success/failure
- [ ] 27.8 Action log
- [ ] 27.9 Duplicate prevention
- [ ] 27.10 Creation-tool actions
- [ ] 27.11 Confirmation before expensive generation
- [ ] 27.12 Success/failure state
- [ ] 27.13 Idempotency

---

# 28. ACADEMIC INTELLIGENCE

- [ ] 28.1 Deadline extraction
- [ ] 28.2 Exam-date extraction
- [ ] 28.3 Class schedules
- [ ] 28.4 Subject names
- [ ] 28.5 Readings
- [ ] 28.6 Confirmation UI
- [ ] 28.7 Convert to tasks/events
- [ ] 28.8 Ambiguous-date handling
- [ ] 28.9 Multi-format test set

---

# 29. PLATFORM INFRASTRUCTURE

- [x] 29.1 Background job runner
  - Decision record. **Store:** new `public.jobs` table (migration
    `20260912065021_jobs_runner.sql`) — id, nullable `user_id` (system jobs;
    cascade), `kind`, `payload` jsonb, `status` CHECK
    `queued|running|succeeded|failed|dead_letter`, `attempts`/`max_attempts`,
    `run_after`, `locked_at`/`locked_by`, `last_error`, `created_at`/
    `updated_at`/`completed_at`. Two partial indexes match the worker's
    predicates exactly (`(run_after) where status='queued'`, `(locked_at)
    where status='running'`) plus `user_id` for owner reads. RLS: owners may
    SELECT their own jobs; `revoke all` removed the Supabase bootstrap's
    blanket client grants, so no client role can INSERT/UPDATE/DELETE.
    **Protocol:** `claim_jobs(p_worker_id, p_limit)` (security definer) uses
    `FOR UPDATE SKIP LOCKED` to flip due `queued` rows to `running`
    (`attempts+1`, lease) and reclaims `running` rows whose 5-minute lease
    expired before selecting; `finish_job(job, worker, error, retryable)`
    settles as `succeeded`, `failed` (non-retryable), `dead_letter`
    (attempts exhausted) or back to `queued` with
    `least(2^(attempts-1)·30s, 1h)` — only the worker holding the lease may
    finish. Both functions are revoked from `public`, `anon` and
    `authenticated` explicitly (the bootstrap grants EXECUTE directly to
    those roles; a PUBLIC revoke alone leaves a definer function reachable —
    caught and fixed in this task) and granted to `service_role` only.
    **Runner:** plain Node ESM at `backend/worker/` (`run.mjs` + a handler
    registry in `handlers.mjs`), packaged through the backend npm package
    (`npm run worker:once -w backend`, root alias `npm run worker:once`),
    with `--once/--limit/--idle-ms/--worker-id`, bounded batches, idle
    backoff and SIGINT/SIGTERM graceful stop. Handlers are
    `async (payload, ctx) => {}`; a thrown error retries, `.retryable=false`
    fails permanently. 29.1 ships `noop.test` (payload-driven failure for the
    proofs); 24.2 registers the document handler. **Enqueue:** server-only
    `frontend/lib/data/jobs.ts` `enqueueJob(kind, payload, { runAfter?,
    userId? })` writes via the service-role client (decision: enqueue is
    server-only, so the session cannot create work) and is called from a
    Server Action after its gate; `frontend/lib/supabase/service.ts` is the
    one service client, server-only, key never logged.
  - Verification. `frontend/tests/qa/jobs-runner.spec.ts` (own project
    `qa-jobs-runner`, tail of the mutating chain) drives the real worker:
    enqueue → `--once` → `succeeded`; retryable failure → `queued` with the
    documented 30s backoff → fast-forward → `dead_letter`; non-retryable →
    `failed`; stale lock reclaimed while a fresh lock is untouched; system
    job runs but is invisible to users; QA1 rows RLS-isolated from QA2/anon;
    client INSERT/UPDATE/DELETE and `claim_jobs`/`finish_job` RPC all denied.
    `afterAll` asserts zero job rows. Full `npm run test` **124/124**
    (`frontend/.playwright/jobs-green.log`), typecheck/lint/build pass,
    `db:reset` applies all ten migrations cleanly and `db:check-types`
    matches. MCP Chromium: the worker settled a user-owned success job and a
    permanent-failure job, then `/dashboard` rendered authenticated and guest
    at 1280/375 with zero console errors, no overflow and clean network — no
    UI change was made or needed.
  - 24.2 is now unblocked: register a `document.process` handler in
    `backend/worker/handlers.mjs` and enqueue it from the document finalize
    action after that action's gate (the document row id belongs in the
    payload; `user_id` is set so the owner can follow the job's status).
- [ ] 29.2 Timezone strategy
- [ ] 29.3 Structured logging
- [ ] 29.4 Error tracking
- [ ] 29.5 Product analytics + consent
- [ ] 29.6 AI/OCR/storage cost dashboard
- [ ] 29.7 Central rate limiting
- [ ] 29.8 Pull-request CI

---

# PART VII — SHARED TOOL ARCHITECTURE

# 30. TOOL REGISTRY / TOOL PLATFORM

- [x] 30.1 Tool registry
  - Formalized `frontend/components/tools/toolCatalog.ts` as the authoritative source
    (Stage 1 item 5): field parity with 0.11 documented as an explicit mapping
    (`group`→family, `status`→state, `href`→route, plus `shortName` for chip
    rows); registry states documented as exactly live/planned/disabled with the
    processing/failed per-run job states deliberately excluded; tier rules
    documented and enforced.
  - Data and members frozen; module-load `assertToolRegistry()` throws on a
    duplicate tool/group id, unknown group, empty required string, a tier-3
    entry that is not `disabled`, or a `live` entry whose route is not a real
    app route. Compile-time `ToolId` union kept. Canonical API exported as
    `toolRegistry` (accessors + label helpers) alongside the original exports.
  - Single-source fixes (genuine duplications): the /features presentation and
    converter section eyebrows now read names from the registry
    (features/page.tsx, FileConvertersSection.tsx); Quick Actions chips read
    `shortName` instead of eight hand-written labels; per-tool status words come
    from `toolStatusLabel` (ToolCard, homepage marquee); aggregate "not built
    yet" badges/notes in FeatureGrid and QuickActions now read `HAS_LIVE_TOOL` /
    chip status instead of being hardcoded; assistant-launcher starter
    destinations read registry hrefs. No copy changed.
  - Recorded, not changed: `pdf-editor` ("PDF tools") has no distinct /features
    card — the converter section carries merge/split/extract/compress as
    utility groups while the tool is carded on the homepage marquee and the
    dashboard hub; pricing/benchmarks "File converters" mentions are outside
    0.12's named surfaces (pricing is 8.8's reconciliation).
  - Guard: committed `frontend/tests/qa/tool-registry.spec.ts` (Playwright only; wired
    into the authenticated project) proves /features cards, the homepage
    marquee and the dashboard hub render registry names/actions/status
    words/family labels, no disabled tool is carded and no "Open" appears
    while `HAS_LIVE_TOOL` is false. Deliberate-break proof: flipping the
    tier-3 `video-editor` to `planned` made the import throw
    `[toolCatalog] tool "video-editor": tier 3 must be disabled` and the spec
    fail; reverted, 4/4 green. 52/52 committed QA specs; typecheck/lint/build
    pass.

- [ ] 30.2 Tool families
- [ ] 30.3 State model
- [ ] 30.4 Shared tool workspace shell
- [ ] 30.5 File input/output architecture
- [ ] 30.6 Export/download architecture
- [ ] 30.7 Entitlement hooks

## Tool states

```text
live
planned
processing
failed
disabled
```

---

# PART VIII — TIER 1 TOOLS

These are intended to work at launch.

## 38. QR Generator

- [ ] 38.1 UI
- [ ] 38.2 URL/text input
- [ ] 38.3 Preview
- [ ] 38.4 Export
- [ ] 38.5 Payload validation

## 39. Flashcards

- [ ] 39.1 UI
- [ ] 39.2 Manual creation
- [ ] 39.3 From topic
- [ ] 39.4 From notes
- [ ] 39.5 Review/flip
- [ ] 39.6 Edit/delete
- [ ] 39.7 Persistence

## 40. Quiz / MCQ

- [ ] 40.1 Setup
- [ ] 40.2 From topic
- [ ] 40.3 From uploaded notes
- [ ] 40.4 Difficulty
- [ ] 40.5 Question count
- [ ] 40.6 Taking UI
- [ ] 40.7 Evaluation
- [ ] 40.8 Results
- [ ] 40.9 Explanations

## 43. Data Tables

- [ ] 43.1 UI
- [ ] 43.2 Generate from prompt
- [ ] 43.3 Generate from notes/data
- [ ] 43.4 Structured schema
- [ ] 43.5 Manual editing
- [ ] 43.6 Export
- [ ] 43.7 Validation

---

# PART IX — TIER 2 TOOLS

These can be post-launch and should be marked Planned until genuinely implemented.

## 31. Presentation Generator

- [ ] 31.1 Setup
- [ ] 31.2 Topic → outline
- [ ] 31.3 Outline editing
- [ ] 31.4 Slide generation
- [ ] 31.5 Upload presentation template
- [ ] 31.6 Analyze uploaded template
- [ ] 31.7 Recreate style/layout from template
- [ ] 31.8 Slide editing
- [ ] 31.9 Reordering
- [ ] 31.10 Export
- [ ] 31.11 Failure/quality handling

Priority:
topic → slides must be reliable before uploaded-template recreation.

## 32. Document Editor / Maker

- [ ] 32.1 Workspace
- [ ] 32.2 Create from prompt
- [ ] 32.3 Create from notes
- [ ] 32.4 Editing
- [ ] 32.5 Formatting
- [ ] 32.6 Export
- [ ] 32.7 Persistence

## 33. PDF Operations

- [ ] 33.1 Merge
- [ ] 33.2 Split
- [ ] 33.3 Full content editing — Tier 3 / research only
- [ ] 33.4 Reorder pages
- [ ] 33.5 Compress
- [ ] 33.6 Rotate
- [ ] 33.7 Extract pages
- [ ] 33.8 Preview
- [ ] 33.9 Export

## 34. Spreadsheet Editor / Maker

- [ ] 34.1 Workspace
- [ ] 34.2 Generate from prompt
- [ ] 34.3 Generate from structured data
- [ ] 34.4 Manual editing
- [ ] 34.5 Bounded formula support
- [ ] 34.6 Formatting
- [ ] 34.7 Import/export
- [ ] 34.8 Validation

Do not attempt full Excel parity.

## 35. File Converters

- [ ] 35.1 Converter workspace
- [ ] 35.2 Image → PDF
- [ ] 35.3 PDF → image
- [ ] 35.4 Supported document conversions
- [ ] 35.5 File validation
- [ ] 35.6 Progress
- [ ] 35.7 Failure handling
- [ ] 35.8 Export
- [ ] 35.9 Fidelity limitations clearly stated

## 36. Background Remover

- [ ] 36.1 Upload
- [ ] 36.2 Processing
- [ ] 36.3 Preview comparison
- [ ] 36.4 Background removal
- [ ] 36.5 Export
- [ ] 36.6 Failure/size limits

## 42. Mind Maps

- [ ] 42.1 Canvas
- [ ] 42.2 Generate from topic
- [ ] 42.3 Generate from notes
- [ ] 42.4 Node editing
- [ ] 42.5 Repositioning
- [ ] 42.6 Export
- [ ] 42.7 Persistence

---

# PART X — TIER 3 / RESEARCH

These must NOT be advertised as launch functionality.

## 37. Photo / Video Editor

- [ ] 37.1 Feasibility study
- [ ] 37.2 Cost model
- [ ] 37.3 Browser memory constraints
- [ ] 37.4 Mobile constraints
- [ ] 37.5 Processing architecture
- [ ] 37.6 Editing prototype
- [ ] 37.7 Export strategy
- [ ] 37.8 Failure recovery
- [ ] 37.9 Performance
- [ ] 37.10 Launch decision

Do not schedule full implementation without a feasibility gate.

## 41. Handwritten Notes Generator

- [ ] 41.1 Feasibility
- [ ] 41.2 Handwriting styles
- [ ] 41.3 Page templates
- [ ] 41.4 Generation
- [ ] 41.5 Export
- [ ] 41.6 Quality evaluation
- [ ] 41.7 Academic-integrity review

Do not advertise until quality and acceptable-use concerns are resolved.

---

# PART XI — INTELLIGENCE

# 44. Workload Engine

- [ ] 44.1 Calculation definition
- [ ] 44.2 Task load
- [ ] 44.3 Deadline pressure
- [ ] 44.4 Estimated effort
- [ ] 44.5 Deadline clusters
- [ ] 44.6 Calendar conflicts
- [ ] 44.7 Low / Medium / High
- [ ] 44.8 Actionable explanation
- [ ] 44.9 Dashboard output
- [ ] 44.10 Assistant output
- [ ] 44.11 Realistic schedule tests
- [ ] 44.12 Explainable/tunable thresholds

---

# 45. Dashboard Intelligence

This supersedes Dashboard task 15.9.

- [ ] 45.1 Real deadlines
- [ ] 45.2 Real task statistics
- [ ] 45.3 Real document statistics
- [ ] 45.4 Real study streak
- [ ] 45.5 Workload risk
- [ ] 45.6 Upcoming events
- [ ] 45.7 AI recommendations
- [ ] 45.8 Empty states
- [ ] 45.9 Performance / no N+1

---

# PART XII — PRODUCT SYSTEMS

# 46. Calendar Integrations

- [ ] 46.1 Architecture
- [ ] 46.2 Google Calendar
- [ ] 46.3 OAuth
- [ ] 46.4 Import/sync
- [ ] 46.5 Timezones
- [ ] 46.6 Disconnect/reconnect
- [ ] 46.7 Permissions
- [ ] 46.8 Sync errors
- [ ] 46.9 Early Google OAuth verification
- [ ] 46.10 Read-only vs two-way decision

## 47. Academic Integrations

- [ ] 47.1 Canvas feasibility
- [ ] 47.2 Supported import/sync
- [ ] 47.3 Secure tokens
- [ ] 47.4 Assignment/course import
- [ ] 47.5 Conflict handling
- [ ] 47.6 Limitations
- [ ] 47.7 Feasibility gate

## 48. Notifications

- [ ] 48.1 Notification types
- [ ] 48.2 Data model
- [ ] 48.3 Real notification centre
- [ ] 48.4 Deadline notifications
- [ ] 48.5 Workload alerts
- [ ] 48.6 Processing-complete notifications
- [ ] 48.7 AI/action confirmations
- [ ] 48.8 Preferences
- [ ] 48.9 Frequency caps / digesting

---

# 49. BILLING

- [ ] 49.1 Entitlement matrix
- [ ] 49.2 Provider
- [ ] 49.3 Checkout
- [ ] 49.4 Subscription records
- [ ] 49.5 Upgrade
- [ ] 49.6 Downgrade/data retention
- [ ] 49.7 Cancellation
- [ ] 49.8 Payment failure
- [ ] 49.9 Server-side limits
- [ ] 49.10 Billing page
- [ ] 49.11 Edge cases
- [ ] 49.12 Secure webhooks
- [ ] 49.13 Webhook status sync
- [ ] 49.14 Tax/VAT/refunds
- [ ] 49.15 Team seats / roles — implement properly or defer Team plan

---

# 50. SECURITY

- [ ] 50.1–50.14 Existing security requirements
- [ ] 50.15 Signed URL expiry
- [ ] 50.16 Dependency/secret scanning
- [ ] 50.17 Incident/breach response note

---

# 51. ACCESSIBILITY

Accessibility begins during implementation.

- [ ] 51.1 Keyboard navigation
- [ ] 51.2 Focus states
- [ ] 51.3 Semantic HTML
- [ ] 51.4 Form labels
- [ ] 51.5 Dialogs
- [ ] 51.6 Accordions
- [ ] 51.7 Icon labels
- [ ] 51.8 Reduced motion
- [ ] 51.9 Contrast
- [ ] 51.10 Touch targets
- [ ] 51.11 Keyboard drag alternatives
- [ ] 51.12 Full-flow screen-reader pass

---

# 52. PERFORMANCE

- [ ] 52.1–52.10 Existing performance requirements
- [ ] 52.11 Measure Assistant time-to-first-token
- [ ] 52.12 Measure document processing latency
- [ ] 52.13 Define performance budgets

---

# 53. ERROR / EMPTY STATES

- [ ] 53.1 Error boundary
- [ ] 53.2 404
- [ ] 53.3 Unauthorized
- [ ] 53.4 Generic empty states
- [ ] 53.5 Tasks empty
- [ ] 53.6 Documents empty
- [ ] 53.7 Calendar empty
- [ ] 53.8 Assistant empty
- [ ] 53.9 Offline/network failure
- [ ] 53.10 Skeleton system
- [ ] 53.11 Retry interactions

---

# PART XIII — LAUNCH QA

# 54. Marketing QA

- [ ] 54.1 Home
- [ ] 54.2 Features
- [ ] 54.3 How it works
- [ ] 54.4 Pricing
- [ ] 54.5 Benchmarks
- [ ] 54.6 FAQ
- [ ] 54.7 Dev's note

For each:
- typography
- spacing
- glass
- dotted background
- borders
- cards
- CTA behavior
- responsive
- no overflow
- advertised feature accuracy
- Motion behavior

---

# 55. APPLICATION QA

- [ ] 55.1 Dashboard
- [ ] 55.2 Tasks
- [ ] 55.3 Calendar
- [ ] 55.4 Documents
- [ ] 55.5 Assistant
- [ ] 55.6 Login
- [ ] 55.7 Signup
- [ ] 55.8 Onboarding
- [ ] 55.9 Account / billing
- [ ] 55.10 Mobile navigation

This is the PRIMARY full application QA pass.

---

# 56. AUTOMATED TESTS

Tests are written alongside feature work where appropriate.

- [ ] 56.1 Utilities
- [ ] 56.2 Critical components
- [ ] 56.3 Task CRUD
- [ ] 56.4 Calendar CRUD
- [ ] 56.5 Upload
- [ ] 56.6 Search/retrieval
- [ ] 56.7 AI actions
- [ ] 56.8 Authentication
- [ ] 56.9 Authorization/RLS
- [ ] 56.10 Entitlements

Do not over-test simple presentational UI early.

Prioritize:
- business logic
- auth
- persistence
- security
- critical flows

---

# 57. END-TO-END TESTS

- [ ] 57.1 Signup → onboarding → dashboard
- [ ] 57.2 Task lifecycle
- [ ] 57.3 Create event
- [ ] 57.4 Upload → process → indexed
- [ ] 57.5 Search
- [ ] 57.6 Ask AI about document
- [ ] 57.7 Confirmed AI action
- [ ] 57.8 Calendar integration
- [ ] 57.9 Subscription
- [ ] 57.10 Session persistence

---

# 58. SEO

- [ ] 58.1 Titles
- [ ] 58.2 Descriptions
- [ ] 58.3 Open Graph
- [ ] 58.4 Social metadata
- [ ] 58.5 Sitemap
- [ ] 58.6 Robots
- [ ] 58.7 Canonicals
- [ ] 58.8 Structured data
- [ ] 58.9 Icons
- [ ] 58.10 Link check

---

# 59. LEGAL / TRUST

- [ ] 59.1 Privacy Policy
- [ ] 59.2 Terms
- [ ] 59.3 Cookie/consent
- [ ] 59.4 Data deletion
- [ ] 59.5 Support/contact
- [ ] 59.6 Marketing accuracy
- [ ] 59.7 Benchmark claims
- [ ] 59.8 Security claims
- [ ] 59.9 Subprocessors/data retention
- [ ] 59.10 Uploaded-content rights/takedown process

---

# 60. DEPLOYMENT

- [ ] 60.1–60.17 Environment/deployment requirements
- [ ] 60.18–60.19 CI
- [ ] 60.20 Restore-from-backup drill
- [ ] 60.21 Rollback procedure

---

# 61. FINAL LAUNCH CHECKLIST

- [ ] 61.1 Build
- [ ] 61.2 Typecheck
- [ ] 61.3 Lint
- [ ] 61.4 Automated tests
- [ ] 61.5 E2E
- [ ] 61.6 Auth verified
- [ ] 61.7 Database security
- [ ] 61.8 Storage security
- [ ] 61.9 AI retrieval
- [ ] 61.10 Action confirmations
- [ ] 61.11 Payments
- [ ] 61.12 Mobile QA
- [ ] 61.13 Desktop QA
- [ ] 61.14 SEO
- [ ] 61.15 Legal
- [ ] 61.16 Monitoring
- [ ] 61.17 Backups
- [ ] 61.18 Performance
- [ ] 61.19 Visual comparison
- [ ] 61.20 Smoke test
- [ ] 61.21 Launch ready
- [ ] 61.22 Claims audit
- [ ] 61.23 Cost model at 100 / 1k / 10k users

---

# 62. ADMIN

- [ ] 62.1 Admin route
- [ ] 62.2 User management
- [ ] 62.3 System health / AI usage
- [ ] 62.4 Support view without exposing document contents

---

# 63. ACCEPTABLE USE / ACADEMIC INTEGRITY

- [ ] 63.1 Study-assist positioning
- [ ] 63.2 Exam misuse policy
- [ ] 63.3 Generated-output framing review

Particularly review:
- quizzes
- flashcards
- presentations
- handwritten notes
- AI-assisted academic content

---

# RISKS

## R1 — Fabricated marketing claims

Mitigation:
- no fake benchmarks
- no fake usage
- no fake integration claims
- 9.7 + 61.22

## R2 — Scope explosion

Mitigation:
- Tool tiers
- launch only Tier 1
- Tier 3 requires feasibility

## R3 — Mock-state rewrites

Mitigation:
- backend foundation before real application data
- clean data boundaries
- no fake persistence

## R4 — Cross-user data leakage

Mitigation:
- RLS
- two-user tests
- Assistant isolation
- automated security tests

## R5 — AI/OCR cost explosion

Mitigation:
- quotas
- page limits
- spend caps
- rate limits
- cost dashboard

## R6 — Long-running document jobs

Mitigation:
- background workers
- retries
- dead-letter states
- visible failure states

## R7 — Calendar OAuth delays

Mitigation:
- early provider verification
- no premature marketing claims

## R8 — Canvas availability

Mitigation:
- feasibility gate
- remove claim if unavailable

## R9 — Planned tools mistaken for live tools

Mitigation:
- registry states
- explicit Planned labels
- no fake affordances

## R10 — Email deliverability

Mitigation:
- domain authentication
- external inbox verification
- fallback UX

## R11 — Prompt injection

Mitigation:
- uploaded text treated as untrusted
- explicit confirmation before persistence

## R12 — Accessibility deferred too long

Mitigation:
- QA alongside implementation
- Phase 51 final pass

## R13 — Malicious/copyrighted uploads

Mitigation:
- file validation
- abuse policy
- scanning decision
- takedown policy

## R14 — Academic integrity backlash

Mitigation:
- acceptable-use policy
- careful product positioning
- review generated academic outputs

## R15 — Timezone/DST bugs

Mitigation:
- one UTC/profile-timezone strategy
- shared date formatting utility

## R16 — Design drift

Mitigation:
- shared components
- registry-driven tools
- global Motion system

## R17 — Schema drift

Mitigation:
- migration-only schema
- typed DB types
- CI checks

## R18 — Team plan complexity

Mitigation:
- build seats/invites/roles properly
- otherwise defer Team plan

## R19 — Supabase limits

Mitigation:
- validate limits before production scale

## R20 — Single-maintainer scope

Mitigation:
- Tier 1 launch scope
- defer Tier 2/3

## R21 — AI provider lock-in

Mitigation:
- provider abstraction
- no provider-specific types in UI

---

# EXECUTION ORDER

## CURRENT STATE

Reconciliation (2026-09-12, stabilisation): the guest-browsing change and the
`/tools` + `/integrations` work are landed as one coherent tree; the
cross-session interference is resolved by the one-writer rule plus the suite
owning its dev server (`QA_SESSION.md §One writer at a time`,
`frontend/scripts/qa-single-writer.ps1`), and the full suite is green —
**`npm run test` 101/101** on a single dev server
(`frontend/.playwright/recon-green-2026-09-12.log`), typecheck/lint/build
passing on the same tree. 22.7 (recurrence) and 17.14 (UI half of the
timezone/DST rendering) remainders are unchanged and recorded in place; 17.x
was blocked on this baseline and may now start.

Completed and verified:

```text
13.1–13.9 ✅
14.1–14.9 ✅
15.1–15.8 ✅
Motion.dev global system ✅
Guest Dashboard ✅
Quick Actions placement ✅
A.1 Benchmark integrity audit ✅ — /benchmarks compliant as-is; homepage
highlights' captions reframed to carry their own "Illustrative:" label.
No other marketing surface states an unqualified benchmark or performance
claim; metadata/OG carry no figures and no JSON-LD exists. Real measurements
have not been run (9.7 stays partially verified).
A.2 Auth provider verification — 12.2 ✅; 12.3 [~].
Email/password lifecycle verified end-to-end against the local stack + Mailpit
(signup → mail → confirm → session → dashboard; sign-in; reload/navigation
persistence; sign-out; re-gating; wrong password; unconfirmed user; duplicate
signup; malformed email; `?next=` propagation and sanitization; recovery mail
request, whose link still ends at 404 on the unbuilt `/reset-password`).
Google OAuth is verified as far as the environment allows (authorize URL,
scopes, redirect, error branches); the consent roundtrip stays blocked on a
sanctioned Google identity and a provider-enabled project.
Two minimal fixes landed: `ConfirmEmail` handles PKCE `?code=` confirmations
by forwarding to `/auth/callback`, and the AssistantLauncher stage is
pointer-transparent so it no longer blocks bottom-anchored controls.
A.4 Authenticated Motion verification — ✅ (3.10 marked [x]).
Full authenticated Motion pass on the QA fixture across /dashboard, /tasks,
/calendar, /documents, /assistant + shell chrome: RouteTransition settle,
four MotionPopover surfaces (direction/origin, open/close timing, unmount,
Escape/focus, outside press, exclusivity), drawer drop + ~40ms stagger,
rail/calendar/task shared-layout indicators travelling on softSpring, reveals
settling at opacity 1, reduced-motion instant legs, transform/opacity-only
animation and clean console/Motion warnings. Data-driven MotionListItem cases
not exercised (QA identity has no application data; no authenticated surface
uses the primitive) — recorded, not simulated.
Fixes in the pass: mobile-bar 320px overflow (compact padding/gaps below `sm`),
stale AssistantLauncher selector in fonts.spec, and structure.spec's overflow
guard tightened to `clientWidth`. 49/49 QA specs pass.
A.3 Email provider verification — [!] blocked: no verified sending domain and no
provider account (backend/EMAIL.md §Blocking prerequisites); production delivery cannot
be tested until a domain is owned and verified.
Stage 1 item 5 — Formalize 30.1 tool registry ✅ (30.1 [x]).
`frontend/components/tools/toolCatalog.ts` is now the frozen, invariant-checked,
documented single source (0.11 field mapping, live/planned/disabled state model
with processing/failed excluded, tier rules, canonical `toolRegistry` API).
Genuine duplications fixed: two /features section eyebrows, Quick Actions chip
labels, per-tool status words, aggregate availability notes, assistant starter
destinations. Guard: committed `frontend/tests/qa/tool-registry.spec.ts` (Playwright);
deliberate tier-3 break proved the module-load invariant fails the spec, then
reverted. Recorded gap: `pdf-editor` has no distinct /features card (its
capabilities live in the converter section's utility groups). 30.2 (families)
and 30.3 (state model) remain open; 52/52 QA specs, typecheck/lint/build pass.
Stage 1 items 6/7 — Ratify 5.7 + 6.9 against the registry ✅.
Homepage: marquee now reads `OFFERABLE_TOOLS`, so the Tier-3 `disabled`
entries are excluded (previously carded as "Research", contradicting 5.7/6.9
and Part X); per-tool status words come from `toolStatusLabel`, aggregate
badges/notes gate on `HAS_LIVE_TOOL`; the Tasks card's stale
`/features#dashboard` action corrected to `/features#tasks`; no hardcoded
"Planned" literals remain in the ecosystem surfaces. Features: every registry
href, homepage action and jump-nav pill resolves to a rendered anchor
(#create/#edit/#study parts, #document-tools converters, #workspace detail +
#dashboard alias); no Tier-3 cards. Guard extended in
frontend/tests/qa/tool-registry.spec.ts (marquee = offered set, tier-3 absent, registry
destinations resolve, jump pills target real sections, homepage links
resolve). 54/54 QA specs, typecheck/lint/build pass.
Stage 2 item 8 — 20.6 Schema ✅.
One versioned migration (`backend/supabase/migrations/20260911011824_init_schema.sql`,
renamed to its true UTC stamp by 20.7 pre-hosted) defines 12 tables with
ownership, deny-by-default RLS (40 owner-only policies, child tables via EXISTS
on parent), state-vocabulary CHECK constraints and 29 indexes. Applied cleanly
twice on `supabase db reset`; QA identity re-seeded afterward → 1 auth user, 1
trigger-provisioned empty profile, every application table empty; RLS smoke
(anon denied, foreign sub 0 rows, owner 1 row); no hosted contact (not linked,
no `--linked`). Decisions ratified in TASK.md 20.6 and **backend/DATABASE.md**
(first/last names, nullable completion timestamp, smallint year/semester,
text+CHECK vocabulary policy, embeddings deferred to 25.x, auth.users
provisioning trigger).
Stage 2 item 10 — 20.8 Typed DB types ✅.
`frontend/lib/supabase/database.types.ts` generated from the LOCAL schema and committed;
`Database` wired into server/client/proxy clients; `schema-contract.ts` fails
`tsc` if a ratified table/column disappears (proved by renaming `timezone`,
then reverted). `backend/supabase/ops/generate-types.sh` (regenerate) and
`check-types.sh` (drift diff) documented in `backend/supabase/MIGRATIONS.md` and
wrapped by `npm run db:types` / `db:check-types` (via WSL). Stable output (no diff on
re-run), typecheck/lint/build pass, 55/55 QA specs.
Stage 2 item 11 — 20.9 Automated two-user RLS isolation test ✅.
Second identity `qa2.unipilot@unipilot.test` (+ `UNIPILOT_QA2_PASSWORD`) seeded
idempotently by the same local-guarded script; `frontend/tests/qa/rls-isolation.spec.ts`
proves the backend/DATABASE.md matrix with two real sessions plus anon (own-row reads,
cross-user empty reads and zero-row cross writes, child isolation via parent,
denied server-only and anon writes), tears down every seeded row, and leaves
only the two trigger-provisioned profiles. Proven able to fail by relaxing
`tasks_select_own` to `using (true)` (failed with `QA1 must not read QA2's
tasks`), then restored. Migration `20260911032752` makes the usage ledger
server-write-only. Full suite 55/55.
Stage 2 item 9 — 20.7 Migration workflow [~] (workflow formalized; hosted
rollout pending founder approval).
`backend/supabase/MIGRATIONS.md` documents naming/versioning, never-edit-applied,
one-logical-change, forward-only rollback notes, the local command set
(`db reset`, `migration up`, `migration list --local`, `db lint`,
`db diff -f`) and the review checklist; `backend/DATABASE.md` carries the hosted
runbook. Init migration renamed to its true UTC stamp pre-hosted
(`...064824` → `...011824`); `...020548` adds `profiles.timezone` (R15, IANA);
`...020549` is the guarded legacy backfill (no-op locally). Local evidence:
reset applies all three, `migration list --local` shows them, `db lint` clean.
Hosted reconciliation validated in a disposable scratch DB against the legacy
shape + 3 synthetic rows — every mapping asserted, legacy dropped, RLS on —
then the scratch DB was dropped. The hosted project was never contacted; no
`--linked` command ran and no `db push` will happen without explicit founder
approval; the RLS proof (20.9) is green.
Stage 2 item 12 — 13.10 Onboarding persistence ✅.
`frontend/lib/data/onboarding.ts` is the server-only data layer (typed against the
generated `Database`): it reads profile+subjects and writes through the new
security-invoker `complete_onboarding` function; `frontend/lib/data/onboardingValues.ts`
is the single source for the UI-string ↔ schema-code maps, shared by the steps
and the data layer. `20260911034901_complete_onboarding.sql` makes the profile
upsert + subject replacement + completion stamp one transaction, with the stamp
`coalesce`d (repeats never move it) and EXECUTE granted to `authenticated` only
(RLS owner policies enforce the rows). `completeOnboardingAction` runs
requireUser → server-side parse/validate/remap → the atomic write, returning
only the shared sanitized copy on failure; `OnboardingFlow.finish` calls it,
keeps the client double-submit guard and renders the failure with retry. Skip
writes nothing, so completion stays NULL. `frontend/lib/onboarding/gate.ts` gates
/tasks, /calendar, /documents and /assistant on completion and sends completed
students from /onboarding to /dashboard; /dashboard stays public and builds the
full `DashboardStudent` from the persisted profile+subjects (the greeting
renders name, programme/institution, year/semester and subjects; guests keep
the guest state; nothing fabricated). QA: `frontend/tests/qa/onboarding.spec.ts` (5
tests — real completion, skip + redirect without a loop, forced failure +
sanitized error + retry, duplicate writes, two-user isolation), and
`rls-isolation.spec.ts` now tears down by its own ids and asserts QA2 cannot
read QA1's persisted onboarding subjects (plus anon cannot execute the
function). Evidence: 5 migrations apply from scratch on `supabase db reset`,
`supabase db lint` clean, types regenerated from local, typecheck/lint/build
pass, full `npx playwright test` 60/60. No client storage; no hosted contact.
Stage 2 item 13 — 14.10 Persistent "Finish setup" affordance ✅.
The completion marker now has one visibility condition and two persistent
readers. `sessionNeedsSetup()` (`frontend/lib/onboarding/gate.ts`) is the condition:
signed in and incomplete; guests and unreadable state answer false without
throwing. `WorkspaceSetupLink` became a completion-aware async server
component and renders only for an unfinished student, in both the rail and the
mobile drawer (the drawer receives the server node; `Suspense fallback={null}`
at every call site). New `frontend/components/app/FinishSetupAffordance.tsx` renders the
/dashboard banner in `GuestCallout`'s slot, linking to /onboarding; completed
students and guests see neither surface, and finishing onboarding removes the
offer with no reload or client bookkeeping. `sessionUser`
(`frontend/lib/auth/session.ts`) is the request-scoped memoized session read
`sessionViewer` composes over, and `getOnboardingState` is memoized per
request, so the banner shares the dashboard's own read and no boundary shifts
layout. QA: `frontend/tests/qa/finish-setup.spec.ts` (4 tests — QA2 incomplete offer +
persistence + rail/drawer, QA1 complete absent, guest `GuestCallout` only,
reduced motion), server-rendered first-response assertions and a main-content
layout-shift check, clean console; typecheck/lint/build pass, full
`npx playwright test` 64/64. No client storage; no hosted contact.
Stage 2 item 14 — 14.11 Server-side auth guard audit ✅.
Every page, Route Handler and `"use server"` module was inventoried and probed
(AUTH_ARCHITECTURE.md §Server-side guard matrix): gated pages run
`requireOnboardedUser`/`requireUnfinishedOnboarding`, `/dashboard` reads
`sessionUser` behind RLS while staying public (0.17), the auth flows validate
and sanitize, and `completeOnboardingAction` keeps `requireUser` before its
try block. The proxy matcher was confirmed a superset of `PROTECTED_PREFIXES`
and is now guarded at module load
(`assertMatcherCoversProtectedRoutes()`), with a deliberate-break assertion in
the spec. Host-header/open-redirect finding: the callback's
`new URL(request.url).origin` and the actions' `Origin`/`Host` trust were
replaced — same-origin relative callback redirects (`sameOriginRedirect`,
cookies still merged) and `getTrustedSiteOrigin()`
(`NEXT_PUBLIC_SITE_URL`, loopback-only fallback); forged `Host` /
`X-Forwarded-Host` probes now return relative `/login?error=oauth`, and the
variable is documented in both env templates. QA: `frontend/tests/qa/auth-guards.spec.ts`
(6 tests: matcher guard incl. break, protected-route 307s with sanitized
same-origin `?next=`, public guest dashboard, onboarding bounce, authenticated
control, callback notices with no provider-text/forged-host leak); manual curl
probes recorded in AUTH_ARCHITECTURE.md; typecheck/lint/build pass, full
`npx playwright test` 70/70. No hosted contact.
Stage 3 item 15 — 21.x Tasks data service ✅ (21.9 [~], UI remainder).
`frontend/lib/data/tasks.ts` is the server-only service: typed against the
generated `Database`, request-scoped cookie client (never the service role),
`user_id` scoping as belt-and-braces with owner-only RLS authoritative.
`listTasks` (deterministic due_date asc nulls last → created_at → id) and
`getTask` map rows to the 16.5 `TaskItem` contract — hyphenated `in-progress`,
display-ready "Wed, Sep 2" due dates and "High" priority words. Mutations
(create/update/delete/status/priority) return the settled row or null/false
for a zero-row write, which is 21.9's server half; the optimistic UI + rollback
itself is UI-owned and lands with 16.x. `frontend/lib/data/taskValues.ts` owns
the vocabulary/validation/mapping (title trim + 80-char cap, real-calendar
date-only parsing, optional description/effort bounds, status vocabulary,
priority `none` → NULL); `frontend/lib/data/taskDates.ts` owns the R15
timezone maths (date-only ↔ the zone's start-of-day instant; en-US
"Weekday, Mon D"). `frontend/lib/data/taskActions.ts` follows the onboarding
pattern — `requireOnboardedUser("/tasks")` before the try, server-side parse of
untrusted payloads, service call, `revalidatePath("/tasks")` after a write —
and `lib/data/taskErrors.ts` is the sanitized copy; no DB message surfaces.
21.7's migration `20260911151733_add_task_priority.sql` adds nullable
`tasks.priority` (`low`/`medium`/`high`, named CHECK, NULL = unset — no `none`
sentinel), applied via `npm run db:reset` (6 migrations, `db lint` clean) with
types regenerated (`db:check-types` matches); DATABASE.md and
`backend/supabase/MIGRATIONS.md` updated. QA:
`frontend/tests/qa/tasks-data.spec.ts` (pure validation/date tests + QA1/QA2
RLS isolation of every operation, CHECK rejections, id-scoped residue-free
teardown) runs as its own Playwright project dependency so transient task rows
cannot race `rls-isolation.spec.ts`; full `npm run test` 72/72,
typecheck/lint/build pass. Real-Chromium no-regression with the QA session:
/tasks (200, honest no-tasks board) and /dashboard (200) render with empty
error consoles — end-to-end data visibility lands with 16.x. No hosted
contact.
Stage 3 item 16 — 16.x Tasks UI bound to real data ✅.
`tasks/page.tsx` keeps `requireOnboardedUser` + `listTasks(user.id)` and hands
the mapped list to `TasksWorkspace`, the client boundary that owns the live
list and every optimistic mutation (21.9's UI half). One `TaskItem` contract
now lives in `frontend/lib/data/taskValues.ts` and the board imports it (the
duplicate is gone). 16.2/16.6's create form writes through
`createTaskAction` with pending/`aria-busy`/double-submit guarding and an
optimistic insert reconciled with the settled row; the "saved nowhere" copy is
deleted. 16.7's edit dialog is the same `TaskFormModal` (pre-populated from
`dueDateValue`/`priorityValue`) and `parseTaskPatch` gained `priority`, so the
field persists; filter preserved. 16.8's delete is a SkipOnboarding-pattern
confirm with one destructive button, optimistic removal and old-position
rollback. 16.9 is pointer DnD + an ArrowLeft/ArrowRight keyboard path over the
same `setTaskStatusAction`, animated with `MotionListItem` `layout`/`layoutId`,
focus-follows-move and a polite live region; a card moved outside the active
filter leaves the visible set. 16.10 is a URL-driven detail modal
(`?task=<id>`) resolved by `getTaskAction`, with "Task not found" for foreign,
fabricated or altered ids. 16.12's rollback audit is now real: a forced action
failure rolls the optimistic change back with the sanitized copy. 16.13's
authenticated responsive pass ran at 375/1280 in light and dark (MCP
Chromium): zero horizontal overflow, clean consoles, screenshots recorded.
QA: `frontend/tests/qa/tasks-ui.spec.ts` (8 flows: create + persistence +
375 overflow, edit + filter, delete cancel/confirm, pointer drag, keyboard
drag + focus + filter, detail + foreign/altered id, forced-failure rollback,
reduced-motion dialog) runs as its own project dependency (`qa-tasks-ui`,
after `qa-tasks-data`) so task rows never race the isolation counts; full
`npm run test` 80/80, typecheck/lint/build pass. No hosted contact.
Stage 3 item 17 — 22.x Calendar/events data service ✅ (22.7 [~] deferred).
One reviewed migration pair extends `events` with 22.6's type vocabulary
(nullable `type`: class | exam | deadline; NULL = a plain event, no `other`
sentinel) and 17.5's optional course (`subject_id` → `subjects`, ON DELETE
SET NULL, guarded by the `ensure_event_subject_owner` trigger so a subject
belonging to another user is rejected — a plain FK would accept it while RLS
guards only the event's owner). `npm run db:reset` applies eight migrations,
`db:lint` clean, types regenerated (`db:check-types` matches); DATABASE.md and
`backend/supabase/MIGRATIONS.md` updated. `frontend/lib/data/events.ts` is the
server-only service (request-scoped cookie client, `user_id`-scoped, RLS
authoritative): `listEvents(userId, {start,end})` returns the half-open
window's overlapping rows soonest-first (point events included by their
start), `getEvent` resolves one owned row by id, and create/update/delete
return the settled calendar row or null/false. `eventValues.ts` owns the
vocabulary/validation/mapping (title cap, type/course clearing, required
start, end ≥ start, all-day whole-day spans, location/description bounds,
local wall-clock shapes); `taskDates.ts` gained the DST-safe wall-clock ↔
instant maths rather than a second date system (gap times resolve forward —
02:30 spring-forward → 03:30 — ambiguous times take the first occurrence,
ordinary times round-trip). `eventActions.ts` mirrors taskActions:
`requireOnboardedUser("/calendar")` before the try, server-side parse,
sanitized `{ error, event }`, `revalidatePath("/calendar")`. 22.7 recurring
events is deliberately deferred [~]: occurrence identity and series
edit/delete semantics are 17.10's UI decision, and storage before that would
force a follow-up migration — recorded, not faked. QA:
`frontend/tests/qa/events-data.spec.ts` (pure validation/DST/mapping +
QA1/QA2 RLS isolation of list/get/create/update/delete, range window, CHECK
and same-user-subject rejections, id-scoped residue-free teardown) runs as
its own project dependency (`qa-events-data`) and is 3/3 green;
typecheck/lint/build pass. Reconciliation (2026-09-12): the concurrent-session
caveat below was resolved — the suite now owns its server and that server is a
production build (`playwright.config.ts` `webServer` = `npm run build &&
npm run start`, `reuseExistingServer: false`, local `NEXT_PUBLIC_*` passed
explicitly so the build cannot pick up `.env.local`'s hosted project), the
stateful projects are ordered (`qa-tasks-data`/`qa-events-data` depend on
`qa-onboarding`, so the QA subjects reset can never race them), one session at
a time is the documented rule (`QA_SESSION.md §One writer at a time`,
`frontend/scripts/qa-single-writer.ps1` for enforcement), and the full suite
finished **101/101 three consecutive times**, each run from a fresh `db:reset` +
`seed:qa` and the suite's own freshly built server
(`frontend/.playwright/stabilization-green-2026-09-12-run{1,2,3}.log`; the
single-run reconciliation log is `recon-green-2026-09-12.log`). No hosted
contact.
Stage 3 item 18 — 17.x Calendar UI bound to the real events service ✅
(17.5–17.11; 17.12 [~], 17.13/17.14 UI halves now delivered).
`calendar/page.tsx` keeps `getWorkspaceAccess` and loads one range server-side:
the month grid's first–last date (a superset of the anchor's week, so one read
serves both views) through the new `listEventsForDates(userId, {firstDate,
lastDate})`, which resolves the boundary dates to instants in the profile's
zone inside the data layer (R15) — no page or block does timezone maths. The
new `lib/data/subjects.ts` read supplies the form's real course options;
`CalendarWorkspace` is the client provider owning the live list, the URL-driven
detail (`?event=<id>` via `getEventAction`; foreign/altered/fabricated ids
answer "Event not found"), the one create/edit form and the delete confirm —
all shared `Modal` surfaces with pending/`aria-busy` and sanitized inline
errors. Optimistic create/edit/delete reuse `eventItemFromLocal` (the pure
twin of `eventRowToItem`, built on the same `resolveEventDraft` +
`eventRowToItem` path) so a pending block carries exactly the values the
settled row will, and roll back to the prior state on a forced failure.
`CalendarGrid` renders real month chips (type icon + title, `+N more` when a
day exceeds three); `WeekGrid` renders `ClassEventBlock`/`ExamEventBlock`/
`DeadlineEventBlock`/plain blocks inside their start hour cell, absolutely
positioned by `top`/`height` percentages from the profile-zone `HH:mm` values
— minute precision, multi-hour spill — with all-day events in the day header's
chip band and the 17.8 legend naming the vocabulary with the same icons (type
is never colour-only; overlap is the documented single-column fallback until a
design defines otherwise; multi-day timed events anchor to their start day).
The old "Event creation coming soon" badge and "calendar fills in…" copy are
gone; the header carries the real `AddEventButton` and the empty state is
honest. QA: `frontend/tests/qa/calendar-ui.spec.ts` (9 tests: pure placement
maths/span/form bridge, create→month+week+persistence, typed blocks + legend,
all-day span, detail edit + confirmed delete + persistence, foreign id,
forced-failure rollback, guest render + prompt, reduced motion) runs as
`qa-events-ui` after `qa-events-data`, and `events-data.spec.ts` now pins the
two contract additions (`endDateValue`, `durationMinutes`); full
`npm run test` **110/110** (`frontend/.playwright/calendar-ui-green-3.log`),
typecheck/lint/build pass. MCP Chromium pass (QA1 via the session cookie, no
credential typed into any tool call): created class + all-day deadline through
the real form, verified block-in-hour-cell geometry (`top: 0%`,
`height: 150%`) and the all-day band, month/week, light + dark, 1280/375 with
zero horizontal overflow, zero console errors, reduced motion, then deleted
both rows through the UI and restored the empty state (QA identities own no
events at rest). 17.12 external integrations stays [~]: Google Calendar/Canvas
have no provider work in this tree and nothing is faked; 22.7 recurrence
remains [~] as recorded.
Stage 3 item 19 — 23.x Document storage bound ✅ (23.1–23.11, 23.13;
23.12 [~] plan-driven enforcement).
Local Storage was enabled first (git-ignored `config.toml`, `[storage] enabled
= true`, stack restarted → healthy `supabase_storage_unipilot`; hosted never
touched). `20260912053249_documents_storage_bucket.sql` creates the private
`documents` bucket (`public = false`, 26214400-byte cap, PDF/DOCX/PNG/JPEG
allowlist) and the four owner-folder policies on `storage.objects`
(`(storage.foldername(name))[1] = auth.uid()::text`, `to authenticated`;
`anon` has no policy), with the path convention
`{user_id}/{document_id}/{sanitized-name}`. `frontend/lib/data/` gained the
21.x/22.x-shaped layer: `documentValues.ts` (allowlist, 25 MiB cap, name
parsing/sanitizing, path builder, magic-byte sniffing, size formatting, row →
display mapping, quota constants), `documents.ts` (request-scoped RLS client:
list/get/reserve/finalize/rename/delete/usage), `documentActions.ts`
(`requireOnboardedUser("/documents")` first, sanitized results, revalidate on
settle) and `documentErrors.ts`. Upload ordering is reserve → direct
browser→Storage XHR with real progress (session access token per request,
never logged) → finalize; finalize verifies the object in the caller's folder,
re-reads its real size and leading bytes, and discards both halves on any
rejection, and the client's abort path cleans a failed upload. The bucket
constraint, the reserve parse and the finalize sniff are three layers; a
renamed non-PDF is rejected and removed. `/documents` keeps the page's
server-owned list (newest row handed to the provider) and now renders the one
pipeline's surface — drop target + progress + the settled row's inline rename
and confirmed delete — while the full 18.x hub (cards, filters, parsing states)
stays the next step. 23.12 ships the documented default free guard (50
documents or 250 MiB total) with plan entitlements [~] for billing 49.x;
23.13's posture is recorded (closed allowlist at three layers, private bucket,
no execution/render, scanning + takedown deferred per R13 — no scanner faked).
QA: `frontend/tests/qa/documents-data.spec.ts` (pure validation + QA1/QA2
Storage-API isolation incl. cross-user and anon denials, bucket MIME/size
rejections with no residue, row-delete chunk cascade) and
`frontend/tests/qa/documents-ui.spec.ts` (real upload with progress → verified
record + object, fake-PDF rejection with cleanup, rename path-stability +
delete object/row/chunks, guest prompt, 375 overflow) run as `qa-documents-data`
and `qa-documents-ui` after the existing data projects and their UI consumers;
full `npm run test` **118/118** (`frontend/.playwright/docs-green-3.log`),
typecheck/lint/build pass, `db:reset` applies all nine migrations cleanly and
`db:check-types` matches. MCP Chromium pass (QA1 via the session cookie):
uploaded real 2 MB and 12 MB PDFs through the picker (progress bar sampled with
real `aria-valuenow` values 0→100, no interpolation), verified row + object in
the local DB, renamed with the storage path unchanged, confirmed delete leaving
0 rows and 0 objects, reload showed the remaining record, light/dark at
1280/375 with zero horizontal overflow and a clean product network log; guest
click opens the shared prompt. Stabilisation in the same pass: the
`guest-browsing.spec.ts` copy assertions now target the visible streamed copy
(`filter({ visible: true })`, the tasks-ui hidden-projection rule) after a
transient Next shell duplicate failed two full runs, and `calendar-ui.spec.ts`
now waits for the `?event=` URL before driving the detail dialog; the
documents projects were re-ordered after the existing data projects per 23.11,
which removed the contention those two flakes traced to.
Stage 3 item 20 — 29.1 Background job runner ✅.
`20260912065021_jobs_runner.sql` adds the durable `public.jobs` store
(nullable owner for system jobs, closed status vocabulary, attempts/
max_attempts, `run_after`, worker lease, `last_error`, timestamps), the two
partial indexes that match the worker's predicates exactly, owner-only SELECT
RLS, and the two security-definer protocol functions: `claim_jobs` (atomic
`FOR UPDATE SKIP LOCKED` claim with `attempts+1` and a stale-lock reclaim for
running jobs whose 5-minute lease expired) and `finish_job` (succeeded;
non-retryable → failed; attempts exhausted → dead_letter; otherwise queued
with `least(2^(attempts-1)·30s, 1h)` backoff, and only the lease-holding
worker may settle). Two privilege findings were fixed while proving it: the
Supabase bootstrap grants EXECUTE on new functions and ALL on new tables
directly to `anon`/`authenticated`, so the migration now revokes both
explicitly (definer functions end up reachable by `service_role` only, the
table only SELECT for authenticated) — a PUBLIC revoke alone would have left
`claim_jobs` callable by any guest. The runner is a plain Node ESM entry at
`backend/worker/` (packaged via the backend npm package: `npm run worker:once
-w backend`, root alias `npm run worker:once`), polling in bounded batches
with idle backoff and a SIGINT/SIGTERM graceful stop, dispatching by `kind`
through the handler registry (`noop.test` now; 24.2 registers the real
document handler) and logging job id/kind/attempt/status only — never the
service key or payload secrets. `frontend/lib/data/jobs.ts` is the
server-only enqueue helper (service-role write by decision: clients cannot
insert), with `frontend/lib/supabase/service.ts` as the one service client.
QA: `frontend/tests/qa/jobs-runner.spec.ts` runs as `qa-jobs-runner` at the
tail of the mutating projects and drives the real worker — enqueue →
`--once` → succeeded; retryable failure → queued with the 30s backoff →
dead-letter; non-retryable → failed; stale lock reclaimed / fresh lock
untouched; system job invisible to users; RLS isolation plus denied client
writes and denied `claim_jobs`/`finish_job` RPCs; residue-free (`afterAll`
asserts zero rows). Full `npm run test` **124/124**
(`frontend/.playwright/jobs-green.log`), typecheck/lint/build pass, `db:reset`
applies all ten migrations cleanly and `db:check-types` matches (types
regenerated for `jobs`). MCP Chromium: with a succeeded and a failed job in
the store, `/dashboard` rendered authenticated + guest at 1280/375, zero
console errors, no overflow, clean product network — infra-only, no UI
change. 24.2 is unblocked (handler registration + enqueue from the document
finalize action).
Stage 3 item 21 — 24.x Document processing/OCR ✅ (text pipeline; 24.5/24.6
[!] blocked on an OCR provider, 24.14 [~] until a real benchmark set).
Step 0 first: a full ACL audit against the DATABASE.md matrix found the
Supabase bootstrap had granted `MAINTAIN`/`REFERENCES`/`TRIGGER`/`TRUNCATE` to
`authenticated` on every public table (`TRUNCATE` bypasses RLS — the critical
find), write grants with no policy on five tables (`usage_events`,
`subscriptions`, `notifications` INSERT, `profiles`/`tool_runs` DELETE), and
client EXECUTE on four functions (`complete_onboarding` for `anon`, the three
trigger functions for both roles). `20260912072133_acl_least_privilege.sql`
revokes exactly that; live ACLs now match the matrix (authenticated keeps only
the commissioned DML, anon has zero table grants, definer functions are
service-role + owner, `complete_onboarding` is authenticated-only), and
`rls-isolation.spec.ts` now asserts the stronger privilege-level denial where
grants were removed. `20260912072153_documents_failed_state.sql` adds the
`failed` state to the documents vocabulary. The pipeline: the 23.x finalize
action enqueues `document.process` and marks the row `indexing`; the 29.1
worker's new handler (`backend/worker/documentProcessing.mjs`, pdfjs-dist +
mammoth in the worker package) downloads the object with the service client,
routes PDF/DOCX/images, normalizes (`extract/text.mjs`), enforces the 200-page/
2,000,000-character limits, replaces `document_chunks` idempotently (one unit
per PDF page; one for DOCX — 25.x owns embedding chunking), and settles
`indexed` with `page_count` or `failed` with sanitized copy. Retryable
failures ride the 29.1 backoff and record the transient copy; the last attempt
or a non-retryable failure records the terminal copy; corrupt files, no-text
PDFs and images fail permanently (images/no-text PDFs with the honest
"OCR isn't available yet" copy — 24.5/24.6 are [!] blocked on a provider, no
text is faked). 24.14 ships `backend/worker/benchmark.mjs` + the fixture
location, measuring real pairs and exiting non-zero with no fixtures — [~]
until a human-checked set exists, and no accuracy numbers are recorded. QA:
`frontend/tests/qa/documents-processing.spec.ts` (real UI PDF upload →
indexing → worker → indexed chunks/pages; DOCX unit; missing-object retry →
dead-letter; corrupt permanent failure; image OCR block; page limit; chunks
RLS; ACL denials incl. anon `complete_onboarding`; harness honesty) runs as
`qa-documents-processing` after `qa-documents-ui`; the 23.x UI spec now pins
the `Indexing` post-finalize state and sweeps its jobs; full `npm run test`
**133/133** (`frontend/.playwright/processing-green-3.log`), typecheck/lint/
build pass, `db:reset` applies all twelve migrations cleanly,
`db:check-types` matches (types regenerated for the new status). Stabilisation
in the same pass: the pointer-drag flake that failed three full-feature runs
was fixed at the mechanism — `TaskCard`/`TaskBoard` now expose the real
`data-dragging`/`data-drop-target` states and the test drives the HTML5
gesture explicitly, waiting on that state before release instead of
`dragTo()`'s blind one-shot. MCP Chromium (QA1 session): uploaded a real
2-page PDF → row showed `Indexing` → worker ran → reload showed
`2 pages · Indexed` with the real chunks in the DB; uploaded a PNG → worker
→ `Failed` with the sanitized OCR copy; light/dark, 1280/375, zero console
errors, clean product network; documents/jobs/objects swept to zero.
25.x boundary untouched: no embeddings, no second chunking system.
```

Stage 2 items 12–14 are ✅ (above). With item 9 (20.7) still [~] pending the
founder-approved hosted rollout, Stage 2 is otherwise complete.

Stage 3 addendum — 14.12 `/tools` + 14.13 `/integrations` ✅.
The workspace's tool catalogue and integrations routes are live, guest-viewable
and registry-backed: `/tools` renders the four families and every offerable
entry from `components/tools/toolCatalog.ts` (Tier-3 excluded by the registry,
"Planned"/"How it will work" from the registry, `/features` destinations, one
aggregate "none are built yet" note gated on `hasLiveTool`), and
`/integrations` is an honest coming-soon page for WhatsApp and Gmail with their
official marks inlined (the recorded DESIGN.md exception) and no
Connect/connected/sync claim. Both were appended to the single `WORKSPACE_NAV`
list (rail + drawer + travelling highlight), are matched by `proxy.ts` for
session refresh only, and use the same `getWorkspaceAccess` guest policy as the
other workspace routes. Evidence: `frontend/tests/qa/structure.spec.ts`
(renders, overflow 320–1280, nav, motion/reduced motion),
`tool-registry.spec.ts` (every offerable tool by family with registry
action/status/href), the new `frontend/tests/qa/integrations.spec.ts` (marks,
honest state, no fake connect, console), and
  `auth-guards.spec.ts`/`guest-browsing.spec.ts` (guest states, matcher, zero data
  reads); MCP/real-Chromium pass at 1280/375, light + dark, guest + QA1 with clean
  consoles and no horizontal overflow. typecheck/lint/build pass. Reconciliation
  (2026-09-12) closed the window's 99/101 note: the two remaining failures were
  real and are fixed at the source — keyboard focus-follow now focuses the fresh
  card on mount instead of DOM-querying the task id (a query could catch
  Motion's exiting shared-layout clone; `TaskCard`/`TaskBoard`), and the
  finish-setup banner navigation assertion gained the suite's 20s headroom for
  the same slow `/onboarding` read `auth.setup.ts` already allows. The last
  residual flake — a transport `read ECONNRESET` in `auth-guards.spec.ts`'s
  guest-route probes — traced to `next dev` tearing down in-flight streams and
  resetting keep-alive connections under load, so the suite's `webServer` is now
  a production build (`npm run build && npm run start`, local env pinned). Full
  `npm run test` is **101/101 three consecutive times** on one consistent tree,
  each from a clean `db:reset` + `seed:qa`
  (`frontend/.playwright/stabilization-green-2026-09-12-run{1,2,3}.log`).

Task 3.14 — action-label typography ✅.
`frontend/components/ui/Button.tsx`'s `baseClasses` gained `font-heading`, so
`Button`/`ButtonLink` render Bricolage Grotesque in every variant and size, and
the button-styled controls outside the primitive were audited and matched
(`TaskBoard` status filter chips, `CalendarWorkspace` Week/Month segmented
control, the assistant launcher bar and starter chips); nav links, jump pills,
form fields, menu/navigation items, metadata/eyebrow labels and content-like
interactive text stay on Geist/Geist Mono (the content cases marked
`data-fontprobe-role="content"`). `frontend/tests/qa/fonts.spec.ts` now asserts
the button role — RED proven on `/pricing` and `/login` before the change, then
GREEN — and still proves only the three authorized families render. Full
`npm run test` **110/110**
(`frontend/.playwright/action-label-fonts-green-2.log`; the first run's
`tasks-ui` pointer-drag failure was a settle race under a concurrent session and
passed on re-run/isolation), typecheck/lint/build pass; MCP Chromium pass at
1280/375, light + dark, clean consoles and zero horizontal overflow. DESIGN.md
§Typography amended; the closed three-family set is intact.

---

## STAGE 1 — INTEGRITY / ARCHITECTURE RECONCILIATION

1. A.1 Benchmark integrity ✅ (audit complete — see CURRENT STATE)
2. A.2 Auth provider verification — 12.2 ✅, 12.3 [~] (blocked: sanctioned Google identity / provider-enabled project)
3. A.3 Email provider verification — [!] blocked (no verified sending domain; backend/EMAIL.md §Blocking prerequisites)
4. A.4 Authenticated Motion verification — ✅ (pass complete — see CURRENT STATE; 3.10 [x])
5. Formalize 30.1 tool registry — ✅ (registry formalized + guarded; 30.1 [x]; 30.2 families and 30.3 state model remain open)
6. Ratify 5.7 homepage ecosystem against registry — ✅ (5.7 [x]; see CURRENT STATE)
7. Ratify 6.9 Features ecosystem against registry — ✅ (6.9 [x]; see CURRENT STATE)

Do not rebuild already-working UI during these audits.

---

## STAGE 2 — DATABASE FOUNDATION

8. 20.6 Schema — ✅ (migration `20260911011824_init_schema.sql`; contract backend/DATABASE.md; see CURRENT STATE)
9. 20.7 Migration workflow — [~] workflow formalized + locally validated; hosted rollout pending founder approval (see CURRENT STATE)
10. 20.8 Typed DB types — ✅ (generated from local, wired into all clients + compile-time schema contract; see CURRENT STATE)
11. 20.9 RLS isolation tests — ✅ (two QA identities + committed isolation spec; see CURRENT STATE)

Then:

12. 13.10 Onboarding persistence — ✅ (migration `20260911034901_complete_onboarding.sql`; data layer + gate + dashboard read; QA 60/60; see CURRENT STATE)
13. 14.10 Persistent finish-setup affordance — ✅ (completion-aware link + dashboard banner; QA 64/64; see CURRENT STATE)
14. 14.11 Server/API auth guard audit — ✅ (guard matrix + host-header fix; QA 70/70; see CURRENT STATE)

---

## STAGE 3 — REAL CORE DATA

15. 21.x Tasks data — ✅ service layer (21.9 is [~]: its UI remainder); see CURRENT STATE
16. 16.x Tasks UI bound to real data — ✅ (16.2/16.6–16.13; QA 80/80; see CURRENT STATE)

17. 22.x Calendar data — ✅ service layer (22.7 [~] recurrence deferred with the exact reason; see CURRENT STATE)
18. 17.x Calendar UI — ✅ bound to the real events service (17.5–17.11; 17.12 [~]; QA 110/110; see CURRENT STATE)

19. 23.x Document storage — ✅ private bucket + upload pipeline + data layer (23.12 [~] plan-driven enforcement; QA 118/118; see CURRENT STATE)
20. 29.1 Background jobs — ✅ durable store + atomic claim + worker runner + enqueue helper (24.2 now unblocked; QA 124/124; see CURRENT STATE)
21. 24.x Document processing/OCR — ✅ text pipeline (24.5/24.6 [!] blocked on an OCR provider, 24.14 [~] until a real benchmark set); QA 133/133; see CURRENT STATE
22. 18.x Documents UI

23. 25.x Search/embeddings

---

## STAGE 4 — AI

24. 26.x Assistant backend
25. 19.x Assistant UI bound to real backend
26. 27.x AI action engine
27. 28.x Academic intelligence

---

## STAGE 5 — DASHBOARD INTELLIGENCE

28. 44.x Workload engine
29. 45.x Dashboard intelligence
30. 15.10 Final Dashboard responsive QA
31. 15.11 Create with UniPilot tool hub
32. 15.12 New-account Dashboard zero state

Note:
15.9 is superseded and must NOT be implemented separately.

---

## STAGE 6 — TIER 1 TOOLS

33. 39 Flashcards
34. 40 Quiz / MCQ
35. 43 Data Tables
36. 38 QR Generator

Then bind them into:

37. 15.11 Tool Hub
38. Quick Actions
39. Homepage
40. Features page

Registry remains the single source of truth.

---

## STAGE 7 — PRODUCT SYSTEMS

41. 48 Notifications backend
42. 49 Billing
43. 46 Calendar integrations
44. 47 Academic integrations

---

## STAGE 8 — HARDENING

45. 50 Security
46. 51 Accessibility
47. 52 Performance
48. 53 Errors/empty states
49. 29.3–29.8 infrastructure hardening

---

## STAGE 9 — FINAL QA

50. 54 Marketing QA
51. 55 Application QA
52. 56 Automated tests
53. 57 E2E
54. 58 SEO
55. 59 Legal/trust
56. 60 Deployment
57. 61 Final launch checklist
58. 62 Admin
59. 63 Academic integrity

Only after these stages is the product considered launch-ready.

---

# FUTURE DEVELOPMENT RULES

## UI rule

Before creating a new component:

1. Search for an existing component.
2. Reuse it where possible.
3. Only introduce a new primitive when the existing system genuinely cannot support the requirement.

## Motion rule

Before creating animation:

1. Read `MOTION.md`.
2. Inspect existing Motion primitives.
3. Reuse shared variants.
4. Choose animation based on the UI's purpose.
5. Do not default to fade-only animation.
6. Preserve reduced motion.
7. Ensure animation cannot hide content.
8. Verify in Chromium.

## Tool rule

Before adding any tool:

1. Add/update its registry entry.
2. Set its tier.
3. Set its state.
4. Set its real route if live.
5. Mark Planned if unfinished.
6. Ensure homepage/features/dashboard read from the registry.

## Data rule

Before connecting data:

1. Confirm the source exists.
2. Confirm user ownership.
3. Confirm RLS.
4. Keep data access outside presentation.
5. Avoid duplicate queries.
6. Provide explicit loading/error/empty states.

## Guest rule

Every new workspace feature must decide:
- is it available to Guest?
- does it require login?
- what does the guest-safe empty state look like?

Never rely on accidental proxy behavior when a deliberate login CTA is appropriate.

## Testing rule

For each UI task:

```text
Focused Chromium verification
+
typecheck
+
lint
+
build
```

Do not run the entire application regression suite unless the task specifically affects a cross-cutting system.

The full regression happens in Phase 55–61.

---

# NEVER DO THIS

- Do not implement future tasks unrequested.
- Do not work around blockers.
- Do not fabricate data.
- Do not fabricate AI output.
- Do not fabricate integration status.
- Do not fabricate benchmark results.
- Do not add mock persistence to production.
- Do not duplicate reusable components.
- Do not create a second animation system.
- Do not create a second Assistant architecture.
- Do not create page-specific popup systems.
- Do not make animation responsible for content visibility.
- Do not make `/dashboard` private again.
- Do not expose protected workspace data to Guest.
- Do not introduce random gradients/colors.
- Do not hardcode tool availability outside the registry.
- Do not claim something was browser-tested when it was only inspected statically.
- Do not mark `[x]` unless the task actually satisfies its definition of done.

---

# SESSION PROMPT

OpenCode should begin every session with:

> Read `TASK.md`, `AGENTS.md`, `DESIGN.md`, and `MOTION.md`.
>
> Find the next actionable task in the **Execution Order** section.
>
> Check whether the task is already implemented.
>
> If it is implemented, audit/refine instead of rebuilding it.
>
> Confirm its dependencies are complete.
>
> Implement only that task.
>
> Use existing architecture and primitives.
>
> For UI changes, verify the result in real Chromium using Playwright MCP.
>
> Run typecheck, lint and build.
>
> If blocked, mark the task `[!] BLOCKED BY <task id>` and stop.
>
> If partially verifiable, use `[~]` and state the exact limitation.
>
> Update only the relevant task status.
>
> Do not stage or commit.
>
> Stop after the task is complete.

---

# STATUS LEGEND

```text
[x]  Complete and verified
[~]  Partially verified / implementation exists but one verification dependency remains
[ ]  Not started
[!]  Blocked — dependency missing
[-]  Intentionally deferred / superseded
```

# MASTER PRINCIPLE

UniPilot should be built as:

ONE design system
+
ONE glass/dotted visual language
+
ONE Motion.dev animation system
+
ONE tool registry
+
ONE Assistant architecture
+
REAL server data
+
REAL user isolation
+
HONEST product states

The UI should feel complete before the backend is complete, but it must never PRETEND the backend is complete.

The final product should feel like one coherent system from:

Homepage
↓
Auth
↓
Onboarding
↓
Dashboard
↓
Tasks
↓
Calendar
↓
Documents
↓
Assistant
↓
Tools
↓
AI intelligence

with the same visual language, motion quality, accessibility expectations and architectural discipline throughout.
