# Presentation generate/setup — redesign + honest model chooser

Date: 2026-09-21 · Status: **awaiting review at the T0 gate** (no code written).
Task IDs: TASK.md `31.1`/`31.2`/`31.4` chrome follow-up (extends the delivered
generate/setup surface; adds no product capability beyond a service-managed
model switch).
Plan: `docs/superpowers/plans/2026-09-21-presentation-generate-redesign.md`.
Related: `docs/integrations/presenton.md` (the engine contract), `DESIGN.md`,
`MOTION.md`, `frontend/AGENTS.md` (Next rules), `QA_SESSION.md` (browser QA).

Provenance: read-only inspection of Presenton's FastAPI surface
(`presenton-main/servers/fastapi`) and of UniPilot's presentation wiring
(`frontend/lib/integrations/presenton*.ts`, `frontend/lib/data/presentation*.ts`,
`frontend/app/(app)/tools/presentation/**`, `backend/worker/presentationJobs.mjs`),
plus **live probes against the local engine on 2026-09-21** (§2.4). Nothing in
`presenton-main/` is modified or copied.

---

## 1. Goal, scope, non-goals

**Goal.** Reshape the `/tools/presentation` generate/setup surface to the
reference layout — a centered hero with a large prompt box, trailing controls,
real option chips, and a Get-started/Templates split — in UniPilot's existing
design language, with a model chooser that is honest about what the engine
actually permits.

**In scope.** The generate/setup chrome on `/tools/presentation`:
the hero, the prompt form, the real option controls, the run/result panel's
position, the Get-started/Templates split, and the model chooser (display +
selection where the engine grants it).

**Out of scope (unchanged).**

- The rail (`WorkspaceSidebar` / `WorkspaceMobileNav`) — reused, never
  duplicated. No second sidebar.
- History: `DecksList` ("My decks") stays as delivered (F1).
- The templates browser and preview routes (`/tools/presentation/templates`,
  `/templates/[templateId]`); the split links to them.
- The native viewer/editor chrome, the worker, the job runner, the
  `presentations`/`documents` schema, and the generation request flow.
- No new fonts, colors, surfaces, motion primitives or pages.

**Non-goals.** Per-deck (per-request) model selection — not supported by the
engine (§2); the reference's Document/Carousel/Image/Beautify/Import chips and
the effort dropdown — no real UniPilot feature maps to them (§3).

---

## 2. Model selection — the exact mechanism and its limits

### 2.1 What the engine accepts

`GeneratePresentationRequest`
(`presenton-main/servers/fastapi/models/generate_presentation_request.py`) is
the body of `POST /api/v1/ppt/presentation/generate/async`: `content`,
`slides_markdown`, `instructions`, `tone`, `verbosity`, `web_search`,
`n_slides`, `language`, `template`, `include_table_of_contents`,
`include_title_slide`, `files`, `export_as`, `trigger_webhook`.

**There is no `model` or `provider` field.** The UniPilot adapter's
`buildGenerationRequestBody()` and the worker's mirror of it are complete —
nothing can be threaded through the request.

### 2.2 How the model is actually resolved

`get_model()` (`utils/llm_provider.py:126`) reads the provider's environment
variable (`GOOGLE_MODEL`, `CUSTOM_MODEL`, `OPENAI_MODEL`, … — the per-provider
keys are the `*_MODEL` fields in `models/user_config.py`) and falls back to the
engine's `DEFAULT_*_MODEL` constant (`constants/llm.py`).

That environment is synced from the engine's **persisted settings store**: a
single row (`provider_settings.id = 1`, `models/sql/provider_settings.py`).
`save_provider_settings()` (`services/provider_settings.py:137`) merges the
incoming patch into the row, mirrors it to the legacy `userConfig.json`, and
`update_env_with_user_config()` (`utils/user_config.py:378`) writes the values
into the running process's `os.environ`. Every request re-syncs env from the
store through `UserConfigEnvUpdateMiddleware` unless `CAN_CHANGE_KEYS=false`
(`api/middlewares.py:22–26, 79–113`).

**Consequence: the model is one deployment-wide, single-owner setting.**
There is no per-deck, per-user or per-request selection to expose.

