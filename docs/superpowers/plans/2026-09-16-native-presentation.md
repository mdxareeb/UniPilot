# Native presentation experience — implementation plan (Phases A–F)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded Presenton editor and thin tool chrome with a UniPilot-native presentation experience — generate/setup, deck viewer, native editor, templates browser, and history/settings — while Presenton stays the engine behind the existing adapter/worker/registry/documents plumbing.

**Architecture:** UniPilot Next server pages/components read decks through the server-only Presenton adapter; Server Actions mutate through the same adapter; two Node route handlers stream assets and chat. Presenton keeps storing slide state; a saved deck stays a PPTX/PDF `documents` row (`source='presentation'`); export is a worker job that overwrites the same document. No iframe by default; the wrapper route remains only as the labelled Smart-deck fallback (and the interim fork until parity).

**Tech Stack:** Next 16.3.1, React 19.2.8, Tailwind 4, `motion` ^13.1.1, Supabase (local stack), Playwright (`npm run test`), plain-ESM worker (`backend/worker/run.mjs`, Task 29.1), Chart.js 4 + `chartjs-plugin-datalabels` (pending Q1 — see B0).

**Spec:** `docs/superpowers/specs/2026-09-15-presentation-ui-design.md` (refreshed 2026-09-16). The spec is normative for data shapes (§4.2, §6.1–6.2), mutation map (§7.4–7.5), phases (§10), and decisions (D1–D12). Read it before any task.

## Global constraints (every task)

- **Do not commit.** The founder commits when they ask. Each task ends with green checks plus recorded evidence; commits are a separate, explicit request.
- **Stop at every phase boundary for review** (A → B → C → D → E → F). Do not start a phase before the founder's go-ahead.
- **Reuse, no new systems:** adapter `frontend/lib/integrations/presenton.ts` (+`presentonConfig.ts`), data layer `frontend/lib/data/presentation*.ts`, worker `backend/worker/presentationJobs.mjs` (+29.1 runner/heartbeat), registry `frontend/components/tools/toolCatalog.ts`, `documents` plumbing. No new provider wiring; `PRESENTON_URL`/`PRESENTON_API_KEY` stay server-only; no Presenton Cloud.
- **Chrome is UniPilot's; deck content keeps its fonts/colors inside the stage only.** No new fonts/colors; all animation reuses `frontend/components/motion/` (MOTION.md mapping; no new durations/easings; animation never controls content existence).
- **Honest states:** unported capabilities are absent or labelled, never faked. Blocked verification is recorded with its reason.
- **One writer:** generation/export = worker only; editing = browser → Server Action → adapter only.
- **Read `frontend/AGENTS.md` first** — this Next.js has breaking changes; read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers/Server Actions.
- **Verification contract:** focused Playwright project from `frontend/` (`npx playwright test --project=<name>`), then `npm run typecheck`, `npm run lint`, and the full `npm run test` at phase gates. UI evidence uses the browser-qa skill (Playwright MCP, real clicks/keys, console/network, 375/768/1280, screenshots into `frontend/screenshots/`). `fonts.spec.ts` stays green. Authenticated browser work follows `QA_SESSION.md` (QA identity only; never the founder account). Local stack only.
- **Environment:** local Supabase (Docker in `kali-linux` WSL), local Presenton engine (`PRESENTON_URL`), local worker. A generation/provider capability is operational: when no provider is available, live-generation evidence records the blocked reason instead of being faked.

---

## Phase A — Generate/setup + result

**Spec:** §5.2, §7.9 (Phase A), §10-A. **Out of scope:** outline, Smart mode, web search, non-document attachments.

### Task A1: `presentations` request fields migration

**Files:**
- Create: `backend/supabase/migrations/20260916120000_presentation_request_fields.sql`
- Modify: `frontend/lib/supabase/database.types.ts` (regenerated)
- Sweep: every `source_document_id` reference (`backend/worker/presentationJobs.mjs`, `frontend/lib/data/presentations.ts`, `frontend/lib/data/presentationValues.ts`, tests)

**Interfaces:**
- Produces: columns `language text`, `instructions text`, `tone text`, `verbosity text`, `include_table_of_contents boolean not null default false`, `include_title_slide boolean not null default true`, `web_search boolean not null default false`, `source_document_ids uuid[] not null default '{}'`; column `source_document_id` dropped.

- [ ] **Step 1: Write the migration**

```sql
-- Task 31.x (native presentation, Phase A): request fields Presenton's
-- generate/async accepts, and multi-document sources.
alter table public.presentations
  add column if not exists language text,
  add column if not exists instructions text,
  add column if not exists tone text
    check (tone is null or tone in
      ('default','casual','professional','funny','educational','sales_pitch')),
  add column if not exists verbosity text
    check (verbosity is null or verbosity in
      ('concise','standard','text-heavy')),
  add column if not exists include_table_of_contents boolean not null default false,
  add column if not exists include_title_slide boolean not null default true,
  add column if not exists web_search boolean not null default false,
  add column if not exists source_document_ids uuid[] not null default '{}';

update public.presentations
  set source_document_ids = array[source_document_id]
  where source_document_id is not null;

alter table public.presentations drop column if exists source_document_id;

comment on column public.presentations.source_document_ids is
  'Up to 8 owned PDF/DOCX document ids; re-validated by the Server Action and the worker (no array FK exists).';
comment on column public.presentations.web_search is
  'Reserved for a later phase; the UI never sets it in A-F.';
comment on column public.presentations.include_title_slide is
  'Default true preserves current behavior: the service default is true and UniPilot sends the boolean explicitly from Phase A on.';
```

- [ ] **Step 2: Apply and lint**

Run: `npm run db:reset; if ($?) { npm run db:lint }` (root; WSL). Expected: all migrations apply; no lint findings.

- [ ] **Step 3: Regenerate types**

Run: `npm run db:types`. Expected: `database.types.ts` gains the new columns and drops `source_document_id`.

- [ ] **Step 4: Sweep the dropped column**

Run: `npm run typecheck`. Expected: errors listing every consumer of `source_document_id`. Fix them with **compile-preserving compatibility shims only** (the real behavior lands in A2/A4/A5 and replaces these):
- `frontend/lib/data/presentations.ts` `insertPresentation`: write `source_document_ids: draft.sourceDocumentId === null || draft.sourceDocumentId === "" ? [] : [draft.sourceDocumentId]`.
- `backend/worker/presentationJobs.mjs`: `loadPresentation` selects `source_document_ids`; `startGeneration` uses `const sourceIds = Array.isArray(row.source_document_ids) ? row.source_document_ids : []` and keeps the existing single-document path for `sourceIds[0]` (loop lands in A5).

Each shim carries a `// Task A1 shim — replaced by Task A<N>` comment. Typecheck must be green at the end of this task.

### Task A2: Parser + vocabulary (`presentationValues.ts`)

