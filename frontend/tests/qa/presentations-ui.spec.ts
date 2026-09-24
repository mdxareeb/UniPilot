/**
 * tests/qa/presentations-ui.spec.ts — Task B2's owner-gated asset proxy proof,
 * Task B4's viewer proof, and Task C4's native editor proof.
 *
 * The proxy is the only path by which Presenton bytes (slide images, template
 * static assets, engine fonts) reach a browser: `GET
 * /api/presentation/{id}/asset?src=<path>` (spec §6.9). This spec proves the
 * HTTP contract end to end against the real route, the real local stack and
 * the live engine:
 *
 * - no session → 401 (a fresh request context without the stored session);
 * - a deck-referenced path → 200 with the private cache header and the
 *   extension's content type;
 * - a user-data path the deck does not reference → 404 (membership, not just
 *   the prefix allowlist);
 * - another template's `/app_data/templates/<id>/…` path → 404 (deck template
 *   mismatch);
 * - another user's presentation requested with QA1's session → 404 (the
 *   owner-RLS read is the gate; no existence oracle);
 * - traversal/encoding variants and a missing `src` → 400 before any engine
 *   call (these cases never skip);
 * - fixtures return the `presentations` table to its pre-run count.
 *
 * Live cases discover a real v2-standard deck from the engine
 * (`GET /api/v1/ppt/presentation/all`, then the full deck) and skip with a
 * recorded reason when the engine or a suitable deck is unavailable — the
 * unsafe-src, missing-src, cross-owner and unauthenticated cases never skip.
 *
 * The Task C4 editor cases (below the viewer ones) drive the real edit route
 * in Chromium: text edits reach `Saved`, reloads read the engine's stored
 * slide back, the rename/notes/theme writes persist, the structural controls
 * render according to the adapter's `isStructuralEditingEnabled()` (disabled
 * with the honest reason while the flag is off; enabled while it is on —
 * Task D0), and an Export click enqueues the worker job whose mirror settles
 * through the real worker and the live engine. Edits are made on a real
 * engine deck and restored through the engine's own `slide_update`/`update`
 * routes in a `finally` — the deck is never left modified.
 *
 * Task C5 adds the export → document replacement proof (spec §7.7, §10-C): the
 * same edit-route Export click is driven through the real worker and the live
 * engine, and the seeded `documents` row is asserted replaced in place — same
 * row id and bucket key, new `size_bytes`, moved `updated_at`, the re-exported
 * PPTX bytes under it. The structural gate now ships on (`PRESENTON_STRUCTURAL_EDITS=1`,
 * engine auth plus an owner-scoped API key), so Task D0 asserts the editor
 * renders its structural controls enabled but performs no live structural
 * edit — that proof belongs to Task D1. No fake reorder test is written; the
 * pure gate test at the bottom still pins the off branch by clearing the flag
 * in-process (the adapter refuses the structural write before any fetch).
 *
 * Both export tests own their job rows: the worker lock is held from before
 * the Export click through the settle (a foreign worker run in that window
 * would claim the due job — `claim_jobs` is global, and the full suite runs
 * other worker-driving projects concurrently), the job id is captured only
 * from rows created inside that click's enqueue window, and every
 * `presentation.export` row is deleted before the lock is released — the
 * WhatsApp projects assert absolute zero QA1 job residue in their own
 * afterAll, so an export row must not outlive its test.
 *
 * `PRESENTON_URL` (and its optional key) are loaded into this process by
 * `playwright.config.ts` (`process.loadEnvFile`), so no secret is ever read,
 * printed or asserted here beyond a bearer header on the direct engine probes.
 * Every direct engine request goes through `engineApi()`, which attaches
 * `Authorization: Bearer ${process.env.PRESENTON_API_KEY}` whenever that key
 * is non-empty; without a key the engine answers 401 and discovery records
 * the honest skip — never a silent pass.
 */
import { test, expect, request as playwrightRequest } from "@playwright/test";
import type { Locator, Page as TestPage } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import {
  createElementClipboard,
  ELEMENT_CLIPBOARD_PREFIX,
  ELEMENT_PASTE_OFFSET,
  parseElementClipboardText,
  pasteElementClipboard,
} from "../../lib/presentation/clipboardOps";
import { collectAssetPaths } from "../../lib/presentation/elements";
import { getElementAtPath } from "../../lib/presentation/editorOps";
import {
  classifyAssetPath,
  isEnginePublicAssetPath,
  templateAssetUrl,
} from "../../lib/presentation/assets";
import { IMAGE_UPLOAD_MAX_BYTES } from "../../lib/presentation/imageLimits";
import { isSmartDeck } from "../../lib/presentation/smart";
import {
  CHAT_ERROR_COPY,
  normalizeChatSseEvent,
  parseSseBlocks,
  type ChatFrame,
} from "../../lib/presentation/chatFrames";
import type {
  ChartElement,
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
  PresentationDeck,
  PresentationTemplate,
  SlideComponent,
  TableElement,
  TemplateLayout,
} from "../../lib/presentation/types";
import {
  addOnlyLayoutCount,
  buildLayoutPalette,
  layoutReplaceSupport,
  paletteAddState,
  slideLimitReached,
  SLIDE_LIMIT,
  SLIDE_LIMIT_NOTE,
  SLIDE_LIMIT_TITLE,
  TOP_LEVEL_GROUP_REPLACE_REASON,
} from "../../app/(app)/tools/presentation/[id]/edit/_components/layoutPaletteModel";
import {
  supportedInfographicCapabilities,
  UNSUPPORTED_INFOGRAPHIC_NOTE,
  unsupportedInfographicCapabilities,
} from "../../lib/presentation/infographicOps";
import { PRESENTATION_DELETE_UNREACHABLE_ERROR } from "../../lib/data/presentationErrors";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const engineUrl = (process.env.PRESENTON_URL ?? "").trim();

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** The worker driver lives at the repo root's backend workspace. */
const REPO_ROOT = path.resolve(process.cwd(), "..");

/** The export seed's deliberately stale document bytes (PK header). */
const SEEDED_DECK_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

/** A real 1×1 PNG (the engine validates bytes with PIL; this one passes). */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const TEMPLATE_PREFIX = "/app_data/templates/";

/** The content types the proxy must answer for a path's extension (spec §6.9). */
const KNOWN_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** A live deck + referenced path the proxy must serve, discovered in beforeAll. */
type LiveAsset = {
  deckId: string;
  src: string;
  templateId: string;
  contentType: string;
};

let service: SupabaseClient;
let qa1Id = "";
let qa2Id = "";

let presentationsCountBefore = 0;
const createdPresentationIds: string[] = [];
const everCreatedPresentationIds: string[] = [];

/**
 * `presentation.export` job rows the export tests enqueue through the UI.
 * Tracked per test for deletion (asserted) and in `everCreatedExportJobIds`
 * for the afterAll residue read — the full suite's WhatsApp projects assert
 * absolute zero QA1 job residue, so none of these rows may survive.
 */
const createdExportJobIds: string[] = [];
const everCreatedExportJobIds: string[] = [];

/**
 * Throwaway engine decks the F4 live delete cases create
 * (`POST /presentation/create/blank`). The delete flow removes them itself;
 * this list is the failure-path cleanup, and its sweep tolerates the 404 a
 * successful delete leaves.
 */
const engineDeckIds: string[] = [];

/** Enqueue-window slack: Node and Postgres clocks may differ by a little. */
const ENQUEUE_WINDOW_SLACK_MS = 5_000;

let liveAsset: LiveAsset | null = null;
let liveTemplateAsset: LiveAsset | null = null;
let liveSkipReason: string | null = null;
let liveTemplateSkipReason: string | null = null;

/** The engine deck the B4 viewer cases render, with the facts the rail asserts. */
type LiveViewerDeck = {
  deckId: string;
  templateId: string;
  slideCount: number;
};

let liveViewerDeck: LiveViewerDeck | null = null;
let liveViewerSkipReason: string | null = null;
let liveSmartDeckId: string | null = null;
let liveSmartSkipReason: string | null = null;

function assetUrl(presentationId: string, src: string): string {
  return `/api/presentation/${presentationId}/asset?src=${encodeURIComponent(src)}`;
}

/** The E2 session-gated template-asset route's URL for one engine path. */
function templateAssetRouteUrl(src: string): string {
  return `/api/presentation/template-asset?src=${encodeURIComponent(src)}`;
}

/**
 * The route answers every refusal with a sanitized JSON body, never Next's
 * HTML 404 — asserting the shape also proves the request reached the route.
 */