### 2.3 The only write path, and who may use it

`PUT /api/v1/admin/provider-settings` (`api/v1/admin/router.py:169`) is the
only route that changes the model. It is gated by:

1. `require_settings_admin` (`router.py:133`): passes without auth only when
   the engine runs its no-auth, single-user runtime (`DISABLE_AUTH=true`);
   otherwise it requires a browser JWT with `is_superuser`.
2. `_ensure_settings_are_mutable` (`router.py:146`): refuses when
   `CAN_CHANGE_KEYS=false` — for `GET` too.
3. `SessionAuthMiddleware` (`api/middlewares.py:97–113`): every
   `/api/v1/admin/` path is admin-JWT-only. **API-key principals are refused**
   by the middleware's `admin_only` branch (403) before the route handler
   runs, and `require_settings_admin` itself only ever reads a browser cookie.

### 2.4 Live probe (local engine, 2026-09-21)

The local engine was up on `http://localhost:5001` with auth enabled
(`GET /api/v1/auth/status` → `{configured:true, authenticated:false}`; its
`.env` carries `AUTH_USERNAME`/`AUTH_PASSWORD`, no `DISABLE_AUTH`). With
UniPilot's `PRESENTON_API_KEY` from `frontend/.env.development.local`
(never printed):

| Call | Result |
| --- | --- |
| `GET /api/v1/ppt/template/all?…` | **200** — the key is valid |
| `GET /api/v1/async-tasks?…` | **200** |
| `GET /api/v1/auth/verify` | **200** |
| `GET /api/v1/admin/provider-settings` | **403** |
| `PUT /api/v1/admin/provider-settings` | **403** |

So on this deployment UniPilot can neither read nor change the engine's model.

### 2.5 What the chooser can honestly promise

