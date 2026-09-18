"use server";

/**
 * The presentation generator's Server Actions (Task 31.x), following the repo
 * pattern (`documentActions.ts`, `taskActions.ts`): the gate runs first and
 * outside the try block, untrusted payloads are parsed on the server, the
 * service does the work, and only sanitized copy travels back to the client.
 *
 * The gate is `requireOnboardedUser("/tools/presentation")`. Writes go through
 * the service role inside the service layer (the `presentations` table exposes
 * no client write path — TASK.md 31.x decision), and the enqueue rides the
 * 29.1 runner with an ids-only payload.
 *
 * Not-connected posture (GATE 1): when `PRESENTON_URL` is unset, this action
 * writes nothing and answers the honest "not connected" copy — no row, no job,
 * no fake deck. With a configured service, the flow is: row (`queued`) →
 * `presentation.generate` job → worker drives Presenton → `/documents` gains
 * the exported deck.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  deletePresentationImage,
  generatePresentationImage,
  getPresentationDeck,
  isPresentonPlaceholderImage,
  isStructuralEditingEnabled,
  listPresentationImages,
  PRESENTON_MAX_SLIDES,
  PresentonError,
  searchPresentationIcons,
  searchPresentationImages,
  updatePresentation,
  updateSlide,
  type PresentonIcon,
  type PresentonImage,
  type PresentonImageKind,
} from "@/lib/integrations/presenton";
import {
  classifyImageSource,
  filterScopedImages,
  isExternalImageSource,
  isImageInScope,
} from "@/lib/presentation/imageScope";
import { normalizeIconWeight } from "@/lib/presentation/icons";
import {
  grantImageInsertPermit,
  imageScopeFor,
} from "./presentationImageScope";
import type {
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
} from "@/lib/presentation/types";
import { enqueueJob } from "./jobs";
import { getDocument } from "./documents";
import {
  PRESENTATION_INVALID_INPUT_ERROR,
  PRESENTATION_NOT_CONNECTED_ERROR,
  PRESENTATION_QUEUE_ERROR,
  PRESENTATION_SAVE_ERROR,
  PRESENTATION_SOURCE_NOT_FOUND_ERROR,
  PRESENTATION_SOURCE_UNSUPPORTED_ERROR,
} from "./presentationErrors";
import {
  isPresentationUuid,
  parsePresentationRequest,
  type PresentationDraft,
} from "./presentationValues";
import {
  getPresentation,
  hasPendingPresentationExport,
  insertPresentation,
  markPresentationFailed,
} from "./presentations";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type CreatePresentationResult = {
  error: string | null;
  /** The created request's id on success; null on every failure. */
  presentationId: string | null;
};

/**
 * Validates and queues one generation request. The topic+options shape is
 * documented in `docs/integrations/presenton.md` §3.1; this action's job is to
 * write the row and hand the runner an id, nothing more.
 */
export async function createPresentationAction(
  payload: unknown,
): Promise<CreatePresentationResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isPresentonConfigured()) {
    return { error: PRESENTATION_NOT_CONNECTED_ERROR, presentationId: null };
  }

  const draft: PresentationDraft | null = parsePresentationRequest(payload);
  if (draft === null) {
    return { error: PRESENTATION_INVALID_INPUT_ERROR, presentationId: null };
  }

  // Every source document must be the caller's own and readable by the
  // service. The worker re-checks ownership before it hands any bytes to
  // Presenton.
  for (const sourceDocumentId of draft.sourceDocumentIds) {
    let source: Awaited<ReturnType<typeof getDocument>>;
    try {
      source = await getDocument(user.id, sourceDocumentId);
    } catch {
      return { error: PRESENTATION_SAVE_ERROR, presentationId: null };
    }
    if (source === null) {
      return { error: PRESENTATION_SOURCE_NOT_FOUND_ERROR, presentationId: null };
    }
    if (source.mimeType !== "application/pdf" && source.mimeType !== DOCX_MIME) {
      return {
        error: PRESENTATION_SOURCE_UNSUPPORTED_ERROR,
        presentationId: null,
      };
    }
  }

  let created: { id: string };
  try {
    created = await insertPresentation(user.id, draft);
  } catch {
    return { error: PRESENTATION_SAVE_ERROR, presentationId: null };
  }

  try {
    await enqueueJob(
      "presentation.generate",
      { presentationId: created.id },
      { userId: user.id },
    );
  } catch {
    // A request with no job would sit at `queued` forever; settle it honestly.
    await markPresentationFailed(user.id, created.id, PRESENTATION_QUEUE_ERROR);
    return { error: PRESENTATION_QUEUE_ERROR, presentationId: null };
  }

  revalidatePath("/tools/presentation");
  return { error: null, presentationId: created.id };
}