async function expectJsonError(
  res: { status(): number; headers(): Record<string, string>; json(): Promise<unknown> },
  status: number,
): Promise<void> {
  expect(res.status()).toBe(status);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = (await res.json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
}

/** The expectation the proxy's extension mapping must meet, stated locally. */
function expectedContentType(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return KNOWN_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The route only serves `/app_data/templates/<deck template>/…` for deck
 * template paths; discovery must not pick a path the proxy would (correctly)
 * answer 404.
 */
function templateIdOf(path: string): string | null {
  if (!path.startsWith(TEMPLATE_PREFIX)) return null;
  return path.slice(TEMPLATE_PREFIX.length).split("/", 1)[0] ?? "";
}

/**
 * Discover real deck paths the proxy can serve: a v2-standard, non-Smart deck
 * whose full read references at least one path the engine actually answers
 * with non-empty bytes. `primary` is the first fetchable referenced path;
 * `template` is the first fetchable `/app_data/templates/<deck template>/…`
 * path (the rule-3 positive branch). Paths with a known extension are probed
 * first so the 200 cases also prove the content-type mapping for a real type.
 */
async function discoverDeckAssets(): Promise<
  { primary: LiveAsset; template: LiveAsset | null } | { reason: string }
> {
  if (engineUrl === "") {
    return { reason: "PRESENTON_URL is not set in the spec environment." };
  }

  const api = await engineApi();

  try {
    const list = await api.get("/api/v1/ppt/presentation/all?page=1&page_size=50", {
      timeout: 15_000,
    });
    if (!list.ok()) {
      return { reason: `the engine deck list answered ${list.status()}.` };
    }

    const body: unknown = await list.json();
    const items: unknown[] = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.items)
        ? body.items
        : [];

    let primaryAsset: LiveAsset | null = null;
    let templateAsset: LiveAsset | null = null;

    for (const item of items) {
      if (!isRecord(item) || item.version !== "v2-standard") continue;
      if (item.generation_mode === "smart") continue;
      const deckId = typeof item.id === "string" ? item.id : "";
      if (deckId === "") continue;

      const full = await api.get(`/api/v1/ppt/presentation/${deckId}`, {
        timeout: 30_000,
      });
      if (!full.ok()) continue;

      const deck = (await full.json()) as PresentationDeck;
      const templateId = deck.slides[0]?.layout_group ?? "";
      const candidates = collectAssetPaths(deck).filter((src) => {
        const pathTemplate = templateIdOf(src);
        return pathTemplate === null || pathTemplate === templateId;
      });
      candidates.sort((a, b) => {
        const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
        const knownA = KNOWN_CONTENT_TYPES[extensionOf(a)] !== undefined ? 1 : 0;
        const knownB = KNOWN_CONTENT_TYPES[extensionOf(b)] !== undefined ? 1 : 0;
        return knownB - knownA;
      });

      for (const src of candidates) {
        const probe = await api.get(src, { timeout: 30_000 });
        if (!probe.ok()) continue;
        const bytes = await probe.body();
        if (bytes.byteLength === 0) continue;

        const asset: LiveAsset = {
          deckId,
          src,
          templateId,
          contentType: expectedContentType(src),
        };
        if (src.startsWith(TEMPLATE_PREFIX)) {
          if (templateAsset === null) templateAsset = asset;
        } else if (primaryAsset === null) {
          primaryAsset = asset;
        }
        if (primaryAsset !== null && templateAsset !== null) {
          return { primary: primaryAsset, template: templateAsset };
        }
      }
    }

    const primary = primaryAsset ?? templateAsset;
    if (primary === null) {
      return { reason: "no v2-standard deck with an engine-fetchable asset was found." };
    }
    return { primary, template: templateAsset };
  } catch (error) {
    return {
      reason: `engine discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** Public font services a deck may reference; their loads are not spec failures. */
const REACHABLE_EXTERNAL_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

/**
 * E2 — one built-in template the browser/preview cases render end to end: its
 * thumbnail and layouts are engine-servable, and the first layout's images plus
 * the template's fonts are all reachable in a browser through the
 * session-gated template-asset route (or a public font host), so the live case
 * can assert a clean console.
 *
 * `switch` is a pair of layouts that reuse one image slot with different bytes
 * — the preview's deferral case (E2 review fix): switching between them must
 * render the new image immediately, because the preview has no deck save to
 * wait for. Discovery prefers a template that has such a pair; `null` records
 * an honest skip for that one assertion.
 */
type LiveTemplateSwitch = {
  fromLayoutId: string;
  toLayoutId: string;
  fromImageData: string;
  toImageData: string;
};

type LiveBrowserTemplate = {
  id: string;
  name: string;
  /** The engine-relative (engine-public) thumbnail path. */
  thumbnail: string;
  layoutCount: number;
  switch: LiveTemplateSwitch | null;
};

let liveBrowserTemplate: LiveBrowserTemplate | null = null;
let liveBrowserTemplateSkipReason: string | null = null;
/** Why the reused-image-slot switch assertion is not exercised (null = it is). */
let liveBrowserSwitchSkipReason: string | null = null;
/** How many custom templates the engine serves (0 on this engine). */
let liveBrowserCustomCount = 0;

/** Every engine-relative/absolute asset path an element tree references. */
function collectElementAssetPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 30) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    if (
      node.type === "image" &&
      typeof node.data === "string" &&
      node.data.trim() !== ""
    ) {
      paths.add(node.data.trim());
    }
    for (const nested of Object.values(node)) {
      if (nested !== node && (Array.isArray(nested) || isRecord(nested))) {
        visit(nested, depth + 1);
      }
    }
  };
  visit(value, 0);
  return [...paths];
}

/** An external URL is browser-reachable when it is a public font service. */
function isReachableExternalSource(src: string): boolean {
  try {
    return REACHABLE_EXTERNAL_HOSTS.has(new URL(src).hostname);
  } catch {
    return false;
  }
}

/** One engine probe: a public mount path the engine answers with non-empty bytes. */
async function engineServesAsset(
  api: Awaited<ReturnType<typeof engineApi>>,
  src: string,
): Promise<boolean> {
  if (!isEnginePublicAssetPath(src)) return false;
  const probe = await api.get(src, { timeout: 30_000 });
  if (!probe.ok()) return false;
  return (await probe.body()).byteLength > 0;
}

/** Every engine asset one layout references must be browser-reachable. */
async function layoutAssetsReachable(
  api: Awaited<ReturnType<typeof engineApi>>,
  layout: TemplateLayout,
): Promise<boolean> {
  for (const src of collectElementAssetPaths(layout.components)) {
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) {
      if (!isReachableExternalSource(src)) return false;
      continue;
    }
    if (!(await engineServesAsset(api, src))) return false;
  }
  return true;
}

/** Every template font must be a public-host stylesheet or a servable file. */
async function templateFontsReachable(
  api: Awaited<ReturnType<typeof engineApi>>,
  fonts: unknown,
): Promise<boolean> {
  if (!isRecord(fonts)) return true;
  for (const value of Object.values(fonts)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const src = value.trim();
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) {
      if (!isReachableExternalSource(src)) return false;
      continue;
    }
    if (!(await engineServesAsset(api, src))) return false;
  }
  return true;
}

/**
 * Every image slot in a layout, keyed by the identity React reconciles on:
 * the component's `id` (DeckStage keys component frames by it) plus the
 * element's position path. Two layouts sharing a key render the same
 * `ImageElement` instance, which is exactly when the deferral used to fire.
 * A slot remembers whether the element renders a recolored data URI instead of
 * its proxy URL, so the live count assertion never picks such a slot.
 */
type TemplateImageSlot = { data: string; recolored: boolean };

function templateImageSlots(layout: TemplateLayout): Map<string, TemplateImageSlot> {
  const slots = new Map<string, TemplateImageSlot>();
  const components = Array.isArray(layout.components) ? layout.components : [];
  const visitElement = (element: unknown, path: string): void => {
    if (!isRecord(element)) return;
    if (
      element.type === "image" &&
      typeof element.data === "string" &&
      element.data.trim() !== ""
    ) {
      slots.set(path, {
        data: element.data.trim(),
        recolored:
          element.is_icon === true &&
          typeof element.color === "string" &&
          element.color.trim() !== "",
      });
    }
    for (const key of ["child", "children"]) {
      const nested = element[key];
      if (Array.isArray(nested)) {
        nested.forEach((child, index) =>
          visitElement(child, `${path}.${key}${index}`),
        );
      } else if (isRecord(nested)) {
        visitElement(nested, `${path}.${key}`);
      }
    }
  };
  components.forEach((component, componentIndex) => {
    const componentKey =
      typeof component.id === "string" && component.id !== ""
        ? component.id
        : `#${componentIndex}`;
    const elements = Array.isArray(component.elements) ? component.elements : [];
    elements.forEach((element, elementIndex) => {
      visitElement(element, `${componentKey}:${elementIndex}`);
    });
  });
  return slots;
}

/**
 * Find two layouts that reuse one image slot with different bytes and whose
 * assets are all browser-reachable. The pair must be unique — exactly one
 * occurrence of each image in its own layout and none in the other — so the
 * live case's src-count assertion identifies the reused slot's DOM node
 * unambiguously, and neither image may render as a recolored data URI. Null
 * records an honest skip for the deferral assertion (the rest of the live case
 * still runs).
 */
async function findReusedImageSwitch(
  api: Awaited<ReturnType<typeof engineApi>>,
  layouts: TemplateLayout[],
): Promise<LiveTemplateSwitch | null> {
  const slots = layouts.map((layout) => templateImageSlots(layout));
  const countData = (
    map: Map<string, TemplateImageSlot>,
    data: string,
  ): number =>
    [...map.values()].filter((slot) => slot.data === data).length;

  for (let from = 0; from < layouts.length; from += 1) {
    for (let to = from + 1; to < layouts.length; to += 1) {
      for (const [slotKey, fromSlot] of slots[from]) {
        const toSlot = slots[to].get(slotKey);
        if (toSlot === undefined || toSlot.data === fromSlot.data) continue;
        if (fromSlot.recolored || toSlot.recolored) continue;
        if (countData(slots[from], fromSlot.data) !== 1) continue;
        if (countData(slots[to], fromSlot.data) !== 0) continue;
        if (countData(slots[to], toSlot.data) !== 1) continue;
        if (countData(slots[from], toSlot.data) !== 0) continue;
        if (!(await layoutAssetsReachable(api, layouts[from]))) continue;
        if (!(await layoutAssetsReachable(api, layouts[to]))) continue;
        return {
          fromLayoutId: layouts[from].id,
          toLayoutId: layouts[to].id,
          fromImageData: fromSlot.data,
          toImageData: toSlot.data,
        };
      }
    }
  }
  return null;
}

/**
 * Discover the built-in template the E2 browser cases render. Every built-in
 * thumbnail the browser page shows must be engine-servable (a card that falls
 * back to its placeholder would log a resource error), and the chosen
 * template's first layout + fonts must be browser-reachable for the preview.
 * A template with a reused-image-slot layout pair is preferred so the
 * deferral assertion always has a target; the first renderable template is the
 * fallback with that one assertion recorded as skipped. Absence of any
 * renderable template records an honest skip reason; the access-guard cases
 * never skip.
 */
async function discoverBrowserTemplates(): Promise<
  | {
      template: LiveBrowserTemplate;
      customCount: number;
      switchSkipReason: string | null;
    }
  | { reason: string }
> {
  if (engineUrl === "") {
    return { reason: "PRESENTON_URL is not set in the spec environment." };
  }

  const api = await engineApi();
  try {
    const list = await api.get(
      "/api/v1/ppt/template/all?page=1&page_size=100",
      { timeout: 15_000 },
    );
    if (!list.ok()) {
      return { reason: `the engine template list answered ${list.status()}.` };
    }
    const body: unknown = await list.json();
    const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];
    const builtIns = items.filter(
      (item) => isRecord(item) && item.is_default === true,
    );
    const customCount = items.filter(
      (item) => isRecord(item) && item.is_default !== true,
    ).length;

    if (builtIns.length === 0) {
      return { reason: "the engine serves no built-in templates." };
    }

    for (const item of builtIns) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const thumbnail =
        typeof item.thumbnail === "string" ? item.thumbnail.trim() : "";
      if (id === "" || thumbnail === "") {
        return {
          reason: `built-in template "${id || "(no id)"}" has no thumbnail to serve.`,
        };
      }
      if (!(await engineServesAsset(api, thumbnail))) {
        return {
          reason: `the engine does not serve a thumbnail for built-in template "${id}".`,
        };
      }
    }

    let fallback: { template: LiveBrowserTemplate; customCount: number } | null =
      null;

    for (const item of builtIns) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name : id;
      const thumbnail =
        typeof item.thumbnail === "string" ? item.thumbnail.trim() : "";

      const detail = await api.get(`/api/v1/ppt/template/${id}`, {
        timeout: 30_000,
      });
      if (!detail.ok()) continue;
      const template = (await detail.json()) as PresentationTemplate;
      const layouts = (Array.isArray(template.layouts?.layouts)
        ? template.layouts.layouts
        : []
      ).filter((layout) => Array.isArray(layout?.components));
      if (layouts.length === 0) continue;

      if (!(await layoutAssetsReachable(api, layouts[0]))) continue;
      if (!(await templateFontsReachable(api, template.fonts))) continue;

      const switchTarget = await findReusedImageSwitch(api, layouts);
      const candidate: LiveBrowserTemplate = {
        id,
        name,
        thumbnail,
        layoutCount: layouts.length,
        switch: switchTarget,
      };
      if (switchTarget !== null) {
        return { template: candidate, customCount, switchSkipReason: null };
      }
      if (fallback === null) fallback = { template: candidate, customCount };
    }

    if (fallback !== null) {
      return {
        ...fallback,
        switchSkipReason:
          "no built-in template reuses an image slot across two layouts.",
      };
    }
    return {
      reason:
        "no built-in template with a browser-reachable first layout was found.",
    };
  } catch (error) {
    return {
      reason: `template discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** The E2 live cases skip with a recorded reason when no template qualifies. */
function requireLiveBrowserTemplate(): LiveBrowserTemplate {
  if (liveBrowserTemplate !== null) return liveBrowserTemplate;
  test.skip(
    true,
    liveBrowserTemplateSkipReason ??
      "No engine template with servable art was discovered.",
  );
  throw new Error("unreachable");
}


/** Every absolute http(s) URL anywhere in the deck JSON (browser-loaded resources). */
function collectExternalAssetUrls(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 40 || node === null || node === undefined) return;
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node)) found.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const item of Object.values(node)) walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return [...found];
}

/**
 * Discover the decks the B4 viewer cases render, probed so the browser's own
 * loads stay console-clean: a multi-slide standard deck whose every referenced
 * mount path the proxy will allow and the engine answers 200 for (and whose
 * only external URLs are public font services), plus one Smart deck for the
 * labelled-fallback case. Absence records a skip reason; access-guard cases
 * never call this.
 */
async function discoverViewerDecks(): Promise<
  { viewer: LiveViewerDeck; smartDeckId: string | null } | { reason: string }
> {
  if (engineUrl === "") {
    return { reason: "PRESENTON_URL is not set in the spec environment." };
  }

  const api = await engineApi();

  try {
    const list = await api.get("/api/v1/ppt/presentation/all?page=1&page_size=50", {
      timeout: 15_000,
    });
    if (!list.ok()) {
      return { reason: `the engine deck list answered ${list.status()}.` };
    }

    const body: unknown = await list.json();
    const items: unknown[] = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.items)
        ? body.items
        : [];

    let viewer: LiveViewerDeck | null = null;
    let smartDeckId: string | null = null;

    for (const item of items) {
      if (!isRecord(item) || item.version !== "v2-standard") continue;
      const deckId = typeof item.id === "string" ? item.id : "";
      if (deckId === "") continue;

      const full = await api.get(`/api/v1/ppt/presentation/${deckId}`, {
        timeout: 30_000,
      });
      if (!full.ok()) continue;
      const deck = (await full.json()) as PresentationDeck;

      if (smartDeckId === null && isSmartDeck(deck)) {
        smartDeckId = deckId;
        continue;
      }
      if (viewer !== null) continue;
      if (!Array.isArray(deck.slides) || deck.slides.length < 2) continue;

      const templateId = deck.slides[0]?.layout_group ?? "";
      const paths = collectAssetPaths(deck);
      if (paths.length === 0) continue;

      let usable = true;
      for (const src of paths) {
        if (classifyAssetPath(src, deck, templateId) !== "allowed") {
          usable = false;
          break;
        }
        const probe = await api.get(src, { timeout: 30_000 });
        if (!probe.ok() || (await probe.body()).byteLength === 0) {
          usable = false;
          break;
        }
      }
      if (!usable) continue;

      const external = collectExternalAssetUrls(deck);
      const allReachable = external.every((url) => {
        try {
          return REACHABLE_EXTERNAL_HOSTS.has(new URL(url).hostname);
        } catch {
          return false;
        }
      });
      if (!allReachable) continue;

      viewer = { deckId, templateId, slideCount: deck.slides.length };
    }

    if (viewer === null) {
      return {
        reason: "no multi-slide v2-standard deck with browser-reachable assets was found.",
      };
    }
    return { viewer, smartDeckId };
  } catch (error) {
    return {
      reason: `engine discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** The live viewer cases skip with a recorded reason when no deck qualifies. */
function requireLiveViewerDeck(): LiveViewerDeck {
  if (liveViewerDeck !== null) return liveViewerDeck;
  test.skip(
    true,
    liveViewerSkipReason ?? "No engine deck available for the viewer cases.",
  );
  throw new Error("unreachable");
}

/** The Smart-fallback case skips with a recorded reason when no Smart deck exists. */
function requireLiveSmartDeck(): string {
  if (liveSmartDeckId !== null) return liveSmartDeckId;
  test.skip(true, liveSmartSkipReason ?? "No Smart deck is available on the engine.");
  throw new Error("unreachable");
}

/**
 * The live deck the C4 editor cases mutate: the discovered viewer deck plus
 * the exact first editable text element (a top-level `text` element with a
 * real frame) and the original slide/theme/title the tests restore afterwards.
 */
type EditorTarget = {
  deckId: string;
  templateId: string;
  slideCount: number;
  /**
   * Every slide's layout at discovery time, in order — the fixture-deck
   * residue guard's expected shape (the count alone would miss a swap).
   */
  originalLayouts: string[];
  /** `[data-editor-element-hit]` key of the first top-level text element. */
  hitKey: string;
  originalSlide: DeckSlide;
  originalTitle: string | null;
  originalTheme: DeckTheme | DeckThemePackage | null;
};

let editorTarget: EditorTarget | null = null;
let editorSkipReason: string | null = null;

/** A live custom theme the picker case can assert (label + engine id). */
let liveCustomTheme: { id: string; label: string } | null = null;
let liveCustomThemeSkipReason: string | null = null;

/**
 * Two stored conversations on the discovered deck for the D8
 * conversation-switch case. Chat is provider-dependent, so this discovery (and
 * its case) records an honest skip until a turn has ever completed.
 */
type ChatRaceTarget = { deckId: string; conversationIds: [string, string] };
let chatRaceTarget: ChatRaceTarget | null = null;
let chatRaceSkipReason: string | null = null;

/** Finds two conversations on the discovered deck; absence records a reason. */
async function discoverChatRaceTarget(
  deckId: string,
): Promise<ChatRaceTarget | { reason: string }> {
  if (engineUrl === "") {
    return { reason: "PRESENTON_URL is not set in the spec environment." };
  }
  const api = await engineApi();
  try {
    const ids = await engineConversationIds(api, deckId);
    if (ids.length < 2) {
      return {
        reason:
          "the engine stores fewer than two conversations for the discovered deck (no chat turn has completed here).",
      };
    }
    return { deckId, conversationIds: [ids[0], ids[1]] };
  } catch (error) {
    return {
      reason: `chat conversation discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** Reads the engine's custom themes; absence records a skip reason. */
async function discoverCustomTheme(): Promise<
  { id: string; label: string } | { reason: string }
> {
  if (engineUrl === "") {
    return { reason: "PRESENTON_URL is not set in the spec environment." };
  }
  const api = await engineApi();
  try {
    const response = await api.get("/api/v1/ppt/themes/all", {
      timeout: 15_000,
    });
    if (!response.ok()) {
      return { reason: `the engine themes list answered ${response.status()}.` };
    }
    const body: unknown = await response.json();
    const entries = Array.isArray(body) ? body : [];
    const named = entries.find(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        entry.id !== "" &&
        typeof entry.name === "string" &&
        entry.name.trim() !== "",
    );
    if (!isRecord(named) || typeof named.id !== "string") {
      return { reason: "the engine serves no named custom theme." };
    }
    return { id: named.id, label: (named.name as string).trim() };
  } catch (error) {
    return {
      reason: `custom theme discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** The custom-theme picker case skips when the engine serves none. */
function requireLiveCustomTheme(): { id: string; label: string } {
  if (liveCustomTheme !== null) return liveCustomTheme;
  test.skip(
    true,
    liveCustomThemeSkipReason ?? "No custom theme is available on the engine.",
  );
  throw new Error("unreachable");
}

/**
 * Finds the editor's first click target on the discovered deck's first slide:
 * a top-level `text` element (component element or root element) with a
 * non-zero frame. No such element anywhere in the deck records a skip reason.
 */
async function discoverEditorTarget(
  deckId: string,
): Promise<EditorTarget | { reason: string }> {
  const api = await engineApi();

  try {
    const full = await api.get(`/api/v1/ppt/presentation/${deckId}`, {
      timeout: 30_000,
    });
    if (!full.ok()) {
      return { reason: `the engine deck read answered ${full.status()}.` };
    }
    const deck = (await full.json()) as PresentationDeck;
    const slides = Array.isArray(deck.slides) ? deck.slides : [];
    const slide = slides[0];
    if (slide === undefined) {
      return { reason: "the discovered deck has no first slide." };
    }

    const ui = slide.ui;
    if (typeof ui === "object" && ui !== null) {
      const components = Array.isArray(ui.components) ? ui.components : [];
      for (let ci = 0; ci < components.length; ci += 1) {
        const elements = Array.isArray(components[ci].elements)
          ? components[ci].elements
          : [];
        for (let ei = 0; ei < elements.length; ei += 1) {
          const element = elements[ei];
          if (
            element.type === "text" &&
            (element.size?.width ?? 0) > 0 &&
            (element.size?.height ?? 0) > 0
          ) {
            return {
              deckId,
              templateId: slide.layout_group || "general",
              slideCount: slides.length,
              originalLayouts: slides.map((entry) => entry.layout),
              hitKey: `components:${ci}/${ei}`,
              originalSlide: slide,
              originalTitle:
                typeof deck.title === "string" ? deck.title : null,
              originalTheme: deck.theme ?? null,
            };
          }
        }
      }
    }
    return {
      reason:
        "the first slide has no top-level text element with a frame to edit.",
    };
  } catch (error) {
    return {
      reason: `editor target discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** The editor cases skip with a recorded reason when no target exists. */
function requireEditorTarget(): EditorTarget {
  if (editorTarget !== null) return editorTarget;
  test.skip(
    true,
    editorSkipReason ?? "No engine deck with an editable text element was discovered.",
  );
  throw new Error("unreachable");
}

/**
 * The live deck's image element the D3 cases mutate: the first top-level
 * `image` element with a real frame, on whatever slide it lives (the editor
 * navigates to that slide by its thumbnail index).
 */
type EditorImageTarget = {
  deckId: string;
  templateId: string;
  slideIndex: number;
  /** `[data-editor-element-hit]` key of the image element. */
  hitKey: string;
  originalSlide: DeckSlide;
};

let editorImageTarget: EditorImageTarget | null = null;
let editorImageSkipReason: string | null = null;

/** Finds the first framed top-level image element in the discovered deck. */
async function discoverEditorImageTarget(
  deckId: string,
): Promise<EditorImageTarget | { reason: string }> {
  const api = await engineApi();

  try {
    const full = await api.get(`/api/v1/ppt/presentation/${deckId}`, {
      timeout: 30_000,
    });
    if (!full.ok()) {
      return { reason: `the engine deck read answered ${full.status()}.` };
    }
    const deck = (await full.json()) as PresentationDeck;
    const slides = Array.isArray(deck.slides) ? deck.slides : [];

    for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
      const slide = slides[slideIndex];
      const ui = slide.ui;
      if (typeof ui !== "object" || ui === null) continue;
      const components = Array.isArray(ui.components) ? ui.components : [];
      for (let ci = 0; ci < components.length; ci += 1) {
        const elements = Array.isArray(components[ci].elements)
          ? components[ci].elements
          : [];
        for (let ei = 0; ei < elements.length; ei += 1) {
          const element = elements[ei];
          if (
            element.type === "image" &&
            (element.size?.width ?? 0) > 0 &&
            (element.size?.height ?? 0) > 0
          ) {
            return {
              deckId,
              templateId: slide.layout_group || "general",
              slideIndex,
              hitKey: `components:${ci}/${ei}`,
              originalSlide: slide,
            };
          }
        }
      }
    }
    return { reason: "the deck has no top-level image element with a frame." };
  } catch (error) {
    return {
      reason: `image target discovery failed: ${engineErrorText(error)}`,
    };
  } finally {
    await api.dispose();
  }
}

/** The D3 live cases skip with a recorded reason when no image target exists. */
function requireEditorImageTarget(): EditorImageTarget {
  if (editorImageTarget !== null) return editorImageTarget;
  test.skip(
    true,
    editorImageSkipReason ??
      "No engine deck with an editable image element was discovered.",
  );
  throw new Error("unreachable");
}

/** Reads one component/element from a stored slide by its editor hit key. */
function elementAtHitKey(
  deck: PresentationDeck,
  slideIndex: number,
  hitKey: string,
): Record<string, unknown> | null {
  const [componentIndex, elementIndex] = hitKey
    .replace("components:", "")
    .split("/")
    .map((part) => Number(part));
  const slide = deck.slides[slideIndex];
  if (typeof slide !== "object" || slide === null) return null;
  const ui = slide.ui;
  if (typeof ui !== "object" || ui === null) return null;
  const components = Array.isArray(ui.components) ? ui.components : [];
  const element = components[componentIndex]?.elements?.[elementIndex];
  return typeof element === "object" && element !== null
    ? (element as Record<string, unknown>)
    : null;
}

/**
 * The one direct engine context this spec uses — discovery probes, the theme
 * list, the editor fixtures/restores and every engine re-read. The bearer is
 * read from `process.env.PRESENTON_API_KEY` at call time (the key
 * `playwright.config.ts` loaded into this process) and sent whenever it is
 * non-empty; a missing key sends no header, so the engine answers 401 and
 * discovery records its honest skip rather than passing silently.
 */
async function engineApi() {
  const key = (process.env.PRESENTON_API_KEY ?? "").trim();
  return playwrightRequest.newContext({
    baseURL: engineUrl,
    ...(key !== ""
      ? { extraHTTPHeaders: { Authorization: `Bearer ${key}` } }
      : {}),
  });
}

/**
 * Playwright's APIRequestContext errors embed a request call log that includes
 * the `Authorization` header. The engine's bearer must never reach a test log,
 * a skip reason or a report, so callers strip from the call log onward before
 * the text is logged or embedded in a skip reason.
 */
function engineErrorText(error: unknown): string {
  const message =
    error instanceof Error && error.message !== ""
      ? error.message
      : "unknown error";
  const callLog = message.indexOf("Call log:");
  return callLog >= 0 ? message.slice(0, callLog).trim() : message;
}

/**
 * Whether this run's engine answers right now. The spec process and the Next
 * server read the same `PRESENTON_URL` (playwright.config.ts loads the env
 * file into this process and the webServer inherits it), so this is the fact
 * the delete action's adapter will see. `false` for an unset URL.
 */
let engineReachability: boolean | null = null;
async function isEngineReachable(): Promise<boolean> {
  if (engineReachability !== null) return engineReachability;
  if (engineUrl === "") {
    engineReachability = false;
    return false;
  }
  try {
    const response = await fetch(
      `${engineUrl.replace(/\/+$/, "")}/api/v1/auth/status`,
      { signal: AbortSignal.timeout(2_000) },
    );
    engineReachability = response.ok;
  } catch {
    engineReachability = false;
  }
  return engineReachability;
}

/**
 * Removes every throwaway engine deck the F4 live cases created. Best effort
 * by design: the live case itself asserts the deck is gone after the UI
 * delete, and this sweep exists for the failure paths only (a 404 from an
 * already-deleted deck is a response, not a throw).
 */
async function deleteCreatedEngineDecks(): Promise<void> {
  if (engineDeckIds.length === 0) return;
  const ids = [...engineDeckIds];
  engineDeckIds.length = 0;
  if (engineUrl === "") return;

  let api: Awaited<ReturnType<typeof engineApi>> | null = null;
  try {
    api = await engineApi();
    for (const id of ids) {
      await api.delete(`/api/v1/ppt/presentation/${id}`, { timeout: 15_000 });
    }
  } catch {
    // Best effort; the residue is recorded by the live case's own assertion.
  } finally {
    await api?.dispose();
  }
}

/**
 * Creates one throwaway blank deck on the live engine (F4's delete target).
 * A failure is a recorded reason, never a fake id: the caller skips honestly.
 */
async function createBlankEngineDeck(
  api: Awaited<ReturnType<typeof engineApi>>,
): Promise<{ id: string } | { reason: string }> {
  try {
    const created = await api.post("/api/v1/ppt/presentation/create/blank", {
      timeout: 30_000,
    });
    if (!created.ok()) {
      return {
        reason: `the engine's blank-deck route answered ${created.status()}.`,
      };
    }
    const deck = (await created.json()) as { id?: unknown };
    if (typeof deck.id !== "string" || deck.id === "") {
      return { reason: "the engine returned a blank deck without an id." };
    }
    return { id: deck.id };
  } catch (error) {
    return {
      reason: `the engine could not create a throwaway deck: ${engineErrorText(error)}`,
    };
  }
}

/**
 * The engine's stored conversation ids for one deck, in its own list order — a
 * before/after diff deletes exactly the conversations a chat test created
 * (the abort path may commit one after Stop even though the panel never saw a
 * `complete` frame).
 */
async function engineConversationIds(
  api: Awaited<ReturnType<typeof engineApi>>,
  deckId: string,
): Promise<string[]> {
  let response: Awaited<ReturnType<typeof api.get>>;
  try {
    response = await api.get(
      `/api/v1/ppt/chat/conversations?presentation_id=${deckId}`,
      { timeout: 15_000 },
    );
  } catch {
    return [];
  }
  if (!response.ok()) return [];
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body
    .map((entry) =>
      isRecord(entry) && typeof entry.conversation_id === "string"
        ? entry.conversation_id
        : null,
    )
    .filter((id): id is string => id !== null && id !== "");
}

/** Deletes only the conversations that appeared after `before`. */
async function deleteNewEngineConversations(
  api: Awaited<ReturnType<typeof engineApi>>,
  deckId: string,
  before: string[],
): Promise<void> {
  const after = await engineConversationIds(api, deckId);
  for (const conversationId of after) {
    if (before.includes(conversationId)) continue;
    await api.delete(
      `/api/v1/ppt/chat/conversation?presentation_id=${deckId}&conversation_id=${conversationId}`,
      { timeout: 15_000 },
    );
  }
}

/**
 * Restores one engine slide to the snapshot a case captured. The snapshot can
 * predate Task D6's structural restores, which re-insert every stored slide
 * with a fresh id (the production full-array replace), so the helper first
 * re-reads the deck and resolves the **current** stored slide: by the
 * snapshot's id when it is still valid, otherwise by the captured
 * `index` + `layout` and, as a last resort, by `index` alone. The snapshot's
 * fields are written under the current ids. A failed lookup or write is a
 * loud failure, never the silent no-op the stale-id snapshot used to produce
 * (and the `afterAll` fixture-deck residue guard catches any survivor).
 */
async function restoreEngineSlide(
  api: Awaited<ReturnType<typeof engineApi>>,
  slide: DeckSlide,
): Promise<void> {
  const deckId =
    typeof slide.presentation === "string" ? slide.presentation : "";
  if (deckId === "") {
    throw new Error(
      "restoreEngineSlide: the snapshot carries no presentation id.",
    );
  }

  const current = await readEngineDeck(api, deckId);
  const slides = Array.isArray(current.slides) ? current.slides : [];
  const currentSlide =
    slides.find((candidate) => candidate.id === slide.id) ??
    slides.find(
      (candidate) =>
        candidate.index === slide.index && candidate.layout === slide.layout,
    ) ??
    slides.find((candidate) => candidate.index === slide.index);
  if (currentSlide === undefined) {
    throw new Error(
      `restoreEngineSlide: slide ${slide.id} (index ${slide.index}, layout ${slide.layout}) is not stored on deck ${deckId}.`,
    );
  }

  const response = await api.patch("/api/v1/ppt/presentation/slide_update", {
    data: {
      slide: {
        ...slide,
        id: currentSlide.id,
        presentation: deckId,
        index: currentSlide.index,
      },
    },
    timeout: 30_000,
  });
  expect(
    response.ok(),
    `engine slide restore (${deckId} → slide ${currentSlide.id}): ${response.status()}`,
  ).toBe(true);
}

/**
 * Restores the engine deck's whole slide array through the production
 * structural path (Task D6's live cases add/remove slides). Fresh ids mirror
 * the editor's save; `n_slides` is the count the route never recomputes. The
 * theme always travels (the upstream update bug nulls a missing theme).
 */
async function restoreEngineDeckSlides(
  api: Awaited<ReturnType<typeof engineApi>>,
  deckId: string,
  slides: DeckSlide[],
  theme: DeckTheme | DeckThemePackage | null,
): Promise<void> {
  if (theme === null || theme === undefined) return;
  const fresh = slides.map((slide, index) => ({
    ...slide,
    id: randomUUID(),
    index,
  }));
  const response = await api.patch("/api/v1/ppt/presentation/update", {
    data: { id: deckId, theme, slides: fresh, n_slides: fresh.length },
    timeout: 60_000,
  });
  expect(response.ok(), `engine deck restore: ${response.status()}`).toBe(true);
}

/** One engine metadata restore; the theme must always travel (upstream bug). */
async function restoreEngineDeck(
  api: Awaited<ReturnType<typeof engineApi>>,
  deckId: string,
  title: string | null,
  theme: DeckTheme | DeckThemePackage | null,
): Promise<void> {
  if (theme === null || theme === undefined) return;
  await api.patch("/api/v1/ppt/presentation/update", {
    data: {
      id: deckId,
      ...(title !== null && title !== "" ? { title } : {}),
      theme,
    },
    timeout: 30_000,
  });
}

/** Reads the live deck back through the engine (authoritative persistence). */
async function readEngineDeck(
  api: Awaited<ReturnType<typeof engineApi>>,
  deckId: string,
): Promise<PresentationDeck> {
  const response = await api.get(`/api/v1/ppt/presentation/${deckId}`, {
    timeout: 30_000,
  });
  expect(response.ok(), `engine deck read: ${response.status()}`).toBe(true);
  return (await response.json()) as PresentationDeck;
}

/**
 * Every QA scratch marker a live case seeds and restores: the deterministic
 * `qa-d*-…` component ids / `qa_d*_…` element names and the `QA-C4`/`QA-D8`
 * text markers. Used only by the residue guard — a survivor means a restore
 * no-opped (the stale-snapshot defect this file fixed on 2026-09-20).
 */
const FIXTURE_RESIDUE_PATTERN = /qa[-_]d\d|QA-[CD]\d/;

/** The known scratch markers found anywhere in a deck's JSON, de-duplicated. */
function fixtureResidueMarkers(deck: PresentationDeck): string[] {
  const markers = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 40 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (FIXTURE_RESIDUE_PATTERN.test(value)) markers.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(deck, 0);
  return [...markers];
}

/** Runs the worker once against the live engine (worker-lock serialized). */
function runWorkerOnceLive(workerId = "spec-presentation-editor"): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", `--worker-id=${workerId}`],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

/** QA1/QA2 user ids from the local Admin API — no QA password needed to seed rows. */
async function resolveQaIds(): Promise<[string, string]> {
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  expect(error, `admin user list: ${error?.message}`).toBeNull();

  const byEmail = new Map<string, string>();
  for (const user of data?.users ?? []) {
    if (typeof user.email === "string") byEmail.set(user.email.toLowerCase(), user.id);
  }

  const first = byEmail.get(QA1);
  const second = byEmail.get(QA2);
  if (!first || !second) {
    throw new Error("Missing QA identities; run `npm run seed:qa` (see QA_SESSION.md).");
  }
  return [first, second];
}

/** Seed one owned `presentations` row; registered for afterEach/afterAll cleanup. */
async function seedOwnedPresentation(
  userId: string,
  presentonPresentationId: string | null,
  template = "general",
  extra: {
    documentId?: string;
    prompt?: string;
    status?: "queued" | "running" | "succeeded" | "failed";
    slidesDone?: number;
    slidesTotal?: number;
    errorMessage?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const { error } = await service.from("presentations").insert({
    id,
    user_id: userId,
    prompt: extra.prompt ?? "Asset proxy fixture",
    template,
    format: "pptx",
    status: extra.status ?? "succeeded",
    presenton_presentation_id: presentonPresentationId,
    ...(extra.documentId !== undefined ? { document_id: extra.documentId } : {}),
    ...(extra.slidesDone !== undefined ? { slides_done: extra.slidesDone } : {}),
    ...(extra.slidesTotal !== undefined
      ? { slides_total: extra.slidesTotal }
      : {}),
    ...(extra.errorMessage !== undefined
      ? { error_message: extra.errorMessage }
      : {}),
  });
  expect(error, `seed presentation: ${error?.message}`).toBeNull();
  createdPresentationIds.push(id);
  everCreatedPresentationIds.push(id);
  return id;
}

const createdDocumentIds: string[] = [];
const createdDocumentPaths: string[] = [];
const everCreatedDocumentIds: string[] = [];
const everCreatedDocumentPaths: string[] = [];

/**
 * One owned deck document (row + storage object) the export worker replaces
 * in place: the same shape the C1 job spec seeds, with deliberately stale
 * bytes/mime so the replace is observable. Registered for cleanup.
 */
async function seedDeckDocument(
  userId: string,
): Promise<{ id: string; storagePath: string }> {
  const id = randomUUID();
  const storagePath = `${userId}/${id}/Deck.pptx`;

  const uploaded = await service.storage
    .from("documents")
    .upload(storagePath, SEEDED_DECK_BYTES, {
      contentType: "application/pdf",
      upsert: false,
    });
  expect(uploaded.error, `seed deck object: ${uploaded.error?.message}`).toBeNull();
  createdDocumentPaths.push(storagePath);
  everCreatedDocumentPaths.push(storagePath);

  const inserted = await service.from("documents").insert({
    id,
    user_id: userId,
    name: "Deck.pptx",
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: SEEDED_DECK_BYTES.byteLength,
    status: "uploaded",
    source: "presentation",
  });
  expect(inserted.error, `seed deck row: ${inserted.error?.message}`).toBeNull();
  createdDocumentIds.push(id);
  everCreatedDocumentIds.push(id);

  return { id, storagePath };
}

/** Whether one exact bucket key still exists under its owner folder (F4). */
async function storageObjectExists(storagePath: string): Promise<boolean> {
  const slash = storagePath.lastIndexOf("/");
  const { data, error } = await service.storage
    .from("documents")
    .list(storagePath.slice(0, slash));
  expect(error, `storage list for ${storagePath}: ${error?.message}`).toBeNull();
  return (data ?? []).some(
    (entry) => entry.name === storagePath.slice(slash + 1),
  );
}

/**
 * Waits for the `presentation.export` job the Export click enqueues for
 * `presentationId`, scoped to rows created inside this click's enqueue window
 * (`sinceIso`, which is backdated by {@link ENQUEUE_WINDOW_SLACK_MS} for clock
 * skew) so a pre-existing row can never be captured. The captured id is
 * registered for per-test teardown. Fails with the honest message when the
 * enqueue never lands instead of running the worker against nothing.
 */
async function awaitEnqueuedExportJob(
  presentationId: string,
  sinceIso: string,
): Promise<string> {
  let jobId = "";
  await expect
    .poll(
      async () => {
        const { data, error } = await service
          .from("jobs")
          .select("id")
          .eq("kind", "presentation.export")
          .contains("payload", { presentationId })
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(1);
        expect(error, `export job read: ${error?.message}`).toBeNull();
        jobId = data?.[0]?.id ?? "";
        return jobId;
      },
      {
        timeout: 15_000,
        message: `the Export click must enqueue a presentation.export job for ${presentationId} at/after ${sinceIso}`,
      },
    )
    .not.toBe("");

  createdExportJobIds.push(jobId);
  everCreatedExportJobIds.push(jobId);
  return jobId;
}

/**
 * Deletes every `presentation.export` job row belonging to the given fixture
 * presentations (`user_id` is QA1's because the UI action enqueues with the
 * session user). Called under the worker lock right after the settle and
 * again in `afterEach`; the payload sweep also catches a click whose enqueue
 * landed after a failed capture.
 */
async function deleteExportJobsFor(presentationIds: string[]): Promise<void> {
  for (const presentationId of presentationIds) {
    const { error } = await service
      .from("jobs")
      .delete()
      .eq("kind", "presentation.export")
      .contains("payload", { presentationId });
    expect(
      error,
      `teardown export jobs for ${presentationId}: ${error?.message}`,
    ).toBeNull();
  }
}

/**
 * The live cases skip with a recorded reason when no suitable engine deck was
 * discovered; the unsafe/missing-src/cross-owner/401 cases never call this.
 */
function requireLiveAsset(): LiveAsset {
  if (liveAsset !== null) return liveAsset;
  test.skip(true, liveSkipReason ?? "No engine deck available for the live cases.");
  throw new Error("unreachable");
}

/** The rule-3 positive case: the deck's own `/app_data/templates/<id>/…` path. */
function requireLiveTemplateAsset(): LiveAsset {
  if (liveTemplateAsset !== null) return liveTemplateAsset;
  test.skip(
    true,
    liveTemplateSkipReason ??
      liveSkipReason ??
      "No deck-referenced template static asset was discovered.",
  );
  throw new Error("unreachable");
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `presentations-ui is local-only; refusing target "${url || "(unset)"}"`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
    );
  }

  service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const count = await service
    .from("presentations")
    .select("id", { count: "exact", head: true });
  expect(count.error, `pre-run presentations count: ${count.error?.message}`).toBeNull();
  presentationsCountBefore = count.count ?? 0;

  [qa1Id, qa2Id] = await resolveQaIds();

  const discovered = await discoverDeckAssets();
  if ("reason" in discovered) {
    liveSkipReason = discovered.reason;
    liveTemplateSkipReason = discovered.reason;
  } else {
    liveAsset = discovered.primary;
    liveTemplateAsset = discovered.template;
    // Evidence: which real deck/path the live cases exercise (no secret).
    console.log(
      `[qa-presentations-ui] live deck ${discovered.primary.deckId} asset ${discovered.primary.src}`,
    );
    if (discovered.template === null) {
      liveTemplateSkipReason = "no deck-referenced template static asset was discovered.";
    } else {
      console.log(
        `[qa-presentations-ui] live template deck ${discovered.template.deckId} asset ${discovered.template.src}`,
      );
    }
  }

  const viewerDiscovery = await discoverViewerDecks();
  if ("reason" in viewerDiscovery) {
    liveViewerSkipReason = viewerDiscovery.reason;
    liveSmartSkipReason = viewerDiscovery.reason;
    editorSkipReason = viewerDiscovery.reason;
    editorImageSkipReason = viewerDiscovery.reason;
  } else {
    liveViewerDeck = viewerDiscovery.viewer;
    console.log(
      `[qa-presentations-ui] viewer deck ${viewerDiscovery.viewer.deckId} slides ${viewerDiscovery.viewer.slideCount}`,
    );
    if (viewerDiscovery.smartDeckId === null) {
      liveSmartSkipReason = "no Smart deck was discovered on the engine.";
    } else {
      liveSmartDeckId = viewerDiscovery.smartDeckId;
      console.log(`[qa-presentations-ui] smart deck ${viewerDiscovery.smartDeckId}`);
    }

    const editorDiscovery = await discoverEditorTarget(
      viewerDiscovery.viewer.deckId,
    );
    if ("reason" in editorDiscovery) {
      editorSkipReason = editorDiscovery.reason;
    } else {
      editorTarget = editorDiscovery;
      console.log(
        `[qa-presentations-ui] editor deck ${editorDiscovery.deckId} hit ${editorDiscovery.hitKey} slides ${editorDiscovery.slideCount}`,
      );
    }

    const imageDiscovery = await discoverEditorImageTarget(
      viewerDiscovery.viewer.deckId,
    );
    if ("reason" in imageDiscovery) {
      editorImageSkipReason = imageDiscovery.reason;
    } else {
      editorImageTarget = imageDiscovery;
      console.log(
        `[qa-presentations-ui] image deck ${imageDiscovery.deckId} slide ${imageDiscovery.slideIndex} hit ${imageDiscovery.hitKey}`,
      );
    }

    const chatRaceDiscovery = await discoverChatRaceTarget(
      viewerDiscovery.viewer.deckId,
    );
    if ("reason" in chatRaceDiscovery) {
      chatRaceSkipReason = chatRaceDiscovery.reason;
    } else {
      chatRaceTarget = chatRaceDiscovery;
      console.log(
        `[qa-presentations-ui] chat conversations ${chatRaceDiscovery.conversationIds.join(",")}`,
      );
    }
  }

  const customThemeDiscovery = await discoverCustomTheme();
  if ("reason" in customThemeDiscovery) {
    liveCustomThemeSkipReason = customThemeDiscovery.reason;
  } else {
    liveCustomTheme = customThemeDiscovery;
    console.log(
      `[qa-presentations-ui] custom theme ${customThemeDiscovery.label}`,
    );
  }

  const browserTemplateDiscovery = await discoverBrowserTemplates();
  if ("reason" in browserTemplateDiscovery) {
    liveBrowserTemplateSkipReason = browserTemplateDiscovery.reason;
  } else {
    liveBrowserTemplate = browserTemplateDiscovery.template;
    liveBrowserCustomCount = browserTemplateDiscovery.customCount;
    liveBrowserSwitchSkipReason = browserTemplateDiscovery.switchSkipReason;
    console.log(
      `[qa-presentations-ui] browser template ${browserTemplateDiscovery.template.id} layouts ${browserTemplateDiscovery.template.layoutCount} custom ${browserTemplateDiscovery.customCount} switch ${browserTemplateDiscovery.template.switch ? `${browserTemplateDiscovery.template.switch.fromLayoutId}->${browserTemplateDiscovery.template.switch.toLayoutId}` : "none"}`,
    );
  }
});

test.afterEach(async () => {
  // Throwaway engine decks first (F4): the live delete removes its own, but a
  // test that failed before the click must not leave one on the service.
  await deleteCreatedEngineDecks();

  // Export jobs first, while the presentation ids that identify their payloads
  // are still tracked: the WhatsApp projects assert absolute zero QA1 job
  // residue, so a row must not survive even a test that failed mid-flow.
  if (createdExportJobIds.length > 0) {
    const { error } = await service
      .from("jobs")
      .delete()
      .in("id", [...createdExportJobIds]);
    expect(error, `teardown export jobs: ${error?.message}`).toBeNull();
    createdExportJobIds.length = 0;
  }
  await deleteExportJobsFor([...createdPresentationIds]);

  if (createdPresentationIds.length > 0) {
    const { error } = await service
      .from("presentations")
      .delete()
      .in("id", createdPresentationIds);
    expect(error, `teardown presentations: ${error?.message}`).toBeNull();
    createdPresentationIds.length = 0;
  }

  if (createdDocumentPaths.length > 0) {
    const removedObjects = await service.storage
      .from("documents")
      .remove([...createdDocumentPaths]);
    expect(removedObjects.error, `teardown objects: ${removedObjects.error?.message}`).toBeNull();
    createdDocumentPaths.length = 0;
  }

  if (createdDocumentIds.length > 0) {
    const { error } = await service
      .from("documents")
      .delete()
      .in("id", createdDocumentIds);
    expect(error, `teardown documents: ${error?.message}`).toBeNull();
    createdDocumentIds.length = 0;
  }
});

test.afterAll(async () => {
  // Sweep first (a click whose enqueue landed after a failed capture), then
  // assert no tracked export job row survives.
  await deleteExportJobsFor([...everCreatedPresentationIds]);

  const count = await service
    .from("presentations")
    .select("id", { count: "exact", head: true });
  expect(count.error, `residue presentations count: ${count.error?.message}`).toBeNull();
  expect(
    count.count,
    "the spec must return the presentations table to its pre-run count",
  ).toBe(presentationsCountBefore);

  if (everCreatedExportJobIds.length > 0) {
    const { data, error } = await service
      .from("jobs")
      .select("id")
      .in("id", [...everCreatedExportJobIds]);
    expect(error, `own export job residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no export job this spec created may survive").toHaveLength(0);
  }

  if (everCreatedPresentationIds.length > 0) {
    const { data, error } = await service
      .from("presentations")
      .select("id")
      .in("id", [...everCreatedPresentationIds]);
    expect(error, `own presentation residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no presentation this spec created may survive").toHaveLength(0);
  }

  if (everCreatedDocumentIds.length > 0) {
    const { data, error } = await service
      .from("documents")
      .select("id")
      .in("id", [...everCreatedDocumentIds]);
    expect(error, `own document residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no document this spec created may survive").toHaveLength(0);
  }

  /*
   * Fixture-deck residue guard (test hygiene, 2026-09-20). Every live case
   * restores what it wrote, but the D1 Mod+G and D8 stubbed-stop cases used to
   * restore a stale `beforeAll` snapshot whose slide id Task D6's structural
   * restores had rotated, so the restore silently no-opped and left scratch
   * content on the shared engine fixture deck. Read it back at rest: the
   * discovered slide count and layout order, and no QA scratch marker anywhere
   * in the stored JSON. When no editor deck was discovered (or the engine is
   * unreachable now) the check records the honest skip instead of failing.
   */
  if (editorTarget === null) {
    console.log(
      `[qa-presentations-ui] fixture-deck residue check skipped: ${
        editorSkipReason ?? "no editor deck was discovered"
      }`,
    );
  } else {
    const fixtureApi = await engineApi();
    let fixtureDeck: PresentationDeck | null = null;
    try {
      fixtureDeck = await readEngineDeck(fixtureApi, editorTarget.deckId);
    } catch (error) {
      console.log(
        `[qa-presentations-ui] fixture-deck residue check skipped: the engine deck read failed (${
          engineErrorText(error)
        })`,
      );
    } finally {
      await fixtureApi.dispose();
    }

    if (fixtureDeck !== null) {
      const slides = Array.isArray(fixtureDeck.slides)
        ? fixtureDeck.slides
        : [];
      expect(
        slides.length,
        "the fixture deck must be back to the slide count discovery captured",
      ).toBe(editorTarget.slideCount);
      expect(
        slides.map((slide) => slide.layout),
        "the fixture deck must be back to its discovered layouts",
      ).toEqual(editorTarget.originalLayouts);
      const residue = fixtureResidueMarkers(fixtureDeck);
      expect(
        residue,
        `the fixture deck must carry no QA scratch content: ${residue.join(" | ")}`,
      ).toEqual([]);
    }
  }
});

test.describe("no session (fresh request context without storage state)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("answers 401 before any owner read", async ({ request }) => {
    const res = await request.get(
      `/api/presentation/${randomUUID()}/asset?src=/static/images/placeholder.jpg`,
    );
    await expectJsonError(res, 401);
  });

  test("image upload answers 401 before parsing any file", async ({ request }) => {
    const res = await request.post(
      `/api/presentation/${randomUUID()}/images`,
      {
        multipart: {
          file: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG },
        },
      },
    );
    await expectJsonError(res, 401);
  });

  test("chat answers 401 before any owner read", async ({ request }) => {
    const res = await request.post(`/api/presentation/${randomUUID()}/chat`, {
      data: { message: "Hi" },
    });
    await expectJsonError(res, 401);
  });
});

test.describe("owner-gated asset proxy", () => {
  test("serves a deck-referenced asset with the private cache header and its content type", async ({
    request,
  }) => {
    const live = requireLiveAsset();
    const presentationId = await seedOwnedPresentation(qa1Id, live.deckId, live.templateId || "general");

    const res = await request.get(assetUrl(presentationId, live.src));

    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["cache-control"]).toContain("private");
    expect(headers["cache-control"]).toContain("max-age=300");
    expect(headers["content-type"]).toBe(live.contentType);

    const bytes = await res.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("serves the deck's own template static asset (engine-public, deck-matched)", async ({
    request,
  }) => {
    const live = requireLiveTemplateAsset();
    const presentationId = await seedOwnedPresentation(qa1Id, live.deckId, live.templateId || "general");

    const res = await request.get(assetUrl(presentationId, live.src));

    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["cache-control"]).toContain("private");
    expect(headers["content-type"]).toBe(live.contentType);

    const bytes = await res.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("404s a user-data path the deck does not reference", async ({ request }) => {
    const live = requireLiveAsset();
    const presentationId = await seedOwnedPresentation(qa1Id, live.deckId, live.templateId || "general");

    const res = await request.get(
      assetUrl(presentationId, "/app_data/images/definitely-not-referenced.png"),
    );

    await expectJsonError(res, 404);
  });

  test("404s another template's static asset", async ({ request }) => {
    const live = requireLiveAsset();
    const presentationId = await seedOwnedPresentation(qa1Id, live.deckId, live.templateId || "general");
    const otherTemplate = `not-${live.templateId || "this-deck"}`;

    const res = await request.get(
      assetUrl(presentationId, `/app_data/templates/${otherTemplate}/static/x.ttf`),
    );

    await expectJsonError(res, 404);
  });

  test("404s another user's presentation without an existence oracle", async ({
    request,
  }) => {
    const presentationId = await seedOwnedPresentation(qa2Id, randomUUID());

    const res = await request.get(
      assetUrl(presentationId, "/static/images/placeholder.jpg"),
    );

    await expectJsonError(res, 404);
  });

  test("400s a missing src before any deck read", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());

    const res = await request.get(`/api/presentation/${presentationId}/asset`);

    await expectJsonError(res, 400);
  });

  test("404s a padded presentation id without a 500", async ({ request }) => {
    // `isPresentationUuid` trims, so the row read must receive the trimmed id;
    // the untrimmed value used to make PostgREST reject the uuid and 500.
    const res = await request.get(
      `/api/presentation/%20${randomUUID()}%20/asset?src=/static/images/placeholder.jpg`,
    );

    await expectJsonError(res, 404);
  });

  const unsafeQueries: Array<[string, string]> = [
    ["parent traversal", `src=${encodeURIComponent("/app_data/../../etc/passwd")}`],
    [
      "interior traversal",
      `src=${encodeURIComponent("/app_data/images/../../../secret.png")}`,
    ],
    ["percent-encoded traversal", "src=/app_data/%2e%2e/%2e%2e/secret.png"],
    [
      "double-encoded traversal",
      "src=/app_data/fonts/%252e%252e/%252e%252e/api/v1/ppt/presentation/all",
    ],
    ["double-encoded backslash", "src=/app_data/images/%255ccover.png"],
    ["double-encoded null byte", "src=/app_data/images/%2500.png"],
    ["query delimiter", `src=${encodeURIComponent("/app_data/images/cover.png?x=1")}`],
    ["fragment delimiter", `src=${encodeURIComponent("/app_data/images/cover.png#x")}`],
    ["backslash", `src=${encodeURIComponent("/app_data/images\\cover.png")}`],
    ["double slash", `src=${encodeURIComponent("//app_data/images/cover.png")}`],
    ["not rooted", `src=${encodeURIComponent("app_data/images/cover.png")}`],
    ["absolute URL", `src=${encodeURIComponent("https://evil.example/cover.png")}`],
    ["outside the mounts", `src=${encodeURIComponent("/etc/passwd")}`],
    ["empty", "src="],
  ];

  for (const [label, query] of unsafeQueries) {
    test(`400s an unsafe src (${label})`, async ({ request }) => {
      const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());

      const res = await request.get(`/api/presentation/${presentationId}/asset?${query}`);

      await expectJsonError(res, 400);
    });
  }
});

/**
 * Task E2 — the session-gated template-asset route (spec §5.1 rows 7–8).
 *
 * Template art is engine-public and carries no deck/user data, so the route
 * has no deck-membership check; it does keep the session gate, the shared
 * traversal guard and a narrower allowlist (`/app_data/templates/**`,
 * `/app_data/fonts/**`, `/static/**`, `/vendor/**` — never
 * `/app_data/images/**`, exports or uploads). Every refusal below is settled
 * before any engine call, so these rows never skip.
 */
test.describe("template asset route (never skip)", () => {
  test.describe("no session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("answers 401 before any engine call", async ({ request }) => {
      const res = await request.get(
        templateAssetRouteUrl("/app_data/templates/general/static/thumbnail.png"),
      );

      await expectJsonError(res, 401);
    });
  });

  const unsafeQueries: Array<[string, string]> = [
    ["missing src", ""],
    ["empty src", "src="],
    ["parent traversal", `src=${encodeURIComponent("/app_data/../../etc/passwd")}`],
    ["percent-encoded traversal", "src=/app_data/%2e%2e/%2e%2e/secret.png"],
    [
      "double-encoded traversal",
      "src=/app_data/templates/%252e%252e/%252e%252e/api/v1/ppt/presentation/all",
    ],
    ["backslash", `src=${encodeURIComponent("/app_data/templates/x\\thumb.png")}`],
    ["double slash", `src=${encodeURIComponent("//app_data/templates/x/thumb.png")}`],
    ["not rooted", `src=${encodeURIComponent("app_data/templates/x/thumb.png")}`],
    ["absolute URL", `src=${encodeURIComponent("https://evil.example/thumb.png")}`],
    ["outside the mounts", `src=${encodeURIComponent("/etc/passwd")}`],
  ];

  for (const [label, query] of unsafeQueries) {
    test(`400s an unsafe src (${label})`, async ({ request }) => {
      const res = await request.get(
        query === "" ? "/api/presentation/template-asset" : `/api/presentation/template-asset?${query}`,
      );

      await expectJsonError(res, 400);
    });
  }

  const notTemplateAssets: Array<[string, string]> = [
    ["an image-library path", "/app_data/images/uploaded.png"],
    ["an export path", "/app_data/exports/pptx/Deck_7f3a9c2b1d.pptx"],
    ["a conversion scratch path", "/app_data/pptx-to-abc/temp.png"],
  ];

  for (const [label, src] of notTemplateAssets) {
    test(`404s ${label} (user data stays behind the owner-gated proxy)`, async ({
      request,
    }) => {
      const res = await request.get(templateAssetRouteUrl(src));

      await expectJsonError(res, 404);
    });
  }
});

/**
 * Task E2 — the live half of the template-asset route: a real built-in
 * thumbnail streams through the session gate with the private cache header and
 * its extension's content type. The engine's template list is probed in
 * beforeAll; absence records the honest skip.
 */
test.describe("template asset route (live thumbnail)", () => {
  test("serves a real built-in thumbnail with the private cache header", async ({
    request,
  }) => {
    const live = requireLiveBrowserTemplate();

    const res = await request.get(templateAssetRouteUrl(live.thumbnail));

    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["cache-control"]).toContain("private");
    expect(headers["cache-control"]).toContain("max-age=300");
    expect(headers["content-type"]).toBe(expectedContentType(live.thumbnail));

    const bytes = await res.body();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

/**
 * Task D3 — the owner-gated image upload route's HTTP contract. Every case
 * here is settled before any engine call (gate, id, file shape, media type,
 * extension, size), so none of them skip: the owner-gate 401/404 rows and the
 * validation 400/413/415 rows are provable without a reachable engine.
 */
test.describe("owner-gated image upload route (never skip)", () => {
  const uploadUrl = (id: string) => `/api/presentation/${id}/images`;

  test("404s an unknown presentation id before parsing the file", async ({
    request,
  }) => {
    const res = await request.post(uploadUrl(randomUUID()), {
      multipart: {
        file: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    await expectJsonError(res, 404);
  });

  test("404s a malformed id with no 500", async ({ request }) => {
    const res = await request.post(uploadUrl("not-a-uuid"), {
      multipart: {
        file: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    await expectJsonError(res, 404);
  });

  test("404s a row with no stored engine deck", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null);
    const res = await request.post(uploadUrl(presentationId), {
      multipart: {
        file: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    await expectJsonError(res, 404);
  });

  test("404s another user's presentation for QA1", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa2Id, randomUUID());
    const res = await request.post(uploadUrl(presentationId), {
      multipart: {
        file: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG },
      },
    });
    await expectJsonError(res, 404);
  });

  test("400s a multipart request without a file part", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());
    const res = await request.post(uploadUrl(presentationId), {
      multipart: { note: "hello" },
    });
    await expectJsonError(res, 400);
  });

  test("415s a non-image media type", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());
    const res = await request.post(uploadUrl(presentationId), {
      multipart: {
        file: {
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("not an image"),
        },
      },
    });
    await expectJsonError(res, 415);
  });

  test("415s a disallowed extension", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());
    const res = await request.post(uploadUrl(presentationId), {
      multipart: {
        file: {
          name: "image.heic",
          mimeType: "image/heic",
          buffer: TINY_PNG,
        },
      },
    });
    await expectJsonError(res, 415);
  });

  test("413s a file over UniPilot's upload bound", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());
    const res = await request.post(uploadUrl(presentationId), {
      multipart: {
        file: {
          name: "huge.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1),
        },
      },
    });
    await expectJsonError(res, 413);
  });
});

/**
 * Task D8 — the streaming chat proxy's HTTP contract (spec §7.8, §5.4).
 *
 * Every case here settles before any provider call: the session gate, the
 * owner gate, the body validation and the engine's pre-stream error path (a
 * UUID-shaped engine deck id the engine does not store) all answer
 * deterministically, so none of them skip. The engine-side error case proves
 * the sanitized-frame contract end to end: the proxy forwards the engine's
 * `status` frame, then replaces its error detail with UniPilot's own copy —
 * the raw body never carries "Presentation not found", `detail`, or any
 * provider/stack text.
 */
test.describe("chat proxy route (never skip)", () => {
  const chatUrl = (id: string) => `/api/presentation/${id}/chat`;

  test("404s an unknown presentation id before any engine call", async ({
    request,
  }) => {
    const res = await request.post(chatUrl(randomUUID()), {
      data: { message: "Hi" },
    });
    await expectJsonError(res, 404);
  });

  test("404s a malformed id with no 500", async ({ request }) => {
    const res = await request.post(chatUrl("not-a-uuid"), {
      data: { message: "Hi" },
    });
    await expectJsonError(res, 404);
  });

  test("404s a row with no stored engine deck", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null);
    const res = await request.post(chatUrl(presentationId), {
      data: { message: "Hi" },
    });
    await expectJsonError(res, 404);
  });

  test("404s another user's presentation for QA1", async ({ request }) => {
    const presentationId = await seedOwnedPresentation(qa2Id, randomUUID());
    const res = await request.post(chatUrl(presentationId), {
      data: { message: "Hi" },
    });
    await expectJsonError(res, 404);
  });

  test("400s an empty message before the owner read", async ({ request }) => {
    const res = await request.post(chatUrl(randomUUID()), {
      data: { message: "   " },
    });
    await expectJsonError(res, 400);
  });

  test("400s an invalid conversation id with no engine call", async ({
    request,
  }) => {
    const res = await request.post(chatUrl(randomUUID()), {
      data: { message: "Hi", conversationId: "not-a-uuid" },
    });
    await expectJsonError(res, 400);
  });

  test("400s a malformed JSON body", async ({ request }) => {
    const res = await request.post(chatUrl(randomUUID()), {
      headers: { "content-type": "application/json" },
      data: "{",
    });
    await expectJsonError(res, 400);
  });

  test("turns an engine-side error into a sanitized SSE error frame", async ({
    request,
  }) => {
    /* A UUID the engine does not store: its stream answers the `status` frame
       and then the engine's own 404 detail as an error frame. No provider is
       involved, so this case never skips. */
    const presentationId = await seedOwnedPresentation(qa1Id, randomUUID());

    const res = await request.post(chatUrl(presentationId), {
      data: { message: "Hi" },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");

    const body = await res.text();
    const frames = parseSseBlocks(body)
      .events.map(normalizeChatSseEvent)
      .filter((frame): frame is ChatFrame => frame !== null);

    expect(frames.some((frame) => frame.type === "status")).toBe(true);
    const errors = frames.filter((frame) => frame.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ type: "error", message: CHAT_ERROR_COPY });

    /* The engine's detail and every upstream field are gone from the wire. */
    expect(body).not.toContain("Presentation not found");
    expect(body).not.toContain("detail");
    expect(body).not.toContain("Traceback");
  });
});

/**
 * The policy table (assets.ts) exercised directly — no route, no engine. These
 * are the branches the HTTP cases cannot reach honestly: a deck with no slides,
 * a caller-supplied template id that disagrees with the deck, and the fonts /
 * static / vendor allowlist with a deck that references nothing.
 */
test.describe("classifyAssetPath (pure policy)", () => {
  function policyDeck(
    layoutGroups: string[],
    referenced: string[] = [],
  ): PresentationDeck {
    return {
      id: "policy-deck",
      version: "v2-standard",
      content: "",
      n_slides: layoutGroups.length,
      language: "English",
      title: null,
      created_at: "2026-09-16T00:00:00Z",
      updated_at: "2026-09-16T00:00:00Z",
      tone: null,
      verbosity: null,
      slides: layoutGroups.map((group, index) => ({
        id: `slide-${index}`,
        presentation: "policy-deck",
        layout_group: group,
        layout: "layout",
        index,
        content: referenced.length > 0 ? { assets: referenced } : {},
        ui: null,
      })),
      fonts: null,
      theme: null,
      generation_mode: "standard",
      type: "standard",
    };
  }

  const deck = policyDeck(["verdant"], ["/app_data/images/cover.png"]);

  test("allows the engine-public prefixes with the traversal guard alone", () => {
    expect(classifyAssetPath("/app_data/fonts/Inter-Regular.ttf", deck, "verdant")).toBe(
      "allowed",
    );
    expect(classifyAssetPath("/static/images/placeholder.jpg", deck, "verdant")).toBe(
      "allowed",
    );
    expect(
      classifyAssetPath("/vendor/fonts/sans_serif/poppins/Poppins-Regular.ttf", deck, "verdant"),
    ).toBe("allowed");
  });

  test("allows a user-data path only when the deck references it", () => {
    expect(classifyAssetPath("/app_data/images/cover.png", deck, "verdant")).toBe("allowed");
    expect(classifyAssetPath("/app_data/images/other.png", deck, "verdant")).toBe(
      "not-referenced",
    );
    expect(classifyAssetPath("/app_data/exports/deck.pptx", deck, "verdant")).toBe(
      "not-referenced",
    );
  });

  test("allows the deck's template and rejects every other template", () => {
    expect(
      classifyAssetPath("/app_data/templates/verdant/static/logo.svg", deck, "verdant"),
    ).toBe("allowed");
    expect(
      classifyAssetPath("/app_data/templates/general/static/logo.svg", deck, "verdant"),
    ).toBe("not-referenced");
    // A caller id the deck does not carry can never widen access.
    expect(
      classifyAssetPath("/app_data/templates/general/static/logo.svg", deck, "general"),
    ).toBe("not-referenced");
  });

  test("never allows template assets for a deck with no slides", () => {
    const empty = policyDeck([]);
    expect(
      classifyAssetPath("/app_data/templates/verdant/static/logo.svg", empty, null),
    ).toBe("not-referenced");
    expect(
      classifyAssetPath("/app_data/templates/verdant/static/logo.svg", empty, "verdant"),
    ).toBe("not-referenced");
  });

  test("flags every traversal or non-mount shape as unsafe", () => {
    const unsafe = [
      "/app_data/../../etc/passwd",
      "/app_data/images\\cover.png",
      "//app_data/images/cover.png",
      "app_data/images/cover.png",
      "https://evil.example/cover.png",
      "/etc/passwd",
      // Percent-encoding of any kind is rejected: fetch() would canonicalize
      // `%2e%2e` as dot segments, so an encoded traversal here would become an
      // authenticated GET to an arbitrary engine path with the shared bearer.
      "/app_data/%2e%2e/%2e%2e/api/v1/ppt/presentation/all",
      "/app_data/%252e%252e/%252e%252e/api/v1/ppt/presentation/all",
      "/app_data%2Fimages%2Fcover.png",
      "/app_data/images/%5ccover.png",
      "/app_data/images/%00.png",
      "/app_data/images/cover.png?x=1",
      "/app_data/images/cover.png#x",
      "",
    ];
    for (const src of unsafe) {
      expect(classifyAssetPath(src, deck, "verdant"), src).toBe("unsafe");
    }
    expect(classifyAssetPath(null, deck, "verdant")).toBe("unsafe");
  });
});

/**
 * Task E2 — the template-asset route's pure policy and URL builder. The route
 * and the adapter both call these, so the allowlist and the traversal guard
 * are provable without an engine.
 */
test.describe("template-asset policy (pure)", () => {
  test("allows only the engine-public mounts", () => {
    for (const src of [
      "/app_data/templates/general/static/thumbnail.png",
      "/app_data/templates/custom-id/fonts/x.ttf",
      "/app_data/fonts/Inter-Regular.ttf",
      "/static/images/placeholder.jpg",
      "/vendor/fonts/sans_serif/poppins/Poppins-Regular.ttf",
    ]) {
      expect(isEnginePublicAssetPath(src), src).toBe(true);
    }
  });

  test("refuses every other /app_data path and every unsafe shape", () => {
    const refused = [
      "/app_data/images/cover.png",
      "/app_data/uploads/file.png",
      "/app_data/exports/pptx/Deck.pptx",
      "/app_data/pptx-to-abc/temp.png",
      "/etc/passwd",
      "/app_data/../../etc/passwd",
      "/app_data/%2e%2e/%2e%2e/api/v1/ppt/presentation/all",
      "/app_data/templates/%252e%252e/x",
      "/app_data/templates/x\\thumb.png",
      "//app_data/templates/x/thumb.png",
      "app_data/templates/x/thumb.png",
      "https://evil.example/thumb.png",
      "",
      null,
      undefined,
    ];
    for (const src of refused) {
      expect(isEnginePublicAssetPath(src), String(src)).toBe(false);
    }
  });

  test("builds proxy URLs for public paths and passes through absolute sources", () => {
    expect(
      templateAssetUrl("/app_data/templates/general/static/thumbnail.png"),
    ).toBe(
      "/api/presentation/template-asset?src=%2Fapp_data%2Ftemplates%2Fgeneral%2Fstatic%2Fthumbnail.png",
    );
    expect(templateAssetUrl("/vendor/fonts/inter.ttf")).toBe(
      "/api/presentation/template-asset?src=%2Fvendor%2Ffonts%2Finter.ttf",
    );
    // User data and unsafe shapes never get a URL at all.
    expect(templateAssetUrl("/app_data/images/cover.png")).toBeNull();
    expect(templateAssetUrl("/app_data/%2e%2e/secret")).toBeNull();
    expect(templateAssetUrl("")).toBeNull();
    expect(templateAssetUrl(null)).toBeNull();
    // Absolute and data sources pass through exactly like the deck proxy.
    expect(templateAssetUrl("https://cdn.example/art.png")).toBe(
      "https://cdn.example/art.png",
    );
    expect(templateAssetUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});

/**
 * Task E2 — the preview's synthetic deck. The preview route renders template
 * layouts through the existing `DeckStage`, which takes a `PresentationDeck`;
 * this pins the bridge: one slide per layout, hydrated with empty content so
 * the template's own defaults render, plus the template's theme and fonts.
 */
test.describe("template preview deck (pure)", () => {
  const layout = (id: string, description: string): TemplateLayout => ({
    id,
    description,
    components: [
      {
        id: "frame",
        description: "Frame",
        position: { x: 0, y: 0 },
        elements: [
          {
            type: "text",
            name: "title",
            decorative: false,
            position: { x: 10, y: 10 },
            size: { width: 100, height: 40 },
            runs: [{ text: "Template default" }],
          },
        ],
      },
    ],
  });

  test("builds one v2-standard slide per layout with the theme and fonts", async () => {
    const { buildTemplatePreviewDeck } = await import(
      "../../app/(app)/tools/presentation/templates/[templateId]/_components/templatePreviewModel"
    );
    const theme = {
      colors: { primary: "#111111" },
      fonts: { textFont: { name: "Inter", url: "/vendor/fonts/inter.ttf" } },
    } as unknown as DeckTheme;

    const deck = buildTemplatePreviewDeck({
      templateId: "general",
      name: "General",
      layouts: [layout("title_intro", "Title"), layout("bullets", "Bullets")],
      theme,
      fonts: { Inter: "/vendor/fonts/inter.ttf" },
    });

    expect(deck).not.toBeNull();
    expect(deck?.version).toBe("v2-standard");
    expect(deck?.title).toBe("General");
    expect(deck?.theme).toBe(theme);
    expect(deck?.fonts).toEqual({ Inter: "/vendor/fonts/inter.ttf" });
    expect(deck?.slides.map((slide) => slide.layout)).toEqual([
      "title_intro",
      "bullets",
    ]);
    expect(deck?.slides.map((slide) => slide.index)).toEqual([0, 1]);
    // Every slide carries the hydrated layout so the stage has something real
    // to render; the layout's own default text survives the empty hydration.
    expect(deck?.slides[0]?.ui?.id).toBe("title_intro");
    expect(deck?.slides[0]?.ui?.components).toHaveLength(1);
    expect(
      JSON.stringify(deck?.slides[0]?.ui?.components[0]?.elements[0]),
    ).toContain("Template default");
  });

  test("returns null when the template has no layouts", async () => {
    const { buildTemplatePreviewDeck } = await import(
      "../../app/(app)/tools/presentation/templates/[templateId]/_components/templatePreviewModel"
    );

    expect(
      buildTemplatePreviewDeck({
        templateId: "empty",
        name: "Empty",
        layouts: [],
        theme: null,
        fonts: {},
      }),
    ).toBeNull();
  });

  test("drops layouts whose components aren't a list instead of throwing", async () => {
    const { buildTemplatePreviewDeck, renderableTemplateLayouts } = await import(
      "../../app/(app)/tools/presentation/templates/[templateId]/_components/templatePreviewModel"
    );

    const malformed = [
      layout("ok", "Ok"),
      { id: "no-components", description: "Bad", components: null },
      { id: "missing-components", description: "Bad" },
      null,
    ];
    expect(
      renderableTemplateLayouts(malformed).map((entry) => entry.id),
    ).toEqual(["ok"]);

    const deck = buildTemplatePreviewDeck({
      templateId: "general",
      name: "General",
      layouts: malformed as unknown as TemplateLayout[],
      theme: null,
      fonts: {},
    });
    expect(deck?.slides.map((slide) => slide.layout)).toEqual(["ok"]);
    expect(deck?.n_slides).toBe(1);
  });
});

/**
 * Task E2 review fix — the image deferral's source predicate. The quiet window
 * exists for the owner-gated deck proxy only: the template-asset route has no
 * deck and no save to wait for, so a preview layout switch must never defer
 * (the reused-slot case the live preview case also exercises).
 */
test.describe("deferred image sources (pure)", () => {
  test("only the owner-gated deck proxy defers; template assets never do", async () => {
    const { ASSET_INSERT_QUIET_MS, isProxiedSource } = await import(
      "../../components/presentation/useDeferredImageSource"
    );

    expect(
      isProxiedSource(
        `/api/presentation/${randomUUID()}/asset?src=%2Fapp_data%2Fimages%2Fx.png`,
      ),
    ).toBe(true);
    expect(
      isProxiedSource(
        "/api/presentation/template-asset?src=%2Fapp_data%2Ftemplates%2Fgeneral%2Fstatic%2Fimage1.png",
      ),
    ).toBe(false);
    expect(isProxiedSource("/api/presentation/template-asset")).toBe(false);
    expect(isProxiedSource("/api/presentation/")).toBe(false);
    expect(isProxiedSource("/api/presentation")).toBe(false);
    expect(isProxiedSource("/static/images/placeholder.jpg")).toBe(false);
    expect(isProxiedSource(null)).toBe(false);
    // The quiet window itself is unchanged.
    expect(ASSET_INSERT_QUIET_MS).toBe(2_500);
  });
});

/**
 * The Smart detector (spec §5.7, §6.10, D7) exercised directly: the
 * deck-level flags and the per-slide `html_content` signal, including the
 * payload shapes the engine stores unvalidated. The viewer routes and this
 * spec's discovery both run this module, so these cases pin the semantics
 * both sides rely on.
 */
test.describe("isSmartDeck (pure policy)", () => {
  function deckSlide(overrides: Partial<DeckSlide> = {}): DeckSlide {
    return {
      id: "slide-0",
      presentation: "policy-deck",
      layout_group: "general",
      layout: "title_intro",
      index: 0,
      content: {},
      ...overrides,
    };
  }

  function policyDeck(overrides: Partial<PresentationDeck> = {}): PresentationDeck {
    return {
      id: "policy-deck",
      version: "v2-standard",
      content: "",
      n_slides: 1,
      language: "English",
      title: null,
      created_at: "2026-09-16T00:00:00Z",
      updated_at: "2026-09-16T00:00:00Z",
      tone: null,
      verbosity: null,
      slides: [deckSlide()],
      fonts: null,
      theme: null,
      generation_mode: "standard",
      type: "standard",
      ...overrides,
    };
  }

  test("flags a deck whose generation_mode is smart", () => {
    expect(isSmartDeck(policyDeck({ generation_mode: "smart" }))).toBe(true);
  });

  test("flags a deck whose type is smart", () => {
    expect(isSmartDeck(policyDeck({ type: "smart" }))).toBe(true);
  });

  test("flags any slide carrying non-empty html_content", () => {
    const smart = policyDeck({
      slides: [deckSlide(), deckSlide({ id: "slide-1", index: 1, html_content: "<div>hi</div>" })],
    });
    expect(isSmartDeck(smart)).toBe(true);
  });

  test("does not flag whitespace-only, empty or non-string html_content", () => {
    expect(isSmartDeck(policyDeck({ slides: [deckSlide({ html_content: "  \n\t " })] }))).toBe(false);
    expect(isSmartDeck(policyDeck({ slides: [deckSlide({ html_content: "" })] }))).toBe(false);
    expect(isSmartDeck(policyDeck({ slides: [deckSlide({ html_content: null })] }))).toBe(false);
    expect(
      isSmartDeck(
        policyDeck({
          slides: [deckSlide({ html_content: 42 as unknown as string })],
        }),
      ),
    ).toBe(false);
  });

  test("does not flag a standard deck without html_content", () => {
    expect(isSmartDeck(policyDeck())).toBe(false);
  });

  test("honours only `slides` when the read omits the array", () => {
    const malformed = policyDeck({ slides: undefined as unknown as DeckSlide[] });
    expect(isSmartDeck(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task B4 — the native viewer route: access guards, rail, counter, keyboard
//
// Page-level `notFound()` under the `(app)` shell is a streamed soft 404: the
// `loading.tsx` boundary flushes a 200 before the page resolves, then the
// default 404 page arrives in the stream (the same behavior `/edit` has — a
// hard 404 for pages would need a `proxy.ts` rule). The refused-visitor cases
// therefore assert the 404 page by navigation; the route-handler cases above
// still assert real 404 statuses.
// ---------------------------------------------------------------------------

test.describe("viewer route access (never skip)", () => {
  test.describe("no session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("404s a guest without redirecting to sign-in", async ({ page }) => {
      const response = await page.goto(`/tools/presentation/${randomUUID()}`);

      expect(response?.status()).toBe(200);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("404s an unknown presentation id for QA1", async ({ page }) => {
    const response = await page.goto(`/tools/presentation/${randomUUID()}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.locator("[data-viewer-stage]")).toHaveCount(0);
  });

  test("404s a malformed id without a 500", async ({ page }) => {
    const response = await page.goto("/tools/presentation/not-a-presentation-id");

    expect(response?.status()).not.toBe(500);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("404s another user's presentation for QA1", async ({ page }) => {
    const presentationId = await seedOwnedPresentation(qa2Id, randomUUID());

    const response = await page.goto(`/tools/presentation/${presentationId}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.locator("[data-viewer-stage]")).toHaveCount(0);
  });

  test("renders the honest not-ready panel when no engine id is stored", async ({
    page,
  }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null);

    const response = await page.goto(`/tools/presentation/${presentationId}`);

    expect(response?.status()).toBe(200);
    // Next's streaming can briefly hold the streamed segment (`div#S:n`)
    // beside the mounted tree (the phase E finding), which makes a bare
    // `toBeVisible` a strict-mode race. `:visible` + `first()` waits for the
    // rendered copy instead of the streamed one.
    await expect(
      page.locator("[data-viewer-not-ready]:visible").first(),
    ).toBeVisible();
  });
});

/**
 * Task E2 — the templates routes' access contract. The guest and malformed-id
 * rows are settled before any engine call and never skip; the unknown-id 404
 * needs the engine's own 4xx, so it records an honest skip when the engine is
 * unreachable.
 */
test.describe("templates routes access (never skip)", () => {
  test.describe("no session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("renders the sign-in prompt on both templates routes, never a redirect", async ({
      page,
    }) => {
      await page.goto("/tools/presentation/templates");
      await expect(page.getByText("Sign in to browse templates")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);

      await page.goto("/tools/presentation/templates/general");
      await expect(page.getByText("Sign in to preview templates")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("404s a malformed template id without a 500", async ({ page }) => {
    const response = await page.goto(
      "/tools/presentation/templates/not..a..template",
    );

    expect(response?.status()).not.toBe(500);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("404s an unknown template id for QA1", async ({ page }) => {
    test.skip(
      liveBrowserTemplate === null,
      liveBrowserTemplateSkipReason ??
        "The engine template list is not reachable in this environment.",
    );

    const response = await page.goto(
      `/tools/presentation/templates/${randomUUID()}`,
    );

    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });
});

/**
 * Task E2 — the templates browser and preview in a real browser: built-in
 * cards with real art through the session-gated route, the first layout
 * rendered through the shared `DeckStage`, and "Use this template" landing on
 * the generator with the picker preselected. Discovery guarantees the engine
 * art is servable; absence records the honest skip.
 */
test.describe("templates browser (live engine)", () => {
  test("renders built-in cards with art, previews a layout and preselects the template", async ({
    page,
  }) => {
    const live = requireLiveBrowserTemplate();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation/templates");
    await page.waitForSelector("[data-templates-browser]");

    const cards = page.locator("[data-template-card]");
    expect(await cards.count()).toBeGreaterThan(0);

    const thumb = page.locator(`[data-template-thumb="${live.id}"]`);
    await expect(thumb).toBeVisible();
    await expect
      .poll(async () =>
        thumb.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    // The Custom tab is real; with no customs on the engine it shows the
    // honest empty state instead of an invented card.
    await page.locator('[data-template-tab="custom"]').click();
    if (liveBrowserCustomCount === 0) {
      await expect(page.getByText("No custom templates yet")).toBeVisible();
    } else {
      await expect(page.locator("[data-template-card]").first()).toBeVisible();
    }
    await page.locator('[data-template-tab="built-in"]').click();

    // The preview renders the first layout through the shared DeckStage.
    await page.locator(`[data-template-card="${live.id}"]`).click();
    await page.waitForSelector("[data-template-preview-stage] [data-deck-stage]");
    await expect(page.locator("[data-deck-stage]")).toHaveAttribute(
      "data-slide-index",
      "0",
    );
    const layoutButtons = page.locator("[data-template-layout]");
    expect(await layoutButtons.count()).toBeGreaterThan(0);
    if ((await layoutButtons.count()) > 1) {
      await layoutButtons.nth(1).click();
      await expect(page.locator("[data-deck-stage]")).toHaveAttribute(
        "data-slide-index",
        "1",
      );
    }

    // E2 review fix: a layout switch that reuses an image slot with new bytes
    // must render the new image immediately — the preview has no deck save, so
    // the editor's 2.5 s quiet window must not apply. The bounded waits are
    // below `ASSET_INSERT_QUIET_MS` on purpose: under the old prefix predicate
    // the reused `<img>` unmounts for 2.5 s and these counts would not settle.
    // Discovery guarantees each image occurs exactly once in its own layout and
    // never in the other, so the count identifies the reused slot's node.
    const switchTarget = live.switch;
    if (switchTarget !== null) {
      const fromSrc = templateAssetUrl(switchTarget.fromImageData);
      const toSrc = templateAssetUrl(switchTarget.toImageData);
      expect(fromSrc, "the switched image must resolve to a template asset").not.toBeNull();
      expect(toSrc, "the switched image must resolve to a template asset").not.toBeNull();
      if (fromSrc !== null && toSrc !== null) {
        await page
          .locator(`[data-template-layout="${switchTarget.fromLayoutId}"]`)
          .click();
        await expect(
          page.locator(`[data-deck-stage] img[src="${fromSrc}"]`),
        ).toHaveCount(1, { timeout: 1_500 });
        await expect(
          page.locator(`[data-deck-stage] img[src="${toSrc}"]`),
        ).toHaveCount(0);

        await page
          .locator(`[data-template-layout="${switchTarget.toLayoutId}"]`)
          .click();
        await expect(
          page.locator(`[data-deck-stage] img[src="${toSrc}"]`),
        ).toHaveCount(1, { timeout: 1_500 });
        await expect(
          page.locator(`[data-deck-stage] img[src="${fromSrc}"]`),
        ).toHaveCount(0);
      }
    } else {
      console.log(
        `[qa-presentations-ui] reused-image-slot switch not exercised: ${
          liveBrowserSwitchSkipReason ?? "no layout pair discovered"
        }`,
      );
    }

    // "Use this template" lands on the generator with the picker preselected.
    await page.locator("[data-template-use]").click();
    await page.waitForURL(/\/tools\/presentation\?template=/);
    await expect(
      page.getByRole("combobox", { name: "Presentation template" }),
    ).toContainText(live.name);
    await expect(page.locator("[data-template-preselect-miss]")).toHaveCount(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });
});

/**
 * T2 (generate redesign) — the /tools/presentation generate/setup surface:
 * the centered hero that replaces `PageHeader` (one `<h1>`, entrance slot 0),
 * the prompt card's real option controls, the display-only model chip with its
 * honest per-deployment state, and the Get-started/Templates split. The §5.3
 * contracts are re-asserted here for the reshaped page: the template combobox
 * plus `?template=` preselect and its honest miss note, and the guest posture
 * (no template art, no decks list). The F1 decks-list cases below stay
 * untouched.
 *
 * The T2 model control is display-only: the local engine denies its admin
 * settings, so `data-model-state` is `unknown` unless the operator declared
 * `PRESENTON_MODEL` (then `declared`) — the test asserts that state attribute,
 * never env-dependent copy.
 *
 * The split's live cases use the same discovered browser template as the E2
 * cases (its art is engine-servable) and skip with a recorded reason when the
 * engine is unreachable or serves nothing — never a fabricated card.
 */
test.describe("generate redesign (T2)", () => {
  test("renders the hero, the option controls and the split for a signed-in reader", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
    );

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation");

    const hero = page.locator("[data-generate-hero]");
    await expect(hero).toBeVisible();
    // The hero replaces PageHeader on this route: exactly one <h1>.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText("What do you want to present?");
    await expect(
      hero.getByText("Presentation generator", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Topic or prompt")).toBeVisible();

    // The real format control: two aria-pressed pills that toggle.
    const formatGroup = page.getByRole("group", { name: "Export format" });
    await expect(formatGroup).toBeVisible();
    const powerpoint = formatGroup.getByRole("button", { name: "PowerPoint" });
    const pdf = formatGroup.getByRole("button", { name: "PDF" });
    await expect(powerpoint).toHaveAttribute("aria-pressed", "true");
    await expect(pdf).toHaveAttribute("aria-pressed", "false");
    await pdf.click();
    await expect(pdf).toHaveAttribute("aria-pressed", "true");
    await expect(powerpoint).toHaveAttribute("aria-pressed", "false");
    await powerpoint.click();
    await expect(powerpoint).toHaveAttribute("aria-pressed", "true");

    await expect(
      page.getByRole("combobox", { name: "Number of slides" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Presentation template" }),
    ).toBeVisible();

    // Display-only and honest: the state attribute is the deployment fact.
    // No selectable model list exists in T2.
    const model = page.locator("[data-model-control]");
    await expect(model).toBeVisible();
    const declaredModel = (process.env.PRESENTON_MODEL ?? "").trim();
    await expect(model).toHaveAttribute(
      "data-model-state",
      declaredModel === "" ? "unknown" : "declared",
    );
    await expect(
      page.getByRole("combobox", { name: "Presentation model" }),
    ).toHaveCount(0);

    const split = page.locator("[data-generate-split]");
    await expect(split).toBeVisible();
    await expect(page.locator("[data-get-started]")).toBeVisible();
    await expect(page.locator("[data-generate-templates]")).toBeVisible();
    // Engine up → the Templates card links into the browser; a dead engine
    // says so with the retry link instead (never an invented card).
    if (await isEngineReachable()) {
      await expect(
        page.getByRole("link", { name: "Browse all templates" }),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("keeps the ?template= preselect and the honest miss note", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
    );
    const live = requireLiveBrowserTemplate();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(
      `/tools/presentation?template=${encodeURIComponent(live.id)}`,
    );
    const combobox = page.getByRole("combobox", {
      name: "Presentation template",
    });
    await expect(combobox).toContainText(live.name);
    await expect(page.locator("[data-template-preselect-miss]")).toHaveCount(0);

    // A stale id is not silently swallowed: the picker falls back and the miss
    // note says so.
    await page.goto("/tools/presentation?template=qa-stale-template-id");
    await expect(page.locator("[data-template-preselect-miss]")).toBeVisible();
    await expect(combobox).not.toContainText("qa-stale-template-id");

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("shows real template teasers with loaded art and picks one into the form", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
    );
    const live = requireLiveBrowserTemplate();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation");

    const teasers = page.locator("[data-template-teaser]");
    await expect(teasers.first()).toBeVisible();
    expect(await teasers.count()).toBeGreaterThan(0);
    expect(await teasers.count()).toBeLessThanOrEqual(4);

    // Art through the shared thumbnail component: the first teaser is a
    // built-in (built-ins sort first), whose thumbnail discovery proved
    // engine-servable — it must actually load in the browser.
    const firstThumb = page
      .locator("[data-generate-templates] [data-template-thumb]")
      .first();
    await expect(firstThumb).toBeVisible();
    await expect
      .poll(async () =>
        firstThumb.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    // Clicking a teaser sets the picker — no navigation, no URL change.
    const teaser = page.locator(`[data-template-teaser="${live.id}"]`);
    if ((await teaser.count()) > 0) {
      await teaser.click();
      await expect(
        page.getByRole("combobox", { name: "Presentation template" }),
      ).toContainText(live.name);
      await expect(page).toHaveURL(/\/tools\/presentation$/);
    } else {
      console.log(
        `[qa-presentations-ui] split teaser click not exercised: template "${live.id}" is not among the four shown teasers.`,
      );
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test.describe("guest", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("sees the hero with no template art, no decks list and the sign-in note", async ({
      page,
    }) => {
      test.skip(
        engineUrl === "",
        "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
      );

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto("/tools/presentation");

      await expect(page.locator("[data-generate-hero]")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByLabel("Topic or prompt")).toBeVisible();

      // The asset route is session-gated: the split shows the honest sign-in
      // note instead of inventing template cards or art.
      await expect(page.locator("[data-template-thumb]")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Sign in to browse templates" }),
      ).toBeVisible();

      // F1 contract: a guest never gets the history list.
      await expect(page.locator("[data-decks-list]")).toHaveCount(0);
      await expect(page.locator("[data-deck-row]")).toHaveCount(0);

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    });
  });
});

/**
 * T3 (generate redesign) — the model control's honest read-only state on the
 * local deployment. The local engine denies its admin settings (`GET
 * /api/v1/admin/provider-settings` → 403, spec §2.4), so the switch is never
 * granted here: the page must render the chip, never a `Select`, and must not
 * carry an apply state. The interactive path cannot run against the Next
 * server with an in-process stub, so it is proven separately in
 * `frontend/.playwright/model-control-evidence.mjs` (stub engine + production
 * server, spawn-time env only) — see `t3-report.md` for which half is covered
 * where.
 *
 * The chip's text/state is asserted from the deployment's own declaration
 * (`PRESENTON_MODEL`, unset here → "unknown"), never hard-coded to one env.
 */
test.describe("model control (T3)", () => {
  test("a signed-in reader sees the honest read-only chip, never a select", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
    );

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation");

    const control = page.locator("[data-model-control]");
    await expect(control).toBeVisible();
    const declaredModel = (process.env.PRESENTON_MODEL ?? "").trim();
    await expect(control).toHaveAttribute(
      "data-model-state",
      declaredModel === "" ? "unknown" : "declared",
    );
    await expect(control).toHaveText(
      declaredModel === "" ? "Model set on the presentation service." : declaredModel,
    );
    // No switch is granted: no model combobox and no apply state on the chip.
    await expect(
      page.getByRole("combobox", { name: "Presentation model" }),
    ).toHaveCount(0);
    const applyState = await control.getAttribute("data-model-apply");
    expect(
      applyState === null || applyState === "idle",
      `data-model-apply was ${applyState}`,
    ).toBe(true);

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test.describe("guest", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("sees the same read-only chip with no interactive affordance", async ({
      page,
    }) => {
      test.skip(
        engineUrl === "",
        "PRESENTON_URL is not set; the page renders its unconfigured blocked state.",
      );

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto("/tools/presentation");

      // Guests get the constant safe shape (page.tsx `GUEST_MODELS`): nothing
      // is known and nothing is switchable, so the chip alone states the truth.
      const control = page.locator("[data-model-control]");
      await expect(control).toBeVisible();
      await expect(control).toHaveAttribute("data-model-state", "unknown");
      await expect(control).toHaveText("Model set on the presentation service.");
      await expect(
        page.getByRole("combobox", { name: "Presentation model" }),
      ).toHaveCount(0);

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    });
  });
});

/**
 * Task F1 — the tool page's "My decks" list (spec §9): owner-only rows with
 * the status word, template, slide count and created label, actions that
 * degrade honestly per row state, and Open landing on the viewer. Rows are
 * seeded through the service client and removed per test like every other
 * fixture here; the guest case proves a visitor never sees a list.
 */
test.describe("tool page decks list (Task F1)", () => {
  test.describe("no session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("renders no decks list for a guest", async ({ page }) => {
      await page.goto("/tools/presentation");

      await expect(page.locator("[data-decks-list]")).toHaveCount(0);
      await expect(page.locator("[data-deck-row]")).toHaveCount(0);
      if (engineUrl !== "") {
        await expect(page.getByText("Sign in to keep decks")).toBeVisible();
      }
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("lists an owned deck with its actions and Open lands on the viewer", async ({
    page,
  }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null, "general", {
      prompt: "QA F1 deck",
      slidesTotal: 8,
    });

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation");

    const row = page.locator(`[data-deck-row="${presentationId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("QA F1 deck");
    await expect(row).toContainText("Ready");
    await expect(row).toContainText("general");
    await expect(row).toContainText("8 slides");
    await expect(row.locator('[data-deck-action="open"]')).toBeVisible();
    await expect(row.locator('[data-deck-action="edit"]')).toBeVisible();
    // No stored document yet: the row links to the Documents hub, it does not
    // claim the deck is already there.
    await expect(row.getByRole("link", { name: "Documents" })).toBeVisible();

    await row.locator('[data-deck-action="open"]').click();
    await page.waitForURL(`**/tools/presentation/${presentationId}`);
    // No engine id was seeded: the viewer owns the honest not-ready panel.
    // Same strict-safe read as the viewer access case (streaming transient).
    await expect(
      page.locator("[data-viewer-not-ready]:visible").first(),
    ).toBeVisible();

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("offers Download and Open in Documents once the deck has a document", async ({
    page,
  }) => {
    const { id: documentId } = await seedDeckDocument(qa1Id);
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      randomUUID(),
      "general",
      {
        prompt: "QA F1 documented deck",
        documentId,
        slidesTotal: 12,
      },
    );

    await page.goto("/tools/presentation");

    const row = page.locator(`[data-deck-row="${presentationId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Deck.pptx");
    await expect(row).toContainText("12 slides");
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(
      row.getByRole("link", { name: "Open in Documents" }),
    ).toBeVisible();
  });

  test("never lists another user's deck (owner RLS)", async ({ page }) => {
    const otherId = await seedOwnedPresentation(qa2Id, randomUUID(), "general", {
      prompt: "QA2 F1 deck",
    });

    await page.goto("/tools/presentation");

    await expect(page.locator(`[data-deck-row="${otherId}"]`)).toHaveCount(0);
  });

  test("degrades in-flight and failed rows honestly", async ({ page }) => {
    const queuedId = await seedOwnedPresentation(qa1Id, null, "general", {
      prompt: "QA F1 queued",
      status: "queued",
      slidesDone: 2,
      slidesTotal: 10,
    });
    const runningId = await seedOwnedPresentation(
      qa1Id,
      randomUUID(),
      "general",
      {
        prompt: "QA F1 running",
        status: "running",
        slidesDone: 4,
        slidesTotal: 10,
      },
    );
    const failedId = await seedOwnedPresentation(qa1Id, null, "general", {
      prompt: "QA F1 failed",
      status: "failed",
      errorMessage: "The presentation service rejected this request.",
    });

    await page.goto("/tools/presentation");

    // Queued without an engine id: the status word and progress, no Open/Edit
    // and no Delete while a worker may still write the row.
    const queuedRow = page.locator(`[data-deck-row="${queuedId}"]`);
    await expect(queuedRow).toContainText("Queued");
    await expect(queuedRow).toContainText("2/10 slides");
    await expect(queuedRow.locator("[data-deck-action]")).toHaveCount(0);
    await expect(queuedRow.getByRole("button")).toHaveCount(0);

    // Running with an engine id: the deck exists on the service, so Open/Edit
    // are offered while generation continues.
    const runningRow = page.locator(`[data-deck-row="${runningId}"]`);
    await expect(runningRow).toContainText("Generating…");
    await expect(runningRow).toContainText("4/10 slides");
    await expect(runningRow.locator('[data-deck-action="open"]')).toBeVisible();
    await expect(runningRow.locator('[data-deck-action="edit"]')).toBeVisible();

    // Failed: the sanitized stored message, no Open/Edit and no Documents
    // link — Task F4 leaves Delete as the row's one cleanup action.
    const failedRow = page.locator(`[data-deck-row="${failedId}"]`);
    await expect(failedRow).toContainText("Failed");
    await expect(failedRow).toContainText(
      "The presentation service rejected this request.",
    );
    await expect(failedRow.locator('[data-deck-action="delete"]')).toBeVisible();
    await expect(failedRow.locator("[data-deck-action]")).toHaveCount(1);
    await expect(failedRow.getByRole("button")).toHaveCount(1);
    await expect(failedRow.getByRole("link")).toHaveCount(0);
  });

  test("renders the honest empty state exactly when the caller owns no decks", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the workspace renders its unconfigured state instead of the run panel.",
    );

    // The account-level truth this case asserts against: the list must show
    // exactly the caller's decks, capped at the page bound (never more, never
    // invented rows), and the empty copy only when there are none.
    const { count, error } = await service
      .from("presentations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id);
    expect(error, `owned decks count: ${error?.message}`).toBeNull();
    const owned = count ?? 0;

    await page.goto("/tools/presentation");
    await expect(page.locator("[data-deck-row]")).toHaveCount(
      Math.min(owned, 20),
    );

    if (owned === 0) {
      await expect(page.locator("[data-decks-list]")).toHaveCount(0);
      await expect(page.getByText("No decks yet")).toBeVisible();
      return;
    }

    // This local account carries legacy Phase A fixture/evidence rows, so the
    // signed-in empty state cannot be observed without deleting rows this spec
    // does not own. The non-empty branch above is still asserted; the guest
    // case proves a data-less visitor sees no list.
    test.skip(
      true,
      `QA1 owns ${owned} pre-existing deck(s) in this local environment; the signed-in empty state is not observable here.`,
    );
  });
});

/**
 * Task F4 — the deck-delete flow (spec §7.4, §10-F).
 *
 * The row's Delete opens the shared `Modal` confirmation (never a single
 * click); the destructive confirm removes the engine deck, the generated
 * document and the row, and the list drops the row while `/documents` loses
 * the file. The live case creates its own throwaway engine deck
 * (`POST /presentation/create/blank`) and never touches a discovered fixture
 * deck. The unreachable case is the dead-loopback evidence pass's assertion:
 * when the suite's `PRESENTON_URL` points at an unused loopback port the
 * delete must answer the permanent honest copy and keep the row whole — in an
 * engine-up run that case skips with the reason, like every live case.
 *
 * Every seeded row/object and engine deck is removed by the flow itself or by
 * the file's afterEach/afterAll sweeps (both tolerate already-gone items).
 */
test.describe("deck delete (Task F4)", () => {
  test("never single-clicks: Cancel keeps the deck, Delete removes it", async ({
    page,
  }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null, "general", {
      prompt: "QA F4 deck without file",
      slidesTotal: 6,
    });

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/tools/presentation");
    // `:visible` is the strict-safe read for the streaming transient this spec
    // documents (a hidden RSC template node can coexist with the live row).
    const row = page.locator(
      `[data-deck-row="${presentationId}"]:visible`,
    );
    await expect(row).toBeVisible();
    await expect(row).toContainText("QA F4 deck without file");
    await expect(row.locator('[data-deck-action="delete"]')).toBeVisible();

    // Cancel is not a delete: the dialog closes and the row stays.
    await row.locator('[data-deck-action="delete"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete this deck?");
    await expect(dialog).toContainText("QA F4 deck without file");
    // Let the shared Modal's entrance settle before the evidence frame.
    await page.waitForTimeout(300);
    await page.screenshot({ path: "screenshots/phase-f-delete-confirm.png" });

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toBeVisible();
    const stillThere = await service
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(stillThere.error, `cancel read: ${stillThere.error?.message}`).toBeNull();
    expect(stillThere.data ?? []).toHaveLength(1);

    // The modal is usable at the narrow breakpoint too.
    await page.setViewportSize({ width: 375, height: 812 });
    await row.locator('[data-deck-action="delete"]').click();
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: "screenshots/phase-f-delete-confirm-375.png",
    });

    await dialog.locator("[data-deck-delete-confirm]").click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toHaveCount(0);

    const deleted = await service
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(deleted.error, `deleted read: ${deleted.error?.message}`).toBeNull();
    expect(deleted.data ?? []).toHaveLength(0);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: "screenshots/phase-f-delete-success.png" });

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual(
      [],
    );
  });

  test("deletes a live deck, its engine deck and its document", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the live engine delete has no service to remove the deck from.",
    );

    const api = await engineApi();
    try {
      // A throwaway blank deck of our own: the delete removes this, never a
      // discovered fixture deck.
      const blank = await createBlankEngineDeck(api);
      if ("reason" in blank) {
        test.skip(true, blank.reason);
        return;
      }
      engineDeckIds.push(blank.id);

      const { id: documentId, storagePath } = await seedDeckDocument(qa1Id);
      const presentationId = await seedOwnedPresentation(
        qa1Id,
        blank.id,
        "general",
        {
          prompt: "QA F4 live deck",
          documentId,
          slidesTotal: 4,
        },
      );

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto("/tools/presentation");
      const row = page.locator(`[data-deck-row="${presentationId}"]:visible`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("Deck.pptx");

      await row.locator('[data-deck-action="delete"]').click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // The copy names both halves the row's facts actually have.
      await expect(dialog).toContainText(
        "will be deleted from the presentation service",
      );
      await expect(dialog).toContainText("removed from Documents");

      await dialog.locator("[data-deck-delete-confirm]").click();
      await expect(dialog).not.toBeVisible();
      await expect(row).toHaveCount(0);

      // The engine deck is gone for real.
      const engineRead = await api.get(
        `/api/v1/ppt/presentation/${blank.id}`,
        { timeout: 15_000 },
      );
      expect(
        engineRead.status(),
        "the engine deck must be deleted with the row",
      ).toBe(404);

      // The row, the document row and the bucket object are all gone.
      const rowRead = await service
        .from("presentations")
        .select("id")
        .eq("id", presentationId);
      expect(rowRead.error, `deleted row read: ${rowRead.error?.message}`).toBeNull();
      expect(rowRead.data ?? []).toHaveLength(0);

      const documentRead = await service
        .from("documents")
        .select("id")
        .eq("id", documentId);
      expect(
        documentRead.error,
        `deleted document read: ${documentRead.error?.message}`,
      ).toBeNull();
      expect(documentRead.data ?? []).toHaveLength(0);
      expect(
        await storageObjectExists(storagePath),
        "the deck's bucket object must be removed with its row",
      ).toBe(false);

      // `/documents` no longer shows the file.
      await page.goto("/documents");
      await expect(page.locator(`[data-document-id="${documentId}"]`)).toHaveCount(0);
      await page.screenshot({
        path: "screenshots/phase-f-delete-documents-clean.png",
      });

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await api.dispose();
    }
  });

  test("never exposes another user's deck and never deletes it", async ({
    page,
  }) => {
    // QA2's row is the object under test; QA1's own deletable row proves the
    // delete path runs while the foreign row stays untouched.
    const foreignId = await seedOwnedPresentation(qa2Id, randomUUID(), "general", {
      prompt: "QA2 F4 deck",
    });
    const ownId = await seedOwnedPresentation(qa1Id, null, "general", {
      prompt: "QA F4 own deck",
    });

    await page.goto("/tools/presentation");
    await expect(page.locator(`[data-deck-row="${foreignId}"]`)).toHaveCount(0);

    const ownRow = page.locator(`[data-deck-row="${ownId}"]:visible`);
    await expect(ownRow).toBeVisible();
    await ownRow.locator('[data-deck-action="delete"]').click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("[data-deck-delete-confirm]").click();
    await expect(ownRow).toHaveCount(0);

    // The foreign row survived the whole flow (the client DELETE denial and
    // the service role's user scoping are pinned in qa-presentation-jobs).
    const foreign = await service
      .from("presentations")
      .select("id, user_id")
      .eq("id", foreignId);
    expect(foreign.error, `foreign read: ${foreign.error?.message}`).toBeNull();
    expect(foreign.data ?? []).toHaveLength(1);
    expect(foreign.data?.[0]?.user_id).toBe(qa2Id);
  });

  test("fails honestly while the engine is unreachable (dead-loopback evidence run)", async ({
    page,
  }) => {
    test.skip(
      engineUrl === "",
      "PRESENTON_URL is not set; the unconfigured delete copy is pinned by the qa-presentation-jobs adapter guards instead.",
    );
    test.skip(
      await isEngineReachable(),
      "this run's engine is reachable; the unreachable delete copy is proven by the dead-loopback evidence pass (PRESENTON_URL pointing at an unused loopback port).",
    );

    // The row's engine id makes the action attempt the engine delete, which
    // fails at the transport; nothing local may be removed afterwards.
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      randomUUID(),
      "general",
      { prompt: "QA F4 offline deck", slidesTotal: 3 },
    );

    await page.goto("/tools/presentation");
    const row = page.locator(`[data-deck-row="${presentationId}"]:visible`);
    await expect(row).toBeVisible();

    await row.locator('[data-deck-action="delete"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-deck-delete-confirm]").click();

    // The sanitized permanent failure is shown and the deck survives whole.
    await expect(dialog.getByRole("alert")).toContainText(
      PRESENTATION_DELETE_UNREACHABLE_ERROR,
    );
    await page.screenshot({ path: "screenshots/phase-f-delete-offline.png" });

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toBeVisible();

    const survived = await service
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(survived.error, `survivor read: ${survived.error?.message}`).toBeNull();
    expect(survived.data ?? []).toHaveLength(1);
  });
});

test.describe("viewer route (live deck)", () => {
  test("renders the rail, counter and keyboard navigation for a real deck", async ({
    page,
  }) => {
    const deck = requireLiveViewerDeck();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      deck.deckId,
      deck.templateId || "general",
    );

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`/tools/presentation/${presentationId}`);
    await page.waitForSelector('[data-viewer-ready="true"]');

    await expect(page.locator("[data-deck-thumb]")).toHaveCount(deck.slideCount);

    const counter = page.locator("[data-slide-counter]");
    await expect(counter).toHaveText(`1 / ${deck.slideCount}`);
    await expect(
      page.locator("[data-viewer-stage] [data-deck-stage]"),
    ).toHaveAttribute("aria-label", "Slide 1");

    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText(`2 / ${deck.slideCount}`);
    await expect(
      page.locator("[data-viewer-stage] [data-deck-stage]"),
    ).toHaveAttribute("aria-label", "Slide 2");

    await page.keyboard.press("Home");
    await expect(counter).toHaveText(`1 / ${deck.slideCount}`);

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("enters and exits present mode with keyboard navigation", async ({ page }) => {
    const deck = requireLiveViewerDeck();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      deck.deckId,
      deck.templateId || "general",
    );

    await page.goto(`/tools/presentation/${presentationId}`);
    await page.waitForSelector('[data-viewer-ready="true"]');

    await page.getByRole("button", { name: "Present" }).click();
    const present = page.locator("[data-present-mode]");
    await expect(present).toBeVisible();
    await expect(page.locator("[data-present-counter]")).toHaveText(
      `1 / ${deck.slideCount}`,
    );

    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-present-counter]")).toHaveText(
      `2 / ${deck.slideCount}`,
    );

    await page.keyboard.press("Escape");
    await expect(present).toHaveCount(0);
  });

  test("traps focus inside present mode from the first Shift+Tab", async ({ page }) => {
    const deck = requireLiveViewerDeck();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      deck.deckId,
      deck.templateId || "general",
    );

    await page.goto(`/tools/presentation/${presentationId}`);
    await page.waitForSelector('[data-viewer-ready="true"]');

    await page.getByRole("button", { name: "Present" }).click();
    const present = page.locator("[data-present-mode]");
    await expect(present).toBeVisible();

    // Entry focus lands on the overlay itself (tabIndex -1), before any Tab.
    await expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement?.hasAttribute("data-present-mode") ?? false,
        ),
      )
      .toBe(true);

    await page.keyboard.press("Shift+Tab");

    const trap = await page.evaluate(() => {
      const overlay = document.querySelector("[data-present-mode]");
      const active = document.activeElement;
      return {
        inside:
          overlay !== null &&
          active !== null &&
          overlay.contains(active) &&
          active !== overlay,
        label:
          active instanceof HTMLElement
            ? (active.getAttribute("aria-label") ?? active.tagName)
            : "none",
      };
    });
    expect(trap.inside, `active element after Shift+Tab: ${trap.label}`).toBe(true);

    await page.keyboard.press("Escape");
    await expect(present).toHaveCount(0);
  });

  test("Space on a focused button activates it instead of advancing the deck", async ({
    page,
  }) => {
    const deck = requireLiveViewerDeck();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      deck.deckId,
      deck.templateId || "general",
    );

    await page.goto(`/tools/presentation/${presentationId}`);
    await page.waitForSelector('[data-viewer-ready="true"]');

    await page.getByRole("button", { name: "Present" }).focus();
    await page.keyboard.press("Space");

    await expect(page.locator("[data-present-mode]")).toBeVisible();
    await expect(page.locator("[data-slide-counter]")).toHaveText(
      `1 / ${deck.slideCount}`,
    );

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-present-mode]")).toHaveCount(0);
  });

  test("shows the labelled Smart fallback instead of faking HTML", async ({ page }) => {
    const smartDeckId = requireLiveSmartDeck();
    const presentationId = await seedOwnedPresentation(qa1Id, smartDeckId, "smart-html");

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`/tools/presentation/${presentationId}`);

    // The streamed route can briefly keep a hidden pre-hydration copy of the
    // panel in the DOM, so the assertion targets the visible one.
    const fallback = page.locator("[data-smart-fallback]:visible");
    await expect(fallback).toBeVisible();
    await expect(fallback.locator("[data-smart-label]")).toHaveText(
      "Smart HTML deck",
    );
    await expect(fallback).toContainText("This deck isn't rendered natively");
    await expect(fallback).toContainText("nothing is faked into the stage");

    // Both affordances point at the wrapper editor route for this row.
    const editHref = `/tools/presentation/${presentationId}/edit`;
    await expect(page.getByRole("link", { name: "Open in the editor" })).toHaveAttribute(
      "href",
      editHref,
    );
    const newTab = page.getByRole("link", { name: /open in a new tab/i });
    await expect(newTab).toHaveAttribute("href", editHref);
    await expect(newTab).toHaveAttribute("target", "_blank");
    expect(await newTab.getAttribute("rel")).toContain("noopener");

    // Honest state: no stage, no rail, no imitation HTML surface.
    await expect(page.locator("[data-viewer-stage]")).toHaveCount(0);
    await expect(page.locator("[data-deck-stage]")).toHaveCount(0);
    await expect(page.locator("[data-deck-thumb]")).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task C4 — the native editor route: access guards, the gated structural
// toolbar, autosaved text/notes/rename/theme writes (persisted through the
// live engine), and the export button's job + mirror flow.
// ---------------------------------------------------------------------------

test.describe("editor route access (never skip)", () => {
  test.describe("no session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("404s a guest without redirecting to sign-in", async ({ page }) => {
      const response = await page.goto(
        `/tools/presentation/${randomUUID()}/edit`,
      );

      expect(response?.status()).toBe(200);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });
  });

  test("404s an unknown presentation id for QA1", async ({ page }) => {
    const response = await page.goto(
      `/tools/presentation/${randomUUID()}/edit`,
    );

    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.locator("[data-deck-editor]")).toHaveCount(0);
  });

  test("404s a malformed id without a 500", async ({ page }) => {
    const response = await page.goto(
      "/tools/presentation/not-a-presentation-id/edit",
    );

    expect(response?.status()).not.toBe(500);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("404s another user's presentation for QA1", async ({ page }) => {
    const presentationId = await seedOwnedPresentation(qa2Id, randomUUID());

    const response = await page.goto(
      `/tools/presentation/${presentationId}/edit`,
    );

    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.locator("[data-deck-editor]")).toHaveCount(0);
  });

  test("renders the honest not-ready panel when no engine id is stored", async ({
    page,
  }) => {
    const presentationId = await seedOwnedPresentation(qa1Id, null);

    const response = await page.goto(
      `/tools/presentation/${presentationId}/edit`,
    );

    expect(response?.status()).toBe(200);
    // The streamed route can briefly keep a hidden pre-hydration copy of the
    // panel in the DOM, so the assertion targets the visible one.
    await expect(
      page.locator("[data-editor-unavailable]:visible"),
    ).toBeVisible();
  });
});

test.describe("editor route (live deck)", () => {
  test("renders the native editor with the structural gate's honest state", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    // Native surface: the stage and rail, never an iframe.
    await expect(page.locator("[data-deck-editor]")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.locator("[data-deck-thumb]")).toHaveCount(
      target.slideCount,
    );
    await expect(page.locator("[data-slide-counter]")).toHaveText(
      `1 / ${target.slideCount}`,
    );
    await expect(page.locator("[data-save-status]")).toHaveAttribute(
      "data-save-status",
      "idle",
    );

    /*
     * Structural gate branch table (Task D0). The flag is read from the
     * adapter the page itself calls, so each row is the honest runtime state:
     *
     * | flag | toolbar                           | note              | layout picker                        |
     * | off  | all five controls disabled        | `[!]` gate reason | disabled + gate reason              |
     * | on   | enabled (the boundary move apart) | absent            | enabled when the template carried    |
     * |      |                                   |                   | layouts, else the layouts-unavailable |
     * |      |                                   |                   | reason — never the gate's           |
     *
     * A boundary move is the control's own state, not the gate: on slide 1
     * "move up" is disabled because no earlier slide exists, and it enables
     * once slide 2 is selected (asserted below). Live structural edits are
     * Task D1's proof; this case only pins the gate's rendered state.
     */
    const { isStructuralEditingEnabled } = await import(
      "../../lib/integrations/presenton"
    );
    if (!isStructuralEditingEnabled()) {
      // Gate off: disabled controls with the recorded reason, not faked.
      const note = page.locator("[data-editor-structural-note]");
      await expect(note).toBeVisible();
      await expect(note).toContainText("[!]");
      await expect(note).toContainText("matching owner scope");
      for (const selector of [
        "[data-editor-add-slide]",
        "[data-editor-duplicate-slide]",
        "[data-editor-delete-slide]",
        "[data-editor-move-up]",
        "[data-editor-move-down]",
      ]) {
        await expect(page.locator(selector)).toBeDisabled();
      }
      await expect(page.locator("#editor-slide-layout")).toBeDisabled();
      await expect(page.locator("[data-editor-layout-note]")).toContainText(
        "matching owner scope",
      );
    } else {
      // Gate on: the controls are enabled unless their own state says
      // otherwise (slide boundaries, a template without layouts).
      await expect(page.locator("[data-editor-structural-note]")).toHaveCount(0);
      await expect(page.locator("[data-editor-add-slide]")).toBeEnabled();
      await expect(page.locator("[data-editor-duplicate-slide]")).toBeEnabled();
      await expect(page.locator("[data-editor-delete-slide]")).toBeEnabled();

      // Slide 1 of a multi-slide deck: down is possible, up is not.
      await expect(page.locator("[data-editor-move-down]")).toBeEnabled();
      const moveUp = page.locator("[data-editor-move-up]");
      await expect(moveUp).toBeDisabled();
      await expect(moveUp).toHaveAttribute("title", "Move slide up");
      // Selecting slide 2 proves the gate is open, not the slide boundary.
      await page.locator('[data-deck-thumb="1"]').click();
      await expect(page.locator("[data-slide-counter]")).toHaveText(
        `2 / ${target.slideCount}`,
      );
      await expect(moveUp).toBeEnabled();

      const layout = page.locator("#editor-slide-layout");
      const layoutNote = page.locator("[data-editor-layout-note]");
      if (await layout.isEnabled()) {
        await expect(layoutNote).toHaveCount(0);
      } else {
        await expect(layoutNote).toContainText(
          "template layouts weren't available",
        );
      }
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("edits a text element, reaches Saved, and the engine stores it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const hit = page.locator(
        `[data-editor-element-hit="${target.hitKey}"]`,
      );
      await expect(hit).toBeVisible();
      await hit.click({ force: true });

      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();
      const marker = `QA-C4 text ${Date.now()}`;
      // Typed one character at a time after a select-all: a contenteditable
      // that re-renders its children per keystroke would scramble the order
      // (the MCP evidence caught that), so the exact stored string is the
      // assertion.
      await inline.click();
      await page.keyboard.press("Control+a");
      await inline.pressSequentially(marker);

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      // The engine stores the run-preserving plain-text write, in order.
      const stored = await readEngineDeck(api, target.deckId);
      const [componentIndex, elementIndex] = target.hitKey
        .replace("components:", "")
        .split("/")
        .map((part) => Number(part));
      const storedElements = stored.slides[0]?.ui?.components?.[componentIndex]
        ?.elements as Array<{ runs?: Array<{ text?: string }> }> | undefined;
      expect(
        storedElements?.[elementIndex]?.runs?.[0]?.text,
        "the saved text must be the engine's stored first run",
      ).toBe(marker);

      // A reload reads the stored deck back and renders the marker again.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page
        .locator(`[data-editor-element-hit="${target.hitKey}"]`)
        .click({ force: true });
      await expect(page.locator("[data-editor-inline-text]")).toHaveText(
        marker,
      );
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("renames the deck and the engine stores it", async ({ page }) => {
    const target = requireEditorTarget();
    test.skip(
      target.originalTheme === null,
      "the discovered deck has no stored theme to carry through a rename.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const newTitle = `QA-C4 rename ${Date.now()}`;
      await page.locator("[data-editor-title]").fill(newTitle);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      expect(stored.title).toBe(newTitle);

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(page.locator("[data-editor-title]")).toHaveValue(newTitle);
    } finally {
      await restoreEngineDeck(
        api,
        target.deckId,
        target.originalTitle,
        target.originalTheme,
      );
      await api.dispose();
    }
  });

  test("edits speaker notes and the engine stores them", async ({ page }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const marker = `QA-C4 notes ${Date.now()}`;
      await page.locator("[data-editor-notes-text]").fill(marker);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      expect(stored.slides[0]?.speaker_note).toBe(marker);

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(page.locator("[data-editor-notes-text]")).toHaveValue(
        marker,
      );
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("changes the theme to the template theme and the engine stores it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      // The template's own theme is the comparison target (the option the
      // picker offers is that exact object, read server-side).
      const templateResponse = await api.get(
        `/api/v1/ppt/template/${target.templateId}`,
        { timeout: 30_000 },
      );
      expect(
        templateResponse.ok(),
        `engine template read: ${templateResponse.status()}`,
      ).toBe(true);
      const template = (await templateResponse.json()) as {
        theme?: DeckTheme | null;
      };
      const templateTheme = template.theme ?? null;
      if (templateTheme === null) {
        test.skip(true, "the deck's template carries no theme to apply.");
        return;
      }
      const templatePrimary = templateTheme.colors.primary;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      await page.locator("#editor-deck-theme").click();
      const option = page.getByRole("option", { name: /^Template theme/ });
      if ((await option.count()) === 0) {
        test.skip(
          true,
          "the deck's stored theme already matches the template theme.",
        );
      }
      await option.click();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      await expect(page.locator("#editor-deck-theme")).toContainText(
        "Template theme",
      );

      const stored = await readEngineDeck(api, target.deckId);
      expect(stored.theme, "the engine must store a theme").toBeTruthy();
      expect(
        (stored.theme as DeckTheme).colors?.primary,
        "the engine stores the template theme's colors",
      ).toBe(templatePrimary);

      // After a reload the editor reads the stored theme back and renders
      // its first swatch from it.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(
        page.locator('[data-editor-theme-swatch="0"]'),
      ).toHaveAttribute("title", templatePrimary);
    } finally {
      await restoreEngineDeck(
        api,
        target.deckId,
        target.originalTitle,
        target.originalTheme,
      );
      await api.dispose();
    }
  });

  test("offers the engine's custom themes in the deck theme picker", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const custom = requireLiveCustomTheme();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    await page.locator("#editor-deck-theme").click();
    await expect(
      page.getByRole("option", { name: custom.label, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("requests an export, disables the control while exporting, and the worker settles the mirror", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const document = await seedDeckDocument(qa1Id);
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
      { documentId: document.id },
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    const exportButton = page.locator("[data-editor-export]");
    await expect(exportButton).toBeEnabled();

    // The worker lock is held from before the enqueue through the settle (and
    // the job-row cleanup): the full suite runs other worker-driving projects
    // concurrently, and a foreign worker run in that window would claim the
    // due job — `claim_jobs` is global, so the export must own its claim.
    const release = await acquireWorkerLock();
    try {
      const enqueueWindowStart = new Date(
        Date.now() - ENQUEUE_WINDOW_SLACK_MS,
      ).toISOString();
      await exportButton.click();
      await expect(exportButton).toBeDisabled({ timeout: 10_000 });

      // The click enqueued a real `presentation.export` job for this row;
      // only a row created inside this click's window may be captured.
      const jobId = await awaitEnqueuedExportJob(
        presentationId,
        enqueueWindowStart,
      );

      const output = runWorkerOnceLive();
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=succeeded");
    } finally {
      // Delete under the lock: the WhatsApp residue guards run only while
      // holding it, so this row cannot be observed after this release.
      try {
        await deleteExportJobsFor([presentationId]);
      } finally {
        release();
      }
    }

    await expect
      .poll(
        async () => {
          const { data, error } = await service
            .from("presentations")
            .select("export_status, exported_at")
            .eq("id", presentationId)
            .single();
          expect(error, `export mirror read: ${error?.message}`).toBeNull();
          return data?.export_status ?? null;
        },
        { timeout: 30_000 },
      )
      .toBe("succeeded");

    // The editor's row poll re-enables the control and shows the settled state.
    await expect(page.locator("[data-editor-export-status]")).toHaveText(
      "Exported",
      { timeout: 30_000 },
    );
    await expect(exportButton).toBeEnabled();
  });

  test("replaces the deck's document in place through the live worker", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const document = await seedDeckDocument(qa1Id);
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
      { documentId: document.id },
    );

    // The in-place proof needs the seeded row's own size and timestamp.
    const seeded = await service
      .from("documents")
      .select("size_bytes, updated_at")
      .eq("id", document.id)
      .single();
    expect(seeded.error, `seeded document read: ${seeded.error?.message}`).toBeNull();
    expect(seeded.data?.size_bytes).toBe(SEEDED_DECK_BYTES.byteLength);

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    const exportButton = page.locator("[data-editor-export]");
    await expect(exportButton).toBeEnabled();

    // Same claim-window contract as the C4 export case: the lock covers the
    // enqueue, the settle and the job-row cleanup.
    const release = await acquireWorkerLock();
    try {
      const enqueueWindowStart = new Date(
        Date.now() - ENQUEUE_WINDOW_SLACK_MS,
      ).toISOString();
      await exportButton.click();
      await expect(exportButton).toBeDisabled({ timeout: 10_000 });

      const jobId = await awaitEnqueuedExportJob(
        presentationId,
        enqueueWindowStart,
      );

      const output = runWorkerOnceLive("spec-c5-export");
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=succeeded");
    } finally {
      try {
        await deleteExportJobsFor([presentationId]);
      } finally {
        release();
      }
    }

    await expect
      .poll(
        async () => {
          const { data, error } = await service
            .from("presentations")
            .select("export_status")
            .eq("id", presentationId)
            .single();
          expect(error, `export mirror read: ${error?.message}`).toBeNull();
          return data?.export_status ?? null;
        },
        { timeout: 30_000 },
      )
      .toBe("succeeded");

    // One deck → one document (spec §7.7): the same row id and bucket key
    // survive, with the re-export's bytes and a fresh `updated_at`.
    const { data: replaced, error: replacedError } = await service
      .from("documents")
      .select("id, storage_path, size_bytes, updated_at")
      .eq("id", document.id)
      .single();
    expect(replacedError, `replaced document read: ${replacedError?.message}`).toBeNull();
    expect(replaced).not.toBeNull();
    expect(replaced!.id).toBe(document.id);
    expect(replaced!.storage_path).toBe(document.storagePath);
    expect(replaced!.size_bytes).not.toBe(seeded.data!.size_bytes);
    expect(
      new Date(replaced!.updated_at).getTime(),
      "the re-export must move the document's updated_at",
    ).toBeGreaterThan(new Date(seeded.data!.updated_at).getTime());

    // The bucket object under the same key is the re-exported PPTX (a real
    // ZIP archive), not the seeded placeholder.
    const stored = await service.storage
      .from("documents")
      .download(document.storagePath);
    expect(stored.error, `stored object read: ${stored.error?.message}`).toBeNull();
    const bytes = Buffer.from(await stored.data!.arrayBuffer());
    expect(bytes.byteLength).toBe(replaced!.size_bytes);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  /*
   * Task D1 — selection, drag/resize/rotate, z-order, group/ungroup (spec
   * §5.4, §6.3, §8.5).
   *
   * Every case edits the discovered engine deck and restores it in a `finally`
   * through the engine's own `slide_update` route. The drag gesture is a real
   * pointer sequence (`page.mouse`), the keyboard cases use the stage's
   * focusable canvas, and each persistence assertion re-reads the engine.
   */

  /**
   * The selected element's live stage frame in **screen** pixels: the overlay
   * renders inside a `scale(fit)` box, so the DOM rect is already on screen.
   */
  async function selectionFrame(page: TestPage, key: string) {
    const frame = page.locator(`[data-editor-selection-frame="${key}"]`);
    await expect(frame).toBeVisible();
    const box = await frame.boundingBox();
    if (box === null) throw new Error(`no frame for ${key}`);
    return box;
  }

  /** `components:0/1` → the path object `getElementAtPath` consumes. */
  function pathFromKey(
    key: string,
  ): { root: "components" | "elements"; indexes: number[] } | null {
    const [root, chain] = key.split(":", 2);
    if (root !== "components" && root !== "elements") return null;
    const indexes = (chain ?? "")
      .split("/")
      .filter((part) => part !== "")
      .map((part) => Number(part));
    if (indexes.some((index) => !Number.isInteger(index) || index < 0)) {
      return null;
    }
    return { root, indexes };
  }

  /** The editor stage box's screen rect at the current scroll position. */
  async function stageBoxRect(page: TestPage) {
    const rect = await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>("[data-editor-stage]");
      if (stage === null) return null;
      const box = stage.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    if (rect === null) throw new Error("stage box missing");
    return rect;
  }

  /** The engine's stored position for one element on the target deck. */
  function storedElementPosition(
    stored: PresentationDeck,
    slideIndex: number,
    key: string,
  ): { x: number; y: number } | null {
    const parsed = pathFromKey(key);
    if (parsed === null) return null;
    const slide = stored.slides[slideIndex];
    if (slide === undefined) return null;
    const element = getElementAtPath(slide, parsed);
    if (element === null) return null;
    return element.position ?? null;
  }

  test("drags a selected element, saves, and the engine stores the new position", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    /* A scratch component with one positioned target element gives the drag
       a deterministic frame away from every edge and every auto-derived
       layout (the bundled deck's elements sit at canvas edges). It is
       appended to the working slide on the engine and removed again by the
       `finally` restore. */
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const origin = { x: 100, y: 100 };
    const startPosition = { x: 0, y: 0 };
    const dragComponent: SlideComponent = {
      id: "qa-d1-drag-target",
      description: "QA D1 drag target",
      position: origin,
      elements: [
        {
          type: "text",
          name: "qa_d1_drag_target",
          position: startPosition,
          size: { width: 400, height: 120 },
          runs: [{ text: "Drag me" }],
        },
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, dragComponent],
          }
        : target.originalSlide.ui,
    };
    const targetKey = `components:${componentCount}/0`;

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${targetKey}"]`).click({
        force: true,
      });

      /* Selecting a text element autofocuses its inline editor, which can
         scroll the page; settle that before measuring so the frame rect and
         the stage scale describe the same moment. */
      await page.waitForTimeout(300);
      await page.locator("[data-editor-stage]").focus();
      await page.waitForTimeout(100);
      const before = await selectionFrame(page, targetKey);
      const beforeStage = await stageBoxRect(page);
      const screenDx = 120;
      const screenDy = 60;
      /* The gesture starts on the labelled grab handle: a text element being
         edited is covered by its contenteditable, so the handle is the one
         drag affordance every element type shares. */
      const grab = page.locator("[data-editor-drag-handle]");
      await expect(grab).toBeVisible();
      const grabBox = (await grab.boundingBox())!;
      await page.mouse.move(
        grabBox.x + grabBox.width / 2,
        grabBox.y + grabBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        grabBox.x + grabBox.width / 2 + screenDx,
        grabBox.y + grabBox.height / 2 + screenDy,
        { steps: 8 },
      );
      await page.mouse.up();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      const position = storedElementPosition(stored, 0, targetKey);
      expect(position).not.toBeNull();

      /* The stored delta is the pointer delta divided by the overlay's live
         scale (spec §6.3). The frame's own width is 400 stage px × that
         scale, so it measures the scale exactly; the stage box's width
         additionally carries its 1px border and must not be used. */
      const scale = before.width / 400;
      const expectedX = Math.round(screenDx / scale);
      const expectedY = Math.round(screenDy / scale);
      expect(position!.x - startPosition.x).toBeGreaterThanOrEqual(
        expectedX - 1,
      );
      expect(position!.x - startPosition.x).toBeLessThanOrEqual(expectedX + 1);
      expect(position!.y - startPosition.y).toBeGreaterThanOrEqual(
        expectedY - 1,
      );
      expect(position!.y - startPosition.y).toBeLessThanOrEqual(expectedY + 1);

      // A reload renders the stored position back: the frame's position
      // *within the stage* moved by the same screen delta.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${targetKey}"]`).click({
        force: true,
      });
      await page.waitForTimeout(300);
      await page.locator("[data-editor-stage]").focus();
      await page.waitForTimeout(100);
      const after = await selectionFrame(page, targetKey);
      const afterStage = await stageBoxRect(page);
      const deltaX = after.x - afterStage.x - (before.x - beforeStage.x);
      const deltaY = after.y - afterStage.y - (before.y - beforeStage.y);
      expect(deltaX).toBeCloseTo(screenDx, 0);
      expect(deltaY).toBeCloseTo(screenDy, 0);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("Escape cancels an in-progress drag without saving", async ({ page }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${target.hitKey}"]`).click({
        force: true,
      });
      const before = await selectionFrame(page, target.hitKey);

      const grab = page.locator("[data-editor-drag-handle]");
      const grabBox = (await grab.boundingBox())!;
      await page.mouse.move(
        grabBox.x + grabBox.width / 2,
        grabBox.y + grabBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        grabBox.x + grabBox.width / 2 + 90,
        grabBox.y + grabBox.height / 2 + 45,
        { steps: 6 },
      );

      // The live preview follows the pointer (a smaller stage-space move on
      // the fitted stage, so any visible offset proves the drag is live).
      const during = await selectionFrame(page, target.hitKey);
      expect(during.x).toBeGreaterThan(before.x + 5);
      expect(during.y).toBeGreaterThan(before.y + 2);

      await page.keyboard.press("Escape");
      await page.mouse.up();

      // The frame snaps back to the stored position and no save is scheduled.
      await page.waitForTimeout(2_500);
      const after = await selectionFrame(page, target.hitKey);
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "idle",
      );
      const stored = await readEngineDeck(api, target.deckId);
      const parsed = pathFromKey(target.hitKey);
      const storedElement =
        parsed === null ? null : getElementAtPath(stored.slides[0], parsed);
      const originalElement =
        parsed === null
          ? null
          : getElementAtPath(target.originalSlide, parsed);
      expect(storedElement?.position ?? null).toEqual(
        originalElement?.position ?? null,
      );
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });



  test("arrow keys move the selected element by 1px and Shift by 10px, and the engine stores it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${target.hitKey}"]`).click({
        force: true,
      });

      /* While a text element's inline editor owns focus, the arrow keys are
         the caret's; the stage's own arrow commands run when the stage holds
         focus (spec §8.5). Focusing it is the keyboard-only path. */
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowDown");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      const parsed = pathFromKey(target.hitKey);
      const originalElement =
        parsed === null ? null : getElementAtPath(target.originalSlide, parsed);
      const originalPosition = originalElement?.position ?? { x: 0, y: 0 };
      const position = storedElementPosition(stored, 0, target.hitKey);
      expect(position).not.toBeNull();
      expect(position!.x - originalPosition.x).toBe(1);
      expect(position!.y - originalPosition.y).toBe(10);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("Alt+K sends the selected element forward and Alt+J back, both persisting", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    // A scratch component with two positioned text siblings gives the layer
    // commands a deterministic pair (the bundled deck's components are
    // single-element); it is appended to the working slide on the engine and
    // removed again by the `finally` restore.
    const stack: SlideComponent = {
      id: "qa-d1-zorder-stack",
      description: "QA D1 z-order stack",
      position: { x: 200, y: 240 },
      elements: [
        {
          type: "text",
          name: "qa_d1_back",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 80 },
          runs: [{ text: "Back" }],
        },
        {
          type: "text",
          name: "qa_d1_front",
          // Deliberately not overlapping the back element: a forced click
          // hits the topmost hit target, so an overlapping pair would select
          // the front element and Alt+K (already front-most) would no-op.
          position: { x: 0, y: 120 },
          size: { width: 300, height: 80 },
          runs: [{ text: "Front" }],
        },
      ],
    };
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, stack],
          }
        : target.originalSlide.ui,
    };
    const backKey = `components:${componentCount}/0`;
    const storedNames = async (): Promise<Array<string | undefined>> => {
      const stored = await readEngineDeck(api, target.deckId);
      return (
        stored.slides[0].ui?.components?.[componentCount]?.elements.map(
          (element) => (element as { name?: string }).name,
        ) ?? []
      );
    };

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${backKey}"]`).click({
        force: true,
      });

      /* The layer commands are keyboard-only (per the brief) and need the
         stage armed: while a text element's inline editor owns focus, keys
         belong to the caret. */
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Alt+K");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      expect(await storedNames()).toEqual(["qa_d1_front", "qa_d1_back"]);

      // The selection follows the moved element, so Alt+J sends it back and
      // the original order is restored. `data-save-status` is already "saved"
      // from the first command, so the engine read is the wait condition.
      await page.keyboard.press("Alt+J");
      await expect
        .poll(storedNames, { timeout: 20_000 })
        .toEqual(["qa_d1_back", "qa_d1_front"]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  /**
   * The scratch frame the resize/rotate cases share: a short, explicitly
   * sized text element (20 stage px tall ≈ 6 screen px, so its corner and
   * edge handles overlap on screen — the corner must stay the topmost).
   */
  function transformScratchComponent(): SlideComponent {
    return {
      id: "qa-d1-transform-target",
      description: "QA D1 transform target",
      position: { x: 240, y: 300 },
      elements: [
        {
          type: "text",
          name: "qa_d1_transform_target",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 20 },
          runs: [{ text: "Transform me" }],
        },
      ],
    };
  }

  test("resizes a selected element from its corner handle and persists", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const scratch = transformScratchComponent();
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, scratch],
          }
        : target.originalSlide.ui,
    };
    const key = `components:${componentCount}/0`;

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });
      /* The caret owns the arrow keys, not the handles: blur into the stage
         so the element is selected but not being typed into. */
      await page.locator("[data-editor-stage]").focus();
      const before = await selectionFrame(page, key);

      const se = page.locator('[data-editor-transform-handle="se"]');
      await expect(se).toBeVisible();
      const seBox = (await se.boundingBox())!;
      const screenDx = 60;
      const screenDy = 20;
      await page.mouse.move(
        seBox.x + seBox.width / 2,
        seBox.y + seBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        seBox.x + seBox.width / 2 + screenDx,
        seBox.y + seBox.height / 2 + screenDy,
        { steps: 8 },
      );
      await page.mouse.up();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      const parsed = pathFromKey(key);
      const storedElement =
        parsed === null ? null : getElementAtPath(stored.slides[0], parsed);
      if (storedElement === null || storedElement.type !== "text") {
        throw new Error("expected the stored scratch text element");
      }
      const scale = before.width / 300;
      const expectedWidth = Math.round(screenDx / scale);
      const expectedHeight = Math.round(screenDy / scale);
      expect(storedElement.size?.width ?? 0).toBeGreaterThanOrEqual(
        300 + expectedWidth - 2,
      );
      expect(storedElement.size?.width ?? 0).toBeLessThanOrEqual(
        300 + expectedWidth + 2,
      );
      // The corner resizes both axes; if the edge handle had captured the
      // gesture this stays at the original height (the pinned regression).
      expect(storedElement.size?.height ?? 0).toBeGreaterThanOrEqual(
        20 + expectedHeight - 2,
      );
      expect(storedElement.size?.height ?? 0).toBeLessThanOrEqual(
        20 + expectedHeight + 2,
      );
      // A corner resize anchors the opposite corner (the position holds).
      expect(storedElement.position ?? { x: 0, y: 0 }).toEqual({
        x: 0,
        y: 0,
      });
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("rotates a selected element with the rotate handle and persists", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const scratch = transformScratchComponent();
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, scratch],
          }
        : target.originalSlide.ui,
    };
    const key = `components:${componentCount}/0`;

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });
      await page.locator("[data-editor-stage]").focus();
      const frame = await selectionFrame(page, key);

      const rotate = page.locator("[data-editor-rotate-handle]");
      await expect(rotate).toBeVisible();
      const rotateBox = (await rotate.boundingBox())!;
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      /* The handle starts above the center (-90°); dragging it to the right
         of the center is a quarter turn clockwise. */
      await page.mouse.move(
        rotateBox.x + rotateBox.width / 2,
        rotateBox.y + rotateBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(centerX + (centerY - (rotateBox.y + rotateBox.height / 2)) * 0.98, centerY, {
        steps: 8,
      });
      await page.mouse.up();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      const parsed = pathFromKey(key);
      const storedElement =
        parsed === null ? null : getElementAtPath(stored.slides[0], parsed);
      if (storedElement === null) {
        throw new Error("expected the stored scratch element");
      }
      const rotation = storedElement.rotation ?? 0;
      expect(rotation).toBeGreaterThan(80);
      expect(rotation).toBeLessThan(100);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("resizes a rotated element in its local axes and persists", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    /* A box large enough that the rotated corner handle is a comfortable
       target (the D1 transform scratch is 20 stage px tall). */
    const scratch: SlideComponent = {
      id: "qa-d1b-rotated-resize-target",
      description: "QA D1b rotated resize target",
      position: { x: 240, y: 300 },
      elements: [
        {
          type: "text",
          name: "qa_d1b_rotated_resize_target",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 100 },
          runs: [{ text: "Rotate then resize" }],
        },
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, scratch],
          }
        : target.originalSlide.ui,
    };
    const key = `components:${componentCount}/0`;
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });
      await page.locator("[data-editor-stage]").focus();

      /* Place the rotation through the real rotate gesture (not a seeded
         rotation): the resize must compose whatever value the editor stored. */
      const frame = await selectionFrame(page, key);
      const rotate = page.locator("[data-editor-rotate-handle]");
      await expect(rotate).toBeVisible();
      const rotateBox = (await rotate.boundingBox())!;
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      await page.mouse.move(
        rotateBox.x + rotateBox.width / 2,
        rotateBox.y + rotateBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        centerX + (centerY - (rotateBox.y + rotateBox.height / 2)) * 0.98,
        centerY,
        { steps: 8 },
      );
      await page.mouse.up();
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const rotatedDeck = await readEngineDeck(api, target.deckId);
      const rotatedPath = pathFromKey(key);
      const rotatedElement =
        rotatedPath === null
          ? null
          : getElementAtPath(rotatedDeck.slides[0], rotatedPath);
      if (rotatedElement === null || rotatedElement.type !== "text") {
        throw new Error("expected the stored rotated scratch text element");
      }
      const rotation = rotatedElement.rotation ?? 0;
      expect(rotation).toBeGreaterThan(80);
      expect(rotation).toBeLessThan(100);
      const beforeSize = {
        width: rotatedElement.size?.width ?? 0,
        height: rotatedElement.size?.height ?? 0,
      };
      const beforePosition = rotatedElement.position ?? { x: 0, y: 0 };

      /* A rotated frame keeps its resize handles (D1b): the honest disabled
         label is gone and the corner handle is live. */
      await expect(page.locator("[data-editor-resize-disabled]")).toHaveCount(
        0,
      );
      const se = page.locator('[data-editor-transform-handle="se"]');
      await expect(se).toBeVisible();
      const beforeFrame = await selectionFrame(page, key);
      const scale = beforeFrame.width / beforeSize.width;

      /* The persisted size is the stage drag converted into the element's
         local axes; the anchor (the se handle's opposite corner) stays fixed,
         which moves the origin, so `position` must change as well. */
      const radians = (rotation * Math.PI) / 180;
      const screenDx = -40;
      const screenDy = 60;
      const stageDx = screenDx / scale;
      const stageDy = screenDy / scale;
      const localDx = stageDx * Math.cos(radians) + stageDy * Math.sin(radians);
      const localDy = -stageDx * Math.sin(radians) + stageDy * Math.cos(radians);

      /* At ~90° the local +x axis points down the stage: a left+down drag
         grows both local dimensions. */
      const seBox = (await se.boundingBox())!;
      await page.mouse.move(
        seBox.x + seBox.width / 2,
        seBox.y + seBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        seBox.x + seBox.width / 2 + screenDx,
        seBox.y + seBox.height / 2 + screenDy,
        { steps: 8 },
      );
      await page.mouse.up();

      /* The autosave debounce (2 s) means `saved` can still describe the
         rotate commit; the engine read is the wait condition for this one. */
      const parsed = pathFromKey(key);
      const engineWidth = async (): Promise<number> => {
        const deck = await readEngineDeck(api, target.deckId);
        const element =
          parsed === null ? null : getElementAtPath(deck.slides[0], parsed);
        return element?.size?.width ?? 0;
      };
      await expect
        .poll(engineWidth, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(beforeSize.width + localDx - 3);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const stored = await readEngineDeck(api, target.deckId);
      const storedElement =
        parsed === null ? null : getElementAtPath(stored.slides[0], parsed);
      if (storedElement === null || storedElement.type !== "text") {
        throw new Error("expected the stored resized scratch text element");
      }
      expect(storedElement.size?.width ?? 0).toBeLessThanOrEqual(
        beforeSize.width + localDx + 3,
      );
      expect(storedElement.size?.height ?? 0).toBeGreaterThanOrEqual(
        beforeSize.height + localDy - 3,
      );
      expect(storedElement.size?.height ?? 0).toBeLessThanOrEqual(
        beforeSize.height + localDy + 3,
      );
      expect(storedElement.position ?? { x: 0, y: 0 }).not.toEqual(
        beforePosition,
      );
      expect(storedElement.rotation ?? 0).toBeCloseTo(rotation, 6);

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("keeps the rotate handle reachable for a top-edge element", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');
    await page.locator(`[data-editor-element-hit="${target.hitKey}"]`).click({
      force: true,
    });
    await page.locator("[data-editor-stage]").focus();

    const frame = await selectionFrame(page, target.hitKey);
    const rotate = page.locator("[data-editor-rotate-handle]");
    await expect(rotate).toBeVisible();
    const rotateBox = (await rotate.boundingBox())!;
    const stage = await stageBoxRect(page);
    const handleCenterY = rotateBox.y + rotateBox.height / 2;

    /* The arm lives 22px outside the frame (plus its own 22px), in screen
       px. When the stage clips that space away the arm must flip below the
       frame instead of rendering unreachable above it. */
    const armOutsidePx = 33;
    if (frame.y - armOutsidePx < stage.y) {
      expect(handleCenterY).toBeGreaterThan(frame.y + frame.height);
    } else {
      expect(handleCenterY).toBeLessThan(frame.y);
    }
    // Either way the handle is inside the stage's visible box.
    expect(handleCenterY).toBeGreaterThanOrEqual(stage.y);
    expect(handleCenterY).toBeLessThanOrEqual(stage.y + stage.height);
  });

  /**
   * A scratch, non-overlapping text pair at the stage's origin, for the
   * gesture-leak and focus-scope cases (the bundled deck's components are
   * single-element).
   */
  function gestureScratchPair(): {
    component: SlideComponent;
    firstKey: (componentCount: number) => string;
    secondKey: (componentCount: number) => string;
  } {
    return {
      component: {
        id: "qa-d1-gesture-pair",
        description: "QA D1 gesture pair",
        position: { x: 0, y: 0 },
        elements: [
          {
            type: "text",
            name: "qa_d1_gesture_a",
            position: { x: 0, y: 0 },
            size: { width: 300, height: 80 },
            runs: [{ text: "Gesture A" }],
          },
          {
            type: "text",
            name: "qa_d1_gesture_b",
            position: { x: 0, y: 120 },
            size: { width: 300, height: 80 },
            runs: [{ text: "Gesture B" }],
          },
        ],
      },
      firstKey: (componentCount: number) => `components:${componentCount}/0`,
      secondKey: (componentCount: number) => `components:${componentCount}/1`,
    };
  }

  test("an off-stage pointer release keeps its gesture on the element it started on", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const pair = gestureScratchPair();
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, pair.component],
          }
        : target.originalSlide.ui,
    };
    const aKey = pair.firstKey(componentCount);
    const bKey = pair.secondKey(componentCount);

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${aKey}"]`).click({
        force: true,
      });

      const grab = page.locator("[data-editor-drag-handle]");
      const grabBox = (await grab.boundingBox())!;
      const stage = await stageBoxRect(page);
      const grabCenter = {
        x: grabBox.x + grabBox.width / 2,
        y: grabBox.y + grabBox.height / 2,
      };
      /* Drag past the stage's right edge and release there: the stage's
         pointer capture keeps delivering, so the release commits to A
         instead of stranding the gesture for the next press. */
      await page.mouse.move(grabCenter.x, grabCenter.y);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width + 80, grabCenter.y, {
        steps: 10,
      });
      await page.mouse.up();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      const afterA = await readEngineDeck(api, target.deckId);
      expect(storedElementPosition(afterA, 0, aKey)?.x).toBe(980);

      // A plain click on B must not inherit A's (now committed) offset.
      await page.locator(`[data-editor-element-hit="${bKey}"]`).click({
        force: true,
      });
      await page.waitForTimeout(400);
      const stored = await readEngineDeck(api, target.deckId);
      expect(storedElementPosition(stored, 0, bKey)).toEqual({ x: 0, y: 120 });
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("does not run stage commands while focus is outside the stage", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const pair = gestureScratchPair();
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, pair.component],
          }
        : target.originalSlide.ui,
    };
    const aKey = pair.firstKey(componentCount);
    const bKey = pair.secondKey(componentCount);

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${aKey}"]`).click({
        force: true,
      });

      /* Focus a chrome control (the Export button is enabled here; Undo is
         disabled with no history and cannot take focus): the arrows and
         layer chords belong to the stage, so nothing may nudge, reorder or
         schedule a save. */
      const exportButton = page.locator("[data-editor-export]");
      await exportButton.focus();
      await expect(exportButton).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Alt+K");
      await page.waitForTimeout(500);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "idle",
      );
      const unchanged = await readEngineDeck(api, target.deckId);
      expect(storedElementPosition(unchanged, 0, aKey)).toEqual({ x: 0, y: 0 });
      const order = (
        unchanged.slides[0].ui?.components?.[componentCount]?.elements ?? []
      ).map((element) => (element as { name?: string }).name);
      expect(order).toEqual(["qa_d1_gesture_a", "qa_d1_gesture_b"]);

      // The stage's own keyboard path still works once it holds focus.
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      const moved = await readEngineDeck(api, target.deckId);
      expect(storedElementPosition(moved, 0, aKey)).toEqual({ x: 1, y: 0 });
      expect(storedElementPosition(moved, 0, bKey)).toEqual({ x: 0, y: 120 });
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("Mod+G groups the selection and Mod+Shift+G ungroups it, both persisting", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    // A scratch component with two positioned text siblings gives the live
    // group/ungroup path a deterministic element list (the bundled deck's
    // components are single-element); it is appended to the working slide on
    // the engine and removed again by the `finally` restore.
    const pair: SlideComponent = {
      id: "qa-d1-group-pair",
      description: "QA D1 group pair",
      position: { x: 160, y: 420 },
      elements: [
        {
          type: "text",
          name: "qa_d1_left",
          position: { x: 0, y: 0 },
          size: { width: 320, height: 90 },
          runs: [{ text: "Left card" }],
        },
        {
          type: "text",
          name: "qa_d1_right",
          position: { x: 400, y: 0 },
          size: { width: 320, height: 90 },
          runs: [{ text: "Right card" }],
        },
      ],
    };
    const componentCount =
      target.originalSlide.ui?.components?.length ?? 0;
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, pair],
          }
        : target.originalSlide.ui,
    };
    const leftKey = `components:${componentCount}/0`;
    const rightKey = `components:${componentCount}/1`;

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${leftKey}"]`).click({
        force: true,
      });
      await page
        .locator(`[data-editor-element-hit="${rightKey}"]`)
        .click({ force: true, modifiers: ["Shift"] });
      /* The chord belongs to the stage (spec §8.5): a keyboard user arms it
         by focusing the canvas. */
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+g");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      const storedGroup = await readEngineDeck(api, target.deckId);
      const groupElements =
        storedGroup.slides[0].ui?.components?.[componentCount]?.elements ?? [];
      expect(groupElements.map((element) => element.type)).toEqual(["group"]);
      const group = groupElements[0];
      if (group.type !== "group") throw new Error("expected a stored group");
      expect(
        group.children.map((child) => (child as { name?: string }).name),
      ).toEqual(["qa_d1_left", "qa_d1_right"]);

      // Ungroup in the same session: select the group on the stage and
      // Mod+Shift+G (the group is the component's only element).
      await page
        .locator(`[data-editor-element-hit="components:${componentCount}/0"]`)
        .click({ force: true });
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+Shift+g");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      const storedUngrouped = await readEngineDeck(api, target.deckId);
      const ungrouped =
        storedUngrouped.slides[0].ui?.components?.[componentCount]?.elements ??
        [];
      expect(ungrouped.map((element) => element.type)).toEqual([
        "text",
        "text",
      ]);
      expect(
        ungrouped.map((element) => (element as { name?: string }).name),
      ).toEqual(["qa_d1_left", "qa_d1_right"]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
});

