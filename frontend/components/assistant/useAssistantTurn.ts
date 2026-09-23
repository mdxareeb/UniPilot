"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyAssistantFrame,
  createAssistantEntry,
  parseSseFrames,
  type AssistantEntry,
} from "@/lib/data/assistantFrames";
import type {
  AssistantStreamFrame,
  MessageItem,
} from "@/lib/data/assistantValues";

/**
 * Task 19.10 — one turn this tab sent, before the stored rows are the truth.
 *
 * `userText` is the exact text the caller typed; `entry` is the C1 assistant
 * entry accumulating only what the stream delivered (never fabricated);
 * `targetConversationId` is where the composer aimed the turn (`null` = "let
 * the server create one"); `failureCopy` is the sanitized failure message to
 * show while a failed entry delivered no text at all.
 */
export type LocalTurn = {
  userText: string;
  entry: AssistantEntry;
  targetConversationId: string | null;
  failureCopy: string | null;
};

/** A turn belongs to the currently selected conversation, or to a new one. */
function belongsToSelection(
  turn: LocalTurn,
  selectedId: string | null,
): boolean {
  if (turn.targetConversationId === selectedId) return true;
  /* A turn sent with no selection started a new conversation. It stays visible
     while the URL still has no `?c=` (the `start` frame's id is not selected
     yet) and once that server id does become the selection. */
  return (
    turn.targetConversationId === null &&
    (selectedId === null || turn.entry.conversationId === selectedId)
  );
}

/** A non-OK response's sanitized `{ error }` copy, when it carries one. */
async function readErrorCopy(response: Response): Promise<string | null> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload)
    ) {
      const copy = (payload as Record<string, unknown>).error;
      if (typeof copy === "string" && copy.trim() !== "") return copy;
    }
  } catch {
    // Not JSON: no sanitized copy to surface; the caller uses the fallback.
  }
  return null;
}

export type UseAssistantTurnOptions = {
  /** The conversation a send targets; `null` lets the server create one. */
  conversationId: string | null;
  /** The server's sanitized fallback copy for transport-level failures. */
  failedCopy: string;
  /**
   * The stored rows currently rendered, used to retire the local turn. A
   * surface with no server read of its own (the 19.16 launcher panel) omits
   * it: the live turn is then the only rendering of that exchange, and the
   * stored conversation is one link away.
   */
  messages?: MessageItem[];
  /**
   * Called after a settle that announced a conversation the send did not
   * target — and only while the caller's selection is still where the send
   * aimed, so a caller who has meanwhile selected (or created, 19.2) another
   * conversation is never overruled. The `/assistant` page replaces its URL
   * here; the 19.16 launcher panel holds the id in component state instead.
   */
  onConversationStarted?: (conversationId: string) => void;
  /**
   * True (the route's default) to `router.refresh()` after every settle so the
   * stored rows become the source of truth. The launcher panel has no stored
   * rows to reconcile and passes `false`.
   */
  refreshOnSettle?: boolean;
};

/**
 * `POST /api/assistant/turn` as the UI consumes it (26.8 → 19.10 → 19.16).
 *
 * One hook for every chat surface — the `/assistant` page and the global
 * launcher panel — so the streaming turn is never implemented twice.
 *
 * On submit the hook appends the optimistic turn (the exact typed text plus a
 * `streaming` assistant entry) and fetches the route. The response body is read
 * with `response.body.getReader()` + `TextDecoder` and fed through C1's
 * `parseSseFrames` (carry preserved across reads, the final partial block
 * flushed), and every frame is applied with `applyAssistantFrame` — so the
 * bubble grows with the real deltas and settles on the real `done`/`error`
 * status. There is no timer, no fake typing and no fabricated text anywhere.
 *
 * Failure honesty:
 * - a non-OK response uses the route's own sanitized `{ error }` copy, else the
 *   server-passed `failedCopy`;
 * - a missing body, a network error, or a stream that closes without any
 *   terminal frame becomes a `failed` entry carrying that same sanitized copy —
 *   never an invented answer;
 * - an `error` frame keeps its own copy; `done` statuses are copied verbatim,
 *   so `unconfigured` never folds into `failed` or `complete`.
 *
 * Reconciliation: after settle the hook calls `router.refresh()` (unless the
 * caller opted out) so the stored rows become the source of truth, and — when
 * `start` announced a conversation the composer did not have selected — hands
 * that id to `onConversationStarted`, so the URL (`/assistant`) or the
 * launcher's component state can move to it. That handoff only runs while the
 * selection is still where the send aimed: if the caller has meanwhile selected
 * another conversation, settling must not steal the choice back.
 *
 * Visibility is derived, never duplicated: the hook returns the local turn only
 * while it belongs to the currently selected conversation (or to the new one it
 * is creating), and hides it as soon as the settled assistant message id
 * appears in the stored `messages`. From that point the server-rendered bubble
 * is the only rendering of that turn. A turn whose selection is not current is
 * hidden rather than discarded; a still-streaming turn is therefore intact if
 * the caller comes back to it. A failure that was never persisted (an `error`
 * frame persists nothing, 26.10) is the one record of that attempt in this tab,
 * so it reappears if its conversation is re-selected — it is never invented and
 * never presented as an answer.
 *
 * One turn at a time: `send` refuses while a turn is in flight, and the
 * composer's disabled states make that visible.
 */