**Files:**
- Modify: `frontend/lib/data/presentationValues.ts`
- Modify: `frontend/lib/data/presentations.ts` (`insertPresentation` writes `draft.sourceDocumentIds`; replaces the A1 shim)
- Modify: `frontend/lib/data/presentationActions.ts` (iterate `draft.sourceDocumentIds` with the existing per-document ownership/MIME checks; the new-field validation stays A4)
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (extend the parser describe)

**Interfaces:**
- Produces (exact):

```ts
export const PRESENTATION_MAX_SOURCES = 8;
export const PRESENTATION_INSTRUCTIONS_MAX_LENGTH = 2_000;
export const PRESENTATION_LANGUAGE_VALUES = [
  "Arabic","Bengali","Chinese (Simplified)","Dutch","English","French",
  "German","Hindi","Indonesian","Italian","Japanese","Korean","Malay","Polish",
  "Portuguese","Russian","Spanish","Swedish","Thai","Turkish","Ukrainian",
  "Urdu","Vietnamese",
] as const;
export const PRESENTATION_LANGUAGE_OPTIONS = ["Auto", ...PRESENTATION_LANGUAGE_VALUES] as const;
export const PRESENTATION_TONES = ["default","casual","professional","funny","educational","sales_pitch"] as const;
export const PRESENTATION_VERBOSITIES = ["concise","standard","text-heavy"] as const;

export type PresentationDraft = {
  prompt: string;
  template: string;
  nSlides: number | null;
  format: PresentationFormat;
  language: string | null; // a PRESENTATION_LANGUAGE_VALUES entry, or null for Auto
  instructions: string | null;
  tone: (typeof PRESENTATION_TONES)[number] | null;
  verbosity: (typeof PRESENTATION_VERBOSITIES)[number] | null;
  includeTableOfContents: boolean;
  includeTitleSlide: boolean;
  sourceDocumentIds: string[];
};
```

- [ ] **Step 1: Write the failing tests**

Add to the parser describe in `presentations-jobs.spec.ts`:

```ts
const { parsePresentationRequest } = await import("../../lib/data/presentationValues");
const base = { prompt: "Photosynthesis", format: "pptx" };
it("accepts the new request vocabulary", () => {
  const draft = parsePresentationRequest({
    ...base, nSlides: 12, language: "English", instructions: "For first years",
    tone: "educational", verbosity: "concise",
    includeTableOfContents: true, includeTitleSlide: true,
    sourceDocumentIds: ["0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234"],
  });
  expect(draft).toMatchObject({
    language: "English", tone: "educational", verbosity: "concise",
    includeTableOfContents: true, includeTitleSlide: true,
    sourceDocumentIds: ["0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234"],
  });
});
it.each([
  { tone: "sarcastic" }, { verbosity: "very" }, { language: "Klingon" },
  { instructions: "x".repeat(2001) },
  { sourceDocumentIds: ["not-a-uuid"] },
  { sourceDocumentIds: Array.from({ length: 9 }, () => "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234") },
])("rejects invalid request %o", (bad) => {
  expect(parsePresentationRequest({ ...base, ...bad })).toBeNull();
});
it("defaults the title-slide flag on and the contents flag off when omitted", () => {
  const draft = parsePresentationRequest(base);
  expect(draft).toMatchObject({ includeTitleSlide: true, includeTableOfContents: false });
});
it("honours an explicit false title-slide flag", () => {
  expect(parsePresentationRequest({ ...base, includeTitleSlide: false }))
    .toMatchObject({ includeTitleSlide: false });
});
```

- [ ] **Step 2: Run to see it fail**

Run (from `frontend/`): `npx playwright test --project=qa-presentation-jobs -g "vocabulary"`.
Expected: FAIL — parser returns the old shape / accepts the invalid values.

- [ ] **Step 3: Implement the parser**

Validate exactly: prompt (trim, 1–2000); template (default `"general"`, ≤120); nSlides (5–30 integer or null); format `pptx|pdf`; language ∈ `PRESENTATION_LANGUAGE_VALUES` or null (the UI maps "Auto" → null before calling; the parser rejects `"Auto"` as a stored value); instructions trimmed ≤2000 or null; tone/verbosity ∈ vocabularies or null; **`includeTableOfContents` is `input.includeTableOfContents === true` (default off), `includeTitleSlide` is `input.includeTitleSlide !== false` (default on — preserves current decks, matches the DB default and the service default)**; `sourceDocumentIds` array of 0–8 UUIDs (reject duplicates); unknown fields ignored.

- [ ] **Step 4: Re-run**

Run: `npx playwright test --project=qa-presentation-jobs -g "vocabulary"`. Expected: PASS; existing parser cases still pass.

### Task A3: Adapter request builder

**Files:**
- Modify: `frontend/lib/integrations/presenton.ts` (`PresentonGenerationInput`, `startPresentationGeneration`)
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (new describe: pure builder)

**Interfaces:**
- Produces: `export function buildGenerationRequestBody(input: PresentonGenerationInput): Record<string, unknown>` (pure; used by `startPresentationGeneration`).

- [ ] **Step 1: Failing test**

```ts
const { buildGenerationRequestBody } = await import("../../lib/integrations/presenton");
it("sends every request field and always sends the booleans", () => {
  const body = buildGenerationRequestBody({
    content: "  Photosynthesis  ", nSlides: 12, language: "English",
    template: "general", format: "pptx",
    instructions: "For first years", tone: "educational", verbosity: "concise",
    includeTableOfContents: true, includeTitleSlide: false,
    sourceFiles: ["/app_data/uploads/1/a.pdf"],
  });
  expect(body).toEqual({
    content: "Photosynthesis", n_slides: 12, language: "English",
    template: "general", export_as: "pptx",
    instructions: "For first years", tone: "educational", verbosity: "concise",
    include_table_of_contents: true, include_title_slide: false,
    files: ["/app_data/uploads/1/a.pdf"],
  });
});
it("omits null optionals and never sends empty files", () => {
  const body = buildGenerationRequestBody({
    content: "x", template: "general", format: "pdf",
    includeTableOfContents: false, includeTitleSlide: true,
  });
  expect(body.n_slides).toBeUndefined();
  expect(body.language).toBeUndefined();
  expect(body.files).toBeUndefined();
  expect(body.include_title_slide).toBe(true);
});
```

- [ ] **Step 2: Run** `npx playwright test --project=qa-presentation-jobs -g "builder"` → FAIL (function missing).

- [ ] **Step 3: Implement** the builder: trim/clip `content` to `PRESENTON_CONTENT_MAX_LENGTH`; clip `instructions` to `PRESENTON_INSTRUCTIONS_MAX_LENGTH`; validate template/nSlides as today; include `language`, `instructions`, `tone`, `verbosity`, `files` only when non-empty; **always** include both boolean keys. `startPresentationGeneration` calls it and keeps the existing fetch/timeout/classification.

