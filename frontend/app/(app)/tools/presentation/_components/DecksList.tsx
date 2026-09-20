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
import { previewDocumentAction } from "@/lib/data/documentActions";
import { PRESENTATION_SAVE_ERROR } from "@/lib/data/presentationErrors";
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
 * - a failed row shows the sanitized stored message and no actions at all:
 *   its one honest next step is generating again in the form above.
 *
 * The list renders only when there is something to list — the page's existing
 * "No decks yet" empty state already covers the empty case, so a second empty
 * card is never stacked under it. Motion reuses the shared vocabulary: the
 * section is one `data-enter="scale"` step after the workspace (`motionIndex`),
 * inserted or removed rows drop in / fade out through `MotionListItem` +
 * `AnimatePresence`, and download failures are `MotionNotice`s in the row.
 */
export function DecksList({ decks }: DecksListProps) {
  const [downloadError, setDownloadError] = useState<{
    deckId: string;
    message: string;
  } | null>(null);

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
    </section>
  );
}

function DeckRow({
  deck,
  downloadError,
  onDownload,
}: {
  deck: PresentationItem;
  downloadError: string | null;
  onDownload: (deckId: string, documentId: string) => void;
}) {
  const inFlight = isPresentationInFlight(deck.statusValue);
  const failed = deck.statusValue === "failed";
  const hasEngineDeck = deck.presentonPresentationId !== undefined;
  /* In flight, the Presenton id is the proof a deck exists to open or edit;
     once generation succeeded the viewer/editor routes own the honest
     not-ready state, so the links are offered either way. */
  const revisable = !failed && (!inFlight || hasEngineDeck);

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

      {failed ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          {document !== undefined ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(deck.id, document.id)}
            >
              Download
            </Button>
          ) : null}
          {revisable ? (
            <ButtonLink
              size="sm"
              href={`/tools/presentation/${deck.id}`}
              data-deck-action="open"
            >
              Open
            </ButtonLink>
          ) : null}
          {revisable ? (
            <ButtonLink
              size="sm"
              variant="outline"
              href={`/tools/presentation/${deck.id}/edit`}
              data-deck-action="edit"
            >
              Edit
            </ButtonLink>
          ) : null}
          <WorkspaceAction href="/documents">
            {document !== undefined ? "Open in Documents" : "Documents"}
          </WorkspaceAction>
        </div>
      )}
    </MotionListItem>
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