// ---------------------------------------------------------------------------
// Task C4 — the native editor's Server Actions
//
// The editor is a client component; it never talks to Presenton and never
// holds a key. Every mutation travels through these actions: gate first
// (`requireOnboardedUser`), then the untrusted payload is parsed on the
// server, the engine deck id comes from the caller's own `presentations` row
// (never from the request), and only sanitized copy travels back. Deck
// content (slides, theme, title) is the deck's own data — the client sends
// back what it loaded — but its shape is still checked before any write so a
// malformed payload fails here instead of half-writing the engine.
// ---------------------------------------------------------------------------

/**
 * The editor actions' single result shape: `error === null` means the write
 * reached the engine; anything else is the sanitized line the editor renders.
 */
export type EditorActionResult = { error: string | null };

const EDITOR_INVALID_INPUT_ERROR =
  "That change couldn't be saved — reload the deck and try again.";
const EDITOR_DECK_NOT_FOUND_ERROR =
  "This deck couldn't be found. Reload the page and try again.";
const EDITOR_NOT_READY_ERROR =
  "This deck has no stored deck on the presentation service, so there's nothing to edit.";
const EDITOR_DECK_UNREACHABLE_ERROR =
  "The presentation service didn't answer for this deck. Try again in a moment.";
const EDITOR_SAVE_ERROR =
  "We couldn't save that change. Try again in a moment.";
const EDITOR_THEME_REQUIRED_ERROR =
  "This deck has no stored theme to send, so the change wasn't made.";
const EDITOR_STRUCTURAL_DISABLED_ERROR =
  "Structural editing isn't available on this service — it needs an engine with matching owner scope, and this one doesn't have it.";
const EDITOR_EXPORT_IN_FLIGHT_ERROR =
  "An export is already running for this deck.";
const EDITOR_EXPORT_NOT_READY_ERROR =
  "This deck can't be exported yet — it has no stored file to replace.";
const EDITOR_EXPORT_QUEUE_ERROR =
  "We couldn't start the export. Try again in a moment.";
const EDITOR_IMAGE_SEARCH_UNAVAILABLE_ERROR =
  "Image search isn't available on this service — the engine needs a Pexels or Pixabay key.";
const EDITOR_IMAGE_GENERATE_UNAVAILABLE_ERROR =
  "Image generation isn't configured on this service, so nothing was created.";
const EDITOR_IMAGE_LIBRARY_ERROR =
  "The image library couldn't be loaded right now. Try again in a moment.";
const EDITOR_IMAGE_DELETE_SCOPE_ERROR =
  "This image isn't part of your decks, so it wasn't deleted.";
const EDITOR_IMAGE_DELETE_ERROR =
  "That image couldn't be deleted. Try again in a moment.";
const EDITOR_IMAGE_NOT_FOUND_ERROR =
  "That image is no longer in the engine's library.";
const EDITOR_IMAGE_INVALID_INPUT_ERROR = "That image request isn't valid.";
const EDITOR_IMAGE_SOURCE_DENIED_ERROR =
  "That image isn't part of your workspace, so it wasn't inserted.";
