"use client";

import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { Modal } from "@/components/ui/Modal";
import { previewDocumentAction } from "@/lib/data/documentActions";
import { deletePresentationAction } from "@/lib/data/presentationActions";
import {
  PRESENTATION_DELETE_ERROR,
  PRESENTATION_SAVE_ERROR,
} from "@/lib/data/presentationErrors";
import {
  isPresentationInFlight,
  type PresentationItem,
} from "@/lib/data/presentationValues";

type DecksListProps = {
  /** The owner's requests, newest first (read by the page via `listPresentations`). */
  decks: PresentationItem[];
};

/**
 * "My decks" (Task F1, spec §9) — the tool page's history list.
 *
 * One `MotionListItem` per owned request, newest first: the deck's name (the
 * generated document once it exists, the prompt before it), a mono metadata
 * line (status word, template, slide count when the row knows it, created
 * label) and actions that are honest per row state:
 *
 * - a stored document offers Download through the existing
 *   `previewDocumentAction` (the same action the run panel uses) plus the
 *   /documents link;
 * - Open and Edit link into the viewer and editor routes, which own their
 *   honest not-ready/unavailable panels. While a request is still being
 *   generated they are offered only when the row already carries a Presenton
 *   id — the proof a deck exists to open;
 * - a failed row shows the sanitized stored message and no Open/Edit — its one
 *   remaining action is Delete (Task F4);
 * - Delete (Task F4) opens the `Modal` confirmation and removes the engine
 *   deck, the generated document and the row. It is offered when no worker can
 *   still be writing this deck: never while generation is in flight, and never
 *   while the export mirror says an export is queued/running (the action
 *   re-checks both server-side).
 *
 * The list renders only when there is something to list — the page's existing
 * "No decks yet" empty state already covers the empty case, so a second empty
 * card is never stacked under it. Motion reuses the shared vocabulary: the
 * section is one `data-enter="scale"` step after the workspace (`motionIndex`),
 * inserted or removed rows drop in / fade out through `MotionListItem` +
 * `AnimatePresence`, and download/delete failures are `MotionNotice`s.
 */
export function DecksList({ decks }: DecksListProps) {
  const [downloadError, setDownloadError] = useState<{
    deckId: string;
    message: string;
  } | null>(null);
  /** The deck whose delete confirmation is open, or null when it is closed. */
  const [confirming, setConfirming] = useState<PresentationItem | null>(null);
  /** Changes on every open; remounts the body so pending/error start fresh. */
  const [deleteBodyKey, setDeleteBodyKey] = useState(0);

  async function onDownload(deckId: string, documentId: string) {
    setDownloadError(null);
    let result: Awaited<ReturnType<typeof previewDocumentAction>>;
    try {
      result = await previewDocumentAction(documentId);
    } catch {
      result = { error: PRESENTATION_SAVE_ERROR, preview: null };
    }
    if (result.error !== null || result.preview === null) {
      setDownloadError({
        deckId,
        message: result.error ?? PRESENTATION_SAVE_ERROR,
      });
      return;
    }
    window.open(result.preview.url, "_blank", "noopener,noreferrer");
  }

  function onDelete(deck: PresentationItem) {
    setDeleteBodyKey((key) => key + 1);
    setConfirming(deck);
  }

  if (decks.length === 0) return null;

  return (
    <section
      data-enter="scale"
      data-decks-list=""
      aria-label="My decks"
      style={motionIndex(2)}
      className="flex min-w-0 flex-col gap-4"
    >
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="font-heading text-body-lg font-semibold text-foreground">
          My decks
        </h2>
        <p className="text-label-sm text-muted-foreground">
          Every deck you&rsquo;ve requested. The deck lives on your presentation
          service; its file lands in Documents when it&rsquo;s ready.
        </p>
      </header>

      <Card className="bg-glass px-4 py-1 backdrop-blur-md md:px-6">
        <ul className="flex min-w-0 list-none flex-col">
          <AnimatePresence initial={false}>
            {decks.flatMap((deck, index) => {
              const row = (
                <DeckRow
                  key={deck.id}
                  deck={deck}
                  downloadError={
                    downloadError?.deckId === deck.id
                      ? downloadError.message
                      : null
                  }
                  onDownload={onDownload}
                  onDelete={onDelete}
                />
              );
              // A `Divider` between rows, never after the last one.
              return index === 0
                ? [row]
                : [
                    <li
                      key={`divider-${deck.id}`}
                      aria-hidden="true"
                      className="py-1"
                    >
                      <Divider />
                    </li>,
                    row,
                  ];
            })}
          </AnimatePresence>
        </ul>
      </Card>

      <DeckDeleteModal
        deck={confirming}
        bodyKey={deleteBodyKey}
        onClose={() => setConfirming(null)}
      />
    </section>
  );
}

