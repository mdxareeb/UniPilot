"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Eye, FileText, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { dissolveVariants } from "@/components/motion/presets";
import {
  DOCUMENT_NAME_MAX_LENGTH,
  type DocumentItem,
} from "@/lib/data/documentValues";

type DocumentCardProps = {
  document: DocumentItem;
  /**
   * The owning presentation's id when this document is a generated deck
   * (`presentations.document_id = documents.id`, read owner-scoped by the
   * page, Task F2). Absent for uploads and for decks the caller cannot link.
   */
  deckId?: string;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  onRetry: (id: string) => Promise<string | null>;
  onPreview: (document: DocumentItem) => void;
};

/**
 * 18.6 — one document card: the real name, one mono metadata line
 * (type · size · pages · status · date, only segments that exist), and the
 * preview / rename / delete actions. A failed document surfaces the worker's
 * sanitized copy and the 18.15 retry control.
 *
 * Task F2 (spec §9) adds the provenance half, honestly:
 * - a `Presentation` badge only when the row itself says
 *   `source = 'presentation'` — an upload never gets one;
 * - an "Open deck" link to `/tools/presentation/[id]` only when the server
 *   page found an owned presentation pointing at this document, so the action
 *   is proof, never a guess. Both are absent together for ordinary uploads.
 *
 * The card never renders file content and never invents a status: the status
 * word is the vocabulary the runner writes (`Parsing…` while `indexing`,
 * `Searchable` once `indexed`, `Failed` with the sanitized reason). 18.13's
 * dissolve plays on that word only — `AnimatePresence` keyed by the status
 * swaps one always-present label for another, so the text is content first
 * and animation second; under reduced motion both legs run at zero duration.
 */
export function DocumentCard({
  document,
  deckId,
  onRename,
  onDelete,
  onRetry,
  onPreview,
}: DocumentCardProps) {
  const reduced = useReducedMotion() ?? false;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(document.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const failed = document.statusValue === "failed";
  const isDeck = document.source === "presentation";
  const metadata = [
    document.mimeLabel,
    document.sizeLabel,
    document.pageCount
      ? `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function onRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const name = draftName.trim();
    if (name === "") {
      setError("Give the document a name.");
      return;
    }

    setPending(true);
    setError(null);
    const failure = await onRename(document.id, name);
    setPending(false);

    if (failure !== null) {
      setError(failure);
      return;
    }
    setEditing(false);
  }

  async function onRetryClick() {
    if (pending) return;
    setPending(true);
    setError(null);
    const failure = await onRetry(document.id);
    setPending(false);
    if (failure !== null) setError(failure);
  }

  return (
    <MotionListItem
      as="li"
      data-document-id={document.id}
      data-document-status={document.statusValue}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-glass p-4 backdrop-blur-md"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {editing ? (
            <form
              onSubmit={onRenameSubmit}
              aria-busy={pending}
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              <Input
                aria-label={`Document name for ${document.name}`}
                value={draftName}
                maxLength={DOCUMENT_NAME_MAX_LENGTH}
                disabled={pending}
                autoFocus
                onChange={(event) => {
                  setDraftName(event.target.value);
                  if (error !== null) setError(null);
                }}
                className="min-w-0"
              />
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraftName(document.name);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="wrap-anywhere text-body-md font-medium text-foreground">
                {document.name}
              </p>
              {isDeck ? (
                <Badge
                  size="sm"
                  variant="outline"
                  data-document-source="presentation"
                >
                  Presentation
                </Badge>
              ) : null}
            </div>
          )}

          <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-label-caps uppercase text-muted-foreground">
            <FileText aria-hidden="true" className="size-3 shrink-0" />
            {metadata ? <span>{metadata}</span> : null}
            {metadata ? <span aria-hidden="true">·</span> : null}
            <span className="inline-flex min-w-0">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={document.statusValue}
                  data-document-status-label=""
                  variants={dissolveVariants(reduced)}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="inline-block"
                >
                  {document.statusLabel}
                </motion.span>
              </AnimatePresence>
            </span>
            <span aria-hidden="true">·</span>
            <span>{document.createdLabel}</span>
          </p>

          {/* Task F2 — the deck's native surface. Rendered only when the
              server found the caller's presentation pointing at this row;
              the viewer route owns its honest not-ready/unavailable panels. */}
          {deckId !== undefined ? (
            <div data-document-action="open-deck">
              <WorkspaceAction href={`/tools/presentation/${deckId}`}>
                Open deck
              </WorkspaceAction>
            </div>
          ) : null}

          {/* 24.12 — the worker's sanitized failure copy, verbatim. */}
          {failed && document.errorMessage ? (
            <p data-document-error="" className="text-label-sm text-destructive">
              {document.errorMessage}
            </p>
          ) : null}

          {failed ? (
            <div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRetryClick}
                disabled={pending}
                aria-busy={pending}
                aria-label={`Retry processing for ${document.name}`}
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                {pending ? "Retrying…" : "Retry processing"}
              </Button>
            </div>
          ) : null}
        </div>

        {!editing ? (
          <div className="flex shrink-0 gap-1">
            <IconButton
              size="sm"
              aria-label={`Preview ${document.name}`}
              onClick={() => onPreview(document)}
            >
              <Eye aria-hidden="true" className="size-3.5" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={`Rename ${document.name}`}
              onClick={() => {
                setDraftName(document.name);
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={`Delete ${document.name}`}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </IconButton>
          </div>
        ) : null}
      </div>

      {error ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {error}
        </MotionNotice>
      ) : null}

      <Modal
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title="Delete this document?"
        description={`“${document.name}” and its indexed text will be removed.`}
        showClose={false}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="primary"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={async () => {
              if (pending) return;
              setPending(true);
              setError(null);
              const failure = await onDelete(document.id);
              setPending(false);
              if (failure !== null) {
                setError(failure);
                return;
              }
              setConfirming(false);
            }}
          >
            {pending ? "Deleting…" : "Delete document"}
          </Button>
        </div>
      </Modal>
    </MotionListItem>
  );
}