/*
 * Task D2 — rich text runs (spec §5.4 "Inline text", §6.4).
 *
 * The inline editor now renders the element's runs as styled spans and the
 * run toolbar (and Mod+B/I/U) formats the current selection: runs split at the
 * selection boundaries, the property lands only on the selected range, and
 * identical adjacent runs merge. Each case seeds a deterministic scratch
 * component ("Alpha Beta") on the discovered engine deck, selects the word
 * "Beta" with real keyboard word-selection, formats it, and restores the
 * original slide in a `finally`. Persistence is asserted by re-reading the
 * engine; undo/redo through the shared history restores the prior runs.
 */
test.describe("editor rich text runs (live deck)", () => {
  /** The engine's stored runs for one `components:c/i` element on slide 0. */
  function storedRuns(
    stored: PresentationDeck,
    key: string,
  ): unknown {
    const [componentIndex, elementIndex] = key
      .replace("components:", "")
      .split("/")
      .map((part) => Number(part));
    const element =
      stored.slides[0]?.ui?.components?.[componentIndex]?.elements?.[
        elementIndex
      ];
    return element !== undefined && element.type === "text"
      ? (element as { runs?: unknown }).runs
      : undefined;
  }

  /**
   * Each case appends one deterministic text component to the working slide
   * on the engine and removes it again through the `finally` restore.
   */
  function seedRunsTarget(target: {
    originalSlide: DeckSlide;
  }): { seededSlide: DeckSlide; key: string; componentCount: number } {
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const component: SlideComponent = {
      id: "qa-d2-runs-target",
      description: "QA D2 runs target",
      position: { x: 120, y: 120 },
      elements: [
        {
          type: "text",
          name: "qa_d2_runs_target",
          position: { x: 0, y: 0 },
          size: { width: 560, height: 120 },
          font: { size: 32, color: "#111827" },
          runs: [{ text: "Alpha Beta" }],
        },
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, component],
          }
        : target.originalSlide.ui,
    };
    return {
      seededSlide,
      key: `components:${componentCount}/0`,
      componentCount,
    };
  }

  test("bolds a selected word through the run toolbar, reloads bold, and undo restores", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const { seededSlide, key } = seedRunsTarget(target);

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });

      /* The inline editor autofocuses with the caret at the end; clicking it
         arms the real caret, and one word selection left covers "Beta"
         (offsets 6..10). */
      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();
      await inline.click();
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await page.locator("[data-editor-format-toggle]").click();
      const toolbar = page.locator("[data-editor-run-toolbar]");
      await expect(toolbar).toBeVisible();
      const bold = page.locator("[data-editor-run-bold]");
      await expect(bold).toBeEnabled();
      await bold.click();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      // The engine stores the split: unselected bytes untouched, bold only on
      // the selected run.
      expect(storedRuns(await readEngineDeck(api, target.deckId), key)).toEqual([
        { text: "Alpha " },
        { text: "Beta", font: { bold: true } },
      ]);

      // Undo restores the previous runs and autosaves them back.
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual([{ text: "Alpha Beta" }]);

      // Redo re-applies it, so the reload below reads a bold deck back.
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+Shift+z");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual([{ text: "Alpha " }, { text: "Beta", font: { bold: true } }]);

      // A reload renders the stored runs as two spans: only the second is bold.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });
      const reloaded = page.locator("[data-editor-inline-text]");
      await expect(reloaded).toBeVisible();
      const spans = reloaded.locator("span[data-editor-run]");
      await expect(spans).toHaveCount(2);
      expect(
        await spans.nth(0).evaluate((node) => getComputedStyle(node).fontWeight),
      ).not.toBe("700");
      expect(
        await spans.nth(1).evaluate((node) => getComputedStyle(node).fontWeight),
      ).toBe("700");
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("Mod+B/I/U format the selection and toggle from the effective font", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const { seededSlide, key } = seedRunsTarget(target);

    const storedBold = [
      { text: "Alpha " },
      { text: "Beta", font: { bold: true } },
    ];

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${key}"]`).click({
        force: true,
      });

      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();
      await inline.click();
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await page.keyboard.press("Control+b");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual(storedBold);

      // The selection survived the commit; italic stacks on bold.
      await page.keyboard.press("Control+i");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual([
          { text: "Alpha " },
          { text: "Beta", font: { bold: true, italic: true } },
        ]);

      await page.keyboard.press("Control+u");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual([
          { text: "Alpha " },
          {
            text: "Beta",
            font: { bold: true, italic: true, underline: true },
          },
        ]);

      // Mod+B toggles the effective bold off (an explicit `false` — the wire
      // has no "unset"; the run no longer renders bold), leaving the others.
      await page.keyboard.press("Control+b");
      await expect
        .poll(async () => storedRuns(await readEngineDeck(api, target.deckId), key), {
          timeout: 20_000,
        })
        .toEqual([
          { text: "Alpha " },
          {
            text: "Beta",
            font: { bold: false, italic: true, underline: true },
          },
        ]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
});