function DeckRow({
  deck,
  downloadError,
  onDownload,
  onDelete,
}: {
  deck: PresentationItem;
  downloadError: string | null;
  onDownload: (deckId: string, documentId: string) => void;
  onDelete: (deck: PresentationItem) => void;
}) {
  const inFlight = isPresentationInFlight(deck.statusValue);
  const failed = deck.statusValue === "failed";
  const hasEngineDeck = deck.presentonPresentationId !== undefined;
  /* In flight, the Presenton id is the proof a deck exists to open or edit;
     once generation succeeded the viewer/editor routes own the honest
     not-ready state, so the links are offered either way. */
  const revisable = !failed && (!inFlight || hasEngineDeck);
  /* A worker may still be writing this deck while generation runs or an
     export is known to be queued/running (the action also refuses a pending
     export job the mirror does not show yet). */
  const exporting =
    deck.exportStatus === "queued" || deck.exportStatus === "running";
  const deletable = !inFlight && !exporting;

  const document = deck.document;
  const title = document?.name ?? deck.prompt;
  const slidesLabel = slideCountLabel(deck);

  return (
    <MotionListItem
      as="li"
      data-deck-row={deck.id}
      data-deck-status={deck.statusValue}
      className="flex min-w-0 flex-col gap-3 py-4 first:pt-2 last:pb-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="wrap-anywhere text-body-md font-medium text-foreground">
          {title}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-label-sm text-muted-foreground">
          <span
            className={
              failed
                ? "font-semibold text-destructive"
                : "font-semibold text-foreground"
            }
          >
            {deck.statusLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate">{deck.template}</span>
          {slidesLabel !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{slidesLabel}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>{deck.createdLabel}</span>
        </p>
        {failed ? (
          <p className="text-label-sm text-destructive">
            {deck.errorMessage ??
              "Generation failed. Adjust the topic or options and generate again."}
          </p>
        ) : null}
        {downloadError !== null ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {downloadError}
          </MotionNotice>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        {!failed && document !== undefined ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDownload(deck.id, document.id)}
          >
            Download
          </Button>
        ) : null}
        {!failed && revisable ? (
          <ButtonLink
            size="sm"
            href={`/tools/presentation/${deck.id}`}
            data-deck-action="open"
          >
            Open
          </ButtonLink>
        ) : null}
        {!failed && revisable ? (
          <ButtonLink
            size="sm"
            variant="outline"
            href={`/tools/presentation/${deck.id}/edit`}
            data-deck-action="edit"
          >
            Edit
          </ButtonLink>
        ) : null}
        {!failed ? (
          <WorkspaceAction href="/documents">
            {document !== undefined ? "Open in Documents" : "Documents"}
          </WorkspaceAction>
        ) : null}
        {/* A failed row has no Open/Edit — the deck never became revisable —
            but Delete stays: removing the dead request is its cleanup path. */}
        {deletable ? (
          <Button
            size="sm"
            variant="outline"
            data-deck-action="delete"
            onClick={() => onDelete(deck)}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </MotionListItem>
  );
}

/**
 * The delete confirmation (Task F4, spec §7.4/§10-F) — the `TaskDeleteModal`
 * pattern applied to a deck: the row is identified by its real name, staying
 * is the primary action, and the confirm is the one destructive fill. A
 * failure keeps the dialog open with the sanitized notice so the user can
 * retry; success closes it and the revalidated page drops the row through
 * `AnimatePresence`.
 */
function DeckDeleteModal({
  deck,
  bodyKey,
  onClose,
}: {
  /** The deck awaiting confirmation, or null when the dialog is closed. */
  deck: PresentationItem | null;
  /** Changes on every open; remounts the body so pending/error start fresh. */
  bodyKey: number;
  onClose: () => void;
}) {
  return (
    <Modal
      open={deck !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Delete this deck?"
      description={deck ? deleteDescription(deck) : undefined}
      showClose={false}
      className="max-w-sm"
    >
      {deck ? (
        <DeckDeleteBody key={bodyKey} deck={deck} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

/** The deck's own facts decide the copy — never a generic claim. */
function deleteDescription(deck: PresentationItem): string {
  const title = deck.document?.name ?? deck.prompt;
  const engineDeck = deck.presentonPresentationId !== undefined;
  const document = deck.document !== undefined;
  if (engineDeck && document) {
    return `“${title}” will be deleted from the presentation service, and its file will be removed from Documents. This can’t be undone.`;
  }
  if (engineDeck) {
    return `“${title}” will be deleted from the presentation service. This can’t be undone.`;
  }
  if (document) {
    return `“${title}” and its file in Documents will be removed. This can’t be undone.`;
  }
  return `“${title}” will be removed from your deck list. This can’t be undone.`;
}

function DeckDeleteBody({
  deck,
  onClose,
}: {
  deck: PresentationItem;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);

    let result: Awaited<ReturnType<typeof deletePresentationAction>>;
    try {
      result = await deletePresentationAction(deck.id);
    } catch {
      result = { error: PRESENTATION_DELETE_ERROR };
    }

    setPending(false);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <>
      {error !== null ? (
        <MotionNotice
          role="alert"
          className="mb-4 text-label-sm text-destructive"
        >
          {error}
        </MotionNotice>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          data-deck-delete-confirm=""
          onClick={confirm}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Deleting…" : "Delete deck"}
        </Button>
      </div>
    </>
  );
}

/**
 * The metadata line's slide count: the worker's mirrored total, with the
 * in-flight done/total pair while generation runs. Absent until the worker has
 * reported a count — the row never invents one from the request.
 */
function slideCountLabel(deck: PresentationItem): string | null {
  const total = deck.slidesTotal;
  if (total === undefined) return null;

  const done = deck.slidesDone;
  if (isPresentationInFlight(deck.statusValue) && done !== undefined) {
    return `${done}/${total} slides`;
  }
  return total === 1 ? "1 slide" : `${total} slides`;
}
