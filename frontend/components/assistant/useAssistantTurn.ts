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

/**
 * C6 (deferred C3 Important) — the client-side deadline for a whole turn.
 *
 * The read loop below consumes the streaming body; a server or proxy that
 * accepted the POST and then never wrote a frame or never closed the body
 * would otherwise pin the composer in `busy` for the rest of the session.
 * The deadline is composed with the caller's abort controller into the fetch
 * signal, so a turn that has not settled within this window fails with the
 * server's sanitized copy (`ASSISTANT_FAILED_COPY` by default) and the
 * composer recovers — even if the caller never uses Stop. Two minutes is a
 * deliberate outer bound for one conversational turn: it is generous for any
 * normal streamed answer, and a turn that genuinely outlives it is cut off
 * honestly rather than left running invisibly.
 */
export const ASSISTANT_TURN_DEADLINE_MS = 120_000;

/**
 * Composes the caller's abort controller with the client deadline.
 * `AbortSignal.any` is the native composition where it exists; the manual
 * fallback keeps older engines (Safari < 17.4) working without it.
 */
function composeDeadline(signal: AbortSignal, ms: number): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, deadline]);
  }
  const composed = new AbortController();
  const abort = (reason: unknown) => composed.abort(reason);
  if (signal.aborted) abort(signal.reason);
  else if (deadline.aborted) abort(deadline.reason);
  else {
    signal.addEventListener("abort", () => abort(signal.reason), { once: true });
    deadline.addEventListener("abort", () => abort(deadline.reason), {
      once: true,
    });
  }
  return composed.signal;
}

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
  /**
   * C6 (deferred C4 Important) — reads the caller's selection intent
   * *synchronously* at settle time, instead of the last committed
   * `conversationId` prop.
   *
   * The handoff guard below must compare against where the caller's selection
   * is when the stream settles. The prop is one render behind: a create/delete
   * verb (or a row navigation) can have moved the selection while the turn was
   * still streaming, and the effect that mirrors the prop has not run yet — so
   * the handoff would overrule the caller's move. `/assistant` passes a
   * callback that reads the live URL (which `router.push`/`replace` updates
   * before the render commits) and its own synchronous verb intent; the
   * launcher panel, whose selection only ever changes through this hook, keeps
   * the default.
   */
  selectionIntent?: () => string | null;
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
 * another conversation, settling must not steal the choice back. The
 * comparison reads the caller's `selectionIntent` synchronously (C6); the
 * committed prop is only the fallback, because a create/delete verb can move
 * the selection before this component has re-rendered with it.
 *
 * Recovery (C6, closing the deferred C3 Important): a turn has two ways out
 * that are not a normal settle — the caller's `stop()` (the composer's Stop
 * control while `busy`) and the client deadline
 * (`ASSISTANT_TURN_DEADLINE_MS`, composed with the caller's controller into
 * the fetch signal). Both end the read and settle the entry as a sanitized
 * failure carrying `failedCopy`, so the composer leaves `busy` instead of
 * staying wedged on a body that never closes, and no fabricated text is ever
 * shown. An unmount is the one abort that stays silent: the component that
 * would have reported it is gone.
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
 * One turn at a time: `send` refuses while a turn is in flight, the
 * composer's disabled states make that visible, and `stop` is the caller's
 * explicit way out of a stream that never settles.
 */
export function useAssistantTurn({
  conversationId,
  failedCopy,
  messages = [],
  onConversationStarted,
  refreshOnSettle = true,
  selectionIntent,
}: UseAssistantTurnOptions) {
  const router = useRouter();
  const [turn, setTurn] = useState<LocalTurn | null>(null);
  const [busy, setBusy] = useState(false);
  /* The one turn this tab has in flight, or null. `cancelled` marks an
     unmount (nothing to report); every other abort — the caller's Stop, the
     deadline, a network failure — settles as a sanitized failure, so the flag
     is what decides and a plain `signal.aborted` check would misread a Stop
     as an unmount. */
  const inFlightRef = useRef<{
    controller: AbortController;
    cancelled: boolean;
  } | null>(null);
  /* The live selection, read at settle time rather than from the send's
     closure: 19.2's "New conversation" can move the selection while a turn is
     still streaming, and the settle must then leave the caller's choice
     alone. The caller's `selectionIntent` (C6) is the synchronous authority;
     the committed prop is the fallback for callers that have no intent of
     their own (the launcher panel). */
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
  const intentRef = useRef(selectionIntent);
  useEffect(() => {
    intentRef.current = selectionIntent;
  }, [selectionIntent]);

  /* A page unmount (navigation away) cancels the read; the server pipeline
     keeps its own request and persists whatever it settles on. */
  useEffect(
    () => () => {
      const flight = inFlightRef.current;
      if (flight === null) return;
      flight.cancelled = true;
      flight.controller.abort();
    },
    [],
  );

  /**
   * C6 (deferred C3 Important) — the caller's own Stop for a turn that is
   * still streaming. The abort settles the turn as a sanitized failure
   * (below), so the composer recovers instead of staying wedged in `busy`.
   */
  const stop = useCallback(() => {
    const flight = inFlightRef.current;
    if (flight === null) return;
    flight.controller.abort();
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (inFlightRef.current !== null) return;
      const controller = new AbortController();
      const flight = { controller, cancelled: false };
      inFlightRef.current = flight;
      setBusy(true);

      const targetConversationId = conversationId;
      /* C6 — the client deadline is composed with the caller's controller, so
         a body that never closes (and never errors) still fails honestly. */
      const signal = composeDeadline(
        controller.signal,
        ASSISTANT_TURN_DEADLINE_MS,
      );

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
          signal,
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
        /* An unmount is not a failure to report; a Stop, the client deadline,
           a network error or a missing body is — the sanitized copy is the
           only failure text and the composer recovers below. */
        if (!flight.cancelled) {
          update({ type: "error", error: failedCopy });
        }
      } finally {
        inFlightRef.current = null;
        if (!flight.cancelled) {
          setBusy(false);
          if (
            entry.conversationId !== null &&
            entry.conversationId !== targetConversationId &&
            (intentRef.current?.() ?? selectionRef.current) ===
              targetConversationId
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

  return { turn: visibleTurn, busy, send, stop };
}
