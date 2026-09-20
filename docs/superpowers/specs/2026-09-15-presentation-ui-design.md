# Native presentation experience — design

Date: 2026-09-15 · Refreshed: 2026-09-16 (post-fork learnings — §4.1–4.2)
Status: Refreshed 2026-09-16 per the founder's directive; awaiting review at
the plan gate before phase A. This refresh is the basis for the phased
implementation plan (`docs/superpowers/plans/2026-09-16-native-presentation.md`).
The interim fork UI (`presenton-ui/`, git-ignored, own repo) stays the editor
until native parity lands, then is retired; the native build replaces it
phase by phase.
Task IDs: TASK.md `31.x` (extends 31.8/31.9; leaves 31.3/31.5/31.6/31.7 as
recorded gaps — §13).
Related: `docs/integrations/presenton.md` (the service contract),
`docs/superpowers/specs/2026-09-15-presenton-fork-theme-design.md` and
`presenton-ui/DIVERGENCE.md` (what the fork proved), `DESIGN.md`, `MOTION.md`,
`AGENTS.md` (QA session, browser QA).

Provenance: read-only inventory of Presenton's Next.js frontend
(`presenton-main/servers/nextjs`), its FastAPI surface
(`presenton-main/servers/fastapi` + `openai_spec.json`), and UniPilot's current
wiring (`frontend/lib/integrations/presenton.ts`, `backend/worker/`, the
`presentations` migration, `/tools/presentation`, `/documents`, `/integrations`,
`frontend/components/motion/`). Taken 2026-09-15; refreshed 2026-09-16 with the
fork's verified runtime behaviour (`presenton-ui/DIVERGENCE.md`) and a re-check
of the exact slide/template/theme response shapes in the FastAPI models.
`presenton-main/` and `presenton-ui/` are both git-ignored; no Presenton code,
CSS, or assets are copied into this repo.

---

## 1. Summary

Replace the embedded Presenton editor and the thin tool chrome with a
UniPilot-native presentation experience: generation/setup, a deck viewer with a
thumbnail rail and a full-size slide stage, a real slide editor (inline text,
add/delete/reorder, layouts, themes, speaker notes, export), an extended editor
(drag/resize, images, icons, fonts, chat-assisted edits), a templates browser,
and history/settings mapped onto `/documents`, the tool page, and
`/integrations`.

Presenton stays the engine: a separate HTTP service behind the existing
server-only adapter (`frontend/lib/integrations/presenton.ts`), worker
(`backend/worker/presentationJobs.mjs`), job runner (`29.1`), and documents
plumbing. A saved deck stays a PPTX/PDF `documents` row with
`source='presentation'`. The native editor edits the deck's working state
through Presenton's presentation/template/theme APIs and re-exports to that
same document. No iframe is the default experience; the wrapper route survives
only as a labelled fallback for decks the native path cannot render (Smart
HTML), recorded in §14, and as the bridge to the interim fork until the native
editor phases land.

The native build sits on the existing UniPilot stack — Next 16.3.1 / React 19 /
Tailwind 4 / `motion` / Supabase SSR, the 26.x assistant-era patterns
(server-only provider boundaries, streaming route handlers, sanitized copy) and
the 29.1 job runner (§7.0) — plus the presentation plumbing already in place
(adapter, worker, tool registry, documents). No new provider wiring: provider
models/keys stay in Presenton's own environment and admin UI.

Everything is built from existing UniPilot primitives and tokens — no new
fonts, no new colors, no page-specific animation system. Native chrome is
UniPilot's (workspace shell, wordmark, Bricolage/Geist/Geist Mono, glass,
dark-first); Presenton's wordmark/logo/marketing strings never appear on a
native surface. Generated decks keep their own deck fonts and colors **inside
the stage only** (the chrome-vs-deck rule, §8.6).

## 2. Goal / non-goals

Goal:

- Full feature parity with Presenton's product surfaces that apply to a
  single-tenant, self-hosted deployment — implemented natively.
- Native rendering of Template V2 decks (the only kind UniPilot generates):
  1280×720 stage, absolute-positioned elements, deck themes/fonts scoped to
  the stage, no Presenton CSS or JS in the UniPilot page.
- Native editing with honest saves: autosave to Presenton, visible save state,
  undo/redo, and an export that replaces the deck's document.
- Clear provenance and navigation: history on the tool page, decks reachable
  from `/documents`, service status on `/integrations`.

Non-goals:

- No vendored Presenton code in UniPilot's repo, no iframe editor by default.
  The interim fork (`presenton-ui/`) is the bridge and is retired once native
  parity lands.
- No new provider wiring: providers/models/keys stay in Presenton's own admin
  UI. UniPilot never gains a provider-settings surface.
- No Presenton Cloud contact (community designs, cloud providers, device
  linking) — self-hosted base URL only.
- No outline editing, no Smart HTML decks, no custom-template studio in
  phases A–F (recorded gaps, §14).
- No multi-user/real-time collaboration; last-write-wins per deck (§7.10).

## 3. Binding rules

1. Presenton remains a service behind the existing adapter/worker/registry/
   documents plumbing; no new provider wiring.
2. A saved deck stays a PPTX/PDF document (`documents.source='presentation'`).
   The editor edits the deck's working state via Presenton's slide/template/
   theme APIs and re-exports to that document.
3. If a phase is genuinely blocked (API gap), say so and mark it — never fake
   an editor capability. An iframe may only be a temporary, labelled fallback
   for a blocked phase, recorded in TASK.md.
4. Honest states; one writer; no hosted contact.
5. DESIGN.md and MOTION.md are binding: monochrome tokens, glass recipe,
   Bricolage/Geist, the radius/elevation scales, and the shared Motion
   vocabulary (`frontend/components/motion/`, `presets.ts`). Deck content is
   user content and may carry its own fonts/colors *inside the stage only*.
6. Native chrome is UniPilot's. Presenton's wordmark, logo, splash art and
   marketing strings never appear on a native surface; the shell, wordmark and
   type system are the app's own (§8.6). The chrome-vs-deck rule is one rule:
   chrome is UniPilot, deck content is the deck.

## 4. Current state

| Piece | Today |
|---|---|
| Tool page `/tools/presentation` | Server page + `PresentationWorkspace` client: prompt, template, slides (5–30), format, one source document; polling `router.refresh()` every 4 s while queued/running; result card (Download / Edit deck / Open in Documents). |
| Editor | `/tools/presentation/[id]/edit` — `EditDeckFrame` iframe. The frame URL comes from `resolveEditorUrl`: the themed fork (`PRESENTON_UI_URL`) when set and reachable, Presenton's own editor as the honest fallback; labelled cross-origin, with "open in a new tab". |
| Adapter | `listPresentationTemplates`, `startPresentationGeneration`, `getPresentationTaskStatus` (async-tasks list workaround), `uploadPresentationSourceFile`, `downloadPresentationExport`, `presentonEditUrl`, `resolveEditorUrl`. Server-only, typed, path-guarded. |
| Worker | `presentation.generate`: start async task → poll → download export → quota guard → `documents` row (`source='presentation'`) → row `succeeded`. Retry/backoff/dead-letter via `public.jobs`. |
| DB | `public.presentations` (request + status mirror + `presenton_presentation_id` + `document_id`); `documents.source`; bucket allowlist includes PPTX. |
| History | None (only `getLatestPresentation`); `/documents` lists the file with no provenance or deck affordance. |
| Settings | `/integrations` has no Presenton card. |