| Deployment | Chooser |
| --- | --- |
| Engine grants admin settings access (no-auth single-user runtime **and** `CAN_CHANGE_KEYS` not `false`) | Live: shows the engine's provider + model and can switch it. The switch is **deployment-global** and applies to generations started after it (an in-flight task keeps the model it began with). |
| Engine denies settings access (today's local engine) | Read-only: shows the operator-declared model (or "set on the presentation service" when none is declared), with the honest reason, and never a fake selectable list. |
| UniPilot unconfigured (`PRESENTON_URL` unset) | The existing blocked state; no model UI. |

The switch is **not** coupled to submission: selecting a model changes the
service, and the next generation uses it. A submit never silently performs an
admin write; if the write is refused, no row is created and no deck is queued.

### 2.6 Recorded limits (`[!]` — carried into TASK.md by T4)

- `[!]` Per-request model selection is impossible with this engine; the
  request schema has no model field. Dependency: an engine feature
  (request-level provider/model), not a UniPilot change.
- `[!]` The switch needs the engine's no-auth single-user runtime with mutable
  keys (`DISABLE_AUTH=true`, `CAN_CHANGE_KEYS` ≠ `false`). Today's local
  engine refuses both read and write to UniPilot's API key (403, §2.4).
- `[!]` The switch is single-owner/global: it changes the service for every
  user of the deployment and every later deck.
- The reference's **effort dropdown is not shipped**: the engine's reasoning
  profile/effort are the same kind of admin-global setting and have no
  per-request equivalent; there is no real per-deck control to offer.

---

## 3. Model listing — sources and the honest fallback

### 3.1 What is impossible

- The engine's own model-listing routes
  (`POST /api/v1/ppt/{openai,google,anthropic}/models/available`,
  `utils/available_models.py`) take the **provider API key in the request
  body**. UniPilot holds no provider key, and the one server-side settings read
  it does perform is deliberately limited to the provider and model fields —
  no key material is read, stored or forwarded (§3.3).
- The engine's settings read (`GET /api/v1/admin/provider-settings`) returns
  the whole config **including keys**. Even where the engine grants it, the
  adapter extracts only `LLM` and the mapped `*_MODEL` and discards the rest
  immediately (§3.3).
- No engine route reports the configured model without that admin gate.
- A curated provider→model table in UniPilot code is **rejected**: it would
  list models the configured key may not have, which is exactly the invention
  this task forbids.

### 3.2 Sources that are real (in priority order)

1. **Engine read** (when §2.5 grants it): `LLM` → provider, `<PROVIDER>_MODEL`
   → the model in use.
2. **Operator declaration** (server-only env, always available):
   - `PRESENTON_MODEL` — the model id this deployment's engine is configured
     with. Display-only fallback; shown labelled "configured on the service".
   - `PRESENTON_MODEL_OPTIONS` — comma-separated model ids the operator
     declares available for switching. **Its presence is the opt-in for the
     deployment-global switch**, because the switch changes what every user's
     next deck uses.
3. Nothing known → the control renders a single honest chip ("Model set on the
   presentation service") with no options and no name.

No source ever invents an id: every value shown is either the engine's own
report or a string the operator wrote.

### 3.3 Adapter contract (T1, exact)

```ts
export type PresentationModelOption = {
  /** The exact model id the engine's provider settings expect. */
  value: string;
  /** Display label; the id by default. */
  label: string;
  /** True only for the value in use (engine report or declared default). */
  current: boolean;
  /** True when this option may be applied (see §2.5). */
  selectable: boolean;
};

export type PresentationModelNotice =
  | "service-managed"    // engine settings denied (or unconfigured): no switching from here
  | "switching-disabled" // engine managed, but no PRESENTON_MODEL_OPTIONS declared
  | "unreachable";       // the settings probe did not answer
// `current === null` with any notice is the "no model name is known" case;
// no notice ever implies a model that is not in `current`/`options`.

export type PresentationModels = {
  current: string | null;
  currentSource: "engine" | "declared" | null;
  provider: string | null;       // engine report only ('google', 'custom', …)
  providerModelKey: string | null; // e.g. 'GOOGLE_MODEL' (write target)
  engineManaged: boolean;        // settings read answered 200
  switchingDeclared: boolean;    // PRESENTON_MODEL_OPTIONS non-empty
  options: PresentationModelOption[];
  notice: PresentationModelNotice | null;
};

export type PresentationModelApplyResult =
  | { applied: true; model: string; provider: string }
  | {
      applied: false;
      reason:
        | "not-configured"
        | "not-declared"
        | "not-supported"
        | "unreachable"
        | "rejected";
    };
```

- `listPresentationModels()` **never throws** for configuration/engine states —
  a dead engine must not take the tool page down; it degrades to `notice`
  ("unreachable") with whatever the declaration provides.
- `applyPresentationModel(value)` guard order: configured → value is in the
  declared/known catalogue (trimmed, exact) → the provider's settings key is
  known → `PUT` exactly `{ [providerModelKey]: value }` → the response's model
  equals the request (else `rejected`). Any 4xx is `rejected`, transport/5xx is
  `unreachable`; the returned shape carries no engine text.
- Provider→key map is one explicit table over the engine's `LLMProvider` enum
  (openai→`OPENAI_MODEL`, google→`GOOGLE_MODEL`, custom→`CUSTOM_MODEL`,
  anthropic→`ANTHROPIC_MODEL`, …); an unknown provider is `not-supported`.
  No provider-specific branches beyond that map.

### 3.4 UI posture (T3)

- `Select` (the app's combobox, `aria-label="Presentation model"`) only when
  `engineManaged && switchingDeclared && options.length > 1`; otherwise a
  static chip that names the model when known.
- Default = `current` (engine report wins over the declaration).
- Helper line under the prompt box, rendered only when true:
  - switch available → "Applies to every deck this service generates."
  - engine-managed but no declared options → "Changing the model isn't enabled
    for this deployment."
  - engine denies settings → "The model is configured on the presentation
    service."
- Applying is an immediate Server Action; failure shows sanitized copy through
  `MotionNotice role="alert"` and the control re-reads the server value (no
  phantom selection).
- Guests can see the state but cannot apply (the action gates on
  `requireOnboardedUser`, same as generation).

---

## 4. Real vs fake — reference element mapping

| Reference element | UniPilot element | Status |
| --- | --- | --- |
| Centered hero, large prompt box | Centered hero + big `Textarea` in a glass card | Real (existing prompt state) |
| Trailing model dropdown | Model chooser (§2.5, §3.4) | Real, honest per deployment |
| Trailing effort dropdown | — | **Dropped** (no per-request equivalent) |
| Content-type chips (Document/Carousel/Image/Beautify/Import) | Real option chips: format (`pptx`/`pdf`), slide count, template | Mapped, not faked |
| Submit | `createPresentationAction` (existing) | Real, unchanged |
| "Get started" cards | Three real entry points onto the form: focus the prompt, open Sources, open the templates browser | Real controls, no invented flows |
| "Templates" cards | Real engine templates (art through the session-gated template-asset route) + "Browse all templates" + template preselect | Real |
| Result/progress area | Existing `RunPanel` states (in-flight, failed, ready) | Real, repositioned only |
| History | Existing `DecksList` | Unchanged, out of scope |

---

## 5. Layout specification (T2)

### 5.1 Shape

```
Container (flex min-w-0 flex-col gap-8 py-6 md:py-8)
├─ section [data-generate-hero] (flex flex-col items-center gap-6)
│  ├─ hero text block (mx-auto max-w-3xl text-center, gap-3)
│  │  ├─ eyebrow  font-mono text-label-caps uppercase text-muted-foreground
│  │  ├─ h1       font-heading text-headline-lg-mobile md:text-headline-lg font-bold
│  │  └─ support  text-body-md md:text-body-lg text-muted-foreground
│  └─ form [data-generate-form] (w-full max-w-3xl)
│     └─ Card bg-glass backdrop-blur-md p-4 md:p-5 shadow-floating
│        ├─ Textarea  (rows≈4, min-h, resize-none; solid control per DESIGN.md)
│        ├─ trailing row (flex flex-wrap items-center justify-between gap-2)
│        │  ├─ model chooser (chip / Select size="sm")
│        │  └─ submit (Button primary) or guest SignInAction
│        ├─ divider
│        ├─ options row (flex flex-wrap gap-1.5): format chips (aria-pressed pills),
│        │  Slides Select size="sm", Template Select size="sm" (aria-label kept),
│        │  Sources disclosure, Advanced disclosure
│        └─ Collapsible panels: Sources, Advanced (content unchanged)
├─ RunPanel (existing states/copy), centered max-w-3xl
├─ section [data-generate-split] (grid gap-4 lg:grid-cols-2)
│  ├─ Get started card  [data-get-started]
│  └─ Templates card    [data-generate-templates] (real cards, honest empty states)
└─ DecksList (unchanged)
```

- The page keeps exactly **one `<h1>`** (the hero heading). `PageHeader` is
  deliberately not used on this route: the reference's hero *is* the page
  title, and a second header block would read as two competing titles. The
  hero block owns entrance slot 0; the form is slot 1 (`data-enter="scale"`);
  the run panel slot 2; the split is a `MotionRevealGroup` (one observer) whose
  two cards are `MotionRevealItem variant="scale"`.
- `(app)/loading.tsx`'s generic `PageHeader` skeleton is unaffected.

### 5.2 Tokens and rules (no new tokens)

- Surfaces: `bg-glass` + `backdrop-blur-md` card on the page; `bg-glass-subtle`
  only if a nested well is used; format chips/selects keep the solid `--card`
  control styling (DESIGN.md §Surface Fill System).
- Radius: card `rounded-card`; pills `rounded-pill`; nested wells
  `rounded-nested`; never a radius equal to or above the parent's.
- Type: Bricolage for the h1 and action labels; Geist body; Geist Mono eyebrow
  (`text-label-caps`). No display/offset-shadow treatment (application
  surface).
- Motion: `data-enter` slots + `motionIndex`, `MotionRevealGroup`/
  `MotionRevealItem`, `Collapsible`, `MotionNotice`, `icon-turn`,
  `press-feedback`, `hover-lift` — all existing. No new durations/easings and
  no page-specific animation system.
- Responsive: single column at 375; hero text scales via the responsive
  heading step; the trailing row and chips wrap without overflow; the split is
  one column below `lg`. No horizontal scrollbar at 320/375.
- A11y: one h1; real `<button>`/`<a>`/`Select`; format chips are
  `aria-pressed` inside a labelled `role="group"`; the model chooser keeps the
  `Select` combobox pattern; keyboard-only operation with a visible focus ring
  for every control; the prompt keeps its label/`aria-describedby`.

### 5.3 Contracts that must not regress

- `getByRole("combobox", { name: "Presentation template" })` stays on the
  page, contains the selected template's name, and keeps the `?template=`
  preselect plus the `[data-template-preselect-miss]` honest-miss paragraph.
- Guest copy and states: guest submit opens the shared prompt; the run panel's
  guest state stays ("Sign in to keep decks"); the signed-in empty state stays
  ("No decks yet") so the F1 cases keep their meaning.
- The blocked (unconfigured) state stays honest — no form, no fake deck.
- "My decks" (`[data-decks-list]`, `[data-deck-row]`) is untouched.

### 5.4 File plan

- Rewrite `frontend/app/(app)/tools/presentation/_components/PresentationWorkspace.tsx`
  into a small set of route-private components (`GenerateHero`, `ModelControl`,
  `GetStartedTemplates`), keeping all existing state and the `RunPanel`.
- Extend `frontend/app/(app)/tools/presentation/page.tsx` to pass the template
  slice needed by the split (`description`, `layoutCount`, `thumbnail`,
  `isDefault`) and the `PresentationModels` result.
- Extract the template thumbnail into a shared route-private component
  (preserving `data-template-thumb` / `data-template-thumb-fallback`) and have
  the templates browser import it — no markup change there.

---

## 6. Phases (T1–T4)

| Phase | Deliverable | Gate |
| --- | --- | --- |
| T1 | Adapter: `listPresentationModels()` / `applyPresentationModel()` + env readers + unit tests | `qa-presentation-jobs` focused green, typecheck/lint |
| T2 | Layout: hero, big prompt, real option chips, Get-started/Templates split, run panel repositioned | `qa-presentation-ui` focused green + browser evidence |
| T3 | Model dropdown wiring: `Select`, server action, honest states, a11y | focused green + keyboard + console-clean evidence |
| T4 | Verification + docs: dark/light, 375/768/1280, reduced motion, screenshots, TASK.md + integration doc | full `npm run test` gate |

Each phase is one fresh subagent, one writer at a time, review between phases,
commit per reviewed phase (message per the plan). No phase starts before the
previous one is reviewed.

---

## 7. Verification (T4)

- Focused Playwright: `qa-presentation-jobs` (adapter unit/in-process stub
  cases), `qa-presentation-ui` (generate page), `qa-presentation-renderer` and
  the full `npm run test` at the gate; `npm run typecheck` + `npm run lint`.
- Real Chromium via the session's browser tools against the local stack
  (§QA_SESSION.md; QA identity only): dark + light, 375/768/1280, keyboard-only
  pass (tab order through hero → prompt → model → chips → submit; the `Select`
  listbox by keys), reduced-motion pass, console clean (zero errors), no
  overflow.
- Screenshots into `frontend/screenshots/` as
  `generate-redesign-{dark,light}-{375,768,1280}.png` plus model-state and
  split close-ups.
- Docs: TASK.md `31.x` note with the `[!]` list from §2.6;
  `docs/integrations/presenton.md` gains the model-mechanism section (§2 here)
  and the two new server-only env vars; this spec's status is updated to
  "delivered" with the phase records.

---

## 8. Open questions for the T0 review

1. **Model switching defaults.** The switch ships behind
   `PRESENTON_MODEL_OPTIONS` (presence = opt-in, because it is
   deployment-global). Alternative: never ship a switch and keep the chooser
   read-only. The task asked for a live chooser, so the opt-in switch is the
   proposal.
2. **Hero replaces `PageHeader`.** The plan drops the shared `PageHeader` on
   this route in favour of the reference's centered hero (one `<h1>`, same
   eyebrow/title/description semantics, same entrance slot 0). If the reviewer
   prefers page-header consistency, the hero becomes a centered block *below*
   `PageHeader` and the heading drops to `text-headline-md`.
3. **"Get started" card.** Proposed as three real entry points onto existing
   controls (focus prompt / open Sources / open templates browser) rather than
   an invented feature grid or sample-prompt cards.
