import { Badge } from "@/components/ui/Badge";
import type {
  AssistantActionItem,
  AssistantActionMutationResult,
  AssistantSource,
  MessageItem,
} from "@/lib/data/assistantValues";
import { AssistantActionCard } from "./AssistantActionCard";
import { AssistantAvatar } from "./AssistantAvatar";
import { SourceReferences } from "./SourceReferences";

/**
 * Tasks 19.4 (user bubble), 19.5 (AI bubble) and 19.11 (source references) —
 * one message, stored or still being received. Shared by the `/assistant`
 * conversation and the 19.16 launcher panel, so both surfaces render the exact
 * same chrome.
 *
 * Role-aligned: the caller's own turns sit at the trailing edge on `bg-muted`,
 * the assistant's turns at the leading edge with 19.6's avatar and a
 * `bg-glass-subtle` surface — the bubble is nested inside a glass panel, so it
 * takes the one-step-up fill rather than a second glass layer. `system` rows,
 * the one other role the 26.4 contract stores, belong to neither party and
 * render as a centred mono note.
 *
 * The stored contract is the only source of text: `content` is printed exactly
 * as persisted (whitespace preserved), and a `failed` status is labelled
 * "Failed" instead of letting the sanitized failure copy read as an answer.
 * Labels and timestamps are mono (`font-mono`), the workspace's metadata role.
 *
 * C3 splits the render into `UserBubble` and `AssistantBubble` so the live
 * streaming turn (19.10) can use the exact chrome the stored rows use, without
 * pretending to be a stored row:
 * - `local` marks the not-yet-stored optimistic turn (19.10). It adds
 *   `data-message-local` and drops the timestamp, which would be invented:
 *   nothing has recorded a time for a message the server has not written yet;
 * - the assistant bubble's `status` is the stored `complete|failed` for a row,
 *   or the live entry's `streaming|unconfigured|complete|failed`. It is always
 *   copied verbatim — `unconfigured` is never folded into `failed`;
 * - `failureCopy` is a sanitized failure/error message (an `error` frame's copy
 *   or the transport fallback), shown as failure text when no answer text
 *   arrived, never as an answer;
 * - sources (19.11) render through the shared `SourceReferences` for both
 *   halves.
 *
 * T27-C adds the confirmation cards: an assistant bubble renders the
 * `AssistantActionCard`s for the proposals that name it (`messageId`), after
 * the source references. Stored rows get theirs from the page's action read;
 * the launcher panel's live turn gets the ones its registration returned.
 */
export function MessageBubble({
  message,
  actions = [],
  onActionSettled,
}: {
  message: MessageItem;
  /** The confirmation cards to render inside this bubble, in order. */
  actions?: AssistantActionItem[];
  onActionSettled?: (result: AssistantActionMutationResult) => void;
}) {
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

  if (message.role === "user") {
    return (
      <UserBubble
        content={message.content}
        timestampLabel={message.createdLabel}
        messageId={message.id}
        status={message.status}
      />
    );
  }

  return (
    <AssistantBubble
      content={message.content}
      status={message.status}
      sources={message.sources}
      timestampLabel={message.createdLabel}
      messageId={message.id}
      actions={actions}
      onActionSettled={onActionSettled}
    />
  );
}

/** The statuses a bubble can announce: the stored pair plus the live turn's. */
export type BubbleStatus =
  | "streaming"
  | "complete"
  | "failed"
  | "unconfigured";

type UserBubbleProps = {
  content: string;
  /** Stored rows carry their formatted timestamp; the local turn does not. */
  timestampLabel?: string | null;
  /** Stored row id; omitted for the local turn. */
  messageId?: string | null;
  /** Stored status; omitted for the local turn (nothing is stored yet). */
  status?: "complete" | "failed" | null;
  /** True for the not-yet-stored optimistic turn (19.10). */
  local?: boolean;
};