Presenton's editor interior is a separate Next.js app on its own origin; it is
forked and themed locally as the interim bridge (`presenton-ui/`), and this
spec replaces the embed with native UI over phases B–D. The fork is a bridge,
not the destination: no Presenton code or assets live in this repo.

### 4.1 Post-fork runtime behaviour (verified 2026-09-15/16)

Sources: `presenton-ui/DIVERGENCE.md`, `docs/integrations/presenton.md` §3.2,
and the running stack (engine image built 2026-09-08, `PRESENTON_URL` local).
These are the learnings the native build inherits; none of them require new
UniPilot surfaces.

| Behaviour | What was verified | Native consequence |
|---|---|---|
| `/status` 500 workaround | `GET /presentation/status/{id}` and `GET /async-tasks/status/{id}` answer 500 for every task whose `data` is set (SQLAlchemy `ObjectDereferencedError`, upstream `presentation.py:3212`). The async-tasks list endpoint returns identical fields without the mutation. | The adapter and worker already resolve tasks from `GET /api/v1/async-tasks?type=presentation.generate&limit=200&order=desc` and filter by id. Native reads keep this path; revert both call sites only when upstream fixes the status route. |
| Export-through-the-engine path | `POST /api/v1/ppt/presentation/{id}/export {export_as}` answers `{presentation_id, path, edit_path}`; `path` is already app-relative — `/app_data/exports/{pdf,pptx}/<Title>_<uuid>.<ext>`. The fork delegates its export button to this endpoint and downloads through the proxy; P0 verified a 911,303-byte PDF and a valid 21-entry OOXML PPTX. | The native `presentation.export` worker job consumes the same call and the same `path` guard as the generate flow (`/app_data/` prefix + no `..`). No second export mechanism, no new formats. |
| Asset mounts (exact shape) | `/app_data/**` is FastAPI `StaticFiles` over the app-data volume: auth + owner-path checked, **except** `/app_data/fonts/**` and `/app_data/templates/**`, which the engine serves without auth. `/static/**` is FastAPI's packaged resources (icons, replaceable-image placeholders, vendored Tailwind/Chart.js for the export renderer). `/vendor/fonts/**` is served by the Next app's `public/` dir (theme font URLs such as Montserrat point there, not at FastAPI). | The native asset proxy (§6.9) must accept the three prefixes (`/app_data/`, `/static/`, `/vendor/`), keep the `..` guard and the deck-reference membership check, and gate the `/app_data/` image/export families by owner exactly as the engine does. |
| Template asset shape | Bundled `templates/<id>/template.json` carries `thumbnail: "static/…"` and other relative `static/…` URLs; at seed time they are rewritten to `/app_data/templates/<template_id>/static/…` and the files are copied to the app-data volume (`app_data/templates/<id>/static/image*.png`, `thumbnail.png`). | Template thumbnails and layout assets resolve to `/app_data/templates/**` and are safe to proxy without the per-deck scan when the deck's template id matches; still no cross-template reach. |
| userConfig / provider gate | Presenton's web UI validates provider + key **and model** (`hasValidLLMConfig`) in its settings store and otherwise redirects every app route to its setup wizard; the engine container works because `USER_CONFIG_PATH` exists, and the fork sets `PRESENTON_USER_CONFIG_PATH` read-only to satisfy the same check. | Native pages never load Presenton's UI, so the gate does not apply to them — generation and export APIs are governed by the service's own env/admin settings, not the browser gate. The gate matters only for the labelled fallback wrapper (fork/engine editor), which keeps the fork's env handling. |
| Provider output cap | `LLM_MAX_OUTPUT_TOKENS=1000` (a Groq OTPM workaround) truncated the outline call and produced a 1-slide deck; full decks need a provider/tier with a larger output budget. | Operational, not code: live-QA deck sizes depend on the configured provider. Verification may use short decks; nothing is faked. |
| Long SSE in dev | The fork's dev-server generation stream disconnected ~4–5 minutes in; the engine persisted completed slides and resumes on reload with `stream=true`. | Native generation stays on the async-task + polling path (worker), never a browser SSE stream. The phase-D chat proxy is server-to-server (adapter opens the upstream SSE; the browser gets UniPilot frames), mirroring the 26.x assistant streaming route. |
| Frozen content scope | The fork's P3 sweep froze deck-content paths (`components/slide-editor/**`, template/slide previews, export runtime, deck-preview cards carrying `slide-theme`) so chrome theming could not touch deck fonts/colors. | Evidence that the chrome-vs-deck rule is implementable exactly as written: native chrome is UniPilot; stage content stays the deck's. |

### 4.2 Exact data shapes (re-verified 2026-09-16)

Against `presenton-main/servers/fastapi`. These are the wire shapes the native
renderer and editor consume; §6 describes how they render.

- `GET /api/v1/ppt/presentation/{id}` → `PresentationWithSlides`:
  `{id, version, content, n_slides, language, title, created_at, updated_at,
  tone, verbosity, slides: SlideModel[], fonts, theme, generation_mode,
  type}`.
- `SlideModel`: `{id (uuid), layout_group, layout, index, content: dict,
  html_content?, speaker_note?, properties?, ui?}` — `ui` is
  `{components: [{id, description, position: {x, y}, elements: [SlideElement]}]}`.
- `TemplateV2` (`GET /template/{id}`): `{id, name, description,
  layouts: {layouts: [{id, description, components}]}, theme, fonts,
  merged_components, is_default, assets?}` with
  `theme = {colors: {primary, background, card, stroke, background_text,
  primary_text, graph_0…graph_9}, fonts: {textFont: {name, url}}}`.
- Element discriminator `type`: `text`, `text-list`, `image`, `table`,
  `vector`, `chart`, `infographic`, `container`, `flex`, `grid`, `group`
  (measured counts in §6.2).

## 5. Presenton UI inventory — screen/feature matrix

### 5.1 Matrix

