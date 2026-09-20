"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Maximize2, Minimize2, Search, Upload } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { motionIndex } from "@/components/motion/stagger";
import { buttonClasses } from "@/components/ui/Button";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DOCUMENT_NOT_FOUND_ERROR } from "@/lib/data/documentErrors";
import {
  DOCUMENT_STATUS_LABELS,
  type DocumentItem,
  type DocumentStatus,
} from "@/lib/data/documentValues";
import type { DocumentPreview } from "@/lib/data/documents";
import { DocumentCard } from "./DocumentCard";
import { useDocuments } from "./DocumentsWorkspace";

type StatusFilter = "all" | DocumentStatus;

const FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "uploaded", label: DOCUMENT_STATUS_LABELS.uploaded },
  { id: "indexing", label: DOCUMENT_STATUS_LABELS.indexing },
  { id: "indexed", label: DOCUMENT_STATUS_LABELS.indexed },
  { id: "failed", label: DOCUMENT_STATUS_LABELS.failed },
];

type PreviewState = {
  document: DocumentItem;
  preview: DocumentPreview;
};

/**
 * The documents hub (18.1–18.17): the real list, search and status filters,
 * the upload entry points (button in the header, drop target here), the
 * preview surface and every per-card action.
 *
 * The list is server-loaded (`listDocuments`) and owned by
 * `DocumentsWorkspace`; this component is the presentation and local view
 * state (query, filter) over it, which is exactly the 0.16 shape: server
 * read → client workspace → presentational cards. Search and filters operate
 * on the real dataset only — counts appear when they count something, and an
 * empty result says so honestly.
 *
 * Guest: the same header and drop affordance, the pinned sign-in line, and no
 * list — using it opens the shared prompt via the header's sign-in action.
 */