export function useAssistantTurn({
  conversationId,
  failedCopy,
  messages = [],
  onConversationStarted,
  refreshOnSettle = true,
}: UseAssistantTurnOptions) {
  const router = useRouter();
  const [turn, setTurn] = useState<LocalTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /* The live selection, read at settle time rather than from the send's
     closure: 19.2's "New conversation" can move the selection while a turn is
     still streaming, and the settle must then leave the caller's choice
     alone. */
  const selectionRef = useRef(conversationId);
  useEffect(() => {
    selectionRef.current = conversationId;
  }, [conversationId]);
  /* The settle callback is read through a ref too, so a caller's inline arrow
     (the route's `router.replace`) never changes `send`'s identity. */
  const startedRef = useRef(onConversationStarted);
  useEffect(() => {
    startedRef.current = onConversationStarted;
  }, [onConversationStarted]);

  /* A page unmount (navigation away) cancels the read; the server pipeline
     keeps its own request and persists whatever it settles on. */
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (content: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy(true);

      const targetConversationId = conversationId;
      const controller = new AbortController();
      abortRef.current = controller;

      let entry = createAssistantEntry({ conversationId: targetConversationId });
      const update = (frame: AssistantStreamFrame) => {
        entry = applyAssistantFrame(entry, frame);
        const nextFailure =
          entry.error ??
          (entry.status === "failed" && entry.content === ""
            ? failedCopy
            : null);
        setTurn((current) =>
          current === null
            ? current
            : { ...current, entry, failureCopy: nextFailure },
        );
      };

      setTurn({
        userText: content,
        entry,
        targetConversationId,
        failureCopy: null,
      });

      try {
        const response = await fetch("/api/assistant/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: targetConversationId,
            content,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          update({
            type: "error",
            error: (await readErrorCopy(response)) ?? failedCopy,
          });
          return;
        }

        if (response.body === null) {
          update({ type: "error", error: failedCopy });
          return;
        }

        /* Read the SSE body chunk by chunk; C1 owns the wire parsing, so a
           frame split anywhere across chunks (and CRLF, comments, malformed
           blocks) is handled exactly as the pure spec proves. */
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let carry = "";
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const parsed = parseSseFrames(
              decoder.decode(value, { stream: true }),
              carry,
            );
            carry = parsed.carry;
            for (const frame of parsed.frames) update(frame);
          }
          /* Flush the decoder's tail and an unterminated final block (a
             well-formed stream ends every frame with the blank separator). */
          const tail = decoder.decode();
          if (tail !== "" || carry !== "") {
            const parsed = parseSseFrames(`${tail}\n\n`, carry);
            for (const frame of parsed.frames) update(frame);
          }
        } finally {
          reader.releaseLock();
        }

        /* A body that ended without a terminal frame is a truncated turn, not
           a silent success. */
        if (entry.status === "streaming") {
          update({ type: "error", error: failedCopy });
        }
      } catch {
        /* Aborting on unmount is not a failure to report; anything else is. */
        if (!controller.signal.aborted) {
          update({ type: "error", error: failedCopy });
        }
      } finally {
        abortRef.current = null;
        inFlightRef.current = false;
        if (!controller.signal.aborted) {
          setBusy(false);
          if (
            entry.conversationId !== null &&
            entry.conversationId !== targetConversationId &&
            selectionRef.current === targetConversationId
          ) {
            startedRef.current?.(entry.conversationId);
          }
          if (refreshOnSettle) router.refresh();
        }
      }
    },
    [conversationId, failedCopy, refreshOnSettle, router],
  );

  const visibleTurn =
    turn !== null &&
    belongsToSelection(turn, conversationId) &&
    !(
      turn.entry.messageId !== null &&
      messages.some((message) => message.id === turn.entry.messageId)
    )
      ? turn
      : null;

  return { turn: visibleTurn, busy, send };
}