| # | Presenton surface (route) | What it does | UniPilot treatment | Phase |
|---|---|---|---|---|
| 1 | Auth gate / onboarding | Admin setup/sign-in, role split, provider onboarding wizard | Not surfaced — Presenton auth is service-level (`PRESENTON_API_KEY` bearer or `DISABLE_AUTH` single-user). UniPilot keeps its own auth; guests see the existing sign-in prompt. | — |
| 2 | Generate `/upload` | Prompt + attachments (8 files, many types), slide count (Auto/5/8–20/custom ≤ 50), language (~100, auto), advanced (instructions, tone ×6, verbosity ×3, TOC, title slide), Standard/Smart mode, provider pill, preflight | Native form on `/tools/presentation` (§5.2). Smart mode and non-document attachment types deferred. | A |
| 3 | Outline `/outline` | Template selection (built-in/custom cards + suggested), streamed outline, inline markdown edit, add/delete/reorder (≤ 50 slides, ≤ 100 words), AI outline chat, regenerate, Continue | Not in A–F. Requires the create → outlines → prepare → stream pipeline instead of the current one-shot async job. Recorded gap (§14; settled out — §13). | — |
| 4 | Deck editor `/presentation?id=…` | Header (rename, regenerate, undo/redo, present, shortcuts, export PDF/PPTX, autosave indicator), 165 px thumbnail rail (drag reorder, add slides + layout chooser), canvas editor (full element editing, toolbars, palette), slide actions (duplicate/move/delete, notes), AI chat panel, streaming generation overlay, present mode | Native viewer (B), native core editor (C), extended parity (D). Streaming overlay not needed natively (worker owns generation; viewer reads the finished deck). | B/C/D |
| 5 | Present mode (`mode=present`) | Fullscreen 1280×720 stage, auto-hiding chrome, progress, prev/next, layout grid, speaker notes panel, keyboard (←→↑↓ Space PageUp/Down Home End F G N Esc), click zones | Native inside the viewer route (B). | B |
| 6 | Dashboard `/dashboard` | Decks grid/list with first-slide previews, type badge, slide count, open, rename, duplicate, delete, blank presentation, legacy table | Tool-page history list (F). Duplicate/delete actions: §10-F. Legacy v1 decks: not supported. | F |
| 7 | Templates `/templates` | Built-in/Custom tabs, cards (thumbnail, name, layout count), custom creation entry, async task polling | Native browser + preview (E). Custom template creation deferred (§14). | E |
| 8 | Template preview `/template-preview` | Read-only built-ins, editable customs: layouts panel, slide id/description, element editing, undo/redo, save, delete, copy id, AI layout generation, content-density preview | Read-only native preview (E) using the viewer renderer. Editing custom templates deferred. | E |
| 9 | Custom template studio `/custom-template` | 6-step wizard: upload PPTX → font check → font upload → slide previews → schema editor → create; progress + retry | Deferred (TASK 31.5–31.7). Presenton's own UI remains the tool for this. | — |
| 10 | Settings `/settings` | 17 text providers + Codex OAuth + Ollama, 10 image providers, 6 web-search providers, privacy/analytics, admin (users, API keys), sign out | `/integrations` card: status only (configured/reachable/unreachable), link to the tool; provider admins use Presenton directly. No keys or provider fields in UniPilot. | F |
| 11 | Admin `/admin` | Users + API keys (server-gated) | Not surfaced (service administration, not student UX). | — |
| 12 | Export (header popover, `/pdf-maker`) | PDF/PPTX; headless Puppeteer render; per-user export files; ownership-checked download | Worker job `presentation.export` re-exporting into the same document (C). No new formats. | C |
| 13 | AI chat (`/chat/*`) | Conversations, streaming, quick prompts, context tags (slide/selection), follow mode, attachments, per-message edit review ("Select edits", restore original/modified) | Native chat panel (D) through a UniPilot streaming proxy. Attachments from UniPilot documents. Edit-review model: adopt only for slide mutations where the diff is representable; otherwise honest "changes applied" + undo. | D |
| 14 | Splash / 404 / legacy preview routes | Presenton internal | Not applicable. UniPilot uses its own loading/error/empty primitives. | — |

### 5.2 Generation/setup detail (Phase A scope)

Presenton's `/upload` fields and which UniPilot will carry:

| Presenton field | UniPilot today | Phase A |
|---|---|---|
| Prompt (Ctrl/Cmd+Enter submits) | ✓ `Textarea` | Keep |
| Supporting documents (drag/drop, ≤ 8 files, many types) | one document, PDF/DOCX | Up to 8 existing UniPilot documents (PDF/DOCX) — the documents vocabulary bounds this; other types recorded as a gap |
| Slide count (Auto / 5 / 8–20 / custom ≤ 50) | 5–30 fixed options | Keep 5–30 (UI bounds); worker/adapter allow 1–50 and stay |
| Language (~100 + Auto) | — | Add `Select` (auto default), passed through |
| Instructions | — | Add (bounded, 2000 chars like the adapter constant) |
| Tone (6 values) | — | Add |
| Verbosity (3 values) | — | Add |
| Include TOC / title slide | — | Add two toggle controls |
| Web search | — | Excluded in A (provider-dependent; provider config stays Presenton-side — settled out, §13) |
| Standard / Smart mode | — | Standard only (UniPilot generates v2-standard) |
| Template | ✓ picker from `GET /template/all` | Keep; E deepens it |
| Format pptx/pdf | ✓ | Keep |
| Provider pill / preflight | — | Not surfaced; `/integrations` shows reachability (F) |

New `presentations` request columns for A: `language`, `instructions`, `tone`,
`verbosity`, `include_table_of_contents`, `include_title_slide` (all
nullable/defaulted; `source_document_id` becomes `source_document_ids uuid[]` —
see D9 and §7.9, the migration list).

### 5.3 Outline (recorded, deferred)

Presenton's outline step is a distinct product flow (create row → stream
outline → edit slides markdown → pick template on the outline screen →
`prepare` → stream slide generation). UniPilot's one-shot `generate/async`
skips it. Bringing outline editing in means switching the worker's pipeline and
adding a streamed editing surface; that is a separate spec. TASK.md 31.3 stays
open (settled out for this program — §13).

### 5.4 Editor operations inventory (Phases B–D scope)

| Operation | Presenton behaviour | Native plan |
|---|---|---|
| Open deck | `GET /presentation/{id}`; unsupported v1 → dashboard | B |
| Thumbnail rail | 165 px rail, slide numbers, lazy near-viewport thumbnails, selected border | B |
| Slide navigation | arrows in editor; present-mode keys | B/C |
| Add slide | Blank or "Use Template +" layout chooser modal | C |
| Copy slide content from layout | Konva editor / Redux `updateSlideUi` | C via hydration module (§7.6) |
| Delete / duplicate / move | Slide action menu; last slide delete falls back to blank | C |
| Reorder | drag in rail; persisted with the full slide array | C |
| Rename deck | inline title, autosave | C |
| Inline text | Tiptap overlay: family, size, bold/italic/underline, color, alignment, opacity, letter spacing, line height, list markers | C (plain text, run-preserving) → D (rich runs) |
| Speaker notes | popover; persisted via slide update | C |
| Undo / redo | snapshots (≤ 30), Mod+Z / Mod+Shift+Z / Mod+Y | C (client snapshots) |
| Theme | template theme + custom themes; CSS vars on the wrapper | C (template theme + custom list; theme *creation* deferred) |
| Layout change | layout chooser (new slides); per-slide layout swap | C |
| Export | PDF/PPTX popover; headless render | C |
| Present | fullscreen, keys, grid, notes | B |
| Drag / resize / rotate | Konva handles, multi-select, snapping | D |
| Z-order / group / ungroup | Alt+J/K, Mod+G | D |
| Copy / paste / duplicate | custom MIME + localStorage fallback | D (in-app paste; OS clipboard best-effort) |
| Element toolbars | text/bullets/image/shape/line/chart/table/container/flex-grid | D |
| Images | search (Pexels/Pixabay), AI generate, upload, generated/uploaded library, fit/cover/fill, crop window, flips, opacity, radius | D |
| Icons | search, type/weight, recolor, apply-to-deck | D |
| Charts | 12 types + data editor | D (renderer in B; editor in D) |
| Tables | cell editing | D |
| Infographics | 27 types, insert from palette | D — insertion limited to the types the renderer implements; others recorded (§6.7) |
| Blocks | template components/variants insertion | D (template layouts)
| Design variables | theme fonts/colors toolbar | D (theme-level only) |
| Smart HTML edit | contenteditable spans, media replace, select-to-edit | Excluded (§6.10) |
| AI chat edits | conversations, streaming, edit review | D |

### 5.5 Templates detail

`GET /template/all` (built-in + custom, paginated) and `GET /template/{id}`
(layouts, theme, fonts) are the whole API a native browser needs. Bundled
templates and layout counts: general 12, modern 10, standard 11, swift 9,
editorial 24, verdant 27, momentum 28, dynamic 32, executive 32, mosaic 34.