/**
 * The C4 editor's element addressing, exercised purely: text elements are
 * listed in render order (nested ones included), a path resolves back to its
 * element, an update replaces exactly that element immutably, and the
 * run-preserving plain-text write keeps the first run's style.
 */
test.describe("editor images (live deck)", () => {
  test("searches stock images in the picker and states provider honesty", async ({
    page,
  }) => {
    const target = requireEditorImageTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');
    if (target.slideIndex > 0) {
      await page.locator(`[data-deck-thumb="${target.slideIndex}"]`).click();
    }
    await page
      .locator(`[data-editor-element-hit="${target.hitKey}"]`)
      .click({ force: true });
    await page.locator("[data-editor-image-picker-open]").click();
    await page.locator('[data-image-tab="search"]').click();
    await page.locator("[data-image-search-input]").fill("ocean waves");
    await page.locator("[data-image-search-submit]").click();

    /* Live provider, or the honest unavailable state — never fabricated
       results. Whichever branch runs is recorded in the run log. */
    await expect
      .poll(
        async () =>
          (await page.locator("[data-image-tile]").count()) +
          (await page.locator("[data-image-unavailable]").count()),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const results = await page.locator("[data-image-tile]").count();
    if (results > 0) {
      console.log(
        `[qa-presentations-ui] image search exercised: ${results} provider result(s)`,
      );
    } else {
      console.log(
        "[qa-presentations-ui] image search unavailable on this engine; the honest state was shown",
      );
    }
  });

  test("uploads an image, inserts it, persists fit/crop, and the proxy serves it", async ({
    page,
    request,
  }) => {
    const target = requireEditorImageTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let uploadedId: string | null = null;
    let foreignImageId: string | null = null;

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      if (target.slideIndex > 0) {
        await page.locator(`[data-deck-thumb="${target.slideIndex}"]`).click();
      }
      const hit = page.locator(`[data-editor-element-hit="${target.hitKey}"]`);
      await expect(hit).toBeVisible();
      await hit.click({ force: true });
      await expect(page.locator("[data-editor-image-controls]")).toBeVisible();

      // Upload through the picker → the owner-gated route → the engine store.
      await page.locator("[data-editor-image-picker-open]").click();
      await page.locator('[data-image-tab="upload"]').click();
      await page.locator("[data-image-upload-input]").setInputFiles({
        name: "qa-d3-fixture.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
      const [uploadResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(`/api/presentation/${presentationId}/images`) &&
            response.request().method() === "POST",
        ),
        page.locator("[data-image-upload-submit]").click(),
      ]);
      expect(uploadResponse.status()).toBe(201);
      const uploadBody = (await uploadResponse.json()) as {
        image?: { id?: string; fileUrl?: string };
      };
      const uploaded = uploadBody.image;
      expect(uploaded?.fileUrl, "the route returns the created image").toBeTruthy();
      uploadedId = uploaded?.id ?? null;

      const insert = page.locator("[data-image-insert-upload]");
      await expect(insert).toBeVisible({ timeout: 30_000 });
      await insert.click();
      await expect(page.locator("[data-image-picker]")).toBeHidden();

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      // The engine stores the uploaded file URL on the element.
      const stored = await readEngineDeck(api, target.deckId);
      const storedElement = elementAtHitKey(
        stored,
        target.slideIndex,
        target.hitKey,
      );
      const uploadedUrl =
        typeof storedElement?.data === "string" ? storedElement.data : "";
      expect(uploadedUrl, "the persisted data is the uploaded file_url").toBe(
        uploaded?.fileUrl,
      );
      expect(uploadedUrl).toMatch(/^\/app_data\/images\//);

      // The proxy serves the uploaded bytes now that the deck references them.
      const asset = await request.get(assetUrl(presentationId, uploadedUrl));
      expect(asset.status()).toBe(200);
      expect((await asset.body()).byteLength).toBeGreaterThan(0);

      // The stage's <img> resolves without a reload (the bounded retry).
      const stageImage = page
        .locator(`img[src*="${encodeURIComponent(uploadedUrl)}"]`)
        .first();
      await expect
        .poll(
          async () =>
            stageImage.evaluate((node) =>
              node instanceof HTMLImageElement ? node.naturalWidth : 0,
            ),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);

      // Fit + crop through the inspector controls (one slide save each).
      await page.locator("#editor-image-fit").click();
      await page.getByRole("option", { name: /cover/i }).click();
      await page.locator('[data-editor-image-field="focus-x"]').fill("25");
      await page.locator('[data-editor-image-field="focus-y"]').fill("75");
      await page.locator('[data-editor-image-field="crop-scale"]').fill("2");
      await page.locator('[data-editor-image-field="crop-scale"]').press("Enter");

      /* The status was already "saved" from the insert, so waiting on it would
         pass before the debounced crop save lands. Poll the engine instead:
         the stored focus_x is the proof the write arrived. */
      await expect
        .poll(
          async () => {
            const deck = await readEngineDeck(api, target.deckId);
            return elementAtHitKey(deck, target.slideIndex, target.hitKey)
              ?.focus_x;
          },
          { timeout: 20_000 },
        )
        .toBe(25);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      const edited = await readEngineDeck(api, target.deckId);
      const editedElement = elementAtHitKey(
        edited,
        target.slideIndex,
        target.hitKey,
      );
      expect(editedElement?.fit, "fit persists").toBe("cover");
      expect(editedElement?.focus_x, "focus_x persists").toBe(25);
      expect(editedElement?.focus_y, "focus_y persists").toBe(75);
      expect(editedElement?.crop_scale, "crop_scale persists").toBe(2);

      // Reload reads the stored style back into the controls.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      if (target.slideIndex > 0) {
        await page.locator(`[data-deck-thumb="${target.slideIndex}"]`).click();
      }
      await page
        .locator(`[data-editor-element-hit="${target.hitKey}"]`)
        .click({ force: true });
      await expect(
        page.locator('[data-editor-image-field="focus-x"]'),
      ).toHaveValue("25");
      await expect(
        page.locator('[data-editor-image-field="focus-y"]'),
      ).toHaveValue("75");
      await expect(
        page.locator('[data-editor-image-field="crop-scale"]'),
      ).toHaveValue("2");

      /* The library is scoped to the caller's own referenced images (review
         fix). The just-saved deck references the uploaded image, so it lists
         and is deletable; an engine image no QA1 deck references — created
         directly for the proof — must stay hidden, never previewed and never
         deletable. */
      const foreignUpload = await api.post("/api/v1/ppt/images/upload", {
        multipart: {
          file: {
            name: "qa-d3-foreign.png",
            mimeType: "image/png",
            buffer: TINY_PNG,
          },
        },
        timeout: 60_000,
      });
      expect(foreignUpload.ok()).toBe(true);
      const foreignBody = (await foreignUpload.json()) as { id?: string };
      foreignImageId = foreignBody.id ?? null;
      expect(foreignImageId).toBeTruthy();

      await page.locator("[data-editor-image-picker-open]").click();
      await page.locator('[data-image-tab="library"]').click();
      await page.locator('[data-image-library-kind="uploaded"]').click();

      const deleteButton = page.locator(`[data-image-delete="${uploadedId}"]`);
      await expect(deleteButton).toBeVisible({ timeout: 30_000 });
      await expect(deleteButton).toBeEnabled();
      await expect(
        page.locator(`[data-image-delete="${foreignImageId}"]`),
        "a foreign engine image must never be listed",
      ).toHaveCount(0);

      await deleteButton.click();
      const confirmDialog = page
        .locator("dialog[open]")
        .filter({ has: page.locator("[data-image-delete-confirm]") });
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog).toContainText("This deck uses it");
      await page.locator("[data-image-delete-confirm]").click();
      await expect(deleteButton).toHaveCount(0, { timeout: 30_000 });
      uploadedId = null;

      const library = await api.get("/api/v1/ppt/images/uploaded", {
        timeout: 30_000,
      });
      expect(library.ok()).toBe(true);
      const entries = (await library.json()) as Array<{ id?: unknown }>;
      expect(
        entries.some((entry) => entry.id === uploaded?.id),
        "the deleted image is gone from the engine library",
      ).toBe(false);
      expect(
        entries.some((entry) => entry.id === foreignImageId),
        "the foreign image itself was never touched",
      ).toBe(true);
    } finally {
      // The deck is restored even on failure; no engine image this test
      // created may outlive it (the UI delete already removed the upload).
      await restoreEngineSlide(api, target.originalSlide);
      if (uploadedId !== null) {
        await api
          .delete(`/api/v1/ppt/images/${uploadedId}`, { timeout: 30_000 })
          .catch(() => undefined);
      }
      if (foreignImageId !== null) {
        await api
          .delete(`/api/v1/ppt/images/${foreignImageId}`, { timeout: 30_000 })
          .catch(() => undefined);
      }
      await api.dispose();
    }
  });
});

