"use client";

/**
 * Task D8 — the editor's deck assistant panel (spec §7.8, §5.4 "AI chat
 * edits", §8.3 popup vocabulary).
 *
 * A right-side floating panel toggled from the editor toolbar. The browser
 * talks to `POST /api/presentation/{id}/chat` (the streaming proxy) and to the
 * `chatActions` Server Actions for conversation listing, history and the
 * post-turn deck re-read — never to Presenton, never with a key. Frames are
 * parsed with the shared pure vocabulary (`lib/presentation/chatFrames.ts`):
 * `chunk` deltas accumulate, `status` is the latest progress line, `trace`
 * records the turn's tool calls, `complete` ends the turn and `error` shows
 * the sanitized copy without faking a reply.
 *
 * Edit-review honesty: after a turn whose tools may have mutated the deck, the
 * editor re-reads the stored deck (the engine is the writer) and this panel
 * compares before/after. A per-message review with "Restore original" is
 * offered only when the diff is whole-slide representable; structural or
 * deck-metadata changes say "changes applied" and point at the editor's undo.
 *
 * `MotionPopover` owns the entrance/exit transition (portalled, fixed to the
 * right edge); this component owns Escape-to-close (returning focus to the
 * toolbar toggle), the message stream and the input.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ArrowUp,
  MessageSquareText,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { PresentonChatConversation } from "@/lib/integrations/presenton";
import {
  applyChatFrame,
  CHAT_ERROR_COPY,
  chatHistoryDiscardReleasesLoading,
  chatHistoryResponseApplies,
  chatTraceMutatesDeck,
  chatTurnMayChangeDeck,
  classifyChatDeckDiff,
  createChatEntry,
  normalizeChatSseEvent,
  parseSseBlocks,
  type ChatDeckDiff,
  type ChatDeckSnapshot,
  type ChatEntry,
  type ChatFrame,
} from "@/lib/presentation/chatFrames";
import type { DeckSlide, PresentationDeck } from "@/lib/presentation/types";
import {
  getChatMessagesAction,
  listChatConversationsAction,
} from "./chatActions";

const CONVERSATIONS_ERROR = "The conversations couldn't be loaded right now.";
const HISTORY_ERROR = "That conversation couldn't be loaded right now.";
const DECK_RELOAD_ERROR =
  "The assistant changed the stored deck, but the editor couldn't reload it. Reload the page to see the stored deck.";
const SETTLE_UNRESOLVED_ERROR =
  "The assistant may still be applying changes to the deck. Reload the page before editing.";
const RESTORE_ERROR =
  "The original slides couldn't be restored. Try again in a moment.";
const CONNECTION_ERROR = "The deck assistant connection dropped. Try again.";
const EXAMPLE_PROMPT =
  "Ask for a change to this deck — for example, \u201cMake the title on slide 2 shorter.\u201d";

/**
 * Settle watcher cadence after an abort or a dropped connection: the route
 * drains the engine's turn instead of hard-cancelling it (see the route's
 * workaround note), so the engine may commit a deck edit *after* Stop. The
 * watcher probes the stored deck until two consecutive reads agree, then
 * re-reads it into the editor.
 */
const SETTLE_PROBE_MS = 1_200;
const SETTLE_MAX_PROBES = 8;

type PanelReview = {
  before: ChatDeckSnapshot;
  diff: ChatDeckDiff;
  /** True once the representable changes were written back. */
  restored: boolean;
  /** True once the reviewer chose to keep the changes (dismisses the diff). */
  kept: boolean;
  restoring: boolean;
  error: string | null;
};

type PanelEntry = ChatEntry & {
  id: string;
  review: PanelReview | null;
};