### 5.6 History / settings / admin detail

History (Presenton `/dashboard`): decks with first-slide previews, type badge,
slide count, open/duplicate/delete, blank deck, legacy table.
Native: §9. Settings/admin: service-side only (§5.1 rows 10–11).

### 5.7 Smart mode

Presenton has two generation modes. UniPilot's worker uses the standard
(`v2-standard`) path; Smart decks store freeform HTML (`html_content`) that
depends on Presenton's Tailwind browser runtime and Chart.js injection.
Native rendering of Smart HTML is out of scope — a Smart deck opened in the
native viewer shows an honest "not supported natively" state with the wrapper
route as a labelled fallback (D7). UniPilot never generates Smart decks today.

## 6. Slide representation and native rendering

### 6.1 Template V2 model (exact shapes)

Read-only source of truth: `presenton-main/servers/fastapi` (exact response
fields re-verified 2026-09-16 — §4.2).

A deck is a row in `presentations` + one `slides` row per slide. A slide
carries:

- `id` (uuid) — rotated by Presenton's `/slide/edit` endpoints; stable through
  `/presentation/slide_update`.
- `layout_group` (template id, e.g. `"general"`; `"blank"` for blank decks),
  `layout` (layout id within the template, e.g. `"title_intro"`;
  `"__blank_slide__"` for blank).
- `index` (0-based order).
- `content` — generated values keyed by element/component `name`.
- `ui` — **what is rendered**: `{"components": [{"id", "description",
  "position": {x, y}, "elements": [SlideElement…]}]}`. Elements are absolutely
  positioned inside their component's frame (`component.position` offsets the
  whole component). `ui` is produced by hydrating the template layout with
  `content`.
- `html_content` — Smart only. `speaker_note`, `properties` (legacy, required
  in request bodies).

A template row (`TemplateV2`) stores `layouts` (`{"layouts": [{id,
description, components: [...]}]}`), `theme` (`{colors: {primary, background,
card, stroke, background_text, primary_text, graph_0…graph_9}, fonts:
{textFont: {name, url}}}`), `fonts` (`{family: url}`) and `merged_components`.

Element types (`templates/v2/models/elements.py` discriminator `type`):

`text` (with `runs`), `text-list`, `image`, `table`, `vector`, `chart`,
`infographic`, `container`, `flex`, `grid`, `group`.

### 6.2 Element types in real decks (measured)

Counted across the ten bundled templates (`presenton-main/templates/*/template.json`):

| Type | Count | Notes |
|---|---|---|
| `text` | 3592 | runs with per-run font/size/color |
| `image` | 1796 | `data` = URL/path; `fit` contain/cover/fill, crop (`focus_x/y`, `crop_scale`), radius, `is_icon` |
| `group` | 1244 | children positioned relative |
| `vector` | 984 | polygons/ellipses, fill/stroke/dash/shadow |
| `flex` | 780 | direction/wrap/align/justify/gap |
| `container` | 370 | single-child wrapper |
| `chart` | 132 | nine `chart_type` values appear: bar 42, line 36, pie 14, horizontal_bar 12, donut 10, area 6, stacked_bar 6, scatter 4, horizontal_stacked_bar 2 (the engine enum defines 11 — `radar` and `polar_area` exist but appear in no bundled template — verified 2026-09-16 against `templates/v2/models/elements.py`) |
| `grid` | 78 | columns/rows/gaps |
| `infographic` | 42 | only three `data.type` values appear: gauge 22, progress_bar 16, vertical_funnel 4 (enum defines 27) |
| `text-list` | 6 | marker/gap/items |
| `table` | 10 | columns/rows of cell runs |

So a renderer for **text, text-list, table, image, vector, container, flex,
grid, group, chart (9+ types), infographic (3 types)** covers every element
that exists in every bundled template. That is the Phase B target.

### 6.3 Stage and coordinate model

Fixed 1280×720 canvas (`SlideScale` in Presenton). Native plan: a `DeckStage`
component renders a 1280×720 absolutely positioned div; a wrapper applies
`transform: scale(fit)` to the viewport (viewer: fit to width; present mode:
fit to screen; editor: fit with zoom later). Coordinates are element
`position` + component `position`, in stage pixels. No responsive reflow inside
the stage — the deck is a fixed canvas by design.

### 6.4 Text, runs, lists, tables

Render `runs` as inline spans (`TextRun` + `LatexTextRun` — LaTeX math is
unsupported natively; record as a gap and render the raw run honestly). Text
blocks use the element's `font` (family/size/weight/style/color/line-height/
letter-spacing), `alignment`, `fill`, `stroke`, `shadow`. `text-list` renders
marker + items; `table` renders cells as run containers. Editing (C) starts
with plain-text replacement per text element, preserving the first run's
style; full run formatting is D.

### 6.5 Images, icons, vectors

- Images: `data` is a path/URL. Render with `fit`/`focus`/`crop_scale`/
  `border_radius`/`clip_path`. Icon elements are images with `is_icon: true`
  (recolor via CSS filter/SVG fetch; Presenton uses a server SVG recolor
  route — native approach: fetch the SVG through the asset proxy and recolor
  client-side; D).
- Vectors: render `points`/`closed`/`curve` as SVG paths with fill/stroke/
  dash/shadow — no canvas needed.
- Fonts: deck fonts load through the asset proxy as `@font-face` declared
  **inside the stage container scope only** (namespaced family names). Deck
  fonts are document content; UniPilot chrome keeps Geist/Geist Mono/
  Bricolage (fonts.spec.ts stays green).

### 6.6 Charts

Chart data is fully server-side (`chart_type`, `categories`, `series`,
`colors`, axis/grid options, `data_labels`). Native rendering needs a chart
engine. Options: (a) Chart.js 4 + `chartjs-plugin-datalabels` — same engine
family Presenton uses, highest parity, one new frontend dependency; (b) a
custom SVG chart renderer — no dependency, more work, parity risk on
scatter/stacked/area. **Recommendation: Chart.js** (decision D5, question Q1).

### 6.7 Infographics

The enum defines 27 types; bundled templates use `progress_bar`, `gauge`,
`vertical_funnel`. Phase B implements those three natively; any other type
renders an honest placeholder that preserves the element's frame and shows
"Infographic type not yet rendered" (never a fake chart). Extending coverage is
demand-driven in D.

### 6.8 Theme and fonts

Deck theme = colors + one text font (`fonts.textFont`) applied as CSS variables
on the stage (the stage, not the page). Template themes come from
`GET /template/{id}/theme`; decks can carry their own `theme` object. Because
of the upstream update bug (§7.5) every `PATCH /presentation/update` must send
the current theme explicitly.

### 6.9 Assets — the proxy problem

Slide assets live on Presenton. Verified mounts (2026-09-16, §4.1):

- `/app_data/**` — FastAPI `StaticFiles` over the app-data volume. Auth +
  owner-path checked, **except** `/app_data/fonts/**` and
  `/app_data/templates/**`, which are public prefixes on the engine.
- `/static/**` — FastAPI's packaged resources: icons, replaceable-image
  placeholders, vendored Tailwind/Chart.js used by the export renderer.
- `/vendor/fonts/**` — served by the Next app's `public/` dir (theme font URLs,
  e.g. Montserrat, point here, not at FastAPI).
- Template assets: `template.json` `static/…` URLs are rewritten at seed time
  to `/app_data/templates/<template_id>/static/…` (thumbnail included).