/*
 * Task D4 — icon search, insert and recolor (spec §5.4 icons row, §6.5).
 *
 * The engine's icon catalog is searched through the editor's picker (a Server
 * Action → `GET /api/v1/ppt/icons/search`), the chosen path replaces a seeded
 * icon element's `data`, and the color field recolors the rendered SVG
 * client-side (fetched through the owner-gated asset proxy — never an engine
 * recolor route). The case seeds a scratch icon component on the discovered
 * deck, drives the picker with real clicks/typing, asserts the engine-stored
 * `data`/`is_icon`/`color`, the proxy's `image/svg+xml` answer and the stage's
 * recolored data URI, then removes the component in a `finally`. When the
 * engine's catalog answers nothing the case skips with a recorded reason —
 * no icon is ever faked.
 */
test.describe("editor icons (live deck)", () => {
  const SEEDED_ICON_PATH = "/static/icons/bold/lightbulb-bold.svg";

  /** One deterministic icon component appended to the target slide. */
  function seedIconComponent(target: EditorImageTarget): {
    seededSlide: DeckSlide;
    key: string;
  } {
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const component: SlideComponent = {
      id: "qa-d4-icon-target",
      description: "QA D4 icon target",
      position: { x: 320, y: 240 },
      elements: [
        {
          type: "image",
          name: "qa_d4_icon_target",
          position: { x: 0, y: 0 },
          size: { width: 160, height: 160 },
          data: SEEDED_ICON_PATH,
          is_icon: true,
          decorative: false,
        },
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, component],
          }
        : target.originalSlide.ui,
    };
    return {
      seededSlide,
      key: `components:${componentCount}/0`,
    };
  }

  test("searches the catalog, inserts an icon, recolors it and reloads the stored fields", async ({
    page,
    request,
  }) => {
    const target = requireEditorImageTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const { seededSlide, key } = seedIconComponent(target);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      if (target.slideIndex > 0) {
        await page.locator(`[data-deck-thumb="${target.slideIndex}"]`).click();
      }
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });

      // The seeded element is an icon: its controls offer the catalog picker.
      await expect(page.locator("[data-editor-icon-controls]")).toBeVisible();
      await page.locator("[data-editor-icon-picker-open]").click();
      await page.locator("[data-icon-search-input]").fill("lightbulb");
      await page.locator("[data-icon-search-submit]").click();

      await expect(
        page.locator("[data-icon-tile], [data-icon-unavailable]").first(),
      ).toBeVisible({ timeout: 30_000 });

      const tileCount = await page.locator("[data-icon-tile]").count();
      if (tileCount === 0) {
        const reason =
          (await page.locator("[data-icon-unavailable]").count()) > 0
            ? "the engine's icon catalog is unavailable on this service."
            : "the engine's icon catalog answered no results for the query.";
        console.log(
          `[qa-presentations-ui] icon search exercised nothing: ${reason}`,
        );
        test.skip(true, reason);
      }

      /* The weight filter re-runs the search; the latest request wins and
         every result then lives in the requested weight directory. */
      await page.locator("#icon-search-weight").click();
      await page.getByRole("option", { name: "Regular", exact: true }).click();
      await expect
        .poll(
          async () =>
            page.locator('[data-icon-path^="/static/icons/regular/"]').count(),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      await expect(
        page.locator('[data-icon-path]:not([data-icon-path^="/static/icons/regular/"])'),
      ).toHaveCount(0);

      /* Every tile preview streams through the owner-gated proxy; wait for
         the bytes before the screenshot (and prove the preview path works). */
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const images = Array.from(
                document.querySelectorAll("[data-icon-tile] img"),
              ) as HTMLImageElement[];
              return (
                images.length > 0 &&
                images.every((image) => image.complete && image.naturalWidth > 0)
              );
            }),
          { timeout: 30_000 },
        )
        .toBe(true);

      await page.screenshot({
        path: "screenshots/phase-d-d4-icon-picker.png",
      });

      const firstTile = page
        .locator('[data-icon-path^="/static/icons/regular/"]')
        .first();
      const chosenPath = await firstTile.getAttribute("data-icon-path");
      expect(chosenPath).toBeTruthy();
      await firstTile.click();

      /* Picking runs the Server Action validation first (the server is the
         authority), so the modal closes once that round-trip settles — give a
         live engine room on a cold server rather than assuming a fast one. */
      await expect(page.locator("[data-icon-picker]")).toBeHidden({
        timeout: 30_000,
      });
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      let stored = await readEngineDeck(api, target.deckId);
      let storedElement = elementAtHitKey(stored, target.slideIndex, key);
      expect(storedElement?.data, "the picked path persists").toBe(chosenPath);
      expect(storedElement?.is_icon, "the element stays an icon").toBe(true);

      // The owner-gated proxy serves the icon's SVG bytes.
      const asset = await request.get(assetUrl(presentationId, chosenPath!));
      expect(asset.status()).toBe(200);
      expect(asset.headers()["content-type"]).toContain("image/svg+xml");
      expect((await asset.body()).byteLength).toBeGreaterThan(0);

      // Recolor through the inspector's color field.
      await page.locator("[data-editor-icon-color]").fill("#C2410C");
      await expect
        .poll(
          async () =>
            elementAtHitKey(
              await readEngineDeck(api, target.deckId),
              target.slideIndex,
              key,
            )?.color,
          { timeout: 20_000 },
        )
        .toBe("#C2410C");

      /* The stage renders the recolored SVG from a data URI produced by the
         client-side recolor (the proxy/url path is asserted above). */
      const recolored = page
        .locator('img[data-deck-icon-recolored="true"]')
        .first();
      await expect(recolored).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () =>
            recolored.evaluate((node) =>
              node.getAttribute("src")?.startsWith("data:image/svg+xml") ??
              false,
            ),
          { timeout: 20_000 },
        )
        .toBe(true);
      await expect
        .poll(
          async () =>
            recolored.evaluate((node) =>
              node instanceof HTMLImageElement ? node.naturalWidth : 0,
            ),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);

      /* The rendered bytes are the recolored SVG: the chosen color is in the
         markup and no `currentColor` survives (spec §6.5's fill/stroke
         replacement, proved on the live proxy bytes). */
      const decodedIcon = await recolored.evaluate((node) => {
        const src = node.getAttribute("src") ?? "";
        return decodeURIComponent(src.slice(src.indexOf(",") + 1));
      });
      expect(decodedIcon).toContain("#C2410C");
      expect(decodedIcon).not.toContain("currentColor");

      await page.locator("[data-editor-stage]").screenshot({
        path: "screenshots/phase-d-d4-icon-stage.png",
      });
      await page.screenshot({
        path: "screenshots/phase-d-d4-icon-recolored.png",
      });

      // Reload reads the stored data/is_icon/color back into the editor.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      if (target.slideIndex > 0) {
        await page.locator(`[data-deck-thumb="${target.slideIndex}"]`).click();
      }
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });
      await expect(page.locator("[data-editor-icon-color]")).toHaveValue(
        "#C2410C",
      );
      await expect
        .poll(
          async () =>
            page
              .locator('img[data-deck-icon-recolored="true"]')
              .first()
              .evaluate((node) =>
                node instanceof HTMLImageElement ? node.naturalWidth : 0,
              ),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      await page.screenshot({
        path: "screenshots/phase-d-d4-icon-reload.png",
      });

      stored = await readEngineDeck(api, target.deckId);
      storedElement = elementAtHitKey(stored, target.slideIndex, key);
      expect(storedElement?.data).toBe(chosenPath);
      expect(storedElement?.is_icon).toBe(true);
      expect(storedElement?.color).toBe("#C2410C");

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
});