const EDITOR_ICON_SEARCH_UNAVAILABLE_ERROR =
  "Icon search isn't available on this service right now.";
const EDITOR_ICON_INVALID_INPUT_ERROR = "That icon request isn't valid.";

/** Title bound; the engine stores it as free text, the UI keeps decks sane. */
const EDITOR_TITLE_MAX_LENGTH = 200;
/** Notes bound: generous for a slide's speaker script, bounded for the wire. */
const EDITOR_NOTES_MAX_LENGTH = 20_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuidString(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * A theme the adapter may forward verbatim: either the resolved `DeckTheme`
 * (colors + fonts) or the stored `DeckThemePackage` (`data` carrying them).
 * Unknown extra keys are deliberately kept — this validates, it never
 * rebuilds, so the stored package's shape survives every save.
 */
function isThemeValue(value: unknown): value is DeckTheme | DeckThemePackage {
  if (!isRecord(value)) return false;
  const resolved =
    typeof (value as { colors?: unknown }).colors === "object" &&
    typeof (value as { fonts?: unknown }).fonts === "object";
  const packaged =
    isRecord(value.data) &&
    typeof (value.data as { colors?: unknown }).colors === "object" &&
    typeof (value.data as { fonts?: unknown }).fonts === "object";
  return resolved || packaged;
}

/**
 * The full slide write the engine's `slide_update` accepts: the same ten-field
 * record the deck read carries. `ui` and `content` are the unvalidated bags
 * the engine stores, so they are checked only for object shape.
 */
function isSlideValue(value: unknown): value is DeckSlide {
  if (!isRecord(value)) return false;
  const slide = value as Partial<DeckSlide>;
  if (
    !isUuidString(slide.id) ||
    !isUuidString(slide.presentation) ||
    typeof slide.layout_group !== "string" ||
    slide.layout_group === "" ||
    typeof slide.layout !== "string" ||
    slide.layout === "" ||
    typeof slide.index !== "number" ||
    !Number.isInteger(slide.index) ||
    slide.index < 0 ||
    !isRecord(slide.content)
  ) {
    return false;
  }
  if (
    slide.properties !== null &&
    slide.properties !== undefined &&
    !isRecord(slide.properties)
  ) {
    return false;
  }
  if (slide.ui !== null && slide.ui !== undefined && !isRecord(slide.ui)) {
    return false;
  }
  if (
    slide.html_content !== null &&
    slide.html_content !== undefined &&
    typeof slide.html_content !== "string"
  ) {
    return false;
  }
  if (
    slide.speaker_note !== null &&
    slide.speaker_note !== undefined &&
    (typeof slide.speaker_note !== "string" ||
      slide.speaker_note.length > EDITOR_NOTES_MAX_LENGTH)
  ) {
    return false;
  }
  return true;
}

/** The owner row + its engine deck id, or the sanitized failure to answer. */
async function requireEngineDeck(
  userId: string,
  presentationId: string,
): Promise<
  | { error: null; engineDeckId: string; exportStatus: string | null; documentId: string | null }
  | { error: string }
> {
  let presentation: Awaited<ReturnType<typeof getPresentation>>;
  try {
    presentation = await getPresentation(userId, presentationId);
  } catch {
    return { error: EDITOR_SAVE_ERROR };
  }
  if (presentation === null) return { error: EDITOR_DECK_NOT_FOUND_ERROR };

  const engineDeckId = presentation.presentonPresentationId;
  if (engineDeckId === undefined) return { error: EDITOR_NOT_READY_ERROR };

  return {
    error: null,
    engineDeckId,
    exportStatus: presentation.exportStatus ?? null,
    documentId: presentation.documentId ?? null,
  };
}

/** Maps any adapter throw to the editor's sanitized unreachable copy. */
function editorFailureCopy(): string {
  return EDITOR_DECK_UNREACHABLE_ERROR;
}

/**
 * Renames one owned deck. The theme is read from the engine immediately around
 * the write — the upstream route writes `theme=None` whenever the key is
 * absent, so a rename must carry the deck's current theme object verbatim
 * (never a flattened copy). If the deck read fails there is no theme to send,
 * and the rename is refused honestly instead of risking a wiped theme.
 */
export async function renamePresentationAction(
  payload: unknown,
): Promise<EditorActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  const rawTitle = payload.title;
  if (!isPresentationUuid(presentationId)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  if (typeof rawTitle !== "string") {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  const title = rawTitle.trim();
  if (title === "" || title.length > EDITOR_TITLE_MAX_LENGTH) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };

  let deck: Awaited<ReturnType<typeof getPresentationDeck>>;
  try {
    deck = await getPresentationDeck(owned.engineDeckId);
  } catch {
    return { error: editorFailureCopy() };
  }
  if (deck.theme === null || deck.theme === undefined) {
    return { error: EDITOR_THEME_REQUIRED_ERROR };
  }

  try {
    await updatePresentation({
      id: owned.engineDeckId,
      title,
      theme: deck.theme,
    });
  } catch {
    return { error: EDITOR_SAVE_ERROR };
  }
  return { error: null };
}

/**
 * Applies a deck-level metadata write — the theme picker's save (the title is
 * optional so a coalesced burst can carry both). The theme is forwarded
 * verbatim: the resolved `DeckTheme` when the user picked the template's own
 * theme, the stored `DeckThemePackage` when they kept the deck's.
 */
export async function updatePresentationAction(
  payload: unknown,
): Promise<EditorActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  if (!isPresentationUuid(presentationId)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  if (!isThemeValue(payload.theme)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  let title: string | undefined;
  if (payload.title !== undefined) {
    if (typeof payload.title !== "string") {
      return { error: EDITOR_INVALID_INPUT_ERROR };
    }
    title = payload.title.trim();
    if (title === "" || title.length > EDITOR_TITLE_MAX_LENGTH) {
      return { error: EDITOR_INVALID_INPUT_ERROR };
    }
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };

  try {
    await updatePresentation({
      id: owned.engineDeckId,
      theme: payload.theme,
      ...(title !== undefined ? { title } : {}),
    });
  } catch {
    return { error: EDITOR_SAVE_ERROR };
  }
  return { error: null };
}

/**
 * Saves one slide (text, speaker notes). The engine's `slide_update` ignores
 * `id`/`presentation`/`index` on the stored row, so the client sends the full
 * slide it loaded with the field changed — no id rotation. The slide's
 * `presentation` must be this deck's engine id: a cross-deck write is refused
 * here before the adapter sees it.
 */
export async function updateSlideAction(
  payload: unknown,
): Promise<EditorActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  if (!isPresentationUuid(presentationId)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  if (!isSlideValue(payload.slide)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };
  if (payload.slide.presentation !== owned.engineDeckId) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }

  try {
    await updateSlide(owned.engineDeckId, payload.slide);
  } catch {
    return { error: EDITOR_SAVE_ERROR };
  }
  return { error: null };
}

/**
 * Queues the worker's `presentation.export` job for one owned deck (spec
 * §7.7). The UI never downloads or stores bytes — the worker replaces the same
 * document in place. The action refuses a second concurrent export for the
 * same deck (the mirror or the queued job is the evidence) so double clicks
 * cannot pile up jobs.
 */
export async function requestExportAction(
  payload: unknown,
): Promise<EditorActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  if (!isPresentationUuid(presentationId)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };
  // The mirror alone cannot stop a fast double-click: between the enqueue and
  // the worker's first mirror write it still reads null/old, so the queued job
  // itself is consulted too.
  const pendingExport =
    owned.exportStatus === "queued" || owned.exportStatus === "running"
      ? true
      : await hasPendingPresentationExport(user.id, presentationId.trim());
  if (pendingExport) {
    return { error: EDITOR_EXPORT_IN_FLIGHT_ERROR };
  }
  if (owned.documentId === null) {
    return { error: EDITOR_EXPORT_NOT_READY_ERROR };
  }

  try {
    await enqueueJob(
      "presentation.export",
      { presentationId: presentationId.trim() },
      { userId: user.id },
    );
  } catch {
    return { error: EDITOR_EXPORT_QUEUE_ERROR };
  }

  // The editor reads `hasPendingPresentationExport` on the refreshed page to
  // show the queued job before the worker's first mirror write.
  revalidatePath(`/tools/presentation/${presentationId.trim()}/edit`);
  return { error: null };
}