- [ ] **Step 4: Re-run** → PASS.

### Task A4: Server Action + data layer (multi-source, new fields)

**Files:**
- Modify: `frontend/lib/data/presentations.ts` (`insertPresentation`)
- Modify: `frontend/lib/data/presentationActions.ts` (`createPresentationAction`)
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (RLS describe gains a multi-source insert assertion)

**Interfaces:**
- Consumes: `PresentationDraft` (A2), `buildGenerationRequestBody` (A3).
- Produces: `insertPresentation(userId, draft)` writes every draft field; `source_document_ids` stored as the array.

- [ ] **Step 1: Test** — service-role insert of a row with two `source_document_ids` and the new fields round-trips (extend the RLS/read describe with one assertion on the fetched row).
- [ ] **Step 2: Run** focused → FAIL (column write missing).
- [ ] **Step 3: Implement** the insert field mapping; in `createPresentationAction`, validate each of `draft.sourceDocumentIds`: `getDocument(user.id, id)` non-null and MIME `application/pdf` or DOCX, else return `PRESENTATION_SOURCE_NOT_FOUND_ERROR` / `PRESENTATION_SOURCE_UNSUPPORTED_ERROR` without writing; reject duplicates before the service call.
- [ ] **Step 4: Re-run** → PASS; `npm run typecheck` clean.

### Task A5: Worker pass-through + stub-engine test

**Files:**
- Modify: `backend/worker/presentationJobs.mjs` (`loadPresentation`, `uploadSourceDocument` → loop, `startGeneration` payload)
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (new describe with a local stub engine)

**Interfaces:**
- Consumes: row columns from A1.
- Produces: `startGeneration` sends the full request (booleans always); every source document is uploaded and concatenated into `files`.

- [ ] **Step 1: Failing test**

Controller ruling (2026-09-16, from execution): `runWorkerOnce` uses `execFileSync`, which blocks the Playwright event loop — the plan's in-process `http.createServer` stub deadlocks (proven: `spawnSync node ETIMEDOUT`). The stub must run as a **child process inside the spec** (OS-assigned port on 127.0.0.1, URL reported on the child's stdout, captured traffic readable via a test-only `GET /__captured` route, killed in `finally`). The three required routes are unchanged. The test shape below is otherwise the contract:

