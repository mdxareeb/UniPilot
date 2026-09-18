"use client";

/**
 * The image picker (Task D3, spec §5.4 images row, §8.2 element palette).
 *
 * One modal for every way an image enters a slide element, with four tabs:
 *
 * - Search — a query through the engine's stock provider (Pexels/Pixabay). An
 *   engine without a provider key answers an error and the tab states that
 *   honestly (`data-image-unavailable`), never fabricated results.
 * - Generate — a prompt through the engine's configured provider. The engine
 *   answers a placeholder when generation is disabled; the Server Action
 *   refuses it, so no fake image is ever inserted. An engine-path result shows
 *   the metadata tile until the deck references it (mirroring Library) rather
 *   than a proxy preview that would 404 before the save.
 * - Library — the engine's `generated`/`uploaded` partitions **filtered to the
 *   caller's own image scope** (review fix: the engine store is account-global,
 *   so the server returns only images the caller's own decks reference or the
 *   caller's own upload/generate just created). Previews stream through the
 *   owner-gated asset proxy only for paths this deck references; anything else
 *   is listed by name without faking a preview. Deleting is confirmed in a
 *   second dialog and warns when the current deck still uses the image.
 * - Upload — one file through the owner-gated `POST /api/presentation/{id}/
 *   images` route (the API key never reaches the browser).
 *
 * Clicking any result runs the generic insert validation first: only external
 * http(s) URLs, paths in the caller's referenced union, or fresh
 * upload/generate permits are committed. `onSelect(data)` then replaces the
 * element's `data` only, through the same single-slide autosave + undo path as
 * every other edit. Motion is the shared system: the panel/scrim come from
 * `Modal`, the tile grids use the reveal-group vocabulary, errors use
 * `MotionNotice`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageOff,
  Library,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  deletePresentationImageAction,
  generatePresentationImageAction,
  listPresentationImagesAction,
  searchPresentationImagesAction,
  validatePresentationImageSourceAction,
} from "@/lib/data/presentationActions";
import type { PresentonImage } from "@/lib/integrations/presenton";
import { deckAssetUrl } from "@/lib/presentation/elements";
import { isExternalImageSource } from "@/lib/presentation/imageScope";
import { IMAGE_UPLOAD_MAX_BYTES } from "@/lib/presentation/imageLimits";

type PickerTab = "search" | "generate" | "library" | "upload";
type LibraryKind = "generated" | "uploaded";

export type ImagePickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The UniPilot presentation row id (owner gate + asset proxy). */
  presentationId: string;
  /**
   * The engine-relative sources the stored deck already references: only these
   * preview through the asset proxy (spec §6.9's membership rule).
   */
  referencedSources: readonly string[];
  /** Replaces the selected element's `data` with the clicked source. */
  onSelect: (data: string) => void;
};

const TABS: Array<{ id: PickerTab; label: string; Icon: typeof Search }> = [
  { id: "search", label: "Search", Icon: Search },
  { id: "generate", label: "Generate", Icon: Sparkles },
  { id: "library", label: "Library", Icon: Library },
  { id: "upload", label: "Upload", Icon: Upload },
];

const UPLOAD_MAX_MB = Math.round(IMAGE_UPLOAD_MAX_BYTES / (1024 * 1024));
const FALLBACK_UPLOAD_ERROR =
  "The image couldn't be uploaded right now. Try again in a moment.";

/** One clickable thumbnail; badges/buttons live inside the tile. */
function Tile({
  src,
  title,
  onSelect,
  children,
}: {
  src: string | null;
  title: string;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <MotionRevealItem variant="scale" className="relative">
      <button
        type="button"
        data-image-tile=""
        title={title}
        onClick={onSelect}
        className="block aspect-video w-full overflow-hidden rounded-nested border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {src !== null ? (
          /* eslint-disable-next-line @next/next/no-img-element -- engine bytes
             stream through the owner-gated asset proxy (spec §6.9); provider
             URLs pass through untouched. */
          <img
            alt=""
            src={src}
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <ImageOff aria-hidden="true" className="size-4" />
            <span className="px-2 text-center font-mono text-label-sm">
              {title}
            </span>
          </span>
        )}
      </button>
      {children}
    </MotionRevealItem>
  );
}

