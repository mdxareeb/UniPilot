"use client";

import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import type { MessageItem } from "@/lib/data/assistantValues";
import { MessageBubble } from "./MessageBubble";

/**
 * Tasks 19.3/19.4/19.5 — a conversation's stored turns, in order.
 *
 * The list is one `MotionRevealGroup` (`ul`) whose messages are
 * `MotionRevealItem`s (`li`), so a conversation arrives as one composition on
 * the shared stagger instead of N independent fades; the group starts hidden
 * and reveals when it enters the viewport, and the app layout's `<noscript>`
 * rule un-hides it when scripts never run. Nothing here animates existence:
 * every stored message is rendered structurally and stays in the DOM.
 *
 * The stored order is `listMessages`' contract (`created_at`, then `id`) and is
 * deliberately not re-sorted here.
 */
export function MessageList({ messages }: { messages: MessageItem[] }) {
  return (
    <MotionRevealGroup
      as="ul"
      data-message-list=""
      aria-label="Messages"
      className="flex list-none flex-col gap-3"
    >
      {messages.map((message) => (
        <MotionRevealItem as="li" key={message.id} className="min-w-0">
          <MessageBubble message={message} />
        </MotionRevealItem>
      ))}
    </MotionRevealGroup>
  );
}