/**
 * The structural save (spec §7.5): the whole slide array with fresh ids and
 * the stored count. Gated twice — this action refuses before anything else
 * when `PRESENTON_STRUCTURAL_EDITS` is not `1`, and the adapter's structural
 * branch enforces the same gate server-side, so no caller can fake it. The
 * deck's theme is included verbatim (the route re-inserts rows wholesale and
 * writes `theme=None` when the key is absent).
 */
export async function saveDeckAction(
  payload: unknown,
): Promise<EditorActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isStructuralEditingEnabled()) {
    return { error: EDITOR_STRUCTURAL_DISABLED_ERROR };
  }

  if (!isRecord(payload)) return { error: EDITOR_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  if (!isPresentationUuid(presentationId)) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  const deck = payload.deck;
  if (
    !isRecord(deck) ||
    !isThemeValue(deck.theme) ||
    !Array.isArray(deck.slides) ||
    deck.slides.length === 0 ||
    deck.slides.length > PRESENTON_MAX_SLIDES
  ) {
    return { error: EDITOR_INVALID_INPUT_ERROR };
  }
  const slides = deck.slides;
  const seen = new Set<string>();
  for (const slide of slides) {
    if (!isSlideValue(slide)) return { error: EDITOR_INVALID_INPUT_ERROR };
    const key = slide.id.toLowerCase();
    if (seen.has(key)) return { error: EDITOR_INVALID_INPUT_ERROR };
    seen.add(key);
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };
  for (const slide of slides) {
    if (slide.presentation !== owned.engineDeckId) {
      return { error: EDITOR_INVALID_INPUT_ERROR };
    }
  }

  try {
    await updatePresentation({
      id: owned.engineDeckId,
      theme: deck.theme,
      slides,
      nSlides: slides.length,
    });
  } catch {
    return { error: EDITOR_SAVE_ERROR };
  }
  return { error: null };
}

