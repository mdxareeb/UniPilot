"use client";

import { MotionReveal } from "@/components/motion/MotionReveal";
import type {
  AssistantActionItem,
  AssistantActionMutationResult,
  MessageItem,
} from "@/lib/data/assistantValues";
import { AssistantBubble, MessageBubble, UserBubble } from "./MessageBubble";
import type { LocalTurn } from "./useAssistantTurn";

/**
 * Tasks 19.3/19.4/19.5/19.10 — a conversation's turns, in order. Shared by the
 * `/assistant` page (stored rows + the live turn) and the 19.16 launcher panel
 * (the live turn alone, with `messages` empty).
 *
 * The stored order is `listMessages`' contract (`created_at`, then `id`) and is
 * deliberately not re-sorted here.
 *
 * C3 appends the tab's live turn (`19.10`) after the stored rows: the
 * optimistic user bubble then the streaming assistant bubble, both marked
 * `data-message-local` and both using the same bubble chrome as stored rows.
 * The list is `aria-busy` while the assistant entry is still streaming. On the
 * route the live turn disappears when the stored rows catch up (the workspace
 * hook retires it), so it can never double-render a persisted message; in the
 * launcher panel there is no stored read, so the live turn stays as the
 * panel's rendering of that exchange until the next send replaces it.
 *
 * Motion: each row is one `MotionReveal as="li"` — a mount-time reveal on the
 * shared vocabulary, and the `data-reveal` the app layout's `<noscript>` rule
 * un-hides when scripts never run. The single-observer `MotionRevealGroup`
 * this list used in C2 is deliberately NOT used here: a child that mounts
 * after the group has already revealed inherits the hidden initial variant and
 * never animates (verified live — the stored rows stayed at `opacity: 0`
 * after a streaming turn), which would make a persisted conversation
 * invisible after every send. Per-row reveals observe themselves, so an
 * appended row animates in exactly like an initial one; the stagger is
 * sacrificed because a delay based on the row's position would grow without
 * bound as the conversation grows. Rows only ever append, so there is no
 * `AnimatePresence` exit either: the pending-to-stored handoff must be
 * instant, and an exit animation there would briefly double-render the same
 * text.
 *
 * T27-C: the stored proposals render inside the assistant bubble whose id
 * they name (`action.messageId`); the launcher panel passes its live turn's
 * registered proposals as `pendingActions`, which render inside the live
 * bubble. An action that names no message here is simply not rendered on this
 * surface — never guessed onto a bubble.
 */
export function MessageList({
  messages,
  pending = null,
  actions = [],
  pendingActions = [],
  onActionSettled,
}: {
  /** The stored rows, in service order. */
  messages: MessageItem[];
  /** The live turn this tab is receiving, or null. */
  pending?: LocalTurn | null;
  /**
   * The conversation's stored proposals (T27-C). Each stored assistant message
   * renders the cards whose `messageId` is its own; the list is printed in the
   * service's order.
   */
  actions?: AssistantActionItem[];
  /** The live turn's registered proposals (the launcher panel's local state). */
  pendingActions?: AssistantActionItem[];
  /** Called after a card's confirm/reject call returns. */
  onActionSettled?: (result: AssistantActionMutationResult) => void;
}) {
  const streaming = pending !== null && pending.entry.status === "streaming";

  return (
    <ul
      data-message-list=""
      aria-label="Messages"
      aria-busy={streaming ? "true" : undefined}
      className="flex list-none flex-col gap-3"
    >
      {messages.map((message) => (
        <MotionReveal as="li" key={message.id} className="min-w-0">
          <MessageBubble
            message={message}
            actions={
              message.role === "assistant"
                ? actions.filter((action) => action.messageId === message.id)
                : []
            }
            onActionSettled={onActionSettled}
          />
        </MotionReveal>
      ))}
      {pending !== null ? (
        <>
          <MotionReveal as="li" key="pending-user" className="min-w-0">
            <UserBubble content={pending.userText} local />
          </MotionReveal>
          <MotionReveal as="li" key="pending-assistant" className="min-w-0">
            <AssistantBubble
              content={pending.entry.content}
              status={pending.entry.status}
              sources={pending.entry.sources}
              failureCopy={pending.failureCopy}
              actions={pendingActions}
              onActionSettled={onActionSettled}
              local
            />
          </MotionReveal>
        </>
      ) : null}
    </ul>
  );
}
