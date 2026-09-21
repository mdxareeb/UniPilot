# Presentation generate/setup redesign — implementation plan (T1–T4)

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development`. One fresh subagent per task, one
> writer at a time, review between tasks, commit each reviewed task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `/tools/presentation`'s generate/setup chrome to the reference
layout (centered hero, large prompt, trailing controls, real option chips,
Get-started/Templates split) in UniPilot's design language, and ship a model
chooser that is honest about the engine's real mechanism.

**Spec:** `docs/superpowers/specs/2026-09-21-presentation-generate-redesign.md`
(normative: §2 mechanism + limits, §3 adapter contract, §4 real-vs-fake mapping,
§5 layout, §6 phases). Read it before any task; do not re-derive the mapping.

**Tech stack:** Next 16.3.1 / React 19 / Tailwind 4 / `motion` / Supabase local
stack / Playwright (`npm run test`). No new dependencies, fonts, colors,
surfaces or motion primitives.

## Global constraints (every task)

- **Chrome only.** UniPilot chrome is redesigned; deck content, the engine,
  the worker, the schema and the request flow are untouched.
- **No second sidebar.** The existing rail (`WorkspaceSidebar`) and mobile nav
  stay the only navigation.
- **Reuse, don't re-plumb.** Keep `createPresentationAction` and the
  `presentations` row/worker/job flow exactly as they are; the model chooser is
  a separate control and is never coupled to submission.
- **Honest states.** Every model value shown is either the engine's own report
  or an operator declaration (`PRESENTON_MODEL` /
  `PRESENTON_MODEL_OPTIONS`). No invented model names, no fake chips, no fake
  effort control, no dead options. Blocked capability ⇒ labelled read-only
  state, recorded as `[!]`.
- **Never leak keys.** The engine's settings response is read server-side and
  only `LLM` + the mapped `*_MODEL` are extracted; the raw body is never
  returned, cached or logged. No key material reaches a client component.
- **Tokens/Motion.** `bg-glass`, the radius scale, Bricolage/Geist/Geist Mono,
  the entrance ladder, `MotionRevealGroup`/`MotionRevealItem`, `Collapsible`,
  `MotionNotice`, `icon-turn`, `press-feedback`, `hover-lift`. No new
  durations/easings, no page-specific animation system.
- **Next rules first.** Read `frontend/AGENTS.md` and the relevant guide under
  `node_modules/next/dist/docs/` before touching route files.
- **Environment.** Local Supabase stack up; local engine at `PRESENTON_URL`
  (auth enabled today — the model switch is expected to render read-only; that
  is the honest state, not a failure). Never the hosted project. Never the
  founder account (`QA_SESSION.md`; QA identity only).
- **Verification per task.** Focused Playwright project (`npx playwright test
  --project=<name> --no-deps` from `frontend/`), `npm run typecheck`,
  `npm run lint`. Browser evidence via the session's real-Chromium tools for
  anything visual. Screenshots to `frontend/screenshots/`.
- **Review ledger.** Per-task reports/reviews in
  `.superpowers/sdd/2026-09-21-presentation-generate-redesign/` (git-ignored).
  Committed artifacts are the code, `docs/**`, `frontend/screenshots/**` and
  `TASK.md`.

## Review + commit protocol

For each task: (1) dispatch one fresh subagent with the task text plus the
spec; (2) the subagent implements, runs its own checks and writes
`t<N>-report.md`; (3) the controller reviews the diff against the spec
(especially honesty and no-second-sidebar), writes `review-t<N>.md`, and either
sends the task back or commits it; (4) only then dispatch the next task.

| Task | Commit message (suggested) |
| --- | --- |
| T0 | `docs(presentation): spec and plan for generate redesign + model chooser` |
| T1 | `feat(presentation): honest model listing and service-managed selection adapter` |
| T2 | `feat(presentation): reference-shape generate hero and templates split` |
| T3 | `feat(presentation): live model chooser wiring with honest states` |
| T4 | `docs(presentation): record generate redesign verification and limits` |

---

## T0 — Investigation + spec (**done; stop for review**)

Deliverables written (uncommitted until reviewed):

- `docs/superpowers/specs/2026-09-21-presentation-generate-redesign.md`
- `docs/superpowers/plans/2026-09-21-presentation-generate-redesign.md`

Recorded findings, all sourced from the engine code and live probes:

1. The generate request cannot carry a model
   (`models/generate_presentation_request.py`); `get_model()` resolves from
   process env, synced from the singleton `provider_settings` row.
2. The only write path is `PUT /api/v1/admin/provider-settings`, admin-JWT or
   no-auth-single-user only, refused when `CAN_CHANGE_KEYS=false`; API keys are
   refused by the middleware. Live: `GET`/`PUT` on the local engine = **403**
   with UniPilot's key; plugin routes = 200.
3. Listing models under the configured key is impossible without key material
   (the engine's `models/available` routes take the provider key in the body).
   Honest fallback: engine report + operator declaration; never a curated
   provider table.
4. Reference chips/effort have no real counterpart → dropped or mapped to real
   options (format/slides/template); no fake affordances.

Gate: the reviewer answers §8's three open questions (switch opt-in, hero vs
`PageHeader`, "Get started" composition) before T1 starts.

---

## T1 — Adapter: model listing + service-managed selection

**Spec:** §2.5, §3. **Depends on:** T0 review.

**Files:**

- Modify `frontend/lib/integrations/presentonConfig.ts` — add
  `presentonModel(): string | null` (`PRESENTON_MODEL`) and
  `presentonModelOptions(): string[]` (`PRESENTON_MODEL_OPTIONS` split on `,`,
  trimmed, empty dropped, deduped preserving order), both through the existing
  `readEnv` posture (empty string ⇒ null/[]).
- Modify `frontend/lib/integrations/presenton.ts` — add the §3.3 types and the
  provider→model-key table; add `listPresentationModels()` and
  `applyPresentationModel(value)`; reuse `requireBaseUrl`, `requestHeaders`,
  `joinUrl`, `fetchWithTimeout`, `classifyHttpFailure`.
- Modify `frontend/tests/qa/presentations-jobs.spec.ts` — new describes
  (`model listing (in-process stub)`, `model apply (in-process stub)`) beside
  the existing `template reads (in-process stub)` pattern: in-process
  `createServer` stub, env mutation, dynamic import, `finally` restore.
- Modify `frontend/.env.example` and `frontend/.env.development.local.example`
  — document both optional server-only vars next to the other `PRESENTON_*`
  entries.

**Interfaces (exact):** as spec §3.3. `listPresentationModels()` never throws
for configuration/engine states; `applyPresentationModel()` returns the typed
union and writes only `{ [providerModelKey]: value }`.

- [ ] **Step 1: Config readers.** Implement `presentonModel` /
      `presentonModelOptions` with the same trim/empty rules as
      `presentonBaseUrl`; nothing logs or returns them to a client.
- [ ] **Step 2: Types + provider map.** Add `PresentationModelOption`,
      `PresentationModelNotice`, `PresentationModels`,
      `PresentationModelApplyResult` and
      `PRESENTON_MODEL_KEYS: Record<LLMProviderId, string>` covering the
      engine's `LLMProvider` enum (openai, deepseek, google, vertex, azure,
      bedrock, openrouter, fireworks, together, cerebras, anthropic, litellm,
      lmstudio, ollama, custom, codex).
- [ ] **Step 3: `listPresentationModels()`.** No `PRESENTON_URL` ⇒
      `engineManaged:false`, `switchingDeclared:false`, `current` from
      `PRESENTON_MODEL` when declared (`currentSource:"declared"`, else null),
      `notice:"service-managed"`; the page does not render the control in the
      unconfigured state anyway. Configured: probe
      `GET /api/v1/admin/provider-settings` (short timeout, e.g. 3 s); read
      only `LLM` and the mapped `*_MODEL`; 200 ⇒ `engineManaged:true`,
      `current` from the engine (fall back to the declared default when the
      engine field is absent, `currentSource:"declared"`); 401/403 ⇒
      `engineManaged:false` + `notice:"service-managed"`; transport/5xx ⇒
      `notice:"unreachable"`. Options = `current` + declared options (deduped),
      `selectable = engineManaged && switchingDeclared`, `current` flagged.
      `notice:"switching-disabled"` when the engine is managed but nothing is
      declared; `null` when both a managed engine and a declared switch exist.
- [ ] **Step 4: `applyPresentationModel(value)`.** Guards in spec order; PUT
      `{ [providerModelKey]: value }`; verify the returned model equals the
      request; `rejected` on 4xx, `unreachable` on transport/5xx. A denied
      engine ⇒ `{applied:false, reason:"not-supported"}` **before any write
      attempt** (the stub proves no PUT arrived). A value not in the catalogue
      ⇒ `not-declared`, also before any write.
- [ ] **Step 5: Tests.**
  - unset `PRESENTON_URL` ⇒ degraded shape, zero fetches.
  - stub: `GET provider-settings` 403 ⇒ declared options are present but
    `selectable:false`, `engineManaged:false`, `notice:"service-managed"`.
  - stub: 200 with a config containing `GOOGLE_API_KEY` **and** `GOOGLE_MODEL`
    ⇒ only provider/model surface; assert the serialized result contains
    neither the key value nor the string `GOOGLE_API_KEY`.
  - stub: 200 ⇒ applying a declared value sends exactly one PUT to
    `/api/v1/admin/provider-settings` with body `{GOOGLE_MODEL: value}`
    (compare parsed JSON, not raw text).
  - stub: 403 ⇒ `not-supported` and **no** PUT recorded; declared value
    missing ⇒ `not-declared` and no PUT; 500 ⇒ `unreachable`; DELETE/other
    method never sent.
  - stub: settings `LLM` unknown to the map ⇒ `providerModelKey:null`,
    `selectable:false`, apply `not-supported`.
  - config readers: `PRESENTON_MODEL_OPTIONS=""` ⇒ `[]`; `" a , ,b,a "` ⇒
    `["a","b"]`.
- [ ] **Step 6: Checks + report.** `npx playwright test --project=qa-presentation-jobs
      --no-deps`, `npm run typecheck`, `npm run lint` from the repo root
      (`npm run test:scripts` unaffected). Report `t1-report.md` with exact
      commands and outputs; screenshots not applicable.

**Out of scope:** any UI change, any server action, any new env var beyond the
two, any engine write outside `applyPresentationModel`.

---

## T2 — Layout: reference-shape generate page

**Spec:** §4, §5, §5.3. **Depends on:** T1 reviewed.

**Files:**

- Rewrite `frontend/app/(app)/tools/presentation/_components/PresentationWorkspace.tsx`
  into route-private pieces: `GenerateHero` (hero text + prompt card + option
  row + disclosures), `GetStartedTemplates` (the split), keep `RunPanel`
  (states/copy intact) and all existing state/handlers.
- Modify `frontend/app/(app)/tools/presentation/page.tsx` — pass the richer
  template slice (`description`, `layoutCount`, `thumbnail`, `isDefault`) and
  the `PresentationModels` result into the workspace; keep every existing read
  and the `configured`/guest posture.
- Create `frontend/app/(app)/tools/presentation/_components/TemplateThumb.tsx`
  — the thumbnail extracted from `templates/_components/TemplatesBrowser.tsx`
  with identical markup (`data-template-thumb`, `data-template-thumb-fallback`,
  `aspect-video`, `bg-muted`, engine bytes through `templateAssetUrl`); update
  the browser to import it (no other change there).
- Test: extend `frontend/tests/qa/presentations-ui.spec.ts` with a
  `generate redesign (live engine)` describe asserting the hero, prompt, format
  chips, the template combobox contract, the split's real template cards and
  the preselect path.

**Steps:**

- [ ] **Step 1: Hero.** Centered eyebrow + h1 ("What do you want to present?")
      + supporting line, one `<h1>`, entrance slot 0; form slot 1
      (`data-enter="scale"`), `max-w-3xl`, `Card bg-glass backdrop-blur-md`.
      Keep the prompt `Textarea` (id/label/hint/limit) unchanged in behaviour;
      size it with `rows`/`min-h` (do not fight the primitive's base classes).
- [ ] **Step 2: Option row.** Format as two `aria-pressed` pill buttons
      (PowerPoint/PDF) inside a labelled `role="group"`; Slides `Select
      size="sm"` (existing options/aria-label); Template `Select size="sm"`
      (keep `aria-label="Presentation template"` and
      `[data-template-preselect-miss]`); Sources and Advanced keep their
      `aria-expanded` disclosure buttons + `Collapsible` panels and their
      content/state unchanged.
- [ ] **Step 3: Model display (no wiring).** Render the model control from the
      T1 result: the `Select` only when interactive, otherwise a static chip
      naming `current` (or "set on the presentation service"); helper line per
      §3.4. T2 may render the control inert; T3 wires the action.
- [ ] **Step 4: Split.** `MotionRevealGroup` + two `MotionRevealItem
      variant="scale"` cards: "Get started" (three real entry points: focus
      prompt, open Sources, open `/tools/presentation/templates`) and
      "Templates" (up to 4 real cards with art; guests/unavailable/empty get
      the honest notes from §5.3/§3.4 wording; card click sets the picker, no
      URL change; "Browse all templates" `WorkspaceAction`).
- [ ] **Step 5: Run panel + decks.** Reposition `RunPanel` (existing
      states/copy, `max-w-3xl` centered) between hero and split; `DecksList`
      stays as the final section. No data-flow change.
- [ ] **Step 6: Tests.**
  - guest: no decks list, guest run-panel line visible when configured, guest
    submit opens the shared prompt (existing cases stay green).
  - signed-in: hero heading/eyebrow visible; prompt label reachable; format
    chips toggle and submit sends the chosen format (assert via a stubbed
    action path or the row's stored format after a fixture-safe submit — use
    the existing fixture helpers, never invent rows).
  - template contract: `getByRole("combobox", { name: "Presentation template" })`
    contains the `?template=` value; `[data-template-preselect-miss]` present
    for a stale id.
  - split: real template cards (art loads, `naturalWidth > 0`) for the live
    engine; clicking a card changes the combobox; a guest sees no template art.
  - console errors equal `[]` in each case.
- [ ] **Step 7: Browser evidence.** Real Chromium against the local dev stack:
      dark + light at 1280, dark at 375/768, keyboard tab order, no overflow.
      Screenshots `frontend/screenshots/generate-redesign-{dark,light}-{375,768,1280}.png`
      and `generate-redesign-split-{dark,light}-1280.png`.
- [ ] **Step 8: Checks + report.** Focused `qa-presentation-ui --no-deps`,
      `qa-presentation-renderer --no-deps`, typecheck, lint; `t2-report.md`.

**Must not regress:** §5.3 contracts (template combobox + preselect-miss, guest
states, "No decks yet"/"Sign in to keep decks", blocked-unconfigured state,
`data-decks-list`/`data-deck-row`), the fonts spec (buttons stay Bricolage),
and the single-`<h1>` rule.

---

## T3 — Model dropdown wiring (honest states)

**Spec:** §2.5, §3.4. **Depends on:** T2 reviewed.

**Files:**

- Modify `frontend/lib/data/presentationActions.ts` — add
  `updatePresentationModelAction(payload: unknown)`:
  `requireOnboardedUser("/tools/presentation")` → `isPresentonConfigured()` →
  trim/validate the value as a non-empty string ≤ 200 chars → call the
  adapter → map failures to `PRESENTATION_*` copy → on success
  `revalidatePath("/tools/presentation")` and return
  `{ error: null, model }`. Never returns engine text.
- Modify `frontend/lib/data/presentationErrors.ts` — add sanitized copy:
  not-enabled, not-available (declared/known check), unreachable, rejected.
- Create `frontend/app/(app)/tools/presentation/_components/ModelControl.tsx`
  — the client control (spec §3.4): `Select` when interactive, chip when not,
  submit-on-change through the action, `MotionNotice role="alert"` on failure,
  `aria-label="Presentation model"`, `data-model-control` +
  `data-model-state="engine|declared|unknown"`.
- Modify the workspace to use `ModelControl` (replacing T2's inert display).
- Test: extend the UI spec with the model cases below.

**Steps:**

- [ ] **Step 1: Action + copy** exactly as above; unit-test the parser/guard
      path in `presentations-jobs.spec.ts` if the action can be exercised
      without a server (else cover it through the UI spec).
- [ ] **Step 2: Control states.**
  - interactive (`engineManaged && switchingDeclared && options.length > 1`):
    `Select` with the real options, `current` selected; choosing calls the
    action; success re-renders with the engine's value; failure keeps the old
    value and shows the sanitized line.
  - engine denies settings: chip + "The model is configured on the presentation
    service."; no interactive affordance, no options.
  - engine managed but no declared options: chip + "Changing the model isn't
    enabled for this deployment."
  - nothing known: chip "Model set on the presentation service.", no name.
- [ ] **Step 3: A11y + keyboard.** The `Select` combobox keeps the app pattern
      (ArrowUp/Down, Home/End, Enter/Space, Escape, typeahead, focus stays on
      the trigger). The control is reachable in the tab order between the
      prompt and the chips row.
- [ ] **Step 4: UI tests.**
  - an engine stub that grants settings (point `PRESENTON_URL` at an
    in-process stub is not possible for the Next server; instead assert the
    honest offline state end-to-end and the interactive path through the
    action's unit/in-process tests) — record exactly which half is covered
    where in `t3-report.md`.
  - honest states: with today's local engine, the control renders the chip,
    the correct helper line, no `role="combobox"` model select, and zero
    console errors.
  - guest: state visible, no interactive control.
- [ ] **Step 5: Evidence.** Screenshots
      `generate-redesign-model-{dark,light}-1280.png` (chip state) and, if a
      stub grants settings, `generate-redesign-model-live-1280.png`; keyboard
      walk recorded in the report.
- [ ] **Step 6: Checks + report.** Focused projects, typecheck, lint;
      `t3-report.md` with the exact `[!]` wording.

---

## T4 — Verification + docs

**Spec:** §6, §7. **Depends on:** T1–T3 reviewed.

- [ ] **Step 1: Full verification.** From the repo root with the local stack up
      (no manual dev server): `npm run test` (full suite), `npm run typecheck`,
      `npm run lint`, `npm run test:scripts`. Record counts + skips.
- [ ] **Step 2: Real-Chromium sweep.** Via the session's browser tools
      (QA_SESSION.md login): `/tools/presentation` dark + light, 375/768/1280;
      reduced-motion emulation; keyboard-only pass through hero → prompt →
      model → chips → disclosures → split; console clean; no horizontal
      overflow at 320/375. Screenshots refreshed/added under
      `frontend/screenshots/` (`generate-redesign-*`).
- [ ] **Step 3: TASK.md.** Extend the `31.x` section with a dated entry: what
      shipped (hero, chips, split, chooser states), the verification counts,
      the screenshot names, and the `[!]` list verbatim from spec §2.6.
- [ ] **Step 4: Integration doc.** `docs/integrations/presenton.md` gains a
      "Model selection" subsection: the request has no model field; the
      persisted singleton + env sync mechanism; the admin gate; the two new
      UniPilot env vars; the deployment-global limit; what the chooser does in
      each deployment mode (mirroring spec §2.5).
- [ ] **Step 5: Spec status.** Mark the spec "delivered" with phase records and
      the final `[!]` state; commit everything with the T4 message (spec/plan
      may have been committed at T0 review; if not, include them here).

**Gate:** no merge/push. The controller stops after T4 with the diff summary
and evidence pointers.

---

## Final acceptance checklist

- [ ] `/tools/presentation` matches the reference shape with UniPilot tokens
      and no second sidebar.
- [ ] Prompt/format/slides/template/sources/advanced state and actions are the
      existing ones (no re-plumbing).
- [ ] The model control never shows an invented model; its state matches the
      engine's real capability on the current deployment.
- [ ] Adapter tests prove: no key material in any return value; a denied
      engine receives no write; a declared value is the only writable set.
- [ ] Template combobox + preselect contract, guest states, F1 decks list and
      the unconfigured blocked state all still pass.
- [ ] `fonts.spec.ts` green; console clean; 375/768/1280 verified; reduced
      motion respected.
- [ ] TASK.md + integration doc updated; `[!]` recorded with the exact
      dependency; nothing pushed.