- Deck slide images: `/app_data/images/**`; generated deck fonts:
  `/app_data/fonts/**`.

Browsers cannot send the adapter's bearer token for `<img>`/`@font-face`, and
per-user scoping must not leak across UniPilot accounts sharing one Presenton
instance.

Design: **one owner-gated asset proxy** —
`GET /api/presentation/[id]/asset?src=<path>`:

1. Session user must own presentation `id` (RLS read).
2. The deck is loaded server-side. Every **user-data** path
   (`/app_data/images|uploads|exports|pptx-to-*/**`) must be referenced by the
   deck (scan `ui`, `content`, `html_content`, `theme`, `fonts`) — not merely
   allowlisted. `/app_data/templates/<template_id>/…` must match the deck's
   template id (`layout_group`). The engine-public assets
   `/app_data/fonts/**`, `/static/**`, `/vendor/**` pass with the traversal
   guard alone — they carry no user data and the engine mounts them publicly,
   an explicit, recorded relaxation of the scan rule.
3. The proxy fetches from Presenton with the adapter's auth, enforces the
   `/app_data/`, `/static/`, `/vendor/` prefix allowlist plus the no-`..` guard,
   and streams bytes back with a private cache header and the correct content
   type.

Template assets (public on Presenton) use the same route with the deck's
template id as the check. This removes CORS/mixed-origin concerns and keeps
`PRESENTON_PUBLIC_URL` unnecessary for the native path.

### 6.10 Smart HTML decks

Excluded from native rendering (D7). Smart slides are HTML strings that rely
on Presenton's Tailwind browser runtime and chart injection; rendering them
natively would mean shipping Presenton's JS/CSS. Native routes detect
`html_content` and show a labelled fallback state with a link to the wrapper
route (which itself remains as the record of the old mechanism).

### 6.11 What “no Presenton CSS” means concretely

- No Presenton stylesheet, script, or component is loaded by UniPilot pages.
- The only Presenton bytes in a native page are **content assets** (images,
  icons, deck fonts) streamed through the proxy, plus deck JSON from the API.
- Deck colors/fonts are applied only inside the stage container.
- All chrome is UniPilot components/tokens; all animation is the shared Motion
  system.

## 7. Architecture

### 7.0 Stack and plumbing (reused — nothing new is introduced)

- Frontend: Next 16.3.1, React 19.2.8, Tailwind 4, `motion ^13.1.1`, Supabase
  SSR (`frontend/package.json`). Native pages are server components inside
  `(app)`; interactivity is client components; all animation is the shared
  Motion system.
- Presenton access: the server-only adapter
  `frontend/lib/integrations/presenton.ts` + `presentonConfig.ts` — the only
  module that speaks Presenton HTTP. Extended in place; no second client.
- Data: `frontend/lib/data/presentations.ts` (owner-RLS reads via the
  request-scoped client, service-role writes), `presentationValues.ts` (parser
  + display contract), `presentationActions.ts` (Server Actions),
  `presentationErrors.ts` (sanitized copy).