/*
 * Task D5 — chart and table data editors (spec §5.4 charts/tables rows, §6.6,
 * §6.4).
 *
 * Both cases seed a scratch element onto the discovered live deck's first
 * slide through the engine's own `slide_update`, drive the native inspector
 * with real clicks/typing, assert the engine-stored wire and the stage's
 * re-render, reload the editor to prove the stored state reads back, and
 * restore the original slide in a `finally`. The pure halves of every
 * operation are pinned in `qa-presentation-renderer`; these cases prove the
 * live loop (commit → `slide_update` → autosave `Saved` → engine → re-render →
 * reload) and never fake data.
 */
test.describe("editor charts (live deck)", () => {
  /** One deterministic chart component appended to the target slide. */
  function seedChartComponent(target: EditorTarget): {
    seededSlide: DeckSlide;
    key: string;
  } {
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const component: SlideComponent = {
      id: "qa-d5-chart-target",
      description: "QA D5 chart target",
      position: { x: 150, y: 180 },
      elements: [
        {
          type: "chart",
          name: "qa_d5_chart_target",
          position: { x: 0, y: 0 },
          size: { width: 620, height: 320 },
          chart_type: "bar",
          title: "QA D5 chart",
          categories: ["Alpha", "Beta", "Gamma"],
          series: [
            { name: "Series 1", values: [1, 2] },
            { name: "Series 2", values: [3, 4] },
          ],
          colors: ["#285F20"],
          decorative: false,
        } satisfies ChartElement,
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, component],
          }
        : target.originalSlide.ui,
    };
    return { seededSlide, key: `components:${componentCount}/0` };
  }

  test("edits a series value, re-renders the canvas and persists through a reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const { seededSlide, key } = seedChartComponent(target);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });

      // The seeded element is a chart: its controls and canvas are live.
      await expect(page.locator("[data-editor-chart-controls]")).toBeVisible();
      const chart = page.locator(
        '[data-editor-stage] [data-deck-chart-name="qa_d5_chart_target"]',
      );
      await expect(chart).toHaveAttribute("data-deck-chart-state", "ready", {
        timeout: 20_000,
      });
      const canvas = chart.locator("canvas");
      const beforePixels = await canvas.evaluate((node) =>
        (node as HTMLCanvasElement).toDataURL(),
      );

      await page.locator("[data-editor-chart-toggle]").click();
      await expect(page.locator("[data-editor-chart-editor]")).toBeVisible({
        timeout: 10_000,
      });
      await page.screenshot({
        path: "screenshots/phase-d-d5-chart-editor.png",
      });

      // Series 1 stores no value for Gamma: the grid renders the padded 0 and
      // the write must persist it instead of silently discarding the edit.
      const valueInput = page.locator('[data-editor-chart-value="0-2"]');
      await expect(valueInput).toHaveValue("0");
      await valueInput.fill("42");
      await valueInput.press("Enter");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      await expect
        .poll(
          async () => {
            const stored = await readEngineDeck(api, target.deckId);
            const element = elementAtHitKey(stored, 0, key) as {
              series?: Array<{ values?: number[] }>;
            } | null;
            return element?.series?.[0]?.values;
          },
          { timeout: 20_000 },
        )
        .toEqual([1, 2, 42]);

      // The stage chart re-renders from chartConfig (the canvas bytes change).
      await expect
        .poll(
          async () =>
            canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL()),
          { timeout: 20_000 },
        )
        .not.toBe(beforePixels);

      /* Pie renders only the first series: switching the type disables the
         second series' inputs instead of pretending they are editable. */
      await page.locator("#editor-chart-type").click();
      await page.getByRole("option", { name: "Pie chart", exact: true }).click();
      await expect(page.locator('[data-editor-chart-series="1"]')).toBeDisabled();
      await expect(page.locator('[data-editor-chart-value="1-0"]')).toBeDisabled();
      await expect(
        page.locator('[data-editor-chart-note]').filter({
          hasText: "render only the first series",
        }),
      ).toBeVisible();
      await page.screenshot({
        path: "screenshots/phase-d-d5-chart-pie-readonly.png",
      });

      // Back to a bar chart for the stage/reload evidence; the engine read-back
      // is the authoritative settle.
      await page.locator("#editor-chart-type").click();
      await page.getByRole("option", { name: "Bar chart", exact: true }).click();
      await expect
        .poll(
          async () => {
            const stored = await readEngineDeck(api, target.deckId);
            const element = elementAtHitKey(stored, 0, key) as {
              chart_type?: string;
            } | null;
            return element?.chart_type;
          },
          { timeout: 20_000 },
        )
        .toBe("bar");

      // Close the popover for the stage screenshot.
      await page.locator("[data-editor-chart-close]").click();
      await expect(page.locator("[data-editor-chart-editor]")).toBeHidden();
      await page.locator("[data-editor-stage]").screenshot({
        path: "screenshots/phase-d-d5-chart-stage.png",
      });

      // Reload: the stored value reads back into the editor grid.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });
      await page.locator("[data-editor-chart-toggle]").click();
      await expect(page.locator('[data-editor-chart-value="0-2"]')).toHaveValue(
        "42",
      );
      await page.screenshot({
        path: "screenshots/phase-d-d5-chart-reload.png",
      });

      // Responsive: the popover stays inside a 375px viewport, console clean.
      await page.setViewportSize({ width: 375, height: 720 });
      await page.locator("[data-editor-chart-toggle]").scrollIntoViewIfNeeded();
      const responsiveEditor = page.locator("[data-editor-chart-editor]");
      await expect(responsiveEditor).toBeVisible();
      await expect(responsiveEditor).toBeInViewport();
      await page.screenshot({
        path: "screenshots/phase-d-d5-chart-375.png",
      });

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
});

test.describe("editor tables (live deck)", () => {
  /** One deterministic table component appended to the target slide. */
  function seedTableComponent(target: EditorTarget): {
    seededSlide: DeckSlide;
    key: string;
  } {
    const componentCount = target.originalSlide.ui?.components?.length ?? 0;
    const cell = (text: string) => ({ runs: [{ text }] });
    const component: SlideComponent = {
      id: "qa-d5-table-target",
      description: "QA D5 table target",
      position: { x: 140, y: 150 },
      elements: [
        {
          type: "table",
          name: "qa_d5_table_target",
          position: { x: 0, y: 0 },
          size: { width: 820, height: 260 },
          columns: [cell("Region"), cell("Sales")],
          rows: [
            [cell("US"), cell("10")],
            [cell("EU"), cell("20")],
          ],
          decorative: false,
        } satisfies TableElement,
      ],
    };
    const seededSlide: DeckSlide = {
      ...target.originalSlide,
      ui: target.originalSlide.ui
        ? {
            ...target.originalSlide.ui,
            components: [...target.originalSlide.ui.components, component],
          }
        : target.originalSlide.ui,
    };
    return { seededSlide, key: `components:${componentCount}/0` };
  }

  test("edits a cell and adds a row, both rendering and persisting through a reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const { seededSlide, key } = seedTableComponent(target);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await api.patch("/api/v1/ppt/presentation/slide_update", {
        data: { slide: seededSlide },
        timeout: 30_000,
      });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });

      // The seeded element is a table: its grid addresses rendered cells.
      await expect(page.locator("[data-editor-table-controls]")).toBeVisible();
      const stageTable = page.locator(
        '[data-editor-stage] [data-deck-table-name="qa_d5_table_target"]',
      );
      await expect(stageTable.locator('[data-deck-table-cell="1-1"]')).toHaveText(
        "10",
      );

      const cellInput = page.locator('[data-editor-table-cell="1-1"]');
      await expect(cellInput).toHaveValue("10");
      await cellInput.fill("99");
      await cellInput.press("Tab");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      await expect
        .poll(
          async () => {
            const stored = await readEngineDeck(api, target.deckId);
            const element = elementAtHitKey(stored, 0, key) as {
              rows?: Array<Array<{ runs?: Array<{ text?: string }> }>>;
            } | null;
            return element?.rows?.[0]?.[1]?.runs?.[0]?.text;
          },
          { timeout: 20_000 },
        )
        .toBe("99");
      await expect(stageTable.locator('[data-deck-table-cell="1-1"]')).toHaveText(
        "99",
      );
      await page.screenshot({
        path: "screenshots/phase-d-d5-table-editor.png",
      });
      await page.locator("[data-editor-stage]").screenshot({
        path: "screenshots/phase-d-d5-table-stage.png",
      });

      // Add a row through the editor; the engine stores a third body row.
      await page.locator("[data-editor-table-add-row]").click();
      await expect
        .poll(
          async () => {
            const stored = await readEngineDeck(api, target.deckId);
            const element = elementAtHitKey(stored, 0, key) as {
              rows?: unknown[];
            } | null;
            return element?.rows?.length;
          },
          { timeout: 20_000 },
        )
        .toBe(3);
      await expect(page.locator(`[data-editor-table-cell="3-0"]`)).toHaveValue(
        "",
      );

      // Reload: both the cell text and the added row read back.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page
        .locator(`[data-editor-element-hit="${key}"]`)
        .click({ force: true });
      await expect(page.locator('[data-editor-table-cell="1-1"]')).toHaveValue(
        "99",
      );
      await expect(page.locator('[data-editor-table-cell="3-0"]')).toHaveValue(
        "",
      );
      await expect(
        page.locator(
          '[data-editor-stage] [data-deck-table-name="qa_d5_table_target"]',
        ),
      ).toBeVisible();
      await page.screenshot({
        path: "screenshots/phase-d-d5-table-reload.png",
      });

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
});

test.describe("editor element paths (pure)", () => {
  test("lists, resolves and updates nested text elements immutably", async () => {
    const paths = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/elementPath"
    );
    const nestedText = {
      type: "text" as const,
      name: "nested",
      size: { width: 100, height: 20 },
      position: { x: 0, y: 0 },
      runs: [{ text: "Nested", font: { size: 12, bold: true } }],
    };
    const directText = {
      type: "text" as const,
      name: "direct",
      size: { width: 100, height: 20 },
      position: { x: 0, y: 0 },
      runs: [{ text: "Direct", font: { size: 16 } }],
    };
    const slide = {
      id: randomUUID(),
      presentation: randomUUID(),
      layout_group: "general",
      layout: "title_intro",
      index: 0,
      content: {},
      ui: {
        components: [
          {
            id: "component-a",
            description: "",
            position: { x: 0, y: 0 },
            elements: [
              {
                type: "group" as const,
                name: "group",
                children: [nestedText],
              },
              directText,
            ],
          },
        ],
      },
    } as unknown as DeckSlide;

    const entries = paths.listTextElements(slide);
    expect(entries.map((entry) => entry.element.name)).toEqual([
      "nested",
      "direct",
    ]);
    expect(entries.map((entry) => paths.elementPathKey(entry.path))).toEqual([
      "components:0/0/0",
      "components:0/1",
    ]);

    const resolved = paths.getElementAtPath(
      slide,
      paths.parseElementPathKey("components:0/0/0")!,
    );
    expect(resolved?.type).toBe("text");
    expect((resolved as { name?: string } | null)?.name).toBe("nested");

    const updated = paths.updateElementAtPath(
      slide,
      paths.parseElementPathKey("components:0/0/0")!,
      (element) =>
        element.type === "text"
          ? paths.setTextOnElement(element, "Replaced")
          : element,
    );
    const group = updated.ui?.components?.[0]?.elements?.[0];
    expect(group?.type).toBe("group");
    if (group?.type === "group") {
      const child = group.children[0];
      expect(child.type).toBe("text");
      if (child.type === "text") {
        expect(child.runs).toEqual([
          { text: "Replaced", font: { size: 12, bold: true } },
        ]);
      }
    }
    // The original slide was not mutated.
    const originalGroup = slide.ui?.components?.[0]?.elements?.[0];
    if (originalGroup?.type === "group") {
      const originalChild = originalGroup.children[0];
      if (originalChild.type === "text") {
        expect(originalChild.runs?.[0]).toEqual({
          text: "Nested",
          font: { size: 12, bold: true },
        });
      }
    }
  });

  test("degrades a LaTeX first run to the element font when written", async () => {
    const paths = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/elementPath"
    );
    const element = {
      type: "text" as const,
      name: "formula",
      size: { width: 100, height: 20 },
      runs: [{ type: "latex" as const, latex: "x^2", font: { size: 14 } }],
      font: { family: "Tinos", size: 18 },
    };
    expect(paths.textOfTextElement(element)).toBe("x^2");
    const written = paths.setTextOnElement(element, "x squared");
    expect(written.runs).toEqual([
      { text: "x squared", font: { size: 14 } },
    ]);
  });

  test("reads and replaces runs immutably", async () => {
    const paths = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/elementPath"
    );
    const element = {
      type: "text" as const,
      name: "runs",
      runs: [{ text: "a", font: { size: 10 } }],
    };
    expect(paths.runsOfTextElement(element)).toEqual([
      { text: "a", font: { size: 10 } },
    ]);

    const nextRuns = [{ text: "b" }, { text: " c", font: { bold: true } }];
    const next = paths.setRunsOnElement(element, nextRuns);
    expect(next.runs).toEqual(nextRuns);
    expect(next.name).toBe("runs");
    // The element was not mutated.
    expect(element.runs).toEqual([{ text: "a", font: { size: 10 } }]);
    expect(
      paths.runsOfTextElement({ ...element, runs: undefined as never }),
    ).toEqual([]);
  });
});

/**
 * The C4 review fix's pure half: the structural acknowledgement merge. A
 * full-array save rotates every slide id across the network, so edits landing
 * while it is in flight must be mapped onto the fresh ids and re-saved, never
 * replaced by the pre-await snapshot; a newer structural edit wins outright.
 */
test.describe("structural ack merge (pure)", () => {
  function slideFixture(id: string, text: string, index: number): DeckSlide {
    return {
      id,
      presentation: "00000000-0000-4000-8000-000000000000",
      layout_group: "general",
      layout: "title_intro",
      index,
      content: { text },
      properties: null,
      ui: null,
      speaker_note: null,
    };
  }

  test("re-applies edits made during the save onto the fresh ids", async () => {
    const { mergeStructuralAck } = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/structuralMerge"
    );
    const snapshot = [
      slideFixture("old-0", "One", 0),
      slideFixture("old-1", "Two", 1),
    ];
    const acknowledged = [
      slideFixture("new-0", "One", 0),
      slideFixture("new-1", "Two", 1),
    ];
    const edited = { ...snapshot[0], content: { text: "One edited" } };
    const latest = [edited, snapshot[1]];

    const merge = mergeStructuralAck({ snapshot, acknowledged, latest });

    expect(merge.diverged).toBe(false);
    expect(merge.idMap.get("old-0")).toBe("new-0");
    expect(merge.idMap.get("old-1")).toBe("new-1");
    expect(merge.resaveSlideIds).toEqual(["new-0"]);
    expect(merge.slides[0].id).toBe("new-0");
    expect(merge.slides[0].content).toEqual({ text: "One edited" });
    expect(merge.slides[1]).toBe(acknowledged[1]);

    // With no edits during the save the acknowledged slides are adopted as-is.
    const clean = mergeStructuralAck({
      snapshot,
      acknowledged,
      latest: snapshot,
    });
    expect(clean.diverged).toBe(false);
    expect(clean.slides[0]).toBe(acknowledged[0]);
    expect(clean.slides[1]).toBe(acknowledged[1]);
    expect(clean.resaveSlideIds).toEqual([]);
  });

  test("keeps the newer local state when a structural edit landed during the save", async () => {
    const { mergeStructuralAck } = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/structuralMerge"
    );
    const snapshot = [
      slideFixture("old-0", "One", 0),
      slideFixture("old-1", "Two", 1),
    ];
    const acknowledged = [
      slideFixture("new-0", "One", 0),
      slideFixture("new-1", "Two", 1),
    ];
    // The user reordered (and appended) while the save was in flight.
    const latest = [
      { ...snapshot[1], index: 0 },
      { ...snapshot[0], index: 1 },
      slideFixture("old-2", "Three", 2),
    ];

    const merge = mergeStructuralAck({ snapshot, acknowledged, latest });

    expect(merge.diverged).toBe(true);
    expect(merge.slides).toBe(latest);
    expect(merge.resaveSlideIds).toEqual([]);
  });

  test("re-queues pending slide targets onto the fresh ids after the ack", async () => {
    const { rebasePendingAfterAck } = await import(
      "../../app/(app)/tools/presentation/[id]/edit/_components/useDeckAutosave"
    );
    type Entry = {
      target:
        | { kind: "slide"; slideId: string }
        | { kind: "meta" }
        | { kind: "structure" };
      revision: number;
    };
    const pending = new Map<string, Entry>([
      [
        "slide:old-0",
        { target: { kind: "slide", slideId: "old-0" }, revision: 0 },
      ],
      ["meta", { target: { kind: "meta" }, revision: 0 }],
    ]);

    const rebased = rebasePendingAfterAck(pending, {
      idMap: new Map([["old-0", "new-0"]]),
      dropSlideTargets: false,
      revision: 4,
    });
    expect([...rebased.keys()].sort()).toEqual(["meta", "slide:new-0"]);
    expect(rebased.get("slide:new-0")?.target).toEqual({
      kind: "slide",
      slideId: "new-0",
    });
    expect(rebased.get("slide:new-0")?.revision).toBe(4);
    expect(rebased.get("meta")?.revision).toBe(4);

    // A diverged ack drops the per-slide writes (superseded by the newer
    // full-array save); metadata and structural targets always survive.
    const divergedPending = new Map<string, Entry>([
      ...pending,
      ["structure", { target: { kind: "structure" }, revision: 0 }],
    ]);
    const diverged = rebasePendingAfterAck(divergedPending, {
      idMap: new Map(),
      dropSlideTargets: true,
      revision: 5,
    });
    expect([...diverged.keys()].sort()).toEqual(["meta", "structure"]);
    expect(diverged.get("meta")?.revision).toBe(5);
    expect(diverged.get("structure")?.revision).toBe(5);
  });
});

/**
 * The C4 review fix's theme-picker contract, exercised purely: the stored
 * deck theme, the template's own theme and every engine custom theme are
 * offered, and a custom entry travels back as the exact object reference
 * (verbatim, never rebuilt).
 */
test.describe("theme choices (pure)", () => {
  test("offers stored, template and verbatim custom themes", async () => {
    const { buildThemeChoices, themeChoiceValue, themeForChoice } =
      await import(
        "../../app/(app)/tools/presentation/[id]/edit/_components/themeChoices"
      );
    const stored = {
      colors: { primary: "#111111" },
      fonts: { textFont: { name: "Stored", url: "https://example.test/s.woff2" } },
    } as unknown as DeckTheme;
    const template = {
      colors: { primary: "#222222" },
      fonts: { textFont: { name: "Templ", url: "https://example.test/t.woff2" } },
    } as unknown as DeckTheme;
    const customTheme = {
      id: "theme-1",
      name: "Brand",
      description: "d",
      user: "local",
      data: {
        colors: { primary: "#333333" },
        fonts: { textFont: { name: "Brand", url: "https://example.test/b.woff2" } },
      },
    };
    const custom = { id: "theme-1", name: "Brand", theme: customTheme };
    const unnamed = { id: "theme-2", name: null, theme: { id: "theme-2" } };
    const input = {
      storedTheme: stored,
      templateTheme: template,
      templateName: "Verdant",
      customThemes: [custom, unnamed],
    };

    const choices = buildThemeChoices(input);
    expect(choices.map((choice) => choice.value)).toEqual([
      "deck",
      "template",
      "custom:theme-1",
      "custom:theme-2",
    ]);
    expect(choices.map((choice) => choice.label)).toEqual([
      "Deck theme (stored)",
      "Template theme (Verdant)",
      "Brand",
      "Custom theme 2",
    ]);

    // Verbatim: the exact engine entry is the theme value for a custom choice.
    expect(themeForChoice("custom:theme-1", input)).toBe(customTheme);
    expect(themeForChoice("template", input)).toBe(template);
    expect(themeForChoice("deck", input)).toBe(stored);

    // Which choice the applied object corresponds to, by identity.
    expect(themeChoiceValue(customTheme, input)).toBe("custom:theme-1");
    expect(themeChoiceValue(template, input)).toBe("template");
    expect(themeChoiceValue(stored, input)).toBe("deck");

    // An identical stored/template theme collapses the template option.
    const collapsed = buildThemeChoices({
      ...input,
      templateTheme: stored,
      customThemes: [],
    });
    expect(collapsed.map((choice) => choice.value)).toEqual(["deck"]);
  });
});