// ---------------------------------------------------------------------------
// Task D3 — the editor's image surface (search/generate/library/delete/insert)
//
// All five actions gate on `requireOnboardedUser` and on the caller owning the
// presentation row; the engine deck id comes from that row, never from the
// request. The browser never holds the Presenton key (the adapter is
// server-only) and uploads travel through the owner-gated
// `POST /api/presentation/{id}/images` route. Provider-dependent failures are
// answered with honest copy, never a fake result.
//
// The engine's image store is account-global, so the library list, delete and
// insert validation are scoped by reference (review fix): an engine image is
// the caller's only when one of the caller's own stored decks references it
// (`collectAssetPaths` union, the asset proxy's own membership rule), or when
// this process just handed it to the caller from its own upload/generate.
// ---------------------------------------------------------------------------

/** Classifies an adapter throw into image-surface copy. */
function imageFailureCopy(error: unknown, fallback: string): string {
  if (error instanceof PresentonError) {
    if (error.code === "not-configured") return PRESENTATION_NOT_CONNECTED_ERROR;
    if (error.code === "rejected") return fallback;
  }
  return EDITOR_DECK_UNREACHABLE_ERROR;
}

export type ImageSearchActionResult = {
  error: string | null;
  /** Absolute provider URLs (Pexels/Pixabay) when the search succeeded. */
  images: string[];
};