export type ChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The UniPilot presentation row id. */
  presentationId: string;
  /** True while the editor has unsaved or in-flight changes. */
  savePending: boolean;
  /** The current local deck, captured before each turn for the review. */
  captureDeck: () => ChatDeckSnapshot;
  /**
   * Re-reads the stored deck after a mutating turn and replaces the editor's
   * state with it; answers the stored snapshot (for the diff) or an error.
   * The captured `before` snapshot is handed back so the editor can refuse the
   * reload when the deck was edited while the turn ran (never clobbering an
   * unsaved local change silently).
   */
  reloadDeck: (before: ChatDeckSnapshot) => Promise<{
    error: string | null;
    snapshot: ChatDeckSnapshot | null;
  }>;
  /**
   * A read-only stored-deck probe for the settle watcher (no editor state is
   * touched); the guarded `reloadDeck` installs the deck once it is stable.
   */
  probeDeck: () => Promise<{
    error: string | null;
    deck: PresentationDeck | null;
  }>;
  /** Writes the review's original slides back; answers an error or null. */
  restoreSlides: (slides: DeckSlide[]) => Promise<string | null>;
  /**
   * Notifies the editor that the settle watcher is running, so it can pause
   * deck editing until the stored deck is stable and re-read.
   */
  onSettlingChange: (settling: boolean) => void;
  /** The toolbar toggle, so Escape can return focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
};

function reasonCopy(reason: "structural" | "metadata" | "mixed"): string {
  switch (reason) {
    case "structural":
      return "slides were added, removed or reordered";
    case "metadata":
      return "the deck's theme or title changed";
    case "mixed":
      return "slides and deck details changed";
  }
}

function conversationLabel(conversation: PresentonChatConversation): string {
  const preview = conversation.lastMessagePreview;
  if (preview !== null && preview.trim() !== "") {
    return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview;
  }
  return `Conversation ${conversation.conversationId.slice(0, 8)}`;
}

export function ChatPanel({
  open,
  onOpenChange,
  presentationId,
  savePending,
  captureDeck,
  reloadDeck,
  probeDeck,
  restoreSlides,
  onSettlingChange,
  triggerRef,
}: ChatPanelProps) {
  const [entries, setEntries] = useState<PanelEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [settling, setSettling] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    PresentonChatConversation[]
  >([]);
  const [listError, setListError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedRef = useRef(true);
  /* The live selection and the latest history request token: both must agree
     with a response before it may replace the thread (stale-response guard). */
  const conversationIdRef = useRef<string | null>(null);
  const historyTokenRef = useRef(0);
  /* The token that currently owns the loading state; a discarded response
     releases it only when it is that owner. */
  const historyLoadingOwnerRef = useRef<number | null>(null);
  /* A synchronous stream-active flag: a late history response must never wipe
     a just-started turn's messages. */
  const sendingRef = useRef(false);

  const applyConversationId = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setConversationId(id);
  }, []);

  const updateEntry = useCallback(
    (entryId: string, updater: (entry: PanelEntry) => PanelEntry) => {
      setEntries((prev) =>
        prev.map((entry) => (entry.id === entryId ? updater(entry) : entry)),
      );
    },
    [],
  );

  const refreshConversations = useCallback(async () => {
    let result: Awaited<ReturnType<typeof listChatConversationsAction>>;
    try {
      result = await listChatConversationsAction({ presentationId });
    } catch {
      result = { error: CONVERSATIONS_ERROR, conversations: [] };
    }
    if (result.error !== null) {
      setListError(result.error);
      return;
    }
    setListError(null);
    setConversations(result.conversations);
  }, [presentationId]);

  useEffect(() => {
    if (!open) return;
    /* Both the first load and the focus run from a frame callback rather than
       synchronously in the effect body (the launcher's restore pattern): the
       list has to be fetched when the panel opens, and the input should hold
       focus once it has painted. */
    const frame = window.requestAnimationFrame(() => {
      void refreshConversations();
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, refreshConversations]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onOpenChange(false);
      window.requestAnimationFrame(() => triggerRef?.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open, triggerRef]);

  useEffect(() => {
    const node = listRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [entries]);

  /* A panel holding a live stream unmounts on close; abort it cleanly. */
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectConversation = useCallback(
    async (value: string) => {
      const token = historyTokenRef.current + 1;
      historyTokenRef.current = token;
      setHistoryError(null);
      applyConversationId(value === "" ? null : value);
      if (value === "") {
        historyLoadingOwnerRef.current = null;
        setHistoryLoading(false);
        setEntries([]);
        return;
      }
      historyLoadingOwnerRef.current = token;
      setHistoryLoading(true);
      let result: Awaited<ReturnType<typeof getChatMessagesAction>>;
      try {
        result = await getChatMessagesAction({
          presentationId,
          conversationId: value,
        });
      } catch {
        result = { error: HISTORY_ERROR, messages: [] };
      }
      if (!mountedRef.current) return;
      /* A slow response for A must never render under B (nor wipe an active
         turn): the request token, the live selection and the stream state all
         have to agree. */
      if (
        !chatHistoryResponseApplies({
          responseToken: token,
          latestToken: historyTokenRef.current,
          requestedConversationId: value,
          currentConversationId: conversationIdRef.current,
          streamActive: sendingRef.current,
        })
      ) {
        /* The `complete`-bumped token case owns the loading state and nobody
           else will clear it — release it here or the panel wedges. */
        if (
          chatHistoryDiscardReleasesLoading({
            responseToken: token,
            loadingToken: historyLoadingOwnerRef.current,
          })
        ) {
          historyLoadingOwnerRef.current = null;
          setHistoryLoading(false);
        }
        return;
      }
      historyLoadingOwnerRef.current = null;
      setHistoryLoading(false);
      if (result.error !== null) {
        setHistoryError(result.error);
        setEntries([]);
        return;
      }
      setEntries(
        result.messages.map((message) => ({
          ...createChatEntry(message.role === "user" ? "user" : "assistant"),
          id: crypto.randomUUID(),
          text: message.content,
          complete: true,
          review: null,
        })),
      );
    },
    [applyConversationId, presentationId],
  );

  const handleFrame = useCallback(
    (entryId: string, frame: ChatFrame) => {
      updateEntry(entryId, (entry) => ({
        ...applyChatFrame(entry, frame),
        id: entry.id,
        review: entry.review,
      }));
    },
    [updateEntry],
  );

  /** Installs the stored deck after a settled mutating turn + shows the review. */
  const settleFromDeck = useCallback(
    async (before: ChatDeckSnapshot, assistantId: string) => {
      updateEntry(assistantId, (entry) => ({
        ...entry,
        status: "Deck updated — re-reading the stored deck…",
      }));
      const reload = await reloadDeck(before);
      if (reload.error !== null || reload.snapshot === null) {
        updateEntry(assistantId, (entry) => ({
          ...entry,
          status: null,
          error: reload.error ?? DECK_RELOAD_ERROR,
        }));
        return;
      }
      const diff = classifyChatDeckDiff(before, reload.snapshot);
      updateEntry(assistantId, (entry) => ({
        ...entry,
        status: null,
        review: {
          before,
          diff,
          restored: false,
          kept: false,
          restoring: false,
          error: null,
        },
      }));
    },
    [reloadDeck, updateEntry],
  );

  /**
   * The engine may commit a deck edit *after* Stop or a dropped connection
   * (the route drains its turn — see the route's upstream-workaround note).
   * Probe the stored deck until two consecutive reads agree, then hand the
   * stable deck to the guarded reload; if it never stabilizes in the window,
   * say so honestly instead of leaving the editor aimed at stale slide ids.
   */
  const watchSettle = useCallback(
    async (before: ChatDeckSnapshot, assistantId: string) => {
      setSettling(true);
      onSettlingChange(true);
      updateEntry(assistantId, (entry) => ({
        ...entry,
        status: "The assistant may still be applying changes…",
      }));

      try {
        let previous: string | null = null;
        let stable = false;
        for (let probe = 0; probe < SETTLE_MAX_PROBES && !stable; probe += 1) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, SETTLE_PROBE_MS),
          );
          const result = await probeDeck();
          if (result.error !== null || result.deck === null) continue;
          const signature = JSON.stringify({
            title: result.deck.title,
            theme: result.deck.theme,
            slides: result.deck.slides,
          });
          stable = previous !== null && previous === signature;
          previous = signature;
        }

        setSettling(false);
        if (!stable) {
          updateEntry(assistantId, (entry) => ({
            ...entry,
            status: null,
            error: SETTLE_UNRESOLVED_ERROR,
          }));
          return;
        }
        await settleFromDeck(before, assistantId);
      } finally {
        /* Runs even when the panel unmounted mid-watch: the editor must never
           stay paused because the notifier went away. */
        onSettlingChange(false);
      }
    },
    [onSettlingChange, probeDeck, settleFromDeck, updateEntry],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (text === "" || sending || settling || savePending || historyLoading) {
      return;
    }

    const before = captureDeck();
    const assistantId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      {
        ...createChatEntry("user"),
        id: crypto.randomUUID(),
        text,
        review: null,
      },
      {
        ...createChatEntry("assistant"),
        id: assistantId,
        review: null,
      },
    ]);
    setInput("");
    setSending(true);
    sendingRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let completed = false;
    let errored = false;
    /* A mutating tool can commit without ever producing a `complete` frame:
       the engine may fail after a tool round, or the user may Stop while the
       route's drain lets the engine finish. The trace's `start` status is the
       earliest honest proof, so the panel re-reads from it too. */
    let mutated = false;

    const consume = (buffer: string): string => {
      const { events, rest } = parseSseBlocks(buffer);
      for (const event of events) {
        const frame = normalizeChatSseEvent(event);
        if (frame === null) continue;
        handleFrame(assistantId, frame);
        if (frame.type === "trace" && chatTraceMutatesDeck(frame.trace)) {
          mutated = true;
        }
        if (frame.type === "error") {
          errored = true;
        }
        if (frame.type === "complete") {
          completed = true;
          if (frame.conversationId !== null) {
            historyTokenRef.current += 1;
            applyConversationId(frame.conversationId);
          }
          if (chatTurnMayChangeDeck(frame.toolCalls)) mutated = true;
          void refreshConversations();
        }
      }
      return rest;
    };

    type ChatTerminal =
      | "complete"
      | "error"
      | "interrupted"
      | "aborted"
      | "transport";
    let terminal: ChatTerminal = "transport";

    try {
      const response = await fetch(
        `/api/presentation/${presentationId}/chat`,
        {
          method: "POST",
          /* Deliberately no JSON content-type: a string body defaults to the
             CORS-safelisted `text/plain`, so the request never preflights —
             the route parses it with `request.json()` either way. */
          body: JSON.stringify({ message: text, conversationId }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        let copy = CHAT_ERROR_COPY;
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body.error === "string" && body.error !== "") {
            copy = body.error;
          }
        } catch {
          // Keep the sanitized default.
        }
        updateEntry(assistantId, (entry) => ({ ...entry, error: copy }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateEntry(assistantId, (entry) => ({
          ...entry,
          error: CHAT_ERROR_COPY,
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = consume(buffer);
      }
      if (buffer.trim() !== "") consume(`${buffer}\n\n`);
      terminal = completed ? "complete" : errored ? "error" : "interrupted";
    } catch {
      terminal = controller.signal.aborted ? "aborted" : "transport";
      updateEntry(assistantId, (entry) =>
        terminal === "aborted"
          ? { ...entry, stopped: true }
          : { ...entry, error: CONNECTION_ERROR },
      );
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
      setSending(false);
    }

    if (!mutated) {
      if (terminal === "interrupted") {
        updateEntry(assistantId, (entry) => ({ ...entry, interrupted: true }));
      }
      return;
    }
    if (terminal === "aborted" || terminal === "transport") {
      await watchSettle(before, assistantId);
      return;
    }
    await settleFromDeck(before, assistantId);
    if (terminal === "interrupted") {
      updateEntry(assistantId, (entry) => ({ ...entry, interrupted: true }));
    }
  }, [
    applyConversationId,
    captureDeck,
    conversationId,
    handleFrame,
    historyLoading,
    input,
    presentationId,
    refreshConversations,
    savePending,
    sending,
    settleFromDeck,
    settling,
    updateEntry,
    watchSettle,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const keepReview = useCallback(
    (entryId: string) => {
      updateEntry(entryId, (entry) =>
        entry.review === null
          ? entry
          : { ...entry, review: { ...entry.review, kept: true } },
      );
    },
    [updateEntry],
  );

  const restoreReview = useCallback(
    async (entryId: string) => {
      const entry = entries.find((candidate) => candidate.id === entryId);
      const review = entry?.review;
      if (
        review === undefined ||
        review === null ||
        !review.diff.representable ||
        review.diff.changes.length === 0
      ) {
        return;
      }
      const changedIds = new Set(review.diff.changes.map((c) => c.slideId));
      const originals = review.before.slides.filter((slide) =>
        changedIds.has(slide.id),
      );
      if (originals.length === 0) return;

      updateEntry(entryId, (current) =>
        current.review === null
          ? current
          : {
              ...current,
              review: { ...current.review, restoring: true, error: null },
            },
      );
      let error: string | null;
      try {
        error = await restoreSlides(originals);
      } catch {
        error = RESTORE_ERROR;
      }
      updateEntry(entryId, (current) =>
        current.review === null
          ? current
          : {
              ...current,
              review: {
                ...current.review,
                restoring: false,
                restored: error === null,
                error,
              },
            },
      );
    },
    [entries, restoreSlides, updateEntry],
  );

  const conversationOptions = [
    { value: "", label: "New conversation" },
    ...conversations.map((conversation) => ({
      value: conversation.conversationId,
      label: conversationLabel(conversation),
    })),
  ];

  const disabledReason = historyLoading
    ? "Loading the conversation…"
    : settling
      ? "The assistant may still be applying changes — the editor will re-read the deck in a moment."
      : savePending
        ? "The editor is saving your latest change — the assistant can edit once it's stored."
        : null;

  return (
    <MotionPopover
      open={open}
      portal
      direction="down"
      origin="top right"
      id="editor-chat-panel"
      role="complementary"
      aria-label="Deck assistant"
      data-chat-panel=""
      data-chat-conversation={conversationId ?? undefined}
      className="fixed right-3 top-3 bottom-3 z-50 flex w-[min(calc(100vw-1.5rem),25rem)] flex-col gap-2 overflow-hidden rounded-card border border-border bg-glass shadow-overlay backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2 p-3 pb-0">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquareText
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <p className="truncate font-heading text-body-md font-medium text-foreground">
            Deck assistant
          </p>
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Close the deck assistant"
          data-chat-close=""
          onClick={() => {
            onOpenChange(false);
            window.requestAnimationFrame(() => triggerRef?.current?.focus());
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      <div className="flex flex-col gap-1 px-3">
        <Select
          size="sm"
          aria-label="Conversation"
          value={conversationId ?? ""}
          options={conversationOptions}
          disabled={sending || historyLoading || settling}
          onChange={(value) => void selectConversation(value)}
        />
        {listError !== null ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-label-sm text-destructive">{listError}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-chat-retry=""
              onClick={() => void refreshConversations()}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </div>

      <div
        ref={listRef}
        data-chat-messages=""
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3"
      >
        {historyLoading ? (
          <p className="text-label-sm text-muted-foreground">
            Loading conversation…
          </p>
        ) : null}
        {historyError !== null ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {historyError}
          </MotionNotice>
        ) : null}
        {entries.length === 0 && !historyLoading && historyError === null ? (
          <p className="text-label-sm text-muted-foreground">{EXAMPLE_PROMPT}</p>
        ) : null}

        <ul className="flex list-none flex-col gap-2">
          {entries.map((entry) => {
            const streaming =
              entry.role === "assistant" &&
              sending &&
              !entry.complete &&
              entry.error === null;
            return (
              <li
                key={entry.id}
                data-chat-message={entry.role}
                data-chat-complete={entry.complete ? "" : undefined}
                className={
                  entry.role === "user"
                    ? "ml-6 self-end rounded-card border border-border bg-muted px-3 py-2"
                    : "mr-6 self-start rounded-card border border-border bg-card px-3 py-2"
                }
              >
                {entry.text !== "" ? (
                  <p className="whitespace-pre-wrap break-words text-body-md text-foreground">
                    {entry.text}
                  </p>
                ) : null}
                {entry.traces.length > 0 ? (
                  <ul className="mt-1 flex list-none flex-col gap-0.5">
                    {entry.traces.map((trace, index) => (
                      <li
                        key={`${entry.id}-trace-${index}`}
                        className="font-mono text-label-sm text-muted-foreground"
                      >
                        {trace.message ??
                          (trace.tool !== null
                            ? `${trace.tool} (${trace.status ?? "running"})`
                            : trace.kind)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {streaming && entry.status !== null ? (
                  <p
                    data-chat-status=""
                    className="mt-1 text-label-sm text-muted-foreground"
                  >
                    {entry.status}…
                  </p>
                ) : null}
                {streaming && entry.text === "" && entry.traces.length === 0 ? (
                  <p className="text-label-sm text-muted-foreground">
                    Thinking…
                  </p>
                ) : null}
                {entry.error !== null ? (
                  <MotionNotice
                    role="alert"
                    data-chat-error=""
                    className="mt-1 text-label-sm text-destructive"
                  >
                    {entry.error}
                  </MotionNotice>
                ) : null}
                {entry.stopped ? (
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    {entry.text === ""
                      ? "Stopped before a reply arrived."
                      : "Stopped. The reply above is what had arrived."}
                  </p>
                ) : null}
                {entry.interrupted ? (
                  <p className="mt-1 text-label-sm text-muted-foreground">
                    The reply ended before completing.
                  </p>
                ) : null}

                {entry.review !== null ? (
                  <div
                    data-chat-review=""
                    className="mt-2 rounded-nested border border-border bg-muted/60 p-2"
                  >
                    {entry.review.diff.representable ? (
                      entry.review.diff.changes.length === 0 ? (
                        <p className="text-label-sm text-muted-foreground">
                          No slide changes were stored by this turn.
                        </p>
                      ) : (
                        <>
                          <p className="text-label-sm text-foreground">
                            Changes applied to {entry.review.diff.changes.length}{" "}
                            slide
                            {entry.review.diff.changes.length === 1 ? "" : "s"}:
                          </p>
                          <ul className="mt-1 flex list-none flex-col gap-1">
                            {entry.review.diff.changes.map((change) => (
                              <li
                                key={change.slideId}
                                className="text-label-sm text-muted-foreground"
                              >
                                <span className="font-mono">
                                  Slide {change.slideNumber}
                                </span>
                                {": "}
                                {change.beforeText !== ""
                                  ? change.beforeText
                                  : "(no text)"}
                                {" → "}
                                {change.afterText !== ""
                                  ? change.afterText
                                  : "(no text)"}
                              </li>
                            ))}
                          </ul>
                        </>
                      )
                    ) : (
                      <p className="text-label-sm text-muted-foreground">
                        Changes applied to the stored deck —{" "}
                        {reasonCopy(entry.review.diff.reason)}. This change
                        can&rsquo;t be reviewed slide by slide here; use Undo in
                        the editor if you want it reverted.
                      </p>
                    )}

                    {entry.review.diff.representable &&
                    entry.review.diff.changes.length > 0 &&
                    !entry.review.restored &&
                    !entry.review.kept ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-chat-review-restore=""
                          disabled={entry.review.restoring}
                          onClick={() => void restoreReview(entry.id)}
                        >
                          <RotateCcw aria-hidden="true" className="size-3.5" />
                          {entry.review.restoring
                            ? "Restoring…"
                            : "Restore original"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-chat-review-keep=""
                          disabled={entry.review.restoring}
                          onClick={() => keepReview(entry.id)}
                        >
                          Keep changes
                        </Button>
                      </div>
                    ) : null}
                    {entry.review.restored ? (
                      <p className="mt-1 text-label-sm text-muted-foreground">
                        Original slides restored.
                      </p>
                    ) : null}
                    {entry.review.kept ? (
                      <p className="mt-1 text-label-sm text-muted-foreground">
                        Changes kept.
                      </p>
                    ) : null}
                    {entry.review.error !== null ? (
                      <MotionNotice
                        role="alert"
                        className="mt-1 text-label-sm text-destructive"
                      >
                        {entry.review.error}
                      </MotionNotice>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-1 border-t border-border p-3">
        {disabledReason !== null ? (
          <p
            data-chat-disabled-reason=""
            className="text-label-sm text-muted-foreground"
          >
            {disabledReason}
          </p>
        ) : null}
        {settling ? (
          <p
            data-chat-settling=""
            className="text-label-sm text-muted-foreground"
          >
            The assistant may still be applying changes. The editor will re-read
            the stored deck before editing resumes.
          </p>
        ) : null}
        <Textarea
          ref={inputRef}
          rows={2}
          data-chat-input=""
          aria-label="Message the deck assistant"
          placeholder="Ask the assistant to change this deck…"
          value={input}
          disabled={sending || savePending || settling || historyLoading}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-label-sm text-muted-foreground">
            Mod+Enter sends · Stop cancels
          </p>
          {sending ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-chat-stop=""
              onClick={stop}
            >
              <Square aria-hidden="true" className="size-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              data-chat-send=""
              disabled={
                input.trim() === "" || savePending || settling || historyLoading
              }
              onClick={() => void send()}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
              Send
            </Button>
          )}
        </div>
      </div>
    </MotionPopover>
  );
}