/**
 * The C4 review fix's custom-theme read, against an in-process stub: entries
 * are returned verbatim (the whole response entry is the theme value), an
 * entry without an id is dropped, and an unconfigured service refuses before
 * any call — the adapter's existing guard vocabulary.
 */
test.describe("custom theme read (in-process stub)", () => {
  test("returns entries verbatim and refuses an unconfigured service", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const savedUrl = process.env.PRESENTON_URL;
    const savedKey = process.env.PRESENTON_API_KEY;

    const entry = {
      id: "theme-1",
      name: "Brand",
      description: "A custom theme",
      user: "local",
      logo: null,
      logo_url: null,
      company_name: null,
      data: { colors: { primary: "#333333" }, fonts: {} },
    };
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/api/v1/ppt/themes/all") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify([entry, { name: "no id here" }]));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });

    try {
      process.env.PRESENTON_URL = "";
      process.env.PRESENTON_API_KEY = "";
      await expect(adapter.listPresentationThemes()).rejects.toMatchObject({
        code: "not-configured",
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      expect(port).toBeGreaterThan(0);
      process.env.PRESENTON_URL = `http://127.0.0.1:${port}`;
      process.env.PRESENTON_API_KEY = "";

      const themes = await adapter.listPresentationThemes();
      expect(themes).toHaveLength(1);
      expect(themes[0].id).toBe("theme-1");
      expect(themes[0].name).toBe("Brand");
      // Verbatim: the whole response entry is the theme value.
      expect(themes[0].theme).toEqual(entry);
    } finally {
      if (savedUrl === undefined) {
        delete process.env.PRESENTON_URL;
      } else {
        process.env.PRESENTON_URL = savedUrl;
      }
      if (savedKey === undefined) {
        delete process.env.PRESENTON_API_KEY;
      } else {
        process.env.PRESENTON_API_KEY = savedKey;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

/**
 * The C4 adapter addition, exercised purely: a structural replace may carry
 * `n_slides` (the engine's route stores it but never recomputes it after a
 * slide re-insert), and the count must match the array.
 */
test.describe("structural replace body (pure)", () => {
  test("carries n_slides when given and refuses a mismatch", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const deckId = randomUUID();
    const theme: DeckTheme = {
      colors: {
        primary: "#111111",
        background: "#ffffff",
        card: "#ffffff",
        stroke: "#000000",
        background_text: "#111111",
        primary_text: "#ffffff",
        graph_0: "#111111",
        graph_1: "#222222",
        graph_2: "#333333",
        graph_3: "#444444",
        graph_4: "#555555",
        graph_5: "#666666",
        graph_6: "#777777",
        graph_7: "#888888",
        graph_8: "#999999",
        graph_9: "#aaaaaa",
      },
      fonts: { textFont: { name: "Inter", url: "https://example.test/inter.woff2" } },
    };
    const slide = (index: number): DeckSlide => ({
      id: randomUUID(),
      presentation: deckId,
      layout_group: "general",
      layout: "title_intro",
      index,
      content: {},
      properties: null,
      ui: null,
      speaker_note: null,
    });

    const body = adapter.buildSlidesReplaceBody({
      id: deckId,
      theme,
      slides: [slide(0), slide(1)],
      nSlides: 2,
    });
    expect(body.n_slides).toBe(2);
    expect(body.theme).toBe(theme);

    const without = adapter.buildSlidesReplaceBody({
      id: deckId,
      theme,
      slides: [slide(0)],
    });
    expect("n_slides" in without).toBe(false);

    expect(() =>
      adapter.buildSlidesReplaceBody({
        id: deckId,
        theme,
        slides: [slide(0)],
        nSlides: 2,
      }),
    ).toThrow(/Invalid slide count/);
  });
});

/**
 * The structural gate's pure half. Since the flag ships on
 * (`PRESENTON_STRUCTURAL_EDITS=1`), the editor's structural controls render
 * enabled (asserted in the live case above) and the live reorder → reload
 * persists proof is Task D1's scope. No fake reorder test is written.
 *
 * This case pins the off branch by clearing the flag in-process — the state
 * the gate exists for: `isStructuralEditingEnabled` (the same function the
 * edit page calls server-side) is off unless `PRESENTON_STRUCTURAL_EDITS=1`,
 * and with it off the adapter refuses the full-array structural write before
 * any fetch — while the metadata write still goes out, so the refusal is the
 * gate and not a blanket write refusal. The action-level refusal
 * (`saveDeckAction`) is not callable outside a request, so this is its
 * closest real proof.
 */
test.describe("structural editing gate (pure)", () => {
  test("refuses the structural save while the flag is off, and only that save", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const savedUrl = process.env.PRESENTON_URL;
    const savedFlag = process.env.PRESENTON_STRUCTURAL_EDITS;
    // A dead loopback port: a write that actually goes out classifies as
    // `unreachable`; the structural gate must answer `rejected` before it.
    process.env.PRESENTON_URL = "http://127.0.0.1:9";
    delete process.env.PRESENTON_STRUCTURAL_EDITS;

    try {
      expect(adapter.isStructuralEditingEnabled()).toBe(false);

      const deckId = randomUUID();
      const theme: DeckTheme = {
        colors: {
          primary: "#3b82f6",
          background: "#ffffff",
          card: "#f3f4f6",
          stroke: "#d1d5db",
          background_text: "#111827",
          primary_text: "#ffffff",
          graph_0: "#ef4444",
          graph_1: "#f97316",
          graph_2: "#eab308",
          graph_3: "#22c55e",
          graph_4: "#14b8a6",
          graph_5: "#06b6d4",
          graph_6: "#3b82f6",
          graph_7: "#6366f1",
          graph_8: "#8b5cf6",
          graph_9: "#ec4899",
        },
        fonts: {
          textFont: { name: "Inter", url: "https://example.test/inter.woff2" },
        },
      };
      const slide: DeckSlide = {
        id: randomUUID(),
        presentation: deckId,
        layout_group: "general",
        layout: "title_intro",
        index: 0,
        content: {},
      };

      await expect(
        adapter.updatePresentation({ id: deckId, theme, slides: [slide] }),
      ).rejects.toMatchObject({ code: "rejected" });

      // The same adapter still attempts the metadata write: the refusal above
      // is the structural gate, not every write being refused.
      await expect(
        adapter.updatePresentation({ id: deckId, theme }),
      ).rejects.toMatchObject({ code: "unreachable" });
    } finally {
      if (savedUrl === undefined) delete process.env.PRESENTON_URL;
      else process.env.PRESENTON_URL = savedUrl;
      if (savedFlag === undefined) delete process.env.PRESENTON_STRUCTURAL_EDITS;
      else process.env.PRESENTON_STRUCTURAL_EDITS = savedFlag;
    }
  });
});

/**
 * Task D6 — the block palette's live proof. The deck template's layouts are
 * inserted as new slides after the current one and applied over one, every
 * save lands through the editor's structural replace path, and the shared
 * engine deck is restored whole in `finally` (the original slide array with
 * fresh ids + `n_slides`, the same production write the editor uses).
 */
test.describe("editor blocks — template layouts (live deck)", () => {
  async function readTemplateLayouts(
    api: Awaited<ReturnType<typeof engineApi>>,
    templateId: string,
  ): Promise<TemplateLayout[]> {
    const response = await api.get(`/api/v1/ppt/template/${templateId}`, {
      timeout: 30_000,
    });
    expect(
      response.ok(),
      `engine template read: ${response.status()}`,
    ).toBe(true);
    const template = (await response.json()) as PresentationTemplate;
    return template.layouts?.layouts ?? [];
  }

  test("inserts two layouts as new slides after the current one and they persist across reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    test.skip(
      target.originalTheme === null,
      "the discovered deck has no stored theme for a structural save.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlides: DeckSlide[] | null = null;

    try {
      const original = await readEngineDeck(api, target.deckId);
      originalSlides = structuredClone(original.slides);
      test.skip(
        originalSlides.length + 2 > SLIDE_LIMIT,
        "the discovered deck is too close to the engine's 50-slide cap.",
      );

      const layouts = await readTemplateLayouts(api, target.templateId);
      const insertable = layouts.filter(
        (layout) =>
          layoutReplaceSupport(layout).replaceable &&
          layout.id !== originalSlides?.[0]?.layout,
      );
      test.skip(
        insertable.length < 2,
        `the engine template serves ${insertable.length} insertable layout(s).`,
      );
      const first = insertable[0];
      const second = insertable[1];

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      // The palette is the grouped Collapsible surface in the inspector.
      const palette = page.locator('[data-layout-palette="inspector"]');
      await expect(palette).toBeVisible();
      await expect(
        page.locator('[data-layout-group-toggle]').first(),
      ).toBeVisible();

      await palette.locator(`[data-layout-add="${first.id}"]`).click();
      await expect
        .poll(
          async () => (await readEngineDeck(api, target.deckId)).slides.length,
          {
            timeout: 30_000,
            message: "the first inserted slide must reach the engine",
          },
        )
        .toBe(originalSlides.length + 1);
      await palette.locator(`[data-layout-add="${second.id}"]`).click();
      await expect
        .poll(
          async () => (await readEngineDeck(api, target.deckId)).slides.length,
          {
            timeout: 30_000,
            message: "the second inserted slide must reach the engine",
          },
        )
        .toBe(originalSlides.length + 2);

      // The engine stored both slides in order (each new slide goes directly
      // after the one selected when it was inserted).
      const stored = await readEngineDeck(api, target.deckId);
      expect(stored.slides.length).toBe(originalSlides.length + 2);
      expect(stored.slides[1]?.layout).toBe(first.id);
      expect(stored.slides[2]?.layout).toBe(second.id);
      expect(stored.slides[1]?.ui?.id).toBe(first.id);
      expect(stored.slides[2]?.ui?.id).toBe(second.id);

      // A reload renders the inserted slides: the rail grows and the layout
      // select reads each stored layout back.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(page.locator("[data-deck-thumb]")).toHaveCount(
        originalSlides.length + 2,
      );
      await page.locator('[data-deck-thumb="1"]').click();
      await expect(page.locator("#editor-slide-layout")).toHaveText(
        first.description.trim(),
      );
      await page.locator('[data-deck-thumb="2"]').click();
      await expect(page.locator("#editor-slide-layout")).toHaveText(
        second.description.trim(),
      );
    } finally {
      if (originalSlides !== null) {
        await restoreEngineDeckSlides(
          api,
          target.deckId,
          originalSlides,
          target.originalTheme,
        );
        const restored = await readEngineDeck(api, target.deckId);
        expect(
          restored.slides.length,
          "the engine deck must be restored to its original slide count",
        ).toBe(originalSlides.length);
      }
      await api.dispose();
    }
  });

  test("uses a layout on the current slide, keeps its content, and it persists across reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    test.skip(
      target.originalTheme === null,
      "the discovered deck has no stored theme for a structural save.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlides: DeckSlide[] | null = null;

    try {
      const original = await readEngineDeck(api, target.deckId);
      originalSlides = structuredClone(original.slides);

      const layouts = await readTemplateLayouts(api, target.templateId);
      const replaceable = layouts.filter(
        (layout) =>
          layoutReplaceSupport(layout).replaceable &&
          layout.id !== originalSlides?.[0]?.layout,
      );
      test.skip(
        replaceable.length === 0,
        "the engine template serves no other replaceable layout.",
      );
      const replacement = replaceable[0];
      const flagged = layouts.find(
        (layout) => !layoutReplaceSupport(layout).replaceable,
      );

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const palette = page.locator('[data-layout-palette="inspector"]');
      await expect(palette).toBeVisible();

      /* The recorded repeated-group gap is labelled, never faked: when the
         template carries such a layout, its apply action is disabled with the
         recorded reason and the add action stays available. */
      if (flagged !== undefined) {
        await expect(
          palette.locator(`[data-layout-apply="${flagged.id}"]`),
        ).toBeDisabled();
        await expect(
          palette.locator(`[data-layout-replace-note="${flagged.id}"]`),
        ).toContainText("top-level group");
        await expect(
          palette.locator(`[data-layout-add="${flagged.id}"]`),
        ).toBeEnabled();
      }

      await palette.locator(`[data-layout-apply="${replacement.id}"]`).click();
      await expect
        .poll(
          async () =>
            (await readEngineDeck(api, target.deckId)).slides[0]?.layout,
          {
            timeout: 30_000,
            message: "the replaced layout must reach the engine",
          },
        )
        .toBe(replacement.id);

      const stored = await readEngineDeck(api, target.deckId);
      expect(stored.slides.length).toBe(originalSlides.length);
      expect(stored.slides[0]?.layout).toBe(replacement.id);
      // The hydrated ui is the template layout's ("content + layout → ui").
      expect(stored.slides[0]?.ui?.id).toBe(replacement.id);
      // The slide's content travels untouched (nothing silently dropped from
      // the wire; the hydration merge is what maps it into the new ui).
      expect(stored.slides[0]?.content).toEqual(originalSlides[0]?.content);

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(page.locator("#editor-slide-layout")).toHaveText(
        replacement.description.trim(),
      );
    } finally {
      if (originalSlides !== null) {
        await restoreEngineDeckSlides(
          api,
          target.deckId,
          originalSlides,
          target.originalTheme,
        );
        const restored = await readEngineDeck(api, target.deckId);
        expect(
          restored.slides.length,
          "the engine deck must be restored to its original slide count",
        ).toBe(originalSlides.length);
      }
      await api.dispose();
    }
  });

  test("opens the rail palette as a dialog: focus moves in, Escape and an outside press close it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    const addButton = page.locator("[data-editor-add-slide]");
    const railPalette = page.locator('[data-layout-palette="rail"]');

    await addButton.click();
    await expect(railPalette).toBeVisible();
    // Focus moves into the dialog (the group toggle is its first control).
    await expect(
      railPalette.locator("[data-layout-group-toggle]").first(),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(railPalette).toHaveCount(0);
    await expect(addButton).toBeFocused();

    await addButton.click();
    await expect(railPalette).toBeVisible();
    await page.getByRole("heading", { name: "Edit deck" }).click();
    await expect(railPalette).toHaveCount(0);
  });
});

/**
 * Task D6 — the palette's pure half: grouping for `Collapsible`, the recorded
 * add-only rule (the engine's schema-derived top-level repeated-group
 * expansion is not ported), and the 50-slide cap's existing honesty copy.
 */
test.describe("layout palette helpers (pure)", () => {
  function groupElement(
    name: string,
    children: SlideComponent["elements"] = [],
  ): SlideComponent["elements"][number] {
    return {
      type: "group",
      name,
      children,
    } as SlideComponent["elements"][number];
  }

  function textElement(
    name: string,
    constraints: Record<string, unknown> = {},
  ): SlideComponent["elements"][number] {
    return {
      type: "text",
      name,
      decorative: false,
      runs: [{ text: "Placeholder" }],
      ...constraints,
    } as SlideComponent["elements"][number];
  }

  function decorativeImageElement(
    name: string,
  ): SlideComponent["elements"][number] {
    return {
      type: "image",
      name,
      decorative: true,
      data: "x.svg",
    } as SlideComponent["elements"][number];
  }

  function layoutFixture(
    id: string,
    description: string,
    elements: SlideComponent["elements"],
  ): TemplateLayout {
    return {
      id,
      description,
      components: [
        {
          id: "component",
          description: "Component",
          position: { x: 0, y: 0 },
          elements,
        },
      ],
    };
  }

  test("groups the template's layouts for Collapsible and drops malformed entries", () => {
    const groups = buildLayoutPalette({
      layouts: [
        layoutFixture("title_intro", "A clean title slide.", [textElement("title")]),
        layoutFixture("", "No id, dropped.", []),
        layoutFixture("no_description", "   ", [textElement("title")]),
      ],
      groupId: "verdant",
      groupLabel: "Verdant template",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("verdant");
    expect(groups[0].label).toBe("Verdant template");
    expect(groups[0].layouts.map((entry) => entry.id)).toEqual([
      "title_intro",
      "no_description",
    ]);
    expect(groups[0].layouts[0].label).toBe("A clean title slide.");
    // A description-less layout is labelled by its id, never a blank row.
    expect(groups[0].layouts[1].label).toBe("no_description");
    expect(
      groups[0].layouts.every(
        (entry) => entry.replaceable && entry.replaceReason === null,
      ),
    ).toBe(true);

    expect(
      buildLayoutPalette({ layouts: null, groupId: "x", groupLabel: "x" }),
    ).toEqual([]);
    expect(
      buildLayoutPalette({ layouts: [], groupId: "x", groupLabel: "x" }),
    ).toEqual([]);
  });

  test("flags the engine-expandable top-level repeated-group shape, not every all-groups shape", () => {
    /* These fixtures mirror the discriminating shapes the detector was
       verified against the engine over all 219 bundled layouts (2026-09-19):
       the engine refuses the replace exactly for the flagged shapes and for
       none of the replaceable ones. */
    const cardFields = () => [
      textElement("card_heading", { min_length: 4, max_length: 12 }),
      textElement("card_body", { min_length: 20, max_length: 100 }),
    ];
    const layoutOf = (...groups: SlideComponent["elements"]) =>
      layoutFixture("repeated", "Repeated groups.", groups);

    // Numeric-suffixed group names with identical fields (editorial timeline).
    expect(
      layoutReplaceSupport(
        layoutOf(
          groupElement("timeline_2", cardFields()),
          groupElement("timeline_5", cardFields()),
        ),
      ),
    ).toEqual({
      replaceable: false,
      reason: TOP_LEVEL_GROUP_REPLACE_REASON,
    });
    // Identical group names with identical fields (momentum-style cards).
    expect(
      layoutReplaceSupport(
        layoutOf(
          groupElement("content_card", cardFields()),
          groupElement("content_card", cardFields()),
        ),
      ).replaceable,
    ).toBe(false);
    // Different names still flag when the editable fields match: the engine's
    // schema comparison does not require the group names to repeat.
    expect(
      layoutReplaceSupport(
        layoutOf(
          groupElement("top_feature_card", cardFields()),
          groupElement("bottom_feature_card", cardFields()),
        ),
      ).replaceable,
    ).toBe(false);

    // Constraint mismatch (the momentum false-positive shape): replaceable.
    expect(
      layoutReplaceSupport(
        layoutOf(
          groupElement("content_card", [
            textElement("card_title", { min_length: 12, max_length: 24 }),
          ]),
          groupElement("content_card", [
            textElement("card_title", { min_length: 9, max_length: 24 }),
          ]),
        ),
      ).replaceable,
    ).toBe(true);
    // A group whose descendants are all decorative yields no editable nodes
    // (the editorial arch shape): replaceable.
    expect(
      layoutReplaceSupport(
        layoutOf(
          groupElement("arc_bands", [decorativeImageElement("arc_band")]),
          groupElement("process_callouts", [
            textElement("callout_caption", { min_length: 11, max_length: 25 }),
          ]),
        ),
      ).replaceable,
    ).toBe(true);
    // A single group is the ported child path, and a mixed element list is not
    // the engine's top-level repeated-group shape at all.
    expect(
      layoutReplaceSupport(
        layoutOf(groupElement("only_one", cardFields())),
      ).replaceable,
    ).toBe(true);
    expect(
      layoutReplaceSupport(
        layoutOf(groupElement("card_1", cardFields()), textElement("heading")),
      ).replaceable,
    ).toBe(true);

    expect(
      addOnlyLayoutCount([
        layoutOf(
          groupElement("timeline_2", cardFields()),
          groupElement("timeline_5", cardFields()),
        ),
        layoutFixture("ok", "Fine.", [textElement("heading")]),
      ]),
    ).toBe(1);
    expect(addOnlyLayoutCount(null)).toBe(0);
  });

  test("caps insertion at the engine's 50 slides with the existing copy", () => {
    expect(SLIDE_LIMIT).toBe(50);
    expect(slideLimitReached(49)).toBe(false);
    expect(slideLimitReached(50)).toBe(true);
    expect(SLIDE_LIMIT_TITLE).toBe("Slide limit reached (50)");
    expect(SLIDE_LIMIT_NOTE).toBe("Slide limit reached (50).");
    expect(paletteAddState(false)).toEqual({
      disabled: false,
      title: "Add as a new slide",
    });
    expect(paletteAddState(true)).toEqual({
      disabled: true,
      title: SLIDE_LIMIT_TITLE,
    });
  });
});

/*
 * Task D9 — infographic insertion (spec §5.4 "Infographics", §6.7, plan D9).
 *
 * The palette offers only the three types the native renderer implements; the
 * other 24 are listed disabled with the honest note and recorded in
 * `INFOGRAPHIC_CAPABILITIES` for D10's capability checklist. The live case
 * inserts a gauge through the inspector palette, asserts the new element is
 * selected, reads the engine's stored component back (one `slide_update`, one
 * new component frame, the fork's insert defaults), reloads to prove the
 * native render, and restores the original slide in a `finally`. The rail
 * menu carries the same dialog behavior as the layout palette (focus in,
 * Escape out).
 */
test.describe("editor infographics — implemented types only (live deck)", () => {
  test("lists the three implemented types and every unsupported type disabled with its note", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    const palette = page.locator('[data-infographic-palette="inspector"]');
    await expect(palette).toBeVisible();

    /* Exactly the three implemented renderers are addable. */
    expect(supportedInfographicCapabilities()).toHaveLength(3);
    for (const capability of supportedInfographicCapabilities()) {
      await expect(
        palette.locator(`[data-infographic-add="${capability.type}"]`),
        `${capability.type} must be addable`,
      ).toBeEnabled();
    }

    /* The unsupported inventory is listed disabled with the exact note. */
    expect(unsupportedInfographicCapabilities()).toHaveLength(24);
    await palette.locator("[data-infographic-unsupported-toggle]").click();
    for (const capability of unsupportedInfographicCapabilities()) {
      const entry = palette.locator(
        `[data-infographic-unsupported="${capability.type}"]`,
      );
      await expect(entry).toBeVisible();
      await expect(
        entry.locator(
          `[data-infographic-unsupported-note="${capability.type}"]`,
        ),
      ).toHaveText(UNSUPPORTED_INFOGRAPHIC_NOTE);
      const add = entry.locator(
        `[data-infographic-unsupported-add="${capability.type}"]`,
      );
      await expect(add).toBeDisabled();
      await expect(add).toHaveAttribute(
        "title",
        new RegExp(UNSUPPORTED_INFOGRAPHIC_NOTE),
      );
    }
  });

  test("inserts a gauge into the current slide, selects it, and it persists across reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlide: DeckSlide | null = null;

    try {
      const current = await readEngineDeck(api, target.deckId);
      const slide = current.slides[0];
      if (slide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(slide);
      const originalComponents = Array.isArray(slide.ui?.components)
        ? slide.ui.components
        : [];
      const componentIndex = originalComponents.length;
      const key = `components:${componentIndex}/0`;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const palette = page.locator('[data-infographic-palette="inspector"]');
      await palette.locator('[data-infographic-add="gauge"]').click();

      /* The fresh element is the primary selection immediately. */
      await expect(
        page.locator(`[data-editor-selection-frame="${key}"]`),
      ).toBeVisible();

      /* The single-slide save reaches the engine, which stores one new
         component frame carrying the fork's insert defaults. */
      await expect
        .poll(
          async () =>
            (await readEngineDeck(api, target.deckId)).slides[0]?.ui
              ?.components?.length ?? 0,
          {
            timeout: 30_000,
            message: "the inserted component must reach the engine",
          },
        )
        .toBe(componentIndex + 1);

      const stored = await readEngineDeck(api, target.deckId);
      const storedSlide = stored.slides[0];
      const components = storedSlide?.ui?.components ?? [];
      expect(components.length).toBe(componentIndex + 1);
      const inserted = components[componentIndex];
      expect(inserted?.id).toContain("Gauge_Chart");
      expect(inserted?.position).toEqual({ x: 128, y: 170 });
      const element = inserted?.elements?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(element?.type).toBe("infographic");
      expect(element?.position).toEqual({ x: 0, y: 0 });
      expect(element?.size).toEqual({ width: 320, height: 190 });
      expect((element?.data as { type?: unknown } | undefined)?.type).toBe(
        "gauge",
      );
      /* Only the current slide changed; its layout, content and existing
         components travel untouched. */
      expect(storedSlide?.layout).toBe(originalSlide.layout);
      expect(storedSlide?.content).toEqual(originalSlide.content);
      expect(components.slice(0, componentIndex)).toEqual(originalComponents);

      /* The stage renders the implemented type natively — no placeholder. */
      const stage = page.locator("[data-editor-stage]");
      await expect(stage.locator('[data-deck-infographic="gauge"]')).toBeVisible();
      await expect(
        stage.locator('[data-deck-placeholder="infographic"]'),
      ).toHaveCount(0);

      /* A reload reads the stored deck back: the element renders again. */
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(
        page.locator(`[data-editor-element-hit="${key}"]`),
      ).toBeVisible();
      await expect(
        page.locator('[data-editor-stage] [data-deck-infographic="gauge"]'),
      ).toBeVisible();
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      const restored = await readEngineDeck(api, target.deckId);
      expect(
        restored.slides[0]?.ui?.components?.length ?? 0,
        "the engine slide must be restored to its original component count",
      ).toBe(
        Array.isArray(originalSlide?.ui?.components)
          ? originalSlide.ui.components.length
          : 0,
      );
      await api.dispose();
    }
  });

  test("opens the rail element menu as a dialog: focus moves in, Escape returns it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );

    await page.goto(`/tools/presentation/${presentationId}/edit`);
    await page.waitForSelector('[data-editor-ready="true"]');

    const addElement = page.locator("[data-editor-add-element]");
    const railPalette = page.locator('[data-infographic-palette="rail"]');
    const firstEntry = supportedInfographicCapabilities()[0];

    await addElement.click();
    await expect(railPalette).toBeVisible();
    await expect(
      railPalette.locator('[data-infographic-group-toggle="supported"]'),
    ).toBeFocused();
    await expect(
      railPalette.locator(`[data-infographic-add="${firstEntry.type}"]`),
    ).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(railPalette).toHaveCount(0);
    await expect(addElement).toBeFocused();
  });
});

/*
 * Task D7 — in-app clipboard, duplicate, delete and the shortcuts sheet
 * (spec §5.4 copy/paste/duplicate, §8.3 motion, §8.5 keyboard equivalents).
 *
 * Every live case appends one deterministic scratch component to the
 * discovered deck's first slide (`slide_update`), drives the real editor with
 * the same keyboard path a user has (select the hit target, focus the stage,
 * press the chord), asserts the engine's stored slide, reloads to prove the
 * render, and restores the original slide in a `finally`. The cross-slide case
 * restores its second slide too. The OS clipboard is best-effort: the case
 * grants the browser permission, asserts the custom MIME/text form when the
 * browser allows it, and otherwise skips with the recorded limitation — the
 * in-app buffer never depends on it.
 */
test.describe("editor clipboard, duplicate and shortcuts (live deck)", () => {
  /** One deterministic text pair for the clipboard cases. */
  function clipboardScratchComponent(): SlideComponent {
    return {
      id: "qa-d7-clipboard-scratch",
      description: "QA D7 clipboard scratch",
      position: { x: 120, y: 360 },
      elements: [
        {
          type: "text",
          name: "qa_d7_alpha",
          position: { x: 0, y: 0 },
          size: { width: 300, height: 60 },
          runs: [{ text: "Alpha" }],
        },
        {
          type: "text",
          name: "qa_d7_beta",
          position: { x: 0, y: 80 },
          size: { width: 300, height: 60 },
          runs: [{ text: "Beta" }],
        },
      ],
    };
  }

  function clipboardElementName(element: Record<string, unknown>): string {
    return typeof element.name === "string" ? element.name : "";
  }

  function clipboardElementPosition(
    element: Record<string, unknown>,
  ): { x: number; y: number } | null {
    const position = element.position;
    if (typeof position !== "object" || position === null) return null;
    const { x, y } = position as { x?: unknown; y?: unknown };
    return typeof x === "number" && typeof y === "number" ? { x, y } : null;
  }

  /**
   * The stored scratch component's elements (looked up by its component id).
   * The **last** match is the one this test seeded: the id is a shared fixture
   * name, so a component left behind by a failed earlier restore must not
   * shadow the fresh append.
   */
  function storedScratchElements(
    deck: PresentationDeck,
    slideIndex: number,
    componentId: string,
  ): Array<Record<string, unknown>> {
    const components = deck.slides[slideIndex]?.ui?.components;
    if (!Array.isArray(components)) return [];
    const matches = components.filter(
      (candidate) => candidate.id === componentId,
    );
    const component = matches[matches.length - 1];
    return Array.isArray(component?.elements)
      ? (component.elements as unknown as Array<Record<string, unknown>>)
      : [];
  }

  /**
   * The first stored scratch element's first run text — the deleted-guard
   * case polls this so its wait asserts the **typed text persisted**, not a
   * pre-existing name list that would pass before any save.
   */
  function scratchFirstText(
    deck: PresentationDeck,
    slideIndex: number,
    componentId: string,
  ): string {
    const elements = storedScratchElements(deck, slideIndex, componentId);
    const runs = (elements[0] as
      | { runs?: Array<{ text?: unknown }> }
      | undefined)?.runs;
    return runs !== undefined && typeof runs[0]?.text === "string"
      ? runs[0].text
      : "";
  }

  /** `components:0/1` → the path object `getElementAtPath` consumes. */
  function clipboardPathFromKey(
    key: string,
  ): { root: "components" | "elements"; indexes: number[] } | null {
    const [root, chain] = key.split(":", 2);
    if (root !== "components" && root !== "elements") return null;
    const indexes = (chain ?? "")
      .split("/")
      .filter((part) => part !== "")
      .map((part) => Number(part));
    if (indexes.some((index) => !Number.isInteger(index) || index < 0)) {
      return null;
    }
    return { root, indexes };
  }

  /**
   * Appends the scratch component to the given slide on the engine (the editor
   * loads it on the next navigation) and answers the seeded slide plus the
   * component's index, which the element keys are built from. The caller
   * passes a slide read from the engine **in the test** — Task D6's structural
   * restores rotate slide ids, so the beforeAll snapshot is stale by the time
   * the D7 cases run.
   */
  async function seedClipboardScratch(
    api: Awaited<ReturnType<typeof engineApi>>,
    base: DeckSlide,
  ): Promise<{ componentIndex: number; seeded: DeckSlide }> {
    const componentIndex = base.ui?.components?.length ?? 0;
    const scratch = clipboardScratchComponent();
    const seeded: DeckSlide = {
      ...base,
      ui: base.ui
        ? {
            ...base.ui,
            components: [...base.ui.components, scratch],
          }
        : base.ui,
    };
    const response = await api.patch("/api/v1/ppt/presentation/slide_update", {
      data: { slide: seeded },
      timeout: 30_000,
    });
    expect(response.ok(), `seed clipboard slide: ${response.status()}`).toBe(
      true,
    );
    return { componentIndex, seeded };
  }

  test("duplicates the selection with Mod+D, offsets in place, and persists across reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const scratch = clipboardScratchComponent();
    let originalSlide: DeckSlide | null = null;
    const scratchNames = async (): Promise<string[]> =>
      storedScratchElements(await readEngineDeck(api, target.deckId), 0, scratch.id).map(
        clipboardElementName,
      );

    try {
      const current = await readEngineDeck(api, target.deckId);
      const currentSlide = current.slides[0];
      if (currentSlide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(currentSlide);
      test.skip(
        originalSlide.ui === null || originalSlide.ui === undefined,
        "the deck's current first slide has no ui to seed a scratch component into.",
      );
      const { componentIndex } = await seedClipboardScratch(
        api,
        originalSlide,
      );
      const alphaKey = `components:${componentIndex}/0`;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      await page.locator(`[data-editor-element-hit="${alphaKey}"]`).click({
        force: true,
      });
      // The commands belong to the stage; the caret owns the keys otherwise.
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+d");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      // The clone is selected (the D1 selection layer names it) and lands
      // directly after the source with one 16 px step.
      await expect(
        page.locator(
          `[data-editor-selection-frame="components:${componentIndex}/1"]`,
        ),
      ).toBeVisible();

      const first = await readEngineDeck(api, target.deckId);
      const firstElements = storedScratchElements(
        first,
        0,
        scratch.id,
      );
      expect(firstElements.map(clipboardElementName)).toEqual([
        "qa_d7_alpha",
        "qa_d7_alpha",
        "qa_d7_beta",
      ]);
      expect(clipboardElementPosition(firstElements[0]!)).toEqual({
        x: 0,
        y: 0,
      });
      expect(clipboardElementPosition(firstElements[1]!)).toEqual({
        x: 16,
        y: 16,
      });

      // The clone is selected, so a repeated Mod+D walks it a step further.
      await page.keyboard.press("Control+d");
      await expect
        .poll(scratchNames, { timeout: 20_000 })
        .toEqual([
          "qa_d7_alpha",
          "qa_d7_alpha",
          "qa_d7_alpha",
          "qa_d7_beta",
        ]);
      const second = await readEngineDeck(api, target.deckId);
      expect(
        clipboardElementPosition(
          storedScratchElements(second, 0, scratch.id)[2]!,
        ),
      ).toEqual({ x: 32, y: 32 });

      // A reload renders every stored element again.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      for (const index of [0, 1, 2, 3]) {
        await expect(
          page.locator(
            `[data-editor-element-hit="components:${componentIndex}/${index}"]`,
          ),
        ).toBeVisible();
      }
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      await api.dispose();
    }
  });

  test("copies with Mod+C and pastes with Mod+V; a repeated paste walks the offset", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    test.skip(
      target.originalSlide.ui === null ||
        target.originalSlide.ui === undefined,
      "the discovered deck's first slide has no ui to seed a scratch component into.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const scratch = clipboardScratchComponent();
    let originalSlide: DeckSlide | null = null;
    const scratchNames = async (): Promise<string[]> =>
      storedScratchElements(await readEngineDeck(api, target.deckId), 0, scratch.id).map(
        clipboardElementName,
      );

    try {
      const current = await readEngineDeck(api, target.deckId);
      const currentSlide = current.slides[0];
      if (currentSlide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(currentSlide);
      test.skip(
        originalSlide.ui === null || originalSlide.ui === undefined,
        "the deck's current first slide has no ui to seed a scratch component into.",
      );
      const { componentIndex } = await seedClipboardScratch(
        api,
        originalSlide,
      );
      const alphaKey = `components:${componentIndex}/0`;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      await page.locator(`[data-editor-element-hit="${alphaKey}"]`).click({
        force: true,
      });
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");

      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );
      // The paste lands in the same component (the source component id is the
      // preferred target) and is the selected set.
      await expect(
        page.locator(
          `[data-editor-selection-frame="components:${componentIndex}/2"]`,
        ),
      ).toBeVisible();
      const first = await readEngineDeck(api, target.deckId);
      const firstElements = storedScratchElements(first, 0, scratch.id);
      expect(firstElements.map(clipboardElementName)).toEqual([
        "qa_d7_alpha",
        "qa_d7_beta",
        "qa_d7_alpha",
      ]);
      expect(clipboardElementPosition(firstElements[2]!)).toEqual({
        x: 16,
        y: 16,
      });

      // The in-app buffer survives the paste; the second paste walks to 32.
      await page.keyboard.press("Control+v");
      await expect
        .poll(scratchNames, { timeout: 20_000 })
        .toEqual([
          "qa_d7_alpha",
          "qa_d7_beta",
          "qa_d7_alpha",
          "qa_d7_alpha",
        ]);
      const second = await readEngineDeck(api, target.deckId);
      expect(
        clipboardElementPosition(
          storedScratchElements(second, 0, scratch.id)[3]!,
        ),
      ).toEqual({ x: 32, y: 32 });

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(
        page.locator(
          `[data-editor-element-hit="components:${componentIndex}/3"]`,
        ),
      ).toBeVisible();
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      await api.dispose();
    }
  });

  test("copies on one slide and pastes onto another through the same-component rule", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    test.skip(
      target.slideCount < 2,
      "the discovered deck has a single slide; the cross-slide case needs two.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlide: DeckSlide | null = null;
    let slide2: DeckSlide | null = null;

    try {
      const before = await readEngineDeck(api, target.deckId);
      const source = before.slides[0];
      const second = before.slides[1];
      if (source === undefined || second === undefined) {
        throw new Error("the engine deck lost its slides mid-test.");
      }
      originalSlide = structuredClone(source);
      slide2 = structuredClone(second);
      test.skip(
        originalSlide.ui === null || originalSlide.ui === undefined,
        "the deck's current first slide has no ui to seed a scratch component into.",
      );

      const { componentIndex, seeded } = await seedClipboardScratch(
        api,
        originalSlide,
      );
      const alphaKey = `components:${componentIndex}/0`;

      /* The same pure rule the editor runs predicts the landing: the source
         component id when the target slide has it, else the anchor (none after
         a slide switch), else the first component, else the root list. */
      const payload = createElementClipboard(seeded, [alphaKey]);
      expect(payload).not.toBeNull();
      const predicted = pasteElementClipboard(slide2, payload!, {
        offset: ELEMENT_PASTE_OFFSET,
        anchorKey: null,
      });
      expect(
        predicted,
        "the pure paste rule must predict the cross-slide landing",
      ).not.toBeNull();
      const predictedKey = predicted!.keys[0] ?? "";
      const predictedPath = clipboardPathFromKey(predictedKey);
      expect(predictedPath).not.toBeNull();
      const predictedElement = getElementAtPath(
        predicted!.slide,
        predictedPath!,
      );
      const predictedPosition =
        predictedElement === null
          ? null
          : clipboardElementPosition(
              predictedElement as unknown as Record<string, unknown>,
            );
      expect(predictedPosition).toEqual({ x: 16, y: 16 });

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${alphaKey}"]`).click({
        force: true,
      });
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+c");

      // Switching slides clears the selection: the recorded fallback target is
      // the rule under test, not the anchor.
      await page.locator('[data-deck-thumb="1"]').click();
      await expect(page.locator("[data-slide-counter]")).toHaveText(
        `2 / ${target.slideCount}`,
      );
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+v");

      await expect
        .poll(
          async () => {
            const deck = await readEngineDeck(api, target.deckId);
            const element = getElementAtPath(deck.slides[1], predictedPath!);
            return element === null
              ? null
              : clipboardElementName(
                  element as unknown as Record<string, unknown>,
                );
          },
          {
            timeout: 20_000,
            message: "the cross-slide paste must reach the engine",
          },
        )
        .toBe("qa_d7_alpha");
      const after = await readEngineDeck(api, target.deckId);
      const pasted = getElementAtPath(after.slides[1], predictedPath!);
      expect(pasted).not.toBeNull();
      expect(
        clipboardElementPosition(pasted as unknown as Record<string, unknown>),
      ).toEqual(predictedPosition);

      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator('[data-deck-thumb="1"]').click();
      await expect(
        page.locator(`[data-editor-element-hit="${predictedKey}"]`),
      ).toBeVisible();
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      if (slide2 !== null) {
        await restoreEngineSlide(api, slide2);
      }
      await api.dispose();
    }
  });

  test("deletes with Delete and Backspace while inline editing keeps its own keys", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    test.skip(
      target.originalSlide.ui === null ||
        target.originalSlide.ui === undefined,
      "the discovered deck's first slide has no ui to seed a scratch component into.",
    );
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const scratch = clipboardScratchComponent();
    let originalSlide: DeckSlide | null = null;
    const scratchNames = async (): Promise<string[]> =>
      storedScratchElements(await readEngineDeck(api, target.deckId), 0, scratch.id).map(
        clipboardElementName,
      );

    try {
      const current = await readEngineDeck(api, target.deckId);
      const currentSlide = current.slides[0];
      if (currentSlide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(currentSlide);
      test.skip(
        originalSlide.ui === null || originalSlide.ui === undefined,
        "the deck's current first slide has no ui to seed a scratch component into.",
      );
      const { componentIndex } = await seedClipboardScratch(
        api,
        originalSlide,
      );
      const alphaKey = `components:${componentIndex}/0`;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      // An input owns its keys: no duplicate fires and focus stays in the
      // field (a duplicate would focus the stage and select the clone).
      await page.locator("[data-editor-title]").focus();
      await page.keyboard.press("Control+d");
      await expect(page.locator("[data-editor-title]")).toBeFocused();
      await expect(
        page.locator(
          `[data-editor-selection-frame="components:${componentIndex}/1"]`,
        ),
      ).toHaveCount(0);

      await page.locator(`[data-editor-element-hit="${alphaKey}"]`).click({
        force: true,
      });
      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();

      // The caret owns the keys: Backspace edits the text, Mod+D is no
      // duplicate, and the element survives both.
      await inline.click();
      await page.keyboard.press("Control+a");
      await inline.pressSequentially("Gamma");
      await page.keyboard.press("Backspace");
      await expect(inline).toHaveText("Gamm");
      await page.keyboard.press("Control+d");
      await expect(inline).toBeVisible();
      await expect(
        page.locator(
          `[data-editor-selection-frame="components:${componentIndex}/1"]`,
        ),
      ).toHaveCount(0);

      // Escape leaves editing with the element still selected; Delete removes
      // it, Backspace removes the next selection. The wait proves the typed
      // text reached the engine before the deletion overwrites the element.
      await page.keyboard.press("Escape");
      await page.locator("[data-editor-stage]").focus();
      await expect
        .poll(
          async () =>
            scratchFirstText(
              await readEngineDeck(api, target.deckId),
              0,
              scratch.id,
            ),
          { timeout: 20_000 },
        )
        .toBe("Gamm");
      await page.keyboard.press("Delete");
      await expect
        .poll(scratchNames, { timeout: 20_000 })
        .toEqual(["qa_d7_beta"]);

      const betaHit = page.locator(
        `[data-editor-element-hit="components:${componentIndex}/0"]`,
      );
      await expect(betaHit).toBeVisible();
      await betaHit.click({ force: true });
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Backspace");
      await expect.poll(scratchNames, { timeout: 20_000 }).toEqual([]);

      // The reload renders the empty component: no hit target remains.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await expect(
        page.locator(
          `[data-editor-element-hit^="components:${componentIndex}/"]`,
        ),
      ).toHaveCount(0);
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      await api.dispose();
    }
  });

  test("copies through the OS clipboard best-effort and pastes it back after a reload", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlide: DeckSlide | null = null;

    try {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      const current = await readEngineDeck(api, target.deckId);
      const currentSlide = current.slides[0];
      if (currentSlide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(currentSlide);
      test.skip(
        originalSlide.ui === null || originalSlide.ui === undefined,
        "the deck's current first slide has no ui to seed a scratch component into.",
      );
      const { componentIndex } = await seedClipboardScratch(
        api,
        originalSlide,
      );
      const alphaKey = `components:${componentIndex}/0`;

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator(`[data-editor-element-hit="${alphaKey}"]`).click({
        force: true,
      });
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+c");

      // The write is fire-and-forget; poll the OS clipboard briefly. A denial
      // is the recorded limitation, never a fake pass.
      let osText = "";
      for (let attempt = 0; attempt < 20 && osText === ""; attempt += 1) {
        osText = await page
          .evaluate(() =>
            navigator.clipboard.readText().catch(() => ""),
          )
          .catch(() => "");
        if (osText === "") await page.waitForTimeout(150);
      }
      test.skip(
        osText === "",
        "the browser denied the OS clipboard; the in-app buffer covers paste (recorded limitation).",
      );
      expect(osText.startsWith(ELEMENT_CLIPBOARD_PREFIX)).toBe(true);
      expect(
        parseElementClipboardText(osText),
        "the custom MIME text form must parse back to the copied payload",
      ).not.toBeNull();
      console.log(
        "[qa-presentations-ui] OS clipboard round-trip verified through the prefixed text form",
      );

      // The reload drops the module-level buffer; Mod+V falls back to the OS
      // clipboard read and pastes through the same pure path.
      await page.reload();
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator("[data-editor-stage]").focus();
      await page.keyboard.press("Control+v");

      await expect
        .poll(
          async () =>
            storedScratchElements(
              await readEngineDeck(api, target.deckId),
              0,
              "qa-d7-clipboard-scratch",
            ).length,
          { timeout: 20_000, message: "the OS-clipboard paste must persist" },
        )
        .toBe(3);
      const after = await readEngineDeck(api, target.deckId);
      const elements = storedScratchElements(
        after,
        0,
        "qa-d7-clipboard-scratch",
      );
      expect(elements.map(clipboardElementName)).toEqual([
        "qa_d7_alpha",
        "qa_d7_beta",
        "qa_d7_alpha",
      ]);
      expect(clipboardElementPosition(elements[2]!)).toEqual({
        x: 16,
        y: 16,
      });
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      await api.dispose();
    }
  });

  test("opens the shortcuts sheet listing exactly the implemented shortcuts and closes on Escape", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    let originalSlide: DeckSlide | null = null;

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      const current = await readEngineDeck(api, target.deckId);
      const currentSlide = current.slides[0];
      if (currentSlide === undefined) {
        throw new Error("the engine deck lost its first slide mid-test.");
      }
      originalSlide = structuredClone(currentSlide);

      const hitPath = clipboardPathFromKey(target.hitKey);
      const hitComponentIndex = hitPath?.indexes[0] ?? null;
      const countHitComponentElements = async (): Promise<number> => {
        const deck = await readEngineDeck(api, target.deckId);
        const components = deck.slides[0]?.ui?.components;
        if (!Array.isArray(components) || hitComponentIndex === null) return -1;
        const component = components[hitComponentIndex];
        return Array.isArray(component?.elements)
          ? component.elements.length
          : -1;
      };
      const elementCountBefore = await countHitComponentElements();
      expect(elementCountBefore).toBeGreaterThan(0);

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      // The guard is only meaningful with a real selection an element command
      // could act on: select the discovered element first.
      await page
        .locator(`[data-editor-element-hit="${target.hitKey}"]`)
        .click({ force: true });
      await expect(
        page.locator(`[data-editor-selection-frame="${target.hitKey}"]`),
      ).toBeVisible();

      const toggle = page.locator("[data-editor-shortcuts-toggle]");
      await expect(toggle).toBeVisible();
      await toggle.click();
      const panel = page.locator("[data-editor-shortcuts]");
      await expect(panel).toBeVisible();
      // The dialog behavior a role="dialog" surface promises: focus moves in.
      await expect(panel).toBeFocused();

      for (const id of [
        "move",
        "move-large",
        "z-backward",
        "z-forward",
        "z-to-back",
        "z-to-front",
        "group",
        "ungroup",
        "copy",
        "paste",
        "duplicate",
        "delete",
        "bold",
        "italic",
        "underline",
        "next-text",
        "escape",
        "undo",
        "redo",
        "redo-alt",
      ]) {
        await expect(
          page.locator(`[data-editor-shortcut="${id}"]`),
          `the sheet must list the implemented shortcut "${id}"`,
        ).toBeVisible();
      }
      await expect(page.locator('[data-editor-shortcut="copy"]')).toContainText(
        "C",
      );
      await expect(
        page.locator('[data-editor-shortcut="paste"]'),
      ).toContainText("V");
      await expect(
        page.locator('[data-editor-shortcut="duplicate"]'),
      ).toContainText("D");
      await expect(
        page.locator('[data-editor-shortcut="delete"]'),
      ).toContainText("Delete");

      /* `toBeVisible` cannot see occlusion: probe the panel's centre with
         `elementFromPoint` and require the hit to resolve inside the sheet.
         The toolbar Card's backdrop-blur context used to paint the rail and
         the assistant bar over an absolute panel; the portalled fixed sheet
         must win the hit test at both widths. */
      const sheetCentreIsHittable = async (): Promise<boolean> =>
        page.evaluate(() => {
          const sheet = document.querySelector("[data-editor-shortcuts]");
          if (sheet === null) return false;
          const rect = sheet.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && sheet.contains(hit);
        });
      await expect
        .poll(sheetCentreIsHittable, {
          timeout: 5_000,
          message: "the sheet must not be occluded at 1280px",
        })
        .toBe(true);

      await page.setViewportSize({ width: 768, height: 1024 });
      await expect
        .poll(sheetCentreIsHittable, {
          timeout: 5_000,
          message: "the sheet must not be occluded (and stay clamped) at 768px",
        })
        .toBe(true);

      // A popover owns focus while it is open: element commands must not fire
      // — the selection stays, nothing saves, the engine is untouched.
      await page.keyboard.press("Control+d");
      await page.keyboard.press("Delete");
      await expect(
        page.locator(`[data-editor-selection-frame="${target.hitKey}"]`),
      ).toBeVisible();
      await expect(page.locator("[data-editor-selection-frame]")).toHaveCount(1);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "idle",
      );
      expect(await countHitComponentElements()).toBe(elementCountBefore);

      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(toggle).toBeFocused();

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      if (originalSlide !== null) {
        await restoreEngineSlide(api, originalSlide);
      }
      await api.dispose();
    }
  });
});