/** The caller's own turn, trailing-aligned. */
export function UserBubble({
  content,
  timestampLabel = null,
  messageId = null,
  status = null,
  local = false,
}: UserBubbleProps) {
  return (
    <article
      data-message-role="user"
      {...(messageId !== null ? { "data-message-id": messageId } : {})}
      {...(status !== null ? { "data-message-status": status } : {})}
      {...(local ? { "data-message-local": "" } : {})}
      className="flex min-w-0 items-start justify-end gap-2.5"
    >
      <div className="flex min-w-0 max-w-[min(42rem,85%)] flex-col gap-1.5 rounded-card border border-border bg-muted px-3.5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-message-role-label=""
            className="font-mono text-label-caps uppercase text-muted-foreground"
          >
            You
          </span>
        </div>
        <p
          data-message-content=""
          className="whitespace-pre-wrap break-words text-body-md text-foreground"
        >
          {content}
        </p>
        {timestampLabel !== null ? (
          <p
            data-message-timestamp=""
            className="font-mono text-label-sm text-muted-foreground"
          >
            {timestampLabel}
          </p>
        ) : null}
      </div>
    </article>
  );
}

type AssistantBubbleProps = {
  /** Only what the stream/persisted row delivered; never fabricated. */
  content: string;
  status: BubbleStatus;
  /** Cited chunks; an empty/absent list renders no sources chrome. */
  sources?: AssistantSource[];
  /**
   * The sanitized failure/error copy. Shown as a failure line when an error
   * frame arrived, or when a failed turn delivered no text at all; never
   * dressed as an answer.
   */
  failureCopy?: string | null;
  /** Stored rows carry their formatted timestamp; the local turn does not. */
  timestampLabel?: string | null;
  /** Stored row id; omitted for the local turn. */
  messageId?: string | null;
  /** True for the not-yet-stored streaming turn (19.10). */
  local?: boolean;
  /** The confirmation cards for this message's proposals, in order. */
  actions?: AssistantActionItem[];
  /** Called after a card's confirm/reject call returns. */
  onActionSettled?: (result: AssistantActionMutationResult) => void;
};

/** The assistant's turn, leading-aligned with 19.6's avatar. */
export function AssistantBubble({
  content,
  status,
  sources,
  failureCopy = null,
  timestampLabel = null,
  messageId = null,
  local = false,
  actions = [],
  onActionSettled,
}: AssistantBubbleProps) {
  const showFailure = failureCopy !== null && failureCopy !== content;

  return (
    <article
      data-message-role="assistant"
      data-message-status={status}
      {...(messageId !== null ? { "data-message-id": messageId } : {})}
      {...(local ? { "data-message-local": "" } : {})}
      aria-busy={status === "streaming" ? "true" : undefined}
      className="flex min-w-0 items-start justify-start gap-2.5"
    >
      <AssistantAvatar />
      <div className="flex min-w-0 max-w-[min(42rem,85%)] flex-col gap-1.5 rounded-card border border-border bg-glass-subtle px-3.5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-message-role-label=""
            className="font-mono text-label-caps uppercase text-muted-foreground"
          >
            Assistant
          </span>
          {status === "streaming" ? (
            <span
              data-message-streaming=""
              className="font-mono text-label-sm text-muted-foreground"
            >
              Streaming…
            </span>
          ) : null}
          {status === "failed" ? (
            <Badge variant="outline" size="sm" className="text-destructive">
              Failed
            </Badge>
          ) : null}
        </div>
        {content !== "" ? (
          <p
            data-message-content=""
            className="whitespace-pre-wrap break-words text-body-md text-foreground"
          >
            {content}
          </p>
        ) : null}
        {showFailure ? (
          <p
            data-assistant-failure=""
            className={`whitespace-pre-wrap break-words text-body-md ${
              content === "" ? "text-foreground" : "text-destructive"
            }`}
          >
            {failureCopy}
          </p>
        ) : null}
        <SourceReferences sources={sources} />
        {actions.length > 0 ? (
          <ul
            data-assistant-actions=""
            className="flex min-w-0 list-none flex-col gap-2"
          >
            {actions.map((action) => (
              <li key={action.id} className="min-w-0">
                <AssistantActionCard
                  action={action}
                  onSettled={onActionSettled}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {timestampLabel !== null ? (
          <p
            data-message-timestamp=""
            className="font-mono text-label-sm text-muted-foreground"
          >
            {timestampLabel}
          </p>
        ) : null}
      </div>
    </article>
  );
}
