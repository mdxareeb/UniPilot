"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import { FileText, Pencil, Trash2, Upload } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { motionIndex } from "@/components/motion/stagger";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  DOCUMENT_NAME_MAX_LENGTH,
  type DocumentItem,
} from "@/lib/data/documentValues";
import { useDocumentsUpload } from "./DocumentsUploadProvider";

/**
 * The documents surface's upload half (23.2/23.3/23.7/23.8) — deliberately
 * not the 18.x hub. It renders the one drop target, the real progress and
 * error states, and the latest settled document with its rename/delete
 * actions, because those two verbs (23.9/23.10) are part of this task and
 * have to be reachable and verifiable in the browser. Cards, filters,
 * search and the parsing/indexing states remain 18.x's work.
 *
 * The signed-in empty line keeps the page's original honest copy ("Your
 * documents will appear here") until the hub renders the full list. A guest
 * sees the same card copy the guest-browsing contract pins, and the header's
 * sign-in action opens the shared prompt — no upload path exists for a
 * session-less visitor.
 */
export function DocumentsUploadSurface({
  guest,
  index,
}: {
  guest: boolean;
  index: number;
}) {
  const {
    phase,
    progress,
    pendingName,
    error,
    notice,
    document,
    upload,
    rename,
    remove,
  } = useDocumentsUpload();
  const [dragging, setDragging] = useState(false);

  if (guest) {
    return (
      <div
        data-enter="scale"
        style={motionIndex(index)}
        className="rounded-card border border-dashed border-border bg-card/50 p-8 text-label-sm text-muted-foreground"
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

  return (
    <div
      data-enter="scale"
      style={motionIndex(index)}
      className="flex min-w-0 flex-col gap-3"
    >
      {phase === "uploading" ? (
        <div
          data-upload-phase="uploading"
          className="flex flex-col gap-2 rounded-card border border-border bg-glass p-4"
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

      {notice ? (
        <p role="status" className="text-label-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {document ? (
        <DocumentResultRow
          document={document}
          onRename={rename}
          onDelete={remove}
        />
      ) : null}

      <div
        data-upload-phase="idle"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-card border border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-foreground bg-card"
            : "border-border bg-card/50"
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
        {document === null && notice === null ? (
          <p className="text-label-sm text-muted-foreground">
            Your documents will appear here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The latest settled document: the row the pipeline's rename (23.10) and
 * delete (23.9) actions operate on. Rename is inline (display name only, the
 * storage path stays put); delete is a shared `Modal` confirmation — never
 * single-click — with the sanitized copy on failure.
 */
function DocumentResultRow({
  document,
  onRename,
  onDelete,
}: {
  document: DocumentItem;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(document.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

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

  return (
    <div
      data-document-id={document.id}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-glass p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {editing ? (
            <form
              onSubmit={onRenameSubmit}
              aria-busy={pending}
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              <Input
                aria-label="Document name"
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
            <p className="wrap-anywhere text-body-md font-medium text-foreground">
              {document.name}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-label-caps uppercase text-muted-foreground">
            <FileText aria-hidden="true" className="size-3" />
            {[
              document.mimeLabel,
              document.sizeLabel,
              document.pageCount
                ? `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`
                : null,
              document.statusLabel,
              document.createdLabel,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/* 24.12 — the worker's sanitized failure copy, verbatim. */}
          {document.statusValue === "failed" && document.errorMessage ? (
            <p
              data-document-error=""
              className="text-label-sm text-destructive"
            >
              {document.errorMessage}
            </p>
          ) : null}
        </div>

        {!editing ? (
          <div className="flex shrink-0 gap-1">
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
        <DeleteDocumentBody
          pending={pending}
          onConfirm={async () => {
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
          onCancel={() => setConfirming(false)}
        />
      </Modal>
    </div>
  );
}

function DeleteDocumentBody({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="primary"
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        onClick={onConfirm}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "Deleting…" : "Delete document"}
      </Button>
    </div>
  );
}