/**
 * Task D8 — the deck assistant's live cases (spec §7.8, §5.4).
 *
 * The panel is driven through the real editor route, the real streaming proxy
 * and the live engine. The provider is provider-dependent: when the engine
 * answers the turn with its sanitized error frame (a quota or provider
 * failure), the case skips with that recorded reason — a fake reply is never
 * asserted. A successful turn proves deltas rendered, the conversation was
 * stored by the engine (read back through its own `/chat/history`) and the
 * console stayed clean. The abort case proves Stop cancels the in-flight
 * request (the browser observes the abort) and leaves an honest stopped state.
 *
 * Every chat-created conversation is deleted from the engine in `finally`, and
 * the fixture deck's full slide array/title/theme are restored — the shared
 * engine deck is never left modified.
 */
test.describe("editor deck assistant (live deck)", () => {
  test("streams a short turn into the panel and the engine stores it", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const snapshot = await readEngineDeck(api, target.deckId);
    const conversationsBefore = await engineConversationIds(api, target.deckId);
    const createdConversationIds: string[] = [];

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      const toggle = page.locator("[data-editor-chat-toggle]");
      await toggle.click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();
      await expect(panel.locator("[data-chat-message]")).toHaveCount(0);
      await expect(panel).toContainText("Ask for a change to this deck");

      await page.screenshot({
        path: "screenshots/phase-d-d8-chat-panel.png",
      });

      /* The narrow layout: the panel clamps inside the viewport. */
      await page.setViewportSize({ width: 375, height: 720 });
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      await page.screenshot({
        path: "screenshots/phase-d-d8-chat-panel-375.png",
      });
      await page.setViewportSize({ width: 1280, height: 720 });

      const prompt =
        "Reply with one short sentence confirming you can see this deck.";
      await panel.locator("[data-chat-input]").fill(prompt);
      await panel.locator("[data-chat-send]").click();

      await expect(panel.locator('[data-chat-message="user"]')).toHaveCount(1);
      const assistant = panel.locator('[data-chat-message="assistant"]');
      await expect(assistant).toHaveCount(1);

      /* The stream started: a status frame is rendered (or the turn already
         settled, which the poll below catches too). */
      await expect
        .poll(
          async () => {
            const status = await panel.locator("[data-chat-status]").count();
            const complete =
              (await panel.locator("[data-chat-complete]").count()) > 0;
            const error = await panel.locator("[data-chat-error]").count();
            return status > 0 || complete || error > 0;
          },
          {
            timeout: 120_000,
            message: "the chat stream must start (a status frame arrives)",
          },
        )
        .toBe(true);

      await expect
        .poll(
          async () => {
            const complete =
              (await panel.locator("[data-chat-complete]").count()) > 0;
            const error = await panel.locator("[data-chat-error]").count();
            return complete || error > 0;
          },
          {
            timeout: 180_000,
            message: "the turn must settle (complete or a sanitized error)",
          },
        )
        .toBe(true);

      const errorCount = await panel.locator("[data-chat-error]").count();
      if (errorCount > 0) {
        /* The stream contract worked (the status frame arrived); the provider
           answered with an error. The sanitized copy is the whole story. */
        const errorText = (
          await panel.locator("[data-chat-error]").first().innerText()
        ).trim();
        expect(errorText).toBe(CHAT_ERROR_COPY);
        test.skip(
          true,
          `the engine's provider answered the turn with an error (${errorText}).`,
        );
      }

      await expect(panel.locator("[data-chat-complete]")).toHaveCount(1);
      const reply = (
        await assistant.locator("p").first().innerText()
      ).trim();
      expect(reply.length).toBeGreaterThan(0);

      const conversationId = await panel.getAttribute("data-chat-conversation");
      expect(conversationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      if (conversationId !== null) createdConversationIds.push(conversationId);

      /* The engine stored both turns in that conversation. */
      const history = await api.get(
        `/api/v1/ppt/chat/history?presentation_id=${target.deckId}&conversation_id=${conversationId}`,
        { timeout: 30_000 },
      );
      expect(history.ok(), `engine chat history: ${history.status()}`).toBe(true);
      const historyBody = (await history.json()) as {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      const storedUser = (historyBody.messages ?? []).some(
        (message) =>
          message.role === "user" &&
          typeof message.content === "string" &&
          message.content.includes(prompt),
      );
      expect(storedUser, "the engine must store the user prompt").toBe(true);

      await page.screenshot({
        path: "screenshots/phase-d-d8-chat-reply.png",
      });

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      for (const conversationId of createdConversationIds) {
        await api.delete(
          `/api/v1/ppt/chat/conversation?presentation_id=${target.deckId}&conversation_id=${conversationId}`,
          { timeout: 15_000 },
        );
      }
      await deleteNewEngineConversations(api, target.deckId, conversationsBefore);
      await restoreEngineDeckSlides(
        api,
        target.deckId,
        snapshot.slides,
        snapshot.theme ?? null,
      );
      await restoreEngineDeck(
        api,
        target.deckId,
        snapshot.title ?? null,
        snapshot.theme ?? null,
      );
      await api.dispose();
    }
  });

  test("Stop aborts a streaming turn and leaves an honest stopped state", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();
    const snapshot = await readEngineDeck(api, target.deckId);
    /* The abort path may still commit an engine-side conversation after Stop
       (the route drains the turn), so cleanup is a before/after id diff. */
    const conversationsBefore = await engineConversationIds(api, target.deckId);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    let chatRequestFailed = false;
    page.on("requestfailed", (failedRequest) => {
      if (failedRequest.url().includes(`/api/presentation/${presentationId}/chat`)) {
        chatRequestFailed = true;
      }
    });

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');

      await page.locator("[data-editor-chat-toggle]").click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();

      await panel
        .locator("[data-chat-input]")
        .fill("Write a detailed paragraph about study techniques.");
      await panel.locator("[data-chat-send]").click();

      const stop = panel.locator("[data-chat-stop]");
      const stopVisible = await stop
        .waitFor({ state: "visible", timeout: 120_000 })
        .then(() => true, () => false);
      if (!stopVisible) {
        const errorVisible =
          (await panel.locator("[data-chat-error]").count()) > 0;
        test.skip(
          true,
          errorVisible
            ? "the provider answered with an error before Stop could be exercised."
            : "the turn settled before Stop could be exercised.",
        );
      }

      try {
        await stop.click();
      } catch {
        test.skip(true, "the turn settled before Stop could be clicked.");
      }

      await expect(assistantMessage(panel)).toContainText("Stopped");
      await expect(panel.locator("[data-chat-stop]")).toHaveCount(0);
      await expect(panel.locator("[data-chat-send]")).toBeVisible();
      expect(await panel.locator("[data-chat-error]").count()).toBe(0);

      /* The browser observed the abort of the in-flight stream: delivery
         stops immediately. The route then drains the engine's turn instead of
         hard-cancelling it (its recorded upstream workaround — a cancelled
         engine chat stream leaves its SQLite transaction open and locks the
         whole engine), so the health probe below is the other half. */
      await expect
        .poll(() => chatRequestFailed, {
          timeout: 10_000,
          message: "the aborted chat request must be reported as failed",
        })
        .toBe(true);

      await expect
        .poll(
          async () => {
            const response = await api.get(
              "/api/v1/ppt/presentation/all?page=1&page_size=1",
              { timeout: 15_000 },
            );
            return response.status();
          },
          {
            timeout: 30_000,
            message:
              "the engine must stay healthy after an aborted turn (no locked database)",
          },
        )
        .toBe(200);

      await page.screenshot({
        path: "screenshots/phase-d-d8-chat-stopped.png",
      });

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await deleteNewEngineConversations(
        api,
        target.deckId,
        conversationsBefore,
      );
      await restoreEngineDeckSlides(
        api,
        target.deckId,
        snapshot.slides,
        snapshot.theme ?? null,
      );
      await restoreEngineDeck(
        api,
        target.deckId,
        snapshot.title ?? null,
        snapshot.theme ?? null,
      );
      await api.dispose();
    }
  });
});

/** The single assistant turn in the live panel. */
function assistantMessage(panel: Locator): Locator {
  return panel.locator('[data-chat-message="assistant"]');
}

/**
 * D8 review fix — a mutating tool round that never reaches `complete`.
 *
 * The engine can commit a slide change and then fail (or the user can Stop
 * while the route's drain lets the engine finish), so the panel must learn
 * "the deck may have changed" from the mutating `trace` frame itself. These
 * cases stub the browser-facing chat stream (no provider involved) and prove
 * the panel re-reads the stored deck, surfaces the honest state, and leaves
 * the editor able to save afterwards — the failure the review caught was a
 * stale slide id silently wedging every later save.
 */
test.describe("editor deck assistant (stubbed stream)", () => {
  test("a mutating trace followed by an error re-reads the deck and saving still works", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await page.route(`**/api/presentation/${presentationId}/chat`, (route) =>
        route.fulfill({
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
          },
          body:
            'data: {"type":"status","status":"Reading deck context"}\n\n' +
            'data: {"type":"trace","trace":{"kind":"tool_call","round":1,"tool":"updateSlide","status":"start","message":"Updating slide 1"}}\n\n' +
            'data: {"type":"error","detail":"Groq 429 rate limit org_xyz key sk-secret"}\n\n',
        }),
      );

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator("[data-editor-chat-toggle]").click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();

      await panel.locator("[data-chat-input]").fill("Edit slide 1");
      await panel.locator("[data-chat-send]").click();

      /* The turn failed honestly and no upstream detail reached the panel. */
      await expect(panel.locator("[data-chat-error]")).toContainText(
        CHAT_ERROR_COPY,
      );
      await expect(panel).not.toContainText("Groq");
      await expect(panel).not.toContainText("sk-secret");

      /* The mutating trace forced a re-read even without a `complete` frame:
         the review only exists after the stored deck was compared. */
      await expect(panel.locator("[data-chat-review]")).toContainText(
        "No slide changes were stored by this turn.",
        { timeout: 20_000 },
      );

      /* The editor can still save after the errored mutating turn. */
      const hit = page.locator(`[data-editor-element-hit="${target.hitKey}"]`);
      await expect(hit).toBeVisible();
      await hit.click({ force: true });
      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();
      const marker = `QA-D8 stub ${Date.now()}`;
      await inline.click();
      await page.keyboard.press("Control+a");
      await inline.pressSequentially(marker);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });

  test("Stop after a mutating trace waits for the drain, re-reads, and saving still works", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    /* A streaming stub: `status` + mutating `trace`, then the connection stays
       open so Stop has something real to abort. No CORS preflight — the
       panel's body is sent as text/plain (the route parses JSON regardless). */
    let stubTimer: ReturnType<typeof setTimeout> | null = null;
    const stub = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        response.end();
        return;
      }
      response.on("error", () => {
        // The client aborted; nothing to report.
      });
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      response.write('data: {"type":"status","status":"Reading deck context"}\n\n');
      response.write(
        'data: {"type":"trace","trace":{"kind":"tool_call","round":1,"tool":"updateSlide","status":"start","message":"Updating slide 1"}}\n\n',
      );
      stubTimer = setTimeout(() => {
        response.end();
      }, 20_000);
    });
    await new Promise<void>((resolve) => {
      stub.listen(0, "127.0.0.1", resolve);
    });
    const address = stub.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    try {
      await page.route(`**/api/presentation/${presentationId}/chat`, (route) =>
        route.continue({ url: `http://127.0.0.1:${port}/stub/chat` }),
      );

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator("[data-editor-chat-toggle]").click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();

      await panel.locator("[data-chat-input]").fill("Edit slide 1");
      await panel.locator("[data-chat-send]").click();

      /* The client saw the mutating trace before it stopped. */
      const assistant = assistantMessage(panel);
      await expect(assistant).toContainText("Updating slide 1", {
        timeout: 20_000,
      });

      await panel.locator("[data-chat-stop]").click();
      await expect(assistant).toContainText("Stopped");

      /* The drain may still commit: the panel says so and watches. */
      await expect(panel.locator("[data-chat-settling]")).toBeVisible();
      await expect(panel.locator("[data-chat-review]")).toContainText(
        "No slide changes were stored by this turn.",
        { timeout: 30_000 },
      );
      await expect(panel.locator("[data-chat-settling]")).toHaveCount(0);

      /* The editor can still save after the aborted mutating turn. */
      const hit = page.locator(`[data-editor-element-hit="${target.hitKey}"]`);
      await expect(hit).toBeVisible();
      await hit.click({ force: true });
      const inline = page.locator("[data-editor-inline-text]");
      await expect(inline).toBeVisible();
      const marker = `QA-D8 stop ${Date.now()}`;
      await inline.click();
      await page.keyboard.press("Control+a");
      await inline.pressSequentially(marker);
      await expect(page.locator("[data-save-status]")).toHaveAttribute(
        "data-save-status",
        "saved",
        { timeout: 20_000 },
      );

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      if (stubTimer !== null) clearTimeout(stubTimer);
      stub.closeAllConnections();
      await new Promise<void>((resolve) => {
        stub.close(() => resolve());
      });
      await restoreEngineSlide(api, target.originalSlide);
      await api.dispose();
    }
  });
  test("a slow history read holds the gate and settles without wedging", async ({
    page,
  }) => {
    const target = requireEditorTarget();
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    /* A synthetic conversation is injected into the real list action's
       response; its history read is then held open to reproduce the
       slow-response race without needing a completed (provider-dependent)
       turn. */
    const stubConversationId = randomUUID();
    let delayedHistoryReads = 0;

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.route(
      `**/tools/presentation/${presentationId}/edit`,
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST") {
          await route.continue();
          return;
        }
        const body =
          request.postData() ??
          request.postDataBuffer()?.toString("utf8") ??
          "";
        const response = await route.fetch();
        if (body.includes(stubConversationId)) {
          delayedHistoryReads += 1;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await route.fulfill({ response });
          return;
        }
        const text = await response.text();
        const injected = text.replace(
          '"conversations":[]',
          `"conversations":[{"conversationId":"${stubConversationId}","updatedAt":null,"lastMessagePreview":"Stub thread"}]`,
        );
        const headers = Object.fromEntries(
          (await response.headersArray())
            .filter((header) => header.name.toLowerCase() !== "content-length")
            .map((header) => [header.name, header.value]),
        );
        await route.fulfill({ response, headers, body: injected });
      },
    );

    try {
      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator("[data-editor-chat-toggle]").click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();

      /* Type first, so the disabled assertions below are meaningful. */
      await panel.locator("[data-chat-input]").fill("stale message");
      await expect(panel.locator("[data-chat-send]")).toBeEnabled();

      const select = panel.getByRole("combobox", { name: "Conversation" });
      await select.click();
      const stubOption = page.getByRole("option", { name: "Stub thread" });
      await expect(stubOption).toBeVisible({ timeout: 10_000 });
      await stubOption.click();

      /* The history read is in flight: the gate disables every send path. */
      await expect(panel).toContainText("Loading conversation…");
      await expect(select).toBeDisabled();
      await expect(panel.locator("[data-chat-input]")).toBeDisabled();
      await expect(panel.locator("[data-chat-input]")).toHaveValue(
        "stale message",
      );
      await expect(panel.locator("[data-chat-send]")).toBeDisabled();
      await expect.poll(() => delayedHistoryReads).toBeGreaterThan(0);

      /* It settles: loading clears and the panel is usable again — the
         regression wedged "Loading conversation…" forever. */
      await expect(panel.locator("[data-chat-input]")).toBeEnabled({
        timeout: 15_000,
      });
      await expect(select).toBeEnabled();
      await expect(panel).not.toContainText("Loading conversation…");
      await expect(panel.locator("[data-chat-send]")).toBeEnabled();

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await page.unroute(`**/tools/presentation/${presentationId}/edit`);
    }
  });
});

/**
 * D8 review fix — the conversation switch's stale-response guard, live.
 *
 * The select is disabled while a history read is in flight and a response is
 * applied only when its request token is still the latest and the selection
 * has not moved (`chatHistoryResponseApplies`, unit-tested in the renderer
 * spec). The engine stores conversations only after a completed turn, which
 * the provider currently blocks, so the case records an honest skip until two
 * exist.
 */
test.describe("deck assistant conversations (live deck)", () => {
  test("switching conversations shows the selected thread and drops the previous one", async ({
    page,
  }) => {
    if (chatRaceTarget === null) {
      test.skip(
        true,
        chatRaceSkipReason ?? "No two stored conversations were discovered.",
      );
    }
    const target = requireEditorTarget();
    const race = chatRaceTarget as ChatRaceTarget;
    const presentationId = await seedOwnedPresentation(
      qa1Id,
      target.deckId,
      target.templateId,
    );
    const api = await engineApi();

    try {
      const firstUserMessage = async (conversationId: string) => {
        const response = await api.get(
          `/api/v1/ppt/chat/history?presentation_id=${race.deckId}&conversation_id=${conversationId}`,
          { timeout: 30_000 },
        );
        expect(response.ok(), `engine history: ${response.status()}`).toBe(true);
        const body = (await response.json()) as {
          messages?: Array<{ role?: unknown; content?: unknown }>;
        };
        const message = (body.messages ?? []).find(
          (entry) =>
            entry.role === "user" &&
            typeof entry.content === "string" &&
            entry.content !== "",
        );
        return typeof message?.content === "string" ? message.content : "";
      };

      const textA = await firstUserMessage(race.conversationIds[0]);
      const textB = await firstUserMessage(race.conversationIds[1]);
      test.skip(
        textA === "" || textB === "",
        "the discovered conversations carry no user message to assert.",
      );

      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      await page.goto(`/tools/presentation/${presentationId}/edit`);
      await page.waitForSelector('[data-editor-ready="true"]');
      await page.locator("[data-editor-chat-toggle]").click();
      const panel = page.locator("[data-chat-panel]");
      await expect(panel).toBeVisible();

      const select = panel.getByRole("combobox", { name: "Conversation" });
      await select.click();
      await page.getByRole("option").nth(1).click();
      await expect(panel.locator('[data-chat-message="user"]').first()).toContainText(
        textA.slice(0, 24),
      );

      await select.click();
      await page.getByRole("option").nth(2).click();
      await expect(panel.locator('[data-chat-message="user"]').first()).toContainText(
        textB.slice(0, 24),
      );
      await expect(panel).not.toContainText(textA.slice(0, 24));

      expect(
        consoleErrors,
        `console errors: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    } finally {
      await api.dispose();
    }
  });
});

