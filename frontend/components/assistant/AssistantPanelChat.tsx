"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MessageList } from "./MessageList";
import type { LocalTurn } from "./useAssistantTurn";

type AssistantPanelChatProps = {
  /** The live turn this tab sent from the panel, or null before the first send. */
  turn: LocalTurn | null;
  /**
   * The conversation the next send targets. Held by `AssistantLauncher` in
   * component state from the `start` frame, so a follow-up send continues the
   * same conversation instead of starting a new one each time.
   */
  conversationId: string | null;
  /** Closes the panel when the caller follows the full-conversation link. */
  onNavigate: () => void;
};

/**
 * Task 19.16 — the launcher panel's compact chat, the same architecture as
 * `/assistant`.
 *
 * The panel renders the shared pieces and nothing of its own: the turn hook
 * (`useAssistantTurn`, called by `AssistantLauncher` so its state survives the
 * panel's close), the shared `MessageList` (user/assistant bubbles with
 * `19.6`'s avatar and `19.11`'s source references), and the same honest
 * states — the streaming status and every terminal status are copied
 * verbatim, so an `unconfigured` turn never reads as an answer and a
 * sanitized failure copy is the only failure text. No second chat system
 * exists here. The shared `AssistantComposer` is composed by
 * `AssistantLauncher` as the panel's pinned bottom child, so this component
 * is purely the exchange (and its placeholder) inside the panel's flexible
 * scroll region.
 *
 * Before the first send the panel shows a short placeholder rather than an
 * invented transcript. Once the `start` frame has named a conversation, the
 * panel offers "Open in Assistant" → `/assistant?c=<id>` and says so
 * visibly ("Showing the latest exchange…"): the compact surface carries one
 * exchange (the hook's one-turn contract), and the stored, complete
 * conversation — every follow-up included — lives on the page. No second
 * history store exists here. `prefetch` stays off for the same reason the
 * starter links disable it: the gated route's prefetch would run a session
 * read on every page view.
 */
export function AssistantPanelChat({
  turn,
  conversationId,
  onNavigate,
}: AssistantPanelChatProps) {
  return (
    <div
      data-assistant-panel-chat=""
      className={`flex min-h-0 flex-col gap-3 ${
        /* Idle: the placeholder is an intrinsically sized hint, so the panel's
           idle region above it absorbs the shrink on a short viewport. Active:
           the exchange is the panel's flexible, scrollable middle — a long
           answer must never push the pinned composer out of the panel. */
        turn === null ? "shrink-0" : "flex-1"
      }`}
    >
      {turn !== null ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <MessageList messages={[]} pending={turn} />
        </div>
      ) : (
        <p
          data-assistant-panel-empty=""
          className="text-label-sm text-muted-foreground"
        >
          Ask below to start a conversation here. The full conversation stays
          on the Assistant page.
        </p>
      )}

      {conversationId !== null ? (
        /* The honest cue: the compact panel renders the latest exchange (the
           hook's committed one-turn contract), and the full stored
           conversation is one click away. No second history store exists. */
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-label-sm text-muted-foreground">
            Showing the latest exchange. The full conversation is on the
            Assistant page.
          </p>
          <Link
            href={`/assistant?c=${encodeURIComponent(conversationId)}`}
            prefetch={false}
            onClick={onNavigate}
            data-assistant-open=""
            className="inline-flex shrink-0 items-center gap-1 rounded-pill font-heading text-label-sm text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Open in Assistant
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
