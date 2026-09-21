import { Badge } from "@/components/ui/Badge";
import type { MessageItem } from "@/lib/data/assistantValues";
import { AssistantAvatar } from "./AssistantAvatar";

/**
 * Tasks 19.4 (user bubble) and 19.5 (AI bubble) — one stored message.
 *
 * Role-aligned: the caller's own turns sit at the trailing edge on `bg-muted`,
 * the assistant's turns at the leading edge with 19.6's avatar and a
 * `bg-glass-subtle` surface — the bubble is nested inside the page's glass
 * panel, so it takes the one-step-up fill rather than a second glass layer.
 * `system` rows, the one other role the 26.4 contract stores, belong to
 * neither party and render as a centred mono note.
 *
 * The stored contract is the only source of text: `content` is printed exactly
 * as persisted (whitespace preserved), and a `failed` status is labelled
 * "Failed" instead of letting the sanitized failure copy read as an answer.
 * Labels and timestamps are mono (`font-mono`), the workspace's metadata role.
 */
export function MessageBubble({ message }: { message: MessageItem }) {
  if (message.role === "system") {
    return (
      <div
        data-message-role="system"
        data-message-id={message.id}
        data-message-status={message.status}
        className="flex min-w-0 justify-center"
      >
        <p className="max-w-[80%] rounded-pill border border-border bg-glass-subtle px-3 py-1.5 text-center font-mono text-label-sm text-muted-foreground">
          {message.content}
        </p>
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <article
      data-message-role={message.role}
      data-message-id={message.id}
      data-message-status={message.status}
      className={`flex min-w-0 items-start gap-2.5 ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      {isUser ? null : <AssistantAvatar />}
      <div
        className={`flex min-w-0 max-w-[min(42rem,85%)] flex-col gap-1.5 rounded-card border border-border px-3.5 py-3 ${
          isUser ? "bg-muted" : "bg-glass-subtle"
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-message-role-label=""
            className="font-mono text-label-caps uppercase text-muted-foreground"
          >
            {isUser ? "You" : "Assistant"}
          </span>
          {message.status === "failed" ? (
            <Badge variant="outline" size="sm" className="text-destructive">
              Failed
            </Badge>
          ) : null}
        </div>
        <p
          data-message-content=""
          className="whitespace-pre-wrap break-words text-body-md text-foreground"
        >
          {message.content}
        </p>
        <p
          data-message-timestamp=""
          className="font-mono text-label-sm text-muted-foreground"
        >
          {message.createdLabel}
        </p>
      </div>
    </article>
  );
}