```ts
import http from "node:http";

it("sends the full request and every source file (stub engine)", async () => {
  const received: { body?: unknown; uploads: number } = { uploads: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/ppt/files/upload") {
      received.uploads += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([`/app_data/uploads/${received.uploads}.pdf`]));
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/ppt/presentation/generate/async") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        received.body = JSON.parse(raw);
        res.setHeader("content-type", "application/json");
        // A permanent task error settles the row without downloading an export.
        res.end(JSON.stringify({
          id: "task-stub", type: "presentation.generate", status: "error",
          message: "stub", error: { status_code: 400, detail: "stub" }, data: null,
        }));
      });
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const doc = await insertDocumentWithObject(); // helper: service insert + storage.upload of a tiny PDF
    const presentation = await insertPresentation({ source_document_ids: [doc.id], language: "English", tone: "educational", verbosity: "concise", include_table_of_contents: true, include_title_slide: false });
    const jobId = await insertJob({ presentationId: presentation.id });
    const out = runWorkerOnce({ PRESENTON_URL: `http://127.0.0.1:${port}` });
    expect(out).toContain(`settled job=${jobId}`);
    expect(received.uploads).toBe(1);
    expect(received.body).toMatchObject({
      language: "English", tone: "educational", verbosity: "concise",
      include_table_of_contents: true, include_title_slide: false,
      files: ["/app_data/uploads/1.pdf"],
    });
  } finally {
    server.close();
  }
});
```

(The helper seeds a document row + bucket object and registers both ids in the spec's cleanup sets; the existing `afterAll` count guard covers them.)

- [ ] **Step 2: Run** focused → FAIL (no upload loop / fields not sent).
- [ ] **Step 3: Implement**: `loadPresentation` selects the new columns; `uploadSourceDocument` iterates `source_document_ids` (ownership + storage-path prefix re-check per id; one unreadable source fails permanent with `SOURCE_UNREADABLE`); `startGeneration` builds the payload with the A3 field set (`include_*` booleans always sent).
- [ ] **Step 4: Re-run** → PASS. Run the whole project file: `npx playwright test --project=qa-presentation-jobs`.

### Task A6: Generate form — advanced settings + multi-source

**Files:**
- Modify: `frontend/app/(app)/tools/presentation/page.tsx` (pass more source documents)
- Modify: `frontend/app/(app)/tools/presentation/_components/PresentationWorkspace.tsx`
- Verify: existing components `Collapsible`, `Select`, `Input`, `MotionNotice` under `frontend/components/`

**Interfaces:**
- Consumes: `PRESENTATION_LANGUAGE_OPTIONS`/`PRESENTATION_TONES`/`PRESENTATION_VERBOSITIES`/`PRESENTATION_MAX_SOURCES` (A2); `createPresentationAction` (A4).

- [ ] **Step 1: Implement the form**
  - Replace the single-source `Select` with a multi-select list (checkbox rows inside a `Collapsible variant="scale"` "Sources" group, capped at `PRESENTATION_MAX_SOURCES`, mono counter "n/8", disabled beyond the cap with the existing label styling) — reuse `Card`/`Collapsible`/`Divider`; no new primitives.
  - Add an advanced `Collapsible variant="scale"` group: Language `Select` (options `PRESENTATION_LANGUAGE_OPTIONS`, default "Auto", mapped to `null` on submit), Tone `Select` (default "Default" → `default`), Verbosity `Select` (default "Standard" → `standard`), Instructions `Textarea` (`maxLength={PRESENTATION_INSTRUCTIONS_MAX_LENGTH}`), and two **toggle buttons with `aria-pressed`** for Include contents (default **off**) / Include title slide (default **on** — preserves today's decks) — the repo's established boolean pattern (`DocumentsHub.tsx:309`, `CalendarWorkspace.tsx:514`), not a new Switch primitive.
  - Submit maps the state into the action payload fields from A2.
- [ ] **Step 2: Typecheck/lint** `npm run typecheck; if ($?) { npm run lint }` → clean.
- [ ] **Step 3: Browser evidence** (browser-qa skill; dev server `npm run dev:web` from root; local Supabase env; MCP browser authenticates per `QA_SESSION.md`):
  - `/tools/presentation`: advanced settings collapsed by default; expand with a real click; all controls render; sources list caps at 8; guest shows the sign-in prompt and writes nothing; console clean; screenshots at 375/768/1280 into `frontend/screenshots/` (`phase-a-form-*.png`).
  - Unconfigured state still renders the honest blocked card (temporarily blank `PRESENTON_URL` in the local env for this one check, restore after).

### Task A7: Phase A verification gate

- [ ] **Step 1:** From `frontend/`: `npx playwright test --project=qa-presentation-jobs` → green.
- [ ] **Step 2:** From root: `npm run typecheck`, `npm run lint`, `npm run test` (full suite; local stack up, no manual dev server) → green including `fonts.spec.ts`.
- [ ] **Step 3:** Live generation: with the engine + a provider configured, generate one deck from the tool page through the MCP browser (progress appears, result card shows the deck, `/documents` gains it). Record screenshots and the actual deck size; if no provider is available, record the blocked reason and keep the operational item open — never fake it.
- [ ] **Step 4:** Write the phase evidence into the plan checklist and **STOP for review** (no commits).

**Execution record (2026-09-16):** Steps 1–2 green (full suite run 2: 242 passed / 4 skipped / 0 failed after temporarily clearing the local `UNIPILOT_WHATSAPP_LIVE` flag — diagnosed as environmental, unrelated to Phase A; env byte-restored). Step 3: the authenticated live probe created the row and exercised the failure path end-to-end, but the engine failed at the Groq provider call (`reasoning_effort` must be low/medium/high) — deck generation is blocked by engine provider configuration (operational, founder-side), recorded, not faked. Full record: `.superpowers/sdd/2026-09-16-native-presentation/phase-A-record.md`. **Phase A stopped for review** (no commits).

---

## Phase B — Deck viewer

**Spec:** §6 (rendering model), §10-B, D1/D5/D6/D7. **Depends on:** A.

### Task B0: Decision gate — chart engine (spec Q1) — APPROVED 2026-09-16

- **Approved:** `chart.js` + `chartjs-plugin-datalabels`, **deck-content components only** (rendered inside the stage; never chrome), **exact versions pinned** in `frontend/package.json` (`npm install -E chart.js chartjs-plugin-datalabels`, versions recorded in the task's evidence). The custom-SVG fallback stays documented in spec §6.6 as the fallback if the dependency is ever removed. No other task depends on this gate anymore.

### Task B1: Wire types + adapter reads + pure helpers

**Files:**
- Create: `frontend/lib/presentation/types.ts`
- Create: `frontend/lib/presentation/elements.ts`
- Modify: `frontend/lib/integrations/presenton.ts` (`getPresentationDeck`, `getPresentationTemplate`)
- Modify: `frontend/playwright.config.ts` — wire BOTH projects now (so every later task's focused run works; B4 only consumes them):
```ts
{ name: "qa-presentation-renderer", testMatch: /presentations-renderer\.spec\.ts/, timeout: 120_000, dependencies: ["qa-presentation-jobs"] },
{ name: "qa-presentation-ui", testMatch: /presentations-ui\.spec\.ts/, timeout: 240_000, storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json", dependencies: ["qa-presentation-renderer"] },
```
  inserted before `chromium-authenticated`, and `chromium-authenticated`'s `dependencies` array gains `"qa-presentation-ui"`.
- Test: `frontend/tests/qa/presentations-renderer.spec.ts` (new)

**Interfaces:**
- Produces (exact types; mirror the FastAPI shapes in spec §4.2/§6.1): `PresentationDeck`, `DeckSlide`, `SlideUi`, `SlideComponent`, `SlideElement` (discriminated union on `type`), `DeckTheme`, `TemplateLayout`, `PresentationTemplate`.
- Produces helpers in `elements.ts` (pure, tested): `collectAssetPaths(deck): string[]`, `collectTemplateAssetPaths(template): string[]`, `elementFrame(element, component): { x, y, width, height }`, `isTextRun(value): boolean`, `infographicRenderer(type: string): "gauge" | "progress_bar" | "vertical_funnel" | null`.
- Produces adapter reads: `getPresentationDeck(presentationId): Promise<PresentationDeck>` (`GET /api/v1/ppt/presentation/{id}`), `getPresentationTemplate(templateId): Promise<PresentationTemplate>` (`GET /api/v1/ppt/template/{id}`), both with `assertSafeSegment` + existing timeout/classification.

- [ ] **Step 1: Failing tests** for `collectAssetPaths` (nested ui/content/theme/fonts strings; ignores non-asset strings), `elementFrame` (component offset + element position), `infographicRenderer` (three known types, unknown → null).
- [ ] **Step 2: Run** `npx playwright test --project=qa-presentation-renderer` → FAIL.
- [ ] **Step 3: Implement** types + helpers + adapter reads.
- [ ] **Step 4: Re-run** → PASS; `npm run typecheck` clean.

### Task B2: Owner-gated asset proxy

**Files:**
- Create: `frontend/app/api/presentation/[id]/asset/route.ts`
- Modify: `frontend/lib/integrations/presenton.ts` (add `fetchPresentationAsset(path): Promise<{ body: ReadableStream; contentType: string } | null>` — bearer fetch, prefix + traversal guard)
- Test: `frontend/tests/qa/presentations-ui.spec.ts` (new; HTTP-level cases in the storage-state project)

**Interfaces:**
- Consumes: `collectAssetPaths` (B1), `getPresentation` (data layer), adapter auth config.
- Produces: `GET /api/presentation/{id}/asset?src=<path>` → bytes with `content-type` + `cache-control: private, max-age=300`; `400` unsafe src; `401` no session; `404` for a presentation the caller does not own (the owner-RLS read returns null; no existence oracle) and for a non-referenced user-data path; `502` engine failure.

- [ ] **Step 1: Failing tests** (spec cases):
```ts
test("rejects an unsafe src before any fetch", async ({ request }) => {
  const res = await request.get(`/api/presentation/${deckId}/asset?src=/app_data/../../etc/passwd`);
  expect(res.status()).toBe(400);
});
test("404s a path the deck does not reference", async ({ request }) => {
  const res = await request.get(`/api/presentation/${deckId}/asset?src=/app_data/images/other-user.png`);
  expect(res.status()).toBe(404);
});
test("serves a referenced image with a private cache header", async ({ request }) => {
  const src = firstReferencedImagePath; // read from the deck via the adapter in the spec
  const res = await request.get(`/api/presentation/${deckId}/asset?src=${encodeURIComponent(src)}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("private");
});
```
(Cases skip with a recorded reason when no engine/deck is available; the unsafe-src and unauthenticated cases never skip.)
- [ ] **Step 2: Run** → FAIL (route missing).
- [ ] **Step 3: Implement** the route exactly per spec §6.9 (session gate → `getPresentation` owner read → path classification → membership check → adapter fetch → stream). Keep every guard in one exported pure helper `classifyAssetPath(src, deck, templateId)` (testable directly).
- [ ] **Step 4: Re-run** → PASS.

### Task B3: Renderer — stage + elements

**Files:**
- Create: `frontend/components/presentation/DeckStage.tsx`
- Create: `frontend/components/presentation/SlideElementView.tsx`
- Create: `frontend/components/presentation/TextElement.tsx`, `TextListElement.tsx`, `TableElement.tsx`, `ImageElement.tsx`, `VectorElement.tsx`, `ContainerElement.tsx`, `DeckFontFace.tsx` (dynamic `@font-face` + theme CSS variables, stage-scoped)
- Test: pure geometry/style helpers covered in B1's spec; DOM verified live (no component-test infra in this repo — recorded in the phase evidence).

**Interfaces:**
- Consumes: B1 types/helpers; B2 asset URLs (`/api/presentation/{id}/asset?src=…`).
- Produces:
```tsx
export function DeckStage({ deck, id, slideIndex, scale, interactive }: {
  deck: PresentationDeck; id: string; slideIndex: number;
  scale?: "fit-width" | "fit-screen" | number; interactive?: boolean;
}): JSX.Element
```
  - A fixed 1280×720 absolutely-positioned tree; wrapper applies `transform: scale()`; stage-scoped theme via CSS variables; `role="group"` + `aria-label={"Slide " + (slideIndex + 1)}`.
  - `flex`/`grid` containers render as CSS flex/grid inside their absolute frame (gap/direction/align/justify from the element); `group` children position relative; `container` is a single-child frame.
  - `image`: `object-fit` from `fit`, `object-position` from `focus_x/y`, `border_radius`, `clip_path`; `is_icon` images render inline (recolor deferred to D4).
  - `vector`: SVG path from `points`/`closed`/`curve` with fill/stroke/dash/shadow.
  - `text`: runs as inline spans (run style resolution: family/size/weight/style/color/line-height/letter-spacing; LaTeX runs render raw text honestly — spec §6.4); `text-list` marker + items; `table` cells as run containers.
- [ ] **Step 1: Implement** components with no chrome styling inside the stage (spec §6.11).
- [ ] **Step 2: Typecheck** → clean.
- [ ] **Step 3: Renderer fixture checks** — extend the renderer spec with pure assertions on the layout helpers used by flex/grid (child frames within the container bounds) and run it.

### Task B4: Viewer route + rail + present mode

**Files:**
- Create: `frontend/app/(app)/tools/presentation/[id]/page.tsx` (server: owner read via `getPresentation` + adapter `getPresentationDeck`; Smart → fallback panel; 404 for guests/unknown ids)
- Create: `frontend/app/(app)/tools/presentation/[id]/_components/DeckViewer.tsx`, `SlideRail.tsx`, `PresentMode.tsx`
- Create: `frontend/tests/qa/presentations-ui.spec.ts` (started B2)
- Playwright projects `qa-presentation-renderer` + `qa-presentation-ui` were wired by B1; no config change here.
- Provide the viewer entry from the tool page result card (`editHref` sibling: viewerHref) and the history list later (F1).

**Interfaces:**
- Consumes: `DeckStage` (B3); Motion primitives `MotionListItem`/`AnimatePresence`/`MotionSelectionRing`/`MotionRevealGroup`.
- [ ] **Step 1: Implement** viewer: thumbnail rail (stage scaled to rail width; `MotionSelectionRing` `layoutId="deck-thumb"`), prev/next + keyboard (←/→/Space/PageUp/PageDown/Home/End), slide counter in `font-mono text-label-sm`, notes availability indicator (reading is allowed; editing is C), `data-enter` ladder per the shell.
- [ ] **Step 2: Implement present mode**: fullscreen (`requestFullscreen`), auto-hiding chrome, progress, keys (←→↑↓ Space PageUp/Down Home End Esc), speaker-notes panel (N), click zones, focus trap; honest no-op outside `fullscreenEnabled`.
- [ ] **Step 3: Browser evidence** (with a real deck; skip-with-reason otherwise): navigation, keyboard, present mode enter/exit, Smart fallback panel, 404 guest; console clean; screenshots `phase-b-*.png` at 375/768/1280.

### Task B5: Charts + infographics

**Files:**
- Modify: `frontend/package.json` (after B0 approval, pin exact versions: `npm install -E chart.js@4.4.7 chartjs-plugin-datalabels@2.2.0` — verify the exact latest stable with `npm view chart.js version` / `npm view chartjs-plugin-datalabels version` first and pin whatever resolves, recorded in the task's evidence)
- Create: `frontend/components/presentation/ChartElement.tsx`, `InfographicElement.tsx`
- Modify: `frontend/components/presentation/SlideElementView.tsx`
- Test: `elements.ts` gains `chartConfig(element, theme): ChartConfiguration` (pure; asserted in the renderer spec for the 9 observed `chart_type` values)

**Interfaces:**
- Consumes: element `chart_type`, `categories`, `series`, `colors`, axis/grid options, `data_labels` (spec §6.6); theme `graph_0…graph_9`.
- Produces: `InfographicElement` renders `gauge`, `progress_bar`, `vertical_funnel`; any other `data.type` renders the honest placeholder "Infographic type not yet rendered" inside the element frame (spec §6.7).
- [ ] **Step 1: Failing test** on `chartConfig` (type mapping, series/color wiring, datalabels presence).
- [ ] **Step 2: Run** → FAIL; **Step 3:** implement; **Step 4:** re-run → PASS.
- [ ] **Step 5: Browser evidence** on a deck containing charts (or a template preview in E); screenshot.

### Task B6: Smart-deck fallback

**Files:**
- Modify: viewer page/`DeckViewer` (detect `html_content` / `generation_mode === "smart"` / `type === "smart"` on any slide)
- Verify: wrapper route `[id]/edit` still resolves via `resolveEditorUrl`.

- [ ] **Step 1: Implement** the labelled fallback: an `EmptyState` card explaining Smart decks are not rendered natively, with the existing "Edit deck" wrapper link and open-in-new-tab affordance. No imitation rendering.
- [ ] **Step 2: Browser evidence:** force a Smart-looking deck via a fixture row? No — verify against a real Smart deck when one exists; otherwise assert the detector logic in the renderer spec and record the live item as blocked (honest).

### Task B7: Phase B verification gate

- [ ] Focused projects green (`qa-presentation-renderer`, `qa-presentation-ui`); full `npm run test` green; typecheck/lint clean.
- [ ] Live Chromium session on a real generated deck: every element type renders side-by-side against Presenton's editor render (spec §11 mitigation); screenshots archived; fidelity notes recorded (font metric/overflow tolerances).
- [ ] Asset proxy ownership cases exercised as qa1 vs qa2; console clean at three widths.
- [ ] Record evidence; **STOP for review**.

**Execution record (2026-09-16):** focused projects 84/84 + 43/43; full suite **369 passed / 4 skipped / 0 failed** (the local `UNIPILOT_WHATSAPP_LIVE` flag temporarily cleared for the run — diagnosed environmental in A7 — restored after). Live viewer probe passed on a real 5-slide engine deck (seeded QA row, cleaned after): rail/counter/navigation/present mode, zero console errors, zero asset-proxy failures, screenshots `phase-b-gate-viewer-{1280,768,375}.png` + `phase-b-gate-present-1280.png`. Full record: `.superpowers/sdd/2026-09-16-native-presentation/phase-B-record.md`. **Phase B stopped for review** (no commits). Open operational items: provider daily quota blocks a live *generation*; the engine's full-array `PATCH /presentation/update` 500s and must be re-validated before Phase C structural writes.

---

## Phase C — Core editor

**Spec:** §7.4–7.7, §7.9–7.10, §10-C. **Depends on:** B.

### Task C1: Export mirror migration + `presentation.export` job

**Files:**
- Create: `backend/supabase/migrations/20260916130000_presentation_export_mirror.sql`
- Modify: `backend/worker/presentationJobs.mjs` (add `exportPresentation`)
- Modify: `backend/worker/handlers.mjs` (register `"presentation.export": exportPresentation`)
- Modify: `frontend/lib/data/presentations.ts` (surface export mirror fields in the item)
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (stub-engine export test)

**Interfaces:**
- Migration: `export_status text check (export_status is null or export_status in ('queued','running','succeeded','failed'))`, `export_error_message text`, `exported_at timestamptz`.
- Produces: `exportPresentation(payload, ctx)` with `{presentationId}`; flow per spec §7.7: load row (+document), `POST /api/v1/ppt/presentation/{id}/export {export_as}`, download `path` with the existing guards, `storage.upload(path, bytes, { upsert: true })` at the document's existing `storage_path`, update the `documents` row (`name`, `size_bytes`, `mime_type`, `updated_at`), settle `presentations.export_status`.
- [ ] **Step 1: Failing test** with a stub engine: two routes (`/export` → `{presentation_id, path:"/app_data/exports/pdf/deck.pdf", edit_path}`, `GET /app_data/exports/pdf/deck.pdf` → tiny PDF bytes); seed a presentation + document row + storage object; run worker once; assert the same `documents.id`/`storage_path` now has the stub bytes (size/mime updated) and `export_status = "succeeded"`, `exported_at` set. Cleanup in the spec's afterAll count guard.
- [ ] **Step 2: Run** `npx playwright test --project=qa-presentation-jobs -g "export"` → FAIL.
- [ ] **Step 3: Implement**; also implement the permanent/retryable classification (missing path/unreadable document permanent; transport/5xx retryable) with sanitized copy added to `PRESENTATION_COPY`.
- [ ] **Step 4: Re-run** → PASS; `npm run db:reset; npm run db:types; npm run typecheck`.

### Task C2: Hydration module (`hydrateSlide.ts`)

**Files:**
- Create: `frontend/lib/presentation/hydrateSlide.ts`
- Test: `frontend/tests/qa/presentations-renderer.spec.ts`

**Interfaces:**
- Produces: `hydrateSlide(input: { layout: TemplateLayout; content: Record<string, unknown>; }): SlideUi` — places `content` values into elements by `name` where `decorative !== false`, preserves component positions and decorative elements; mirrors Presenton's documented merge semantics (`_apply_template_content_to_ui` / element), not its code.
- [ ] **Step 1: Failing fixtures** — two synthetic layouts (flat text; group with decorative shape) with expected `ui` JSON snapshots.
- [ ] **Step 2: Run** → FAIL; **Step 3:** implement; **Step 4:** re-run → PASS.
- [ ] **Step 5 (phase C):** compare one native-produced slide against Presenton's for the same layout+content in the live session; record any unmappable merge case and fall back to layout-choice-only for it (recorded).

### Task C3: Adapter mutations + pure bodies

**Files:**
- Modify: `frontend/lib/integrations/presenton.ts`
- Test: `frontend/tests/qa/presentations-jobs.spec.ts` (builder describe)

**Interfaces (exported, tested):**
```ts
export function buildPresentationUpdateBody(input: { id: string; title?: string; theme: DeckTheme }): Record<string, unknown>;
export function buildSlideUpdateBody(slide: DeckSlide): { slide: Record<string, unknown> };
export function buildSlidesReplaceBody(input: { id: string; theme: DeckTheme; slides: DeckSlide[] }): Record<string, unknown>;
export async function updatePresentation(input): Promise<void>;   // PATCH /presentation/update
export async function updateSlide(presentationId, slide): Promise<void>; // PATCH /presentation/slide_update
export async function requestPresentationExport(presentationId, format): Promise<void>;
```
- Rules: `buildPresentationUpdateBody` **always includes `theme`** (upstream nulls it otherwise); `buildSlidesReplaceBody` sends every slide with `id/layout_group/layout/index/content/properties(null-able)/ui/html_content(null-able)/speaker_note(null-able)` and the theme, **and requires every slide to carry a fresh UUID** (controller ruling 2026-09-16: the engine flushes inserts before the owner-scoped delete, so existing ids always collide with `UNIQUE(slides.id)`; fresh ids are mandatory for the replace body).
- **Structural editing is gated `[!]`** on this engine runtime: the replace path only works when the request's owner scope matches the deck's slides (auth + owner API key, or decks generated under `DISABLE_AUTH`). Implement the builder + gated wiring; the editor renders structural controls disabled with an honest reason unless `PRESENTON_STRUCTURAL_EDITS=1` (server-only; unset = off). Never fake a structural edit.
- [ ] **Step 1: Failing tests** asserting the exact bodies (theme presence, properties nullability, full-array shape).
- [ ] **Step 2: Run** → FAIL; **Step 3:** implement (PATCH semantics with the existing fetch/classification); **Step 4:** re-run → PASS.

### Task C4: Editor surface

**Files:**
- Modify: `frontend/app/(app)/tools/presentation/[id]/edit/page.tsx` (server read, fallback when the native path cannot render)
- Create: `frontend/app/(app)/tools/presentation/[id]/edit/_components/DeckEditor.tsx`, `EditorRail.tsx`, `InspectorPanel.tsx`, `SaveStatus.tsx`, `useDeckAutosave.ts`, `useDeckHistory.ts`
- Modify: `frontend/lib/data/presentationActions.ts` (new actions: `renamePresentationAction`, `updateSlideAction`, `saveDeckAction`, `requestExportAction`)
- Modify: `frontend/lib/data/presentations.ts` (read/settle export mirror)

**Interfaces:**
- Actions follow the repo Server Action pattern (gate first, parse untrusted input, sanitized copy only). `saveDeckAction` input: `{ presentationId, reason: "text" | "notes" | "structure" | "theme" | "meta", slide?: DeckSlide, deck?: { theme: DeckTheme; slides: DeckSlide[] }, title?: string }`.
- Client state: `useDeckHistory` = bounded snapshots (≤30) with Mod+Z / Mod+Shift+Z / Mod+Y; `useDeckAutosave` = 2 s debounce, one in-flight mutation, stale-revision guard (reject when the loaded revision changed), UI states Saving/Saved/Error.
- [ ] **Step 1: Implement** actions + data plumbing; typecheck.
- [ ] **Step 2: Implement** editor: inline text edit (run-preserving: edit the first run's text, keep its style; plain-text per spec §6.4), speaker notes popover, rename, theme picker (template + custom list; always send theme), export button → `requestExportAction` + poll `router.refresh()` (existing 4 s pattern) until `export_status` settles. **Structural controls (add/duplicate/delete/reorder/layout chooser) ship disabled with the honest reason** (`PRESENTON_STRUCTURAL_EDITS` unset; engine owner-scope dependency recorded in C3 + TASK.md); when the flag is `1` they behave per the hydration/layout rules.
- [ ] **Step 3: Browser evidence:** edit → save → reload persists; rename + theme persist; notes persist; export replaces the document (same document id, new size); structural controls visibly disabled with the honest label (`[!]`); iframe gone (native), fallback shown only for Smart; console clean; screenshots `phase-c-*.png`; reduced-motion pass.

### Task C5: Deck E2E spec

**Files:**
- Modify: `frontend/tests/qa/presentations-ui.spec.ts`

- [ ] **Step 1: Write the persisted-edit tests** (skip-with-reason when no engine/deck): rename persists across reload; a text edit persists; a reorder persists; export requests settle `succeeded` and the document row's `updated_at` moves. Use the storage-state context for UI actions and service-role reads for assertions (read-only assertions, no service writes outside the spec's own fixtures).
- [ ] **Step 2: Run** `npx playwright test --project=qa-presentation-ui` → PASS (or honest skips with reasons recorded).

### Task C6: Phase C verification gate

- [ ] Focused + full suites green; typecheck/lint clean; reduced-motion pass.
- [ ] Live session: create-from-template via hydration matches Presenton's merged slide (one comparison recorded); stale-guard behavior exercised; export replaces the document (screenshot of Documents row before/after).
- [ ] Record evidence; **STOP for review**.

**Execution record (2026-09-16/17):** focused 50/50 + 98/98 + 64/64(+1 recorded skip); full suite **426 passed / 5 skipped / 0 failed** (WhatsApp live flag temporarily cleared for the run — diagnosed environmental — restored); typecheck/lint clean. The live export replacement was proven in-place by the C5 spec (8-byte seed → 1,729,323-byte PPTX, same document id/path); the first gate run's two failures (our export tests' enqueue race + QA1 job residue) were fixed and re-reviewed clean. **Structural editing is `[!]`** with the owner-scope dependency; hydration's live parity comparison is deferred with the gate (structural off). Full record: `.superpowers/sdd/2026-09-16-native-presentation/phase-C-record.md`. **Phase C stopped for review** (no commits).

---

## Phase D — Full editor parity

> **Execution prerequisites (2026-09-17).**
> - **Gate cleared:** structural editing is verified and enabled (`PRESENTON_STRUCTURAL_EDITS=1`; engine auth + owner-scoped API key). D's structural tasks run live.
> - **Task D0 (before D1):** engine auth is on — update UI-spec discovery fetches to send `Authorization: Bearer ${process.env.PRESENTON_API_KEY}`, and make the structural gate assertions branch on `isStructuralEditingEnabled()` (disabled copy when off, live structural behavior when on). Run the focused UI project green before D1.
> - **Provider residual:** Groq-via-custom rejects this model's `max_completion_tokens` (>16384) sent by the engine's custom path; live generation stays blocked until an engine-side model/profile fix — edits/export/structure are unaffected and D's evidence uses existing decks.
> - **QA:** new QA passwords synced; storage state regenerated; QA_SESSION.md carries the secret rule.

**Spec:** §5.4 (operations inventory), §6.5–6.7, §7.4, §7.8, §10-D. Every task inherits C's autosave/undo/one-writer rules; anything not reached is recorded, not faked.

### Task D1: Selection, drag/resize/rotate, z-order, group/ungroup

**Status (2026-09-17):** complete and founder-approved after fix round 1 (vector-group corruption, stale-gesture commit, multi-select resize collapse, focus latch, rotated-resize honesty all fixed; focused 196/1/0; live persistence + MCP screenshots).
**Carry-over D1b (inserted after D2):** rotation-aware resize — compose element rotation into `resizeFrame` with 90°/−180° tests, or keep the honest resize-disabled label; must not vanish.
- Create `frontend/components/presentation/editor/SelectionLayer.tsx`, `TransformHandles.tsx`, `useElementDrag.ts`; extend `DeckEditor`.
- Interactions in stage pixels (divide pointer deltas by the current scale); snapping off by default (recorded); Alt+J/K z-order, Mod+G group.
- Evidence: drag → save → reload persists; group/ungroup; keyboard equivalents.

### Task D2: Rich text runs
- Extend `TextElement` editing: run formatting toolbar (family/size/bold/italic/underline/color/alignment/opacity/letter-spacing/line-height), run splitting/merging on selection; reuses `MotionPopover` + `IconButton`.
- Evidence: format a run → save → reload persists; undo restores.

### Task D3: Images
- Adapter: `searchPresentationImages`, `generatePresentationImage`, `uploadPresentationImage` (route handler `POST /api/presentation/[id]/images` for browser uploads), `listPresentationImages`, `deletePresentationImage`; set element `data` via `updateSlide`.
- UI: image picker modal (`Modal` + `Card bg-glass`), library tabs (generated/uploaded), fit/cover/fill, crop (`focus_x/y`, `crop_scale`), radius, flips, opacity.
- Evidence: search → insert → save → reload; upload path HTTP-asserted; crop persisted.

### Task D4: Icons
- Adapter: icon search (`GET /api/v1/ppt/icons/search`); render through the asset proxy; recolour client-side (SVG fetch + `currentColor`/fill replacement) — no engine recolor route.
- Evidence: search → insert → recolour → save → reload.

### Task D5: Charts/tables data editors
- Extend `ChartElement`/`TableElement` with `MotionPopover` editors writing `slide_update`; charts re-render from `chartConfig` (B5).
- Evidence: edit data → chart updates → save → reload; table cell edit persists.

### Task D6: Blocks (template layout insertion)
- Palette of the deck template's layouts (`getPresentationTemplate`), insert via hydration into a new slide or replace a slide's layout; groups via `Collapsible`; insertion capped at 50 slides with the existing honesty copy.
- Evidence: insert two layouts; persist across reload.

### Task D7: Clipboard, duplicate, shortcuts
- In-app copy/paste (module-level clipboard + element duplicate), `Mod+C/V/D`, delete key; OS clipboard best-effort (recorded).
- Evidence: duplicate persists; shortcuts shown in the shortcuts popover.

### Task D8: Chat proxy + panel
- Create `frontend/app/api/presentation/[id]/chat/route.ts` per spec §7.8 (26.8 precedent); client panel `ChatPanel.tsx` parsing `chunk/status/trace/complete/error`; conversations list/switch; edit-review adopted only where the diff is representable, otherwise "changes applied" + undo.
- Adapter: `streamPresentationChat`, `listPresentationChatConversations`, `getPresentationChatMessages`.
- Evidence: real streaming turn (provider-dependent, recorded); abort propagates; console clean; no provider/database internals in frames.

### Task D9: Infographic insertion
- Palette offers only the implemented renderers (gauge/progress_bar/vertical_funnel); others recorded in the capability checklist.

### Task D10: Capability checklist + phase D gate
- [ ] Write `docs/superpowers/specs/`-adjacent checklist? No — record in the plan's evidence block and TASK.md 31.x: every spec §5.4 operation marked shipped / recorded-gap with the reason.
- [ ] Focused + full suites green; per-capability Chromium evidence; **STOP for review**.

---

## Phase E — Templates browser

**Spec:** §5.1 rows 7–8, §5.5, §10-E. Read-only; custom-template creation stays Presenton-side (31.5–31.7).

### Task E1: Adapter pagination + template reads
- Modify `listPresentationTemplates` to accept `{ page, pageSize, includeCustom }`; expose `getPresentationTemplate` (B1) plus `getTemplateTheme` if the theme endpoint differs.
- Tests: builder/pagination assertions in `presentations-jobs.spec.ts`; unreachable-service states.

### Task E2: Browser + preview routes
- Create `/tools/presentation/templates/page.tsx` (+`TemplatesBrowser.tsx`) and `/tools/presentation/templates/[templateId]/page.tsx` (+`TemplatePreview.tsx` rendering the first layout through `DeckStage` read-only).
- "Use this template" links to `/tools/presentation?template=<id>`; the tool page reads the query param into the picker's initial value.
- Evidence: built-in/custom tabs, preview render, preselect flow; unavailable service shows the honest empty state; screenshots `phase-e-*.png`.

### Task E3: Phase E gate
- [ ] Focused + full green; evidence recorded; **STOP for review**.

---

## Phase F — History / settings

**Spec:** §9, §10-F. **Depends on:** C (edit links), E.

### Task F1: Tool-page decks list
- Data: `listPresentations(userId, limit)` in `presentations.ts` (owner RLS; select the item fields + document embed).
- UI: "My decks" section on `/tools/presentation` using `MotionListItem` + `Divider` + mono metadata; actions Open (viewer), Edit, Download/Open in Documents; empty state honest; guest sees none.
- Evidence: rows render, actions navigate; screenshots.

### Task F2: `/documents` provenance + Open deck
- Modify `frontend/lib/data/documentValues.ts` (`DocumentItem.source?: "upload" | "presentation"`; `DocumentRow` Pick + mapper), `frontend/lib/data/documents.ts` (`DOCUMENT_COLUMNS` gains `source`), `frontend/app/(app)/documents/page.tsx` (read presentations by `document_id` for the user, map `documentId → presentationId`), `DocumentCard.tsx` (provenance `Badge` + "Open deck" `WorkspaceAction` when mapped).
- Evidence: badge renders only for `source='presentation'`; Open deck reaches the viewer; uploads unaffected; `fonts.spec.ts` green.

### Task F3: `/integrations` Presenton card
- Create `frontend/app/(app)/integrations/_components/PresentonCard.tsx` (server component): configured (env read) + reachability probe (`fetch(PRESENTON_URL + "/api/v1/auth/status")`, `cache()`-wrapped, 1.5 s timeout, `no-store`); states configured/reachable/unreachable/not-configured with mono status line; link to the tool; one-line note that provider/model configuration lives in Presenton's admin UI. Extend `IntegrationCard` with optional `badge`/`status` props while keeping the planned variant unchanged.
- Evidence: card states for engine up/down (toggle env), guest view; screenshots.

### Task F4: Delete deck
- Adapter: `deletePresentation(id)` (`DELETE /api/v1/ppt/presentation/{id}`, idempotent on 404).
- Action: `deletePresentationAction(presentationId)` — owner check → engine delete (best-effort when unreachable? Record: engine 404 = success; unreachable = permanent honest failure) → remove the generated document through the existing document removal path (`removeDocument` service function) → delete the row (service role). UI: `Modal` confirm + `Button variant="destructive"`; duplicate remains a stretch (recorded).
- Evidence: delete flows for a deck with/without a document; RLS prevents deleting another user's deck; honest failure when the engine is down.

### Task F5: Fork retirement checklist + docs
- [ ] `resolveEditorUrl` prefers the native editor for native-capable decks and keeps the wrapper only for the Smart fallback; record the fork's status in `docs/integrations/presenton.md` §3.6 and `presenton-ui/DIVERGENCE.md`.
- [ ] Update TASK.md `31.x` statuses (31.8/31.9 native editor pointer; 31.3/31.5–31.7 unchanged gaps; new 31.12–31.17 mapping if the founder wants new ids — ask).
- [ ] Update the spec's §15 with the shipped state. No fork deletion in this plan (the founder decides).

### Task F6: Phase F gate
- [ ] Full `npm run test` green + typecheck/lint; RLS owner-only list assertions; Chromium flows (open/delete, offline states); **STOP for review**.

---

## Execution notes

- **Ordering:** A1→A7, then B0–B7, C1–C6, D1–D10, E1–E3, F1–F6. Within a phase, tasks are sequential unless noted; a task's tests must be green before the next starts.
- **Skip-with-reason pattern:** live-engine tests use `test.skip(reason)` when `PRESENTON_URL` is unset/unreachable, so the suite stays green in unconfigured environments; the phase gates require at least one live run (or a recorded blocked reason).
- **Evidence format:** per task, append to the phase's evidence block: command + result, files touched, screenshot names, console/network summary, known tolerances. Never paste secrets or provider keys.
- **No commits.** When the founder asks for commits, commit per task with the repo's message style (`feat(presentation): …`).

## Self-review record (spec coverage)

| Spec requirement | Task |
|---|---|
| §5.2 generate fields + multi-source | A1–A6 |
| §7.9 Phase A migration | A1 |
| §6 renderer (all element types) | B1, B3, B5 |
| §6.9 asset proxy | B2 |
| §6.10/D7 Smart fallback | B6 |
| Viewer + present mode (B) | B4 |
| §7.7 export job + mirror | C1 |
| §7.6 hydration | C2 |
| §7.4 mutation map | C3–C4 |
| Core editor interactions (C) | C4, C5 |
| Drag/resize/z-order/clipboard (D) | D1, D7 |
| Rich text runs (D) | D2 |
| Images/icons (D) | D3, D4 |
| Charts/tables editors (D) | D5 |
| Blocks (D) | D6 |
| Chat (D) | D8 |
| Infographic coverage honesty | B5, D9 |
| Templates (E) | E1, E2 |
| History/settings (F) | F1–F4 |
| Branding / chrome-only | Global constraints; B3 stage scope; F5 |
| Honest gate at each phase | A7, B7, C6, D10, E3, F6 |
