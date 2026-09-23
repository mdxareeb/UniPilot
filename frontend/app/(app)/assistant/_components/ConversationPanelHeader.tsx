"use client";

import { useRef, useState, type FormEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { ConversationItem } from "@/lib/data/conversations";

/**
 * The title bound is the service's own (`CONVERSATION_TITLE_MAX_LENGTH` in
 * `lib/data/conversations.ts`). It is mirrored here rather than imported: that
 * module is server-only (it builds the request-scoped Supabase client), and a
 * client value import would drag `next/headers` into the browser bundle. The
 * server remains the authority regardless — a title the action rejects comes
 * back as its sanitized copy.
 */
const CONVERSATION_TITLE_MAX_LENGTH = 120;

type ConversationPanelHeaderProps = {
  /** The selected conversation, or null when none is selected. */
  conversation: ConversationItem | null;
  /** The header's mono status line (updated label, or the honest state). */
  statusLine: string;
  /** The 26.1 provider verdict, shown as the outline badge. */
  configured: boolean;
  /**
   * 19.3 rename. Resolves to the sanitized failure copy, or null on success.
   * The header stays open (with the draft) when it fails.
   */
  onRename: (conversationId: string, title: string) => Promise<string | null>;
  /**
   * 19.3 delete. Resolves to the sanitized failure copy, or null on success.
   * The confirmation stays open (with the copy) when it fails.
   */
  onDelete: (conversationId: string) => Promise<string | null>;
};

/**
 * Task 19.3 — the selected conversation's panel chrome: its title and status,
 * the provider badge, and the two conversation verbs.
 *
 * Rename follows the documents-hub precedent (18.x `DocumentCard`): the title
 * is swapped for a labelled input with Save/Cancel, the value is bounded by the
 * service's own limit, and an empty/whitespace-only draft keeps Save disabled
 * (a dead-looking control would be dishonest, so it is an honest disabled one).
 * A failed rename stays open with the action's sanitized copy in place and the
 * caller rolls the title back — never a silently renamed row.
 *
 * Delete uses the shared `Modal` confirmation (the same dialog primitive, the
 * same destructive button, the same focus behaviour: closing returns focus to
 * the trigger). A failed delete keeps the dialog open with the action's own
 * copy — "That conversation no longer exists." when the row is gone — so the
 * failure is visible where the caller is looking, not behind the scrim.
 *
 * The confirmation captures its own target: if the refresh that follows a
 * refused delete turns the selection unavailable, the open dialog still owns
 * the id and title it was opened for. State that belongs to a *previous*
 * selection (an in-progress rename draft) is abandoned when the conversation
 * changes, so a draft can never be submitted against the wrong row.
 *
 * Motion: the shared `Modal` (centred popover + scrim variants) and
 * `MotionNotice` for both error lines. The title/form swap is a state swap
 * inside one card, not a popup — the same plain swap the documents card uses
 * — so it introduces no new animation.
 */
export function ConversationPanelHeader({
  conversation,
  statusLine,
  configured,
  onRename,
  onDelete,
}: ConversationPanelHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  const conversationId = conversation?.id ?? null;

  /* React's documented "adjust state when a prop changes" pattern: a selection
     change abandons a rename draft aimed at the previous conversation. The
     delete dialog is deliberately NOT reset here — a refused delete refreshes
     the page and may make the conversation unavailable, and the open dialog
     must survive that refresh with its captured target and copy. */
  const [trackedId, setTrackedId] = useState(conversationId);
  if (trackedId !== conversationId) {
    setTrackedId(conversationId);
    setEditing(false);
    setDraft("");
    setRenameError(null);
  }

  function startEditing() {
    if (conversation === null) return;
    setDraft(conversation.title);
    setRenameError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setRenameError(null);
    renameButtonRef.current?.focus();
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conversation === null || renaming) return;

    const title = draft.trim();
    if (title === "") return;

    setRenaming(true);
    setRenameError(null);
    const failure = await onRename(conversation.id, title);
    setRenaming(false);

    if (failure !== null) {
      setRenameError(failure);
      return;
    }
    setEditing(false);
    renameButtonRef.current?.focus();
  }

  function startDelete() {
    if (conversation === null) return;
    setConfirmTarget({ id: conversation.id, title: conversation.title });
    setDeleteError(null);
    setConfirming(true);
  }

  async function confirmDelete() {
    if (confirmTarget === null || deleting) return;

    setDeleting(true);
    setDeleteError(null);
    const failure = await onDelete(confirmTarget.id);
    setDeleting(false);

    if (failure !== null) {
      setDeleteError(failure);
      return;
    }
    setConfirming(false);
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing && conversation !== null ? (
            <form
              onSubmit={submitRename}
              aria-busy={renaming}
              data-conversation-rename=""
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              <Input
                aria-label="Conversation name"
                data-conversation-rename-input=""
                value={draft}
                maxLength={CONVERSATION_TITLE_MAX_LENGTH}
                disabled={renaming}
                autoFocus
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (renameError !== null) setRenameError(null);
                }}
                className="min-w-0 max-w-xs"
              />
              <Button
                type="submit"
                size="sm"
                data-conversation-rename-save=""
                disabled={renaming || draft.trim() === ""}
              >
                {renaming ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-conversation-rename-cancel=""
                onClick={cancelEditing}
                disabled={renaming}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <h2
              data-conversation-title=""
              className="min-w-0 truncate font-heading text-body-lg font-semibold text-foreground"
            >
              {conversation?.title ?? "Conversation"}
            </h2>
          )}

          <p className="font-mono text-label-sm text-muted-foreground">
            {statusLine}
          </p>

          {renameError !== null ? (
            <MotionNotice
              role="alert"
              data-assistant-rename-error=""
              className="text-label-sm text-destructive"
            >
              {renameError}
            </MotionNotice>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <Badge
            variant="outline"
            size="sm"
            className="font-mono uppercase"
            data-assistant-provider=""
          >
            {configured ? "Configured" : "Unconfigured"}
          </Badge>

          {conversation !== null ? (
            <div
              data-conversation-actions=""
              className="flex items-center gap-0.5"
            >
              <IconButton
                ref={renameButtonRef}
                size="sm"
                variant="ghost"
                data-conversation-verb="rename"
                aria-label={`Rename ${conversation.title}`}
                onClick={startEditing}
                disabled={confirming}
              >
                <Pencil aria-hidden="true" className="size-3.5" />
              </IconButton>
              <IconButton
                size="sm"
                variant="ghost"
                data-conversation-verb="delete"
                aria-label={`Delete ${conversation.title}`}
                onClick={startDelete}
                disabled={renaming}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </IconButton>
            </div>
          ) : null}
        </div>
      </div>

      <Modal
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title="Delete this conversation?"
        description={
          confirmTarget === null
            ? undefined
            : `“${confirmTarget.title}” and its messages will be removed.`
        }
        showClose={false}
        className="max-w-sm"
      >
        {deleteError !== null ? (
          <MotionNotice
            role="alert"
            data-assistant-delete-error=""
            className="mb-4 text-label-sm text-destructive"
          >
            {deleteError}
          </MotionNotice>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="primary"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-conversation-delete-confirm=""
            disabled={deleting}
            aria-busy={deleting}
            onClick={confirmDelete}
          >
            {deleting ? "Deleting…" : "Delete conversation"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