export function ImagePickerModal({
  open,
  onOpenChange,
  presentationId,
  referencedSources,
  onSelect,
}: ImagePickerModalProps) {
  const [tab, setTab] = useState<PickerTab>("search");
  /** The generic insert validation's refusal, shown beneath the tabs. */
  const [insertError, setInsertError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // Search
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Generate
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Library
  const [libraryKind, setLibraryKind] = useState<LibraryKind>("uploaded");
  const [libraryImages, setLibraryImages] = useState<PresentonImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const libraryRequestRef = useRef(0);
  const [deleteCandidate, setDeleteCandidate] = useState<PresentonImage | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<PresentonImage | null>(
    null,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* Object URLs for the local file preview; revoked when replaced or closed. */
  useEffect(() => {
    return () => {
      if (uploadPreview !== null) URL.revokeObjectURL(uploadPreview);
    };
  }, [uploadPreview]);

  const choose = useCallback(
    async (data: string) => {
      if (validating) return;
      setInsertError(null);
      setValidating(true);
      /* The generic insert validation (review fix): external http(s) URLs,
         paths referenced by the caller's own decks, or fresh upload/generate
         permits only. The server is the authority; the picker never commits a
         source the action refused. */
      const result = await validatePresentationImageSourceAction({
        presentationId,
        source: data,
      });
      setValidating(false);
      if (result.error !== null) {
        setInsertError(result.error);
        return;
      }
      onSelect(data);
      onOpenChange(false);
    },
    [onSelect, onOpenChange, presentationId, validating],
  );

  const loadLibrary = useCallback(
    async (kind: LibraryKind) => {
      const request = libraryRequestRef.current + 1;
      libraryRequestRef.current = request;
      setLibraryLoading(true);
      setLibraryError(null);
      const result = await listPresentationImagesAction({
        presentationId,
        kind,
      });
      if (request !== libraryRequestRef.current) return;
      setLibraryLoading(false);
      if (result.error !== null) {
        setLibraryImages([]);
        setLibraryError(result.error);
        return;
      }
      setLibraryImages(result.images);
    },
    [presentationId],
  );

  useEffect(() => {
    if (!open || tab !== "library") return;
    /* The library read starts after the tab's commit: a timer keeps the
       effect body free of synchronous state updates (the hook lint's
       cascading-render rule) while still loading the moment the tab opens. */
    const timeout = window.setTimeout(
      () => void loadLibrary(libraryKind),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [open, tab, libraryKind, loadLibrary]);

  const runSearch = useCallback(async () => {
    const normalized = query.trim();
    if (normalized === "" || searching) return;
    setSearching(true);
    setSearchError(null);
    const result = await searchPresentationImagesAction({
      presentationId,
      query: normalized,
    });
    setSearching(false);
    if (result.error !== null) {
      setSearchResults([]);
      setSearchError(result.error);
      return;
    }
    setSearchResults(result.images);
  }, [presentationId, query, searching]);

  const runGenerate = useCallback(async () => {
    const normalized = prompt.trim();
    if (normalized === "" || generating) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerated(null);
    const result = await generatePresentationImageAction({
      presentationId,
      prompt: normalized,
    });
    setGenerating(false);
    if (result.error !== null || result.image === null) {
      setGenerateError(result.error ?? "The image wasn't generated.");
      return;
    }
    setGenerated(result.image);
  }, [generating, presentationId, prompt]);

  const onPickFile = useCallback(
    (file: File | null) => {
      setUploadFile(file);
      setUploadedImage(null);
      setUploadError(null);
      setUploadPreview(file !== null ? URL.createObjectURL(file) : null);
    },
    [],
  );

  const runUpload = useCallback(async () => {
    if (uploadFile === null || uploading) return;
    if (uploadFile.size > IMAGE_UPLOAD_MAX_BYTES) {
      setUploadError(`That image is too large — the limit is ${UPLOAD_MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile, uploadFile.name);
      const response = await fetch(
        `/api/presentation/${encodeURIComponent(presentationId)}/images`,
        { method: "POST", body: form },
      );
      const body = (await response.json().catch(() => null)) as
        | { image?: PresentonImage; error?: unknown }
        | null;
      if (!response.ok || body === null || body.image === undefined) {
        setUploadError(
          body !== null && typeof body.error === "string"
            ? body.error
            : FALLBACK_UPLOAD_ERROR,
        );
        return;
      }
      setUploadedImage(body.image);
    } catch {
      setUploadError(FALLBACK_UPLOAD_ERROR);
    } finally {
      setUploading(false);
    }
  }, [presentationId, uploadFile, uploading]);

  const confirmDelete = useCallback(async () => {
    const candidate = deleteCandidate;
    if (candidate === null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deletePresentationImageAction({
      presentationId,
      imageId: candidate.id,
    });
    setDeleting(false);
    if (result.error !== null) {
      setDeleteError(result.error);
      return;
    }
    setLibraryImages((images) =>
      images.filter((image) => image.id !== candidate.id),
    );
    setDeleteCandidate(null);
  }, [deleteCandidate, deleting, presentationId]);

  const referenced = (image: PresentonImage): boolean =>
    referencedSources.includes(image.fileUrl);

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Insert an image"
        description="Pick an image for the selected element. It's saved to the slide like any other edit."
        className="max-w-3xl"
      >
        <Card
          data-image-picker=""
          className="flex flex-col gap-4 bg-glass p-4 backdrop-blur-md"
        >
          <div
            role="tablist"
            aria-label="Image source"
            className="flex flex-wrap items-center gap-1"
          >
            {TABS.map(({ id, label, Icon }) => {
              const selected = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`image-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`image-panel-${id}`}
                  data-image-tab={id}
                  onClick={() => {
                    setTab(id);
                    setInsertError(null);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    selected
                      ? "border-foreground bg-card text-foreground"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {insertError !== null ? (
            <MotionNotice
              role="alert"
              data-image-insert-error=""
              className="text-label-sm text-destructive"
            >
              {insertError}
            </MotionNotice>
          ) : null}

          {tab === "search" ? (
            <div
              role="tabpanel"
              id="image-panel-search"
              aria-labelledby="image-tab-search"
              className="flex flex-col gap-3"
            >
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch();
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label
                    htmlFor="image-search-query"
                    className="text-label-sm font-medium text-foreground"
                  >
                    Search stock photos
                  </label>
                  <Input
                    id="image-search-query"
                    data-image-search-input=""
                    size="sm"
                    type="search"
                    maxLength={200}
                    placeholder="e.g. mountain sunrise"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  data-image-search-submit=""
                  disabled={searching || query.trim() === ""}
                >
                  {searching ? "Searching…" : "Search"}
                </Button>
              </form>
              {searchError !== null ? (
                <MotionNotice
                  role="alert"
                  data-image-unavailable=""
                  className="text-label-sm text-muted-foreground"
                >
                  {searchError}
                </MotionNotice>
              ) : null}
              {searchError === null && searchResults.length > 0 ? (
                <MotionRevealGroup
                  key={searchResults.join("|")}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                >
                  {searchResults.map((url) => (
                    <Tile
                      key={url}
                      src={deckAssetUrl(presentationId, url)}
                      title={url}
                      onSelect={() => void choose(url)}
                    />
                  ))}
                </MotionRevealGroup>
              ) : null}
              {searchError === null &&
              !searching &&
              searchResults.length === 0 ? (
                <p
                  data-image-empty=""
                  className="text-label-sm text-muted-foreground"
                >
                  Search the engine&apos;s stock provider for slide imagery.
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "generate" ? (
            <div
              role="tabpanel"
              id="image-panel-generate"
              aria-labelledby="image-tab-generate"
              className="flex flex-col gap-3"
            >
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runGenerate();
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label
                    htmlFor="image-generate-prompt"
                    className="text-label-sm font-medium text-foreground"
                  >
                    Describe the image
                  </label>
                  <Input
                    id="image-generate-prompt"
                    data-image-prompt-input=""
                    size="sm"
                    maxLength={1000}
                    placeholder="e.g. a lighthouse at dusk, minimal flat illustration"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  data-image-generate-submit=""
                  disabled={generating || prompt.trim() === ""}
                >
                  {generating ? "Generating…" : "Generate"}
                </Button>
              </form>
              {generateError !== null ? (
                <MotionNotice
                  role="alert"
                  data-image-unavailable=""
                  className="text-label-sm text-muted-foreground"
                >
                  {generateError}
                </MotionNotice>
              ) : null}
              {generated !== null ? (
                <div className="w-40">
                  <Tile
                    src={
                      isExternalImageSource(generated) ||
                      referencedSources.includes(generated)
                        ? deckAssetUrl(presentationId, generated)
                        : null
                    }
                    title="Generated image"
                    onSelect={() => void choose(generated)}
                  />
                  <p
                    data-image-generated=""
                    className="mt-1 truncate font-mono text-label-sm text-muted-foreground"
                  >
                    {generated}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "library" ? (
            <div
              role="tabpanel"
              id="image-panel-library"
              aria-labelledby="image-tab-library"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center gap-1">
                {(["uploaded", "generated"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={libraryKind === kind ? "outline" : "ghost"}
                    size="sm"
                    data-image-library-kind={kind}
                    aria-pressed={libraryKind === kind}
                    onClick={() => setLibraryKind(kind)}
                  >
                    {kind === "uploaded" ? "Uploaded" : "Generated"}
                  </Button>
                ))}
                <span className="ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadLibrary(libraryKind)}
                    disabled={libraryLoading}
                  >
                    {libraryLoading ? "Loading…" : "Refresh"}
                  </Button>
                </span>
              </div>
              {libraryError !== null ? (
                <MotionNotice
                  role="alert"
                  data-image-unavailable=""
                  className="text-label-sm text-muted-foreground"
                >
                  {libraryError}
                </MotionNotice>
              ) : null}
              {libraryError === null && libraryImages.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {libraryImages.map((image) => {
                    const inUse = referenced(image);
                    const src = inUse
                      ? deckAssetUrl(presentationId, image.fileUrl)
                      : null;
                    const name = image.prompt ?? image.fileUrl.split("/").pop() ?? image.fileUrl;
                    return (
                      <li key={image.id} className="relative">
                        <Tile
                          src={src}
                          title={name}
                          onSelect={() => void choose(image.fileUrl)}
                        />
                        <span className="absolute right-1 top-1">
                          <IconButton
                            type="button"
                            variant="outline"
                            size="xs"
                            aria-label="Delete image"
                            data-image-delete={image.id}
                            title={
                              inUse
                                ? "Used by this deck — deleting stops the slide rendering it"
                                : "Delete from the image library"
                            }
                            onClick={() =>
                              setDeleteCandidate(image)
                            }
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </IconButton>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {libraryError === null &&
              !libraryLoading &&
              libraryImages.length === 0 ? (
                <p
                  data-image-empty=""
                  className="text-label-sm text-muted-foreground"
                >
                  {libraryKind === "uploaded"
                    ? "No uploaded images yet."
                    : "No generated images yet."}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === "upload" ? (
            <div
              role="tabpanel"
              id="image-panel-upload"
              aria-labelledby="image-tab-upload"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="image-upload-file"
                  className="text-label-sm font-medium text-foreground"
                >
                  Image file
                </label>
                <input
                  ref={fileInputRef}
                  id="image-upload-file"
                  data-image-upload-input=""
                  type="file"
                  accept="image/*"
                  className="text-label-sm text-muted-foreground file:mr-2 file:rounded-base file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-label-sm file:text-foreground"
                  onChange={(event) =>
                    onPickFile(event.target.files?.[0] ?? null)
                  }
                />
                <p className="text-label-sm text-muted-foreground">
                  Up to {UPLOAD_MAX_MB} MB — PNG, JPEG, GIF, WebP, AVIF, BMP or
                  TIFF.
                </p>
              </div>
              {uploadPreview !== null ? (
                <div className="w-40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the
                      local file preview; the uploaded bytes go through the
                      owner-gated route, never the browser to the engine. */}
                  <img
                    data-image-upload-preview=""
                    alt="Selected upload preview"
                    src={uploadPreview}
                    className="aspect-video w-full rounded-nested border border-border object-cover"
                  />
                </div>
              ) : null}
              {uploadError !== null ? (
                <MotionNotice
                  role="alert"
                  className="text-label-sm text-destructive"
                >
                  {uploadError}
                </MotionNotice>
              ) : null}
              {uploadedImage !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    data-image-insert-upload=""
                    disabled={validating}
                    onClick={() => void choose(uploadedImage.fileUrl)}
                  >
                    Insert image
                  </Button>
                  <p className="min-w-0 flex-1 truncate font-mono text-label-sm text-muted-foreground">
                    {uploadedImage.fileUrl}
                  </p>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  data-image-upload-submit=""
                  disabled={uploadFile === null || uploading}
                  onClick={() => void runUpload()}
                >
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              )}
            </div>
          ) : null}
        </Card>
      </Modal>

      <Modal
        open={deleteCandidate !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setDeleteCandidate(null);
            setDeleteError(null);
          }
        }}
        title="Delete this image?"
        description={
          deleteCandidate !== null &&
          referencedSources.includes(deleteCandidate.fileUrl)
            ? "This deck uses it, so the slide will stop rendering it. It will be removed from the engine's image library."
            : "It will be removed from the engine's image library."
        }
      >
        <div className="flex flex-col gap-4">
          {deleteError !== null ? (
            <MotionNotice
              role="alert"
              data-image-delete-error=""
              className="text-label-sm text-destructive"
            >
              {deleteError}
            </MotionNotice>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteCandidate(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-image-delete-confirm=""
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete image"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