- Jobs: `frontend/lib/data/jobs.ts` enqueue → `public.jobs` →
  `backend/worker/run.mjs` (29.1) → `presentationJobs.mjs` (+
  `heartbeat.mjs`'s `touch_job` lease).
- Streaming precedent: `frontend/app/api/assistant/turn/route.ts` (26.8) — the
  session-gated ReadableStream SSE route the phase-D chat proxy mirrors.
- Registry: `frontend/components/tools/toolCatalog.ts` — the presentation
  tool's status/destination stays the single source of truth there.
- Documents: `public.documents` + the private `documents` bucket + the
  `/documents` surfaces (unchanged).
- DB: `backend/supabase/migrations/20260914100000_presentation_generator.sql`;
  the Phase-A/C columns (§7.9) are additive migrations on top.
- No new provider wiring: providers/models/keys stay in Presenton's env and
  admin UI. UniPilot never learns a provider name.

### 7.1 Diagram

```
Browser (UniPilot native UI)
  │  server components read decks via owner-RLS page + adapter
  │  Server Actions mutate (create/rename/export request/delete)
  │  POST/GET route handlers: asset proxy, chat stream passthrough
  ▼
UniPilot server (server-only)
  ├─ frontend/lib/integrations/presenton.ts   (extended adapter, bearer key)
  ├─ frontend/lib/presentation/*              (hydration, diffing, guards)
  └─ Server Actions / Route Handlers          (session-gated, sanitized errors)
  ▼ HTTP
Presenton (separate service, PRESENTON_URL)
  ├─ /api/v1/ppt/presentation/*   GET deck, PATCH update/slide_update, export
  ├─ /api/v1/ppt/template/*       list/get/theme/layouts
  ├─ /api/v1/ppt/images|icons|fonts|chat/*
  └─ /app_data|/static|/vendor    asset bytes (proxied)
  ▲
UniPilot worker (backend/worker)
  ├─ presentation.generate  (unchanged)
  └─ presentation.export    (new: re-export into the same document)
  ▼
Supabase: public.presentations (status mirror) · public.jobs · documents bucket
```

### 7.2 Server-mediated access (D2)

The browser never holds `PRESENTON_URL`/`PRESENTON_API_KEY` and never calls
Presenton directly. Reads happen in server components or Server Actions; all
mutations are Server Actions; the two streaming/asset cases are Node route
handlers. The adapter grows the editor surface (deck read, slide update,
presentation update, images/icons/templates/themes, chat, export request) with
the same guard/error vocabulary it has today.

### 7.3 Reads

| Need | Call |
|---|---|
| Deck (slides, theme, fonts, type) | `GET /api/v1/ppt/presentation/{id}` |
| Template layouts/theme/fonts | `GET /api/v1/ppt/template/{template_id}` and `/template/{template_id}/theme` |
| Template list | `GET /api/v1/ppt/template/all?default=…` |
| Custom themes | `GET /api/v1/ppt/themes/all` |
| Deck list (history) | `public.presentations` (RLS), not Presenton |

### 7.4 Writes — mutation map

| Native capability | Presenton call | Notes |
|---|---|---|
| Rename deck | `PATCH /api/v1/ppt/presentation/update` `{id, title, theme}` | Always include the current theme (upstream bug nulls it otherwise) |
| Text edit / notes / single-side layout / element property | `PATCH /api/v1/ppt/presentation/slide_update` `{slide}` | Send the full slide from the loaded deck with the field changed; `id/presentation/index` ignored; no id rotation |
| Add / delete / duplicate / reorder | `PATCH /api/v1/ppt/presentation/update` `{id, slides: […]}` | Server deletes and re-inserts all slides; send the whole array, `theme` included, every slide with `properties` (nullable) |
| Layout choose for new slide | hydration module (§7.6) + `slide_update` | No API for content→ui |
| Per-slide layout swap | hydration module + `slide_update` | Preserve compatible content; unmapped elements fall back honestly |
| Theme change | `PATCH /api/v1/ppt/presentation/update` `{id, theme}` | Theme object from template/custom list |
| Image search/generate/upload | `GET /images/search`, `GET /images/generate?prompt=`, `POST /images/upload`, `GET /images/generated|uploaded`, `DELETE /images/{id}` | Then set element `data` via `slide_update` |
| Icon search | `GET /api/v1/ppt/icons/search` | Then set `data`/`is_icon`/`color` |
| Chart / table / infographic data | `slide_update` | Native editors write the element JSON |
| Chat edit | `POST /api/v1/ppt/chat/message/stream` (SSE) | Proxied; non-stream fallback `POST /chat/message` |
| Export | `POST /api/v1/ppt/presentation/{id}/export` `{export_as}` | Worker job; replaces the document |
| Templates | read-only in E | |
| Delete deck | `DELETE /api/v1/ppt/presentation/{id}` | Also removes the UniPilot row/artifact per F policy |

Not used: `/slide/edit`, `/slide/edit-html` (rotate slide ids; chat tools cover
AI edits), `presentation/derive`, `presentation/edit` (purpose-built for the
legacy pipeline).

### 7.5 Structural writes (the full-array PATCH)

- Every structural change sends the complete `slides` array; each slide must
  include `id`, `layout_group`, `layout`, `index`, `content`, `properties`
  (nullable) — plus `ui`/`html_content`/`speaker_note` as-is.
- The deck is fetched immediately before a structural write; the write is
  rejected client-side if the loaded revision is stale (see autosave below).
- Always send `theme` (the upstream `if theme or theme is None` bug nulls a
  missing theme).

### 7.6 Hydration module (content + layout → ui)

`frontend/lib/presentation/hydrateSlide.ts` (server-safe, pure): given a
template layout's components, existing `content`, and the deck theme, produce
the `ui` object for a new or re-laid-out slide by placing content values into
elements by `name` (`decorative === false`), preserving component positions and
decorative elements. This mirrors Presenton's documented merge semantics
(`_apply_template_content_to_ui` / `_apply_template_content_to_element`), not
its code. Verified with fixture tests (layout + content → expected ui) and, in
Phase C, by comparing a native-produced slide against one produced by Presenton
for the same request.

### 7.7 Export / re-export

New job kind `presentation.export` (payload `{presentationId}`) handled by
`backend/worker/presentationJobs.mjs` or a sibling module:

1. Read the row; require `presenton_presentation_id` and `document_id`.
2. `POST /presentation/{id}/export {export_as}` → `{presentation_id, path,
   edit_path}`; `path` is app-relative
   (`/app_data/exports/{pdf,pptx}/<Title>_<uuid>.<ext>` — verified on the
   current image, §4.1). The fork's delegated export proved this route
   end-to-end (P0: PDF 911,303 bytes; PPTX valid 21-entry OOXML).
3. Download bytes with the existing guards (≤ 25 MiB, mime by extension).
4. Replace the existing document: upload to the same `storage_path`
   (upsert), update `documents` (`name`, `size_bytes`, `mime_type`,
   `updated_at`). One deck → one document; no version history (D9).

UI mirror: new `presentations` columns `export_status`
(`queued|running|succeeded|failed|null`), `export_error_message` (sanitized),
`exported_at`; the editor polls the row with the existing
`router.refresh()` pattern and disables Export while saving/exporting.

### 7.8 Streaming proxy (chat)

`POST /api/presentation/[id]/chat` (Node route handler): session-gated,
ownership-checked, adapter opens Presenton's SSE with the bearer key and pipes
frames to the browser as-is; the client parses `chunk`/`status`/`trace`/
`complete`/`error`. No timeout truncation; abort propagates. This also sidesteps
Presenton's cookie-only EventSource limitation. The route follows the 26.8
precedent (`frontend/app/api/assistant/turn/route.ts`): session gate →
onboarding gate → `ReadableStream` of SSE frames → sanitized error frame;
no frame carries provider or database internals.

### 7.9 Data model changes (migrations, one per phase that needs them)

Phase A (`presentations` request fields):

- `language text`, `instructions text`, `tone text` (check vocabulary),
  `verbosity text` (check), `include_table_of_contents boolean not null
  default false`, `include_title_slide boolean not null default true`
  (true preserves current decks: the service's own default is true and
  UniPilot will now always send the boolean explicitly),
  `web_search boolean not null default false`.
- Replace `source_document_id` with `source_document_ids uuid[]` (D9). Postgres
  cannot FK an array element, so every id is re-validated in the Server Action
  and the worker (ownership + MIME) exactly as the scalar column is today; the
  `document:` embed used by `getPresentation` keys off `document_id` and is
  unaffected.

Phase C (`export` mirror): `export_status text` (check),
`export_error_message text`, `exported_at timestamptz`.

No slide state is stored in UniPilot (D3). `documents` is unchanged apart from
the re-export update path.

### 7.10 One writer

- Generation: worker only; UI mirrors status. Unchanged.
- Editing: the browser only via Server Actions; Server Actions only via the
  adapter; no direct Presenton writes from the client.
- Export: worker only; the UI never downloads-and-stores directly.
- Autosave: debounced (2 s) diff against the last acknowledged deck snapshot;
  text/notes → `slide_update`; structural → full-array `update`; UI shows
  Saving/Saved/Error. Two open tabs are last-write-wins (recorded); no
  collaborative editing.

### 7.11 Honest capability matrix

| Capability | State | Where recorded |
|---|---|---|
| v2-standard deck read + render (all element types in bundled templates) | Planned (B) | §6 |
| Smart HTML decks | Not native — labelled fallback | §6.10, D7 |
| LaTeX runs in text | Gap — raw run rendered | §6.4 |
| 24 of 27 infographic types | Gap — honest placeholder | §6.7 |
| Custom template editing/creation (TASK 31.5–31.7) | Out of A–F | §14 |
| Outline editing (TASK 31.3) | Out of A–F | §5.3, §13 |
| Theme creation (custom palettes) | Out of C–F | §5.4, §13 |
| Web search at generate time | Out of A | §13 |
| Non-document source attachment types | Gap (documents vocabulary) | §5.2 |
| Multi-tab / multi-user editing | Out of scope (last-write-wins) | §7.10 |

## 8. UniPilot-native mapping (DESIGN.md + MOTION.md)

### 8.1 Routes and shell

| Route | Purpose | Built as |
|---|---|---|
| `/tools/presentation` | Setup/generate + result + history list | Existing PageHeader/Container shell; form and result stay; add `Collapsible` advanced settings and a history list (F) |
| `/tools/presentation/[id]` | Native viewer (+ present mode) | Server page → client `DeckViewer` |
| `/tools/presentation/[id]/edit` | Native editor | Existing route, iframe replaced by `DeckEditor`; wrapper retained as labelled fallback |
| `/tools/presentation/templates` | Native browser | Server page → client `TemplatesBrowser` |
| `/tools/presentation/templates/[templateId]` | Native template preview | Static segment wins over `[id]`; read-only renderer |

All inside `(app)` → `RouteTransition` automatic; `PageHeader` slot 0; sections
at `motionIndex(1..n)` with `data-enter`.

### 8.2 Component mapping

| Presenton surface | UniPilot primitives |
|---|---|
| Generate form, advanced settings | `Card bg-glass`, `Textarea`, `Input`, `Select`, `Collapsible variant="scale"`, `Button`, `SignInAction` for guests |
| Progress | Existing determinate rail (`railFillVariants` tokens) + `MotionNotice` |
| Result card | `MotionRevealGroup` + `MotionRevealItem variant="scale"`, `Button`, `ButtonLink`, `WorkspaceAction` |
| Thumbnail rail | `Card` glass rail; slides as `MotionListItem` in `AnimatePresence`; numbers in `font-mono text-label-sm`; selection ring `MotionSelectionRing` (`layoutId="deck-thumb"`, `radiusClass="rounded-nested"`) |
| Slide stage | `DeckStage` (new, built from plain DOM/SVG; no card/shell styling leaks in); chrome around it uses `Card`/`Divider`/`IconButton` |
| Editor panels (inspector, AI chat, palette) | `MotionPopover` (side panels: `direction`/`origin` per trigger), `Card bg-glass`, `Collapsible` for option groups |
| Element toolbars | `MotionPopover`, `IconButton`, `Divider`, `Select`, `Input` |
| Element palette | `Card bg-glass`, `Select`/filter `Input`, `Button` grid; groups via `Collapsible` |
| Slide/layer selection | `MotionSelectionRing` with its own `layoutId`; hover/selection fills per DESIGN.md two-level active state |
| Charts/infographics/images (content) | Rendered inside the stage by the deck renderer (content, not chrome) |
| Save/export status | `MotionNotice` + inline status word; export button `press-feedback` |
| Deck/template cards | `Card`, `MotionRevealItem`/`MotionListItem`, `Badge` (provenance/type), `EmptyState` |
| Destructive actions (delete deck) | `Modal` + `Button variant="destructive"` (Tasks pattern) |
| History list | `MotionListItem`, `Divider`, mono metadata, `WorkspaceAction` links |
| `/integrations` Presenton card | `IntegrationCard` pattern (Badge, mono status line, `Divider`, non-interactive content), `MotionNotice` for errors |

### 8.3 Motion mapping

Exactly the MOTION.md “Future tool pages” table: route entry `RouteTransition`;
result `MotionRevealGroup`/`MotionRevealItem`; slide set changes
`MotionListItem` in `AnimatePresence`; panels/toolbars `MotionPopover`;
slide/element selection `MotionSelectionRing`; advanced settings `Collapsible`;
errors/status `MotionNotice`; button feedback `press-feedback`/`icon-turn`/
`action-arrow`. Reduced motion: all primitives already honour it; no new
durations or easings; nothing animates layout properties; animation never
controls content existence.

### 8.4 Prohibitions honoured

No new fonts (deck fonts are stage-scoped content), no new colors (deck theme
colors are stage-scoped content; chrome stays monochrome), no new radius or
shadow values, no new motion system, no `bg-dotted-surface` outside `Modal`
panels, Lucide icons only, sanitized copy only.

### 8.5 Accessibility

Stage canvases are `role="group"` with an aria-label per slide; the thumbnail
rail is a `listbox`/`tablist`-style control with arrow-key navigation; inline
editing uses native `contenteditable` with focus management and Escape/Tab
semantics; present mode supports the keyboard set and traps focus; all
toolbars are focusable and dismiss with Escape; drag interactions have
keyboard equivalents (move slide up/down at minimum) — matching the Tasks
board precedent.

### 8.6 Branding (chrome is UniPilot's; deck content is the deck's)

- Native presentation surfaces are UniPilot's throughout: the workspace shell,
  the wordmark (Rocket in the primary badge + "UniPilot"), Bricolage/Geist/
  Geist Mono, glass, dark-first, the shared Motion vocabulary. No Presenton
  wordmark, logo, splash art or marketing string appears anywhere in native
  chrome.
- Generated deck content keeps its own deck fonts and colors **inside the
  stage only** — the same rule the fork's frozen content scope encodes
  (`presenton-ui/DIVERGENCE.md`).
- The interim fork's chrome carries UniPilot's mark (recorded in
  `presenton-ui/DIVERGENCE.md`) so the current editor reads correctly until the
  native build replaces it. Upstream's LICENSE/NOTICE stay in the fork.

## 9. Mapping onto existing UniPilot surfaces

- **History → `/documents` + the tool page.** The tool page gains a “My decks”
  list backed by `public.presentations` (RLS): status, template, slide count,
  updated time, and actions Open (viewer), Edit, Download/Open in Documents.
  `/documents` gains a provenance `Badge` for `source='presentation'` rows and
  an “Open deck” action (requires selecting `source` and joining the
  presentation by `document_id`). Deck files remain ordinary documents for
  preview/download; the viewer is the deck-native surface.
- **Settings → `/integrations`.** A Presenton card shows configured status and
  reachability (server-side probe, cached, honest offline state), the tool
  link, and a one-line note that provider/model configuration lives in
  Presenton's own admin UI. No keys, no provider forms, no admin proxying.
- **Editor entry points.** Result card “Edit deck”, history rows, and the
  `/documents` action all link to `/tools/presentation/[id]/edit` (native once
  C lands; wrapper only for the fallback case).

## 10. Phases A–F

Each phase is independently verifiable, ships its own tests, and uses real
Chromium evidence via the browser-qa skill (dev server, real clicks, console/
network checks, 375/768/1280 screenshots into `frontend/screenshots/`,
`fonts.spec.ts` green). Repository commits happen only when the founder asks.

### A. Generate/setup + result

- Form parity per §5.2; `Collapsible` advanced settings; up to 8 source
  documents; new request columns; parser/action/adapter/worker pass-through
  with the existing bounds and vocabulary checks; result card unchanged except
  it will link to the native viewer once B exists.
- Out of scope: outline, Smart mode, web search, non-document attachments.
- Verification: unit-style parser tests + the existing
  `frontend/tests/qa/presentations-jobs.spec.ts` extended for the new payload;
  Chromium render checks including the honest unconfigured state; a real
  generation run where a provider is available (recording provider-dependent
  results as operational evidence, not a fake).

### B. Deck viewer

- `/tools/presentation/[id]`: server reads deck + template; `DeckStage`,
  thumbnail rail, navigation, keyboard, slide counter, notes availability;
  present mode (fullscreen, keys, grid, notes, click zones); asset proxy;
  native renderer v1 per §6 (all types in §6.2, Chart.js per D5, three
  infographics + honest placeholder); Smart deck detector with labelled
  fallback link.
- Verification: renderer fixture tests from synthetic element JSON; Chromium
  against a real generated deck (QA identity, local Presenton) with
  pixel/vision checks and screenshots; asset proxy ownership tests; console
  clean at three widths.

### C. Core editor

- Native editor at the existing edit route: open deck, inline text edit
  (run-preserving), add/duplicate/delete/reorder, layout chooser (hydration),
  theme picker, speaker notes, rename, autosave with visible state, undo/redo,
  export to the same document (worker job + export columns), stale-deck guard.
  Iframe becomes the labelled fallback only.
- Verification: hydration fixture tests; adapter mutation tests (guards, theme
  inclusion, required fields); end-to-end QA: edit → save → reload persists;
  reorder → reload persists; export replaces the document (same document id,
  new size); Chromium evidence per interaction; reduced-motion pass.

### D. Full editor parity

- Drag/resize/rotate, multi-select, z-order, group/ungroup, copy/paste,
  element toolbars, images (search/generate/upload/library/crop/fit), icons
  (search/recolor), charts/tables editors, block insertion, richer text runs,
  chat-assisted edits via the streaming proxy with conversations and edit
  review (honest where a per-message diff cannot be represented).
- Infographic insertion limited to implemented renderers; others recorded.
- Verification: per-capability Chromium evidence; chat proxy streaming test;
  image/icon path tests; a written capability checklist marking anything that
  stays blocked instead of faking it.

### E. Templates browser

- `/tools/presentation/templates`: built-in/custom tabs, native preview via
  the renderer, “Use this template” → generation preselect. Read-only;
  custom template creation stays Presenton-side (31.5–31.7).
- Verification: list/preview Chromium runs; adapter tests for pagination and
  unreachable states.

### F. History/settings

- Tool-page decks list; `/documents` provenance + Open deck; `/integrations`
  Presenton status card; delete deck (row + Presenton deck + document policy)
  with `Modal` confirm; duplicate as a stretch item.
- Verification: RLS tests (list is owner-only), Chromium flows for open/
  delete, honest service-offline states.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Renderer fidelity vs Presenton's canvas (fonts, overflow, text metrics) | Fixture tests of every element type; side-by-side Chromium screenshots against Presenton's own renderer during B; visual tolerance documented |
| Hydration correctness (content → ui) | Fixture tests; Phase C comparison against Presenton-produced slides for identical requests; fallback to layout-choose-only if a merge case is genuinely unmappable (recorded) |
| Full-array PATCH payload size | Decks ≤ 50 slides; payloads are JSON of rendered slides (hundreds of KB worst case); send only on structural changes, debounce text edits to `slide_update` |
| Upstream update bug nulls theme | Always include the current theme; covered by an adapter test |
| Slide id rotation on `/slide/edit` | Native editing never uses those endpoints; `slide_update` keeps ids stable |
| Asset proxy path traversal / cross-account leak | Allowlist prefixes + `..` guard + deck-reference membership check + owner-RLS gate |
| Concurrent writes | Single in-flight mutation per client; last-write-wins recorded; no multi-tab guarantees |
| Presenton changes under us | Not vendored; API contract tests + integration checks; gaps recorded in `docs/integrations/presenton.md` |
| Chart dependency | Decision D5; if declined, custom SVG renderer with a narrower chart set, recorded |

## 12. Decisions

- **D1. Native DOM renderer/editor, not canvas and not iframe.** A 1280×720
  absolutely positioned React tree (SVG for vectors/charts) with CSS-transform
  scaling. Rationale: one renderer serves viewer, preview, and editor;
  accessible text editing without a canvas overlay; no new canvas dependency;
  stage stays isolated from chrome styling. Trade-off: Presenton uses Konva
  for canvas performance; our decks are bounded (≤ 50 slides) and DOM is
  sufficient.
- **D2. Server-mediated Presenton access.** Extend the existing adapter only;
  route handlers for asset streaming and chat SSE. The browser never holds
  keys; no direct calls.
- **D3. No deck working state in UniPilot.** Presenton stores slides; the
  `presentations` row stores request/status/export mirror and the document
  link. UniPilot never becomes a second source of truth.
- **D4. Export is a worker job (`presentation.export`) with row mirror
  columns.** Reuses 29.1 retry/backoff, keeps one writer, gives the UI an
  honest status.
- **D5. Chart.js for chart rendering** (with `chartjs-plugin-datalabels`),
  pending approval (Q1).
- **D6. One owner-gated asset proxy** with deck-reference membership checks
  (§6.9).
- **D7. Smart HTML decks are not rendered natively**; labelled fallback to the
  wrapper route, recorded. UniPilot does not generate Smart decks.
- **D8. Layout changes use a UniPilot hydration module** (`hydrateSlide.ts`)
  implementing the documented merge semantics, not vendored code.
- **D9. One deck ↔ one document.** `source_document_ids` replaces the single
  `source_document_id`; re-export overwrites the same document row and storage
  object; no export version history.
- **D10. Routes** `/tools/presentation` (setup/history),
  `/tools/presentation/[id]` (viewer/present),
  `/tools/presentation/[id]/edit` (editor/fallback),
  `/tools/presentation/templates[/[templateId]]` (browser/preview).
- **D11. Bounds**: generated decks keep the 5–30 UI choice and the 1–50
  service allowance; editor add-slide caps at 50 with the existing
  "Slide limit reached" honesty.
- **D12. No provider/admin settings in UniPilot**; `/integrations` is
  status-only; no Presenton Cloud calls.

## 13. Open questions (for review)

Only one decision remains open before Phase B:

1. **Chart.js dependency** — approve `chart.js` + `chartjs-plugin-datalabels`
   (D5), or take the custom-SVG route with a narrower chart set? The plan
   carries both options; Phase B starts with the approved one.

Settled for this program by the refresh directive (2026-09-16) — recorded here
so the plan can proceed without re-litigating, and reviewable at the plan
gate:

- **Outline editing** (TASK 31.3) stays out of A–F; it is a separate pipeline
  (create → outlines → prepare → stream) and a separate spec when wanted.
- **Smart mode** stays out: UniPilot generates v2-standard only; Smart HTML
  decks open with the labelled fallback.
- **Theme creation** (`POST /theme/generate`, custom palettes) stays out of
  C–F: the editor offers theme *selection* (template + existing custom
  themes).
- **Web search at generation** stays out of A: it depends on Presenton-side
  provider config, which UniPilot never surfaces.
- **Re-export overwrites the same document** (D9): one deck ↔ one document,
  no export version history.
- **History actions in F**: delete ships (row + engine deck + document per the
  documents policy, `Modal` confirm); duplicate is a stretch.
- **Multi-document sources**: up to 8 existing UniPilot PDF/DOCX documents;
  arbitrary Presenton-supported types stay out (would widen the documents
  vocabulary).
- **Present mode ships in B** (viewer phase).
- **Autosave**: 2 s debounce, last-write-wins, no multi-tab protection.

## 14. Recorded gaps / out of scope

- TASK.md 31.3 outline editing; 31.5–31.7 uploaded-template analysis and
  recreation; custom-template studio and template editing.
- Smart HTML decks (native), LaTeX text runs, 24 of 27 infographic types
  (honest placeholders until demand).
- Non-document attachment types at generation time (UniPilot documents are
  PDF/DOCX/PPTX/PNG/JPEG).
- Presenton admin/settings/provider surfaces, Presenton Cloud, legacy v1 decks.
- **Per-owner engine identity.** The engine's image library has no ownership
  metadata: UniPilot mitigates with a reference-based filter (library
  list/insert/delete intersect the caller's own decks' asset paths), which is
  appropriate for a single-owner deployment but not isolation. The real fix is
  per-owner engine accounts / an isolated library — tracked for a later phase
  (recorded 2026-09-17, D3).
- Real-time collaboration, per-user Presenton auth bridging (the service uses
  one API key; UniPilot's session is the only identity).

## 15. Next step

This refreshed spec is the plan's basis:
`docs/superpowers/plans/2026-09-16-native-presentation.md` (produced with
`writing-plans`, 2026-09-16). Execution ran phase by phase through F6; the Phase F gate is green (full suite 675 passed / 9 skipped / 0 failed) on the
founder's go-ahead; Q1 was approved (Chart.js pinned in
`frontend/package.json`). The native editor is the standard path — standard
decks render `DeckEditor` at `/tools/presentation/[id]/edit`; the wrapper
route survives only as the labelled Smart/legacy fallback, resolving to the
interim fork (`presenton-ui/`) when `PRESENTON_UI_URL` is reachable and to
the engine's own editor otherwise. Phase F shipped the decks list (F1,
`38ec58c`), `/documents` provenance + Open deck (F2, `0521af6`), the
`/integrations` Presenton card (F3, `31d30ee`) and delete deck (F4,
`577da6b`); F5 recorded the fork's interim status in
`docs/integrations/presenton.md` §3.6 and `presenton-ui/DIVERGENCE.md`. No
fork deletion happened — retiring `presenton-ui/` and `PRESENTON_UI_URL` is
the founder's decision. Remaining gaps are §14 (31.3, 31.5–31.7).