export function DocumentsHub({
  guest,
  index,
}: {
  guest: boolean;
  index: number;
}) {
  const {
    documents,
    deckByDocumentId,
    phase,
    progress,
    pendingName,
    error,
    notice,
    upload,
    rename,
    remove,
    retry,
    preview,
  } = useDocuments();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dragging, setDragging] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  /* 18.11's expand state: the preview panel fills the viewport until toggled
     back or the dialog closes. Never persisted — closing resets it. */
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const announcementRef = useRef<HTMLParagraphElement>(null);
  const statusesRef = useRef(
    new Map(documents.map((document) => [document.id, document.statusValue])),
  );
  /* 25.10 — a search result navigates to `/documents?preview=<id>`; the hub
     opens that document's 18.11 preview once. */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewId = searchParams.get("preview");
  const requestedPreviewRef = useRef<string | null>(null);
  const previewMissing =
    previewId !== null && !documents.some((document) => document.id === previewId);

  useEffect(() => {
    if (guest || previewId === null) return;
    if (requestedPreviewRef.current === previewId) return;
    const match = documents.find((document) => document.id === previewId);
    if (!match) return;
    requestedPreviewRef.current = previewId;
    void openPreview(match);
    // `openPreview` is stable enough for this one-shot trigger; the ref makes
    // it run exactly once per id even if the list re-renders while loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest, previewId, documents]);

  /* 18.17 — polite announcements for the status changes the poll brings in;
     writing the live region's text is an external-system update, so it stays
     out of React state. The visible state is the same either way. */
  useEffect(() => {
    const messages: string[] = [];
    for (const document of documents) {
      const previous = statusesRef.current.get(document.id);
      if (previous !== undefined && previous !== document.statusValue) {
        if (document.statusValue === "indexed") {
          messages.push(`${document.name} is searchable.`);
        } else if (document.statusValue === "failed") {
          messages.push(`${document.name} couldn't be processed.`);
        }
      }
      statusesRef.current.set(document.id, document.statusValue);
    }
    if (messages.length > 0 && announcementRef.current) {
      announcementRef.current.textContent = messages.join(" ");
    }
  }, [documents]);

  const counts = useMemo(() => {
    const tally: Record<StatusFilter, number> = {
      all: documents.length,
      uploaded: 0,
      indexing: 0,
      indexed: 0,
      failed: 0,
    };
    for (const document of documents) tally[document.statusValue] += 1;
    return tally;
  }, [documents]);

  const trimmedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      documents.filter((document) => {
        if (status !== "all" && document.statusValue !== status) return false;
        if (trimmedQuery === "") return true;
        return document.name.toLowerCase().includes(trimmedQuery);
      }),
    [documents, status, trimmedQuery],
  );

  if (guest) {
    return (
      <div
        data-enter="scale"
        style={motionIndex(index)}
        className="rounded-card border border-dashed border-border bg-glass p-8 text-label-sm text-muted-foreground backdrop-blur-md"
      >
        Sign in to upload and keep your documents in one place.
      </div>
    );
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  async function openPreview(document: DocumentItem) {
    // Await first: the click/URL path only writes state once the signed URL
    // is in hand, and the effect-driven open stays out of render.
    const result = await preview(document.id);
    if (result.error !== null || result.preview === null) {
      setPreviewError(result.error);
      return;
    }
    setPreviewError(null);
    setPreviewExpanded(false);
    setPreviewState({ document, preview: result.preview });
  }

  /* The one close path: clears the preview (and its expand state, so the next
     open starts compact) and drops the `?preview=` deep link. */
  function closePreview() {
    setPreviewExpanded(false);
    setPreviewState(null);
    if (previewId !== null) {
      router.replace(pathname, { scroll: false });
    }
  }

  const filtersActive = status !== "all" || trimmedQuery !== "";

  return (
    <div
      data-enter="scale"
      style={motionIndex(index)}
      className="flex min-w-0 flex-col gap-4"
    >
      {/* 18.7 — real upload progress; the bar's value is the XHR's bytes. */}
      {phase === "uploading" ? (
        <div
          data-upload-phase="uploading"
          className="flex flex-col gap-2 rounded-card border border-border bg-glass p-4 backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-label-sm text-foreground">
              Uploading {pendingName ?? "file"}…
            </p>
            <span className="font-mono text-label-caps text-muted-foreground">
              {progress}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Upload progress for ${pendingName ?? "file"}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1 w-full overflow-hidden rounded-pill bg-muted"
          >
            <div
              className="h-1 rounded-pill bg-foreground transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {error}
        </MotionNotice>
      ) : null}

      {previewError ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {previewError}
        </MotionNotice>
      ) : null}

      {previewMissing ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {DOCUMENT_NOT_FOUND_ERROR}
        </MotionNotice>
      ) : null}

      {notice ? (
        <p role="status" className="text-label-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {/* 18.4/18.5 — the drop target beside the header's upload button. */}
      <div
        data-upload-phase="idle"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-card border border-dashed p-6 text-center transition-colors backdrop-blur-md ${
          dragging ? "border-foreground bg-glass-strong" : "border-border bg-glass"
        }`}
      >
        <Upload aria-hidden="true" className="size-4 text-muted-foreground" />
        <p className="text-label-sm text-muted-foreground">
          Drag a file here, or use the{" "}
          <span className="font-medium text-foreground">Upload document</span>{" "}
          button.
        </p>
        <p className="font-mono text-label-caps uppercase text-muted-foreground">
          PDF, DOCX, PNG or JPEG · up to 25 MiB
        </p>
      </div>

      {/* 18.2/18.3 — search + status filters over the real list. */}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 lg:max-w-xs lg:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            aria-label="Search documents"
            placeholder="Search documents"
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>

        <div
          role="group"
          aria-label="Filter documents by status"
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          {FILTERS.map((filter) => {
            const selected = status === filter.id;
            const count = counts[filter.id];
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setStatus(filter.id)}
                className={`min-w-0 rounded-pill border px-3 py-2 font-heading text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  selected
                    ? "border-transparent bg-card font-semibold text-foreground shadow-subtle"
                    : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }`}
              >
                {filter.label}
                {count > 0 ? (
                  <span className="ml-1.5 font-mono text-label-caps text-muted-foreground">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <section aria-label="Your documents" className="flex min-w-0 flex-col gap-2">
        {documents.length === 0 ? (
          <p className="rounded-card border border-dashed border-border bg-glass p-6 text-label-sm text-muted-foreground backdrop-blur-md">
            No documents yet. Upload a PDF, DOCX, PNG or JPEG to get started.
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border bg-glass p-6 backdrop-blur-md">
            <p className="text-label-sm text-muted-foreground">
              No documents match your search.
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ul className="flex min-w-0 list-none flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {filtered.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  deckId={deckByDocumentId[document.id]}
                  onRename={rename}
                  onDelete={remove}
                  onRetry={retry}
                  onPreview={openPreview}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {filtersActive && filtered.length > 0 ? (
          <p className="text-label-sm text-muted-foreground">
            Showing {filtered.length} of {documents.length} documents.
          </p>
        ) : null}
      </section>

      {/* 18.17 — the screen-reader channel for poll-driven status changes. */}
      <p
        ref={announcementRef}
        role="status"
        aria-live="polite"
        className="sr-only"
      />

      <Modal
        open={previewState !== null}
        onOpenChange={(next) => {
          if (!next) closePreview();
        }}
        onEscape={() => {
          /* Escape collapses the expanded preview first; a second press closes
             the dialog. */
          if (previewExpanded) setPreviewExpanded(false);
          else closePreview();
        }}
        fullscreen={previewExpanded}
        animateLayout
        headerActions={
          previewState?.preview.mode === "inline" ? (
            <IconButton
              aria-label={previewExpanded ? "Exit full screen" : "Expand preview"}
              aria-pressed={previewExpanded}
              onClick={() => setPreviewExpanded((expanded) => !expanded)}
            >
              {previewExpanded ? (
                <Minimize2 aria-hidden="true" className="size-4" />
              ) : (
                <Maximize2 aria-hidden="true" className="size-4" />
              )}
            </IconButton>
          ) : undefined
        }
        title={previewState?.document.name ?? "Preview"}
        description={
          previewState?.preview.mode === "download"
            ? "This file type downloads instead of rendering."
            : "Preview"
        }
        className="max-w-3xl"
      >
        {previewState === null ? null : previewState.preview.mode === "download" ? (
          <div className="flex flex-col gap-4">
            <p className="text-label-sm text-muted-foreground">
              DOCX files aren&apos;t rendered in the browser. Download the file
              to open it in your word processor.
            </p>
            <div className="flex justify-end">
              <a
                href={previewState.preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ variant: "primary", size: "md" })}
              >
                Download {previewState.document.name}
              </a>
            </div>
          </div>
        ) : previewState.document.mimeType === "application/pdf" ? (
          /* The iframe is one element in both states — only its className
             changes — so expanding never re-fetches the short-lived signed
             URL. */
          <iframe
            title={`Preview of ${previewState.document.name}`}
            src={previewState.preview.url}
            className={
              previewExpanded
                ? "h-full w-full flex-1 bg-card"
                : "h-[70vh] w-full rounded-base border border-border bg-card"
            }
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- a
             short-lived signed URL into a private bucket: there is nothing
             for the optimizer to cache or resize without re-fetching it. */
          <img
            src={previewState.preview.url}
            alt={`Preview of ${previewState.document.name}`}
            className={
              previewExpanded
                ? "my-auto max-h-full max-w-full object-contain"
                : "mx-auto max-h-[70vh] w-auto rounded-base border border-border"
            }
          />
        )}
      </Modal>
    </div>
  );
}