/**
 * Stock image search through the engine (spec §5.4). An engine without a
 * configured provider answers 4xx and the tab shows the honest unavailable
 * state — never fabricated results.
 */
export async function searchPresentationImagesAction(
  payload: unknown,
): Promise<ImageSearchActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, images: [] };
  }
  const presentationId = payload.presentationId;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!isPresentationUuid(presentationId) || query === "") {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, images: [] };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error, images: [] };

  try {
    const images = await searchPresentationImages(query);
    return { error: null, images };
  } catch (error) {
    return {
      error: imageFailureCopy(error, EDITOR_IMAGE_SEARCH_UNAVAILABLE_ERROR),
      images: [],
    };
  }
}

export type ImageGenerateActionResult = {
  error: string | null;
  /** The generated URL (provider URL or engine `/app_data/images/…` path). */
  image: string | null;
};

/**
 * Provider-backed image generation (spec §5.4). The engine answers its
 * placeholder when generation is disabled; that is detected here and refused
 * honestly instead of inserting a stock placeholder as if it were generated.
 */
export async function generatePresentationImageAction(
  payload: unknown,
): Promise<ImageGenerateActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, image: null };
  }
  const presentationId = payload.presentationId;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!isPresentationUuid(presentationId) || prompt === "") {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, image: null };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error, image: null };

  try {
    const image = await generatePresentationImage(prompt);
    if (isPresentonPlaceholderImage(image)) {
      return { error: EDITOR_IMAGE_GENERATE_UNAVAILABLE_ERROR, image: null };
    }
    /* An engine path is insertable before the slide save references it: the
       caller's own generation mints a short-lived permit. External provider
       URLs need none (the insert rule allows them outright). */
    if (!isExternalImageSource(image)) {
      grantImageInsertPermit(user.id, image);
    }
    return { error: null, image };
  } catch (error) {
    return {
      error: imageFailureCopy(error, EDITOR_IMAGE_GENERATE_UNAVAILABLE_ERROR),
      image: null,
    };
  }
}

export type ImageListActionResult = {
  error: string | null;
  images: PresentonImage[];
};

/**
 * One engine image-library partition, gated on the caller's own deck and
 * filtered to the caller's own image scope: engine images referenced by the
 * caller's decks (or freshly created by the caller's own upload/generate) are
 * returned; every other account's engine images are hidden.
 */
export async function listPresentationImagesAction(
  payload: unknown,
): Promise<ImageListActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, images: [] };
  }
  const presentationId = payload.presentationId;
  const kind = payload.kind;
  if (
    !isPresentationUuid(presentationId) ||
    (kind !== "generated" && kind !== "uploaded")
  ) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR, images: [] };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error, images: [] };

  try {
    const [all, scope] = await Promise.all([
      listPresentationImages(kind as PresentonImageKind),
      imageScopeFor(user.id),
    ]);
    return { error: null, images: filterScopedImages(all, scope) };
  } catch (error) {
    return {
      error: imageFailureCopy(error, EDITOR_IMAGE_LIBRARY_ERROR),
      images: [],
    };
  }
}

export type ImageDeleteActionResult = { error: string | null };

/**
 * Deletes one engine image that belongs to the caller's own image scope — the
 * image is re-found in the engine library and its path must be referenced by
 * the caller's decks (or covered by the caller's own fresh upload/generate
 * permit). Anything else is refused, so another account's library image can
 * never be destroyed through this action.
 */
