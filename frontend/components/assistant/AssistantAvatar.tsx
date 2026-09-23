import { Bot } from "lucide-react";

/**
 * Task 19.6 — the assistant's avatar.
 *
 * One place for the assistant's identity mark: a bordered circle holding the
 * same `Bot` icon the workspace rail uses for `/assistant`, so the mark and the
 * navigation label can never disagree. The page's own chat surface renders it
 * beside every assistant bubble, and the 19.16 launcher panel renders the same
 * component through the shared `AssistantBubble` rather than drawing a second
 * mark.
 *
 * Decorative by construction: `aria-hidden`, because the message's role is
 * already announced by the bubble's own "Assistant" label (and its
 * `data-message-role`), and repeating the icon to a screen reader adds nothing.
 */
export function AssistantAvatar() {
  return (
    <span
      data-assistant-avatar=""
      aria-hidden="true"
      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-glass-subtle text-muted-foreground"
    >
      <Bot className="size-4" />
    </span>
  );
}