export async function deletePresentationImageAction(
  payload: unknown,
): Promise<ImageDeleteActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  const imageId = typeof payload.imageId === "string" ? payload.imageId : "";
  if (!isPresentationUuid(presentationId) || !isUuidString(imageId)) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };

  try {
    const [generated, uploaded] = await Promise.all([
      listPresentationImages("generated"),
      listPresentationImages("uploaded"),
    ]);
    const image = [...generated, ...uploaded].find(
      (candidate) => candidate.id === imageId,
    );
    if (image === undefined) return { error: EDITOR_IMAGE_NOT_FOUND_ERROR };

    const scope = await imageScopeFor(user.id);
    if (!isImageInScope(image.fileUrl, scope)) {
      return { error: EDITOR_IMAGE_DELETE_SCOPE_ERROR };
    }

    await deletePresentationImage(imageId);
    return { error: null };
  } catch (error) {
    return { error: imageFailureCopy(error, EDITOR_IMAGE_DELETE_ERROR) };
  }
}

export type ImageSourceValidationResult = { error: string | null };

/**
 * The generic insert validation (review fix): a source may enter a slide only
 * when it is
 *
 * 1. an external http(s) URL (a stock-provider result — never proxied), or
 * 2. an engine mount path referenced by the caller's own stored decks
 *    (`collectAssetPaths` union — the asset proxy's membership rule), or
 * 3. an engine mount path covered by a fresh insert permit minted by the
 *    caller's own upload route or generation action.
 *
 * Anything else — another account's engine image included — is denied. The
 * picker calls this before it commits a source; the rule itself lives in the
 * pure `imageScope` module so it is provable without an engine.
 */
export async function validatePresentationImageSourceAction(
  payload: unknown,
): Promise<ImageSourceValidationResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR };
  const presentationId = payload.presentationId;
  const source = typeof payload.source === "string" ? payload.source.trim() : "";
  if (
    !isPresentationUuid(presentationId) ||
    source === "" ||
    source.length > 2_000
  ) {
    return { error: EDITOR_IMAGE_INVALID_INPUT_ERROR };
  }

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error };

  try {
    const scope = await imageScopeFor(user.id);
    return classifyImageSource(source, scope) === "denied"
      ? { error: EDITOR_IMAGE_SOURCE_DENIED_ERROR }
      : { error: null };
  } catch {
    return { error: EDITOR_DECK_UNREACHABLE_ERROR };
  }
}

// ---------------------------------------------------------------------------
// Task D4 — the editor's icon surface (search/insert/recolor)
//
// The icon catalog is the engine's bundled vector store (`GET
// /api/v1/ppt/icons/search`), not a provider-backed feature, so it needs no
// provider key. The action gates on the caller's own deck like every other
// editor read; the adapter normalizes results to `/static/icons/…` paths,
// which the asset proxy serves and the renderer recolors client-side. Picking
// an icon writes `data`/`is_icon` through the same single-slide save path as
// every other element edit (the picker validates the source first, and the
// engine-public `/static/**` rule lets it through without a permit).
// ---------------------------------------------------------------------------

export type IconSearchActionResult = {
  error: string | null;
  /** Normalized engine icon paths, in the engine's relevance order. */
  icons: PresentonIcon[];
};

/**
 * §5.4 — search the engine's icon catalog. The weight is normalized the way
 * the engine normalizes it (unknown → `bold`); an empty catalog answers an
 * empty list and the picker states that honestly — no icon is ever fabricated.
 */
export async function searchPresentationIconsAction(
  payload: unknown,
): Promise<IconSearchActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload)) {
    return { error: EDITOR_ICON_INVALID_INPUT_ERROR, icons: [] };
  }
  const presentationId = payload.presentationId;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!isPresentationUuid(presentationId) || query === "") {
    return { error: EDITOR_ICON_INVALID_INPUT_ERROR, icons: [] };
  }
  const weight =
    payload.weight === undefined ? undefined : normalizeIconWeight(payload.weight);

  const owned = await requireEngineDeck(user.id, presentationId.trim());
  if (owned.error !== null) return { error: owned.error, icons: [] };

  try {
    const icons = await searchPresentationIcons(query, { weight });
    return { error: null, icons };
  } catch (error) {
    return {
      error: imageFailureCopy(error, EDITOR_ICON_SEARCH_UNAVAILABLE_ERROR),
      icons: [],
    };
  }
}
