"use client";

import type { ReactNode } from "react";
import {
  MessageSquareText,
  MessagesSquare,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { SignInAction } from "@/components/auth/SignInAction";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { motionIndex } from "@/components/motion/stagger";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import type { MessageItem } from "@/lib/data/assistantValues";
import type { ConversationItem } from "@/lib/data/conversations";
import { AssistantComposer } from "./AssistantComposer";
import { ConversationSidebar } from "./ConversationSidebar";
import { MessageList } from "./MessageList";
import { useAssistantTurn, type LocalTurn } from "./useAssistantTurn";

type AssistantWorkspaceProps = {
  /** The caller's conversations, newest first (the 26.3 service order). */
  conversations: ConversationItem[];
  /** The conversation the main pane shows, or null when none is selected. */
  selected: ConversationItem | null;
  /** The selected conversation's messages, in stored order. */
  messages: MessageItem[];
  /** True when `?c=` named a conversation this account cannot read. */
  selectionUnavailable: boolean;
  /** True for a visitor without a session. */
  guest: boolean;
  /** The 26.1 provider verdict for this environment. */
  configured: boolean;
  /** The honest unconfigured explanation; null when a provider is configured. */
  unconfiguredCopy: string | null;
  /** The server's sanitized failure copy (26.12), used for transport failures. */
  failedCopy: string;
  /** The page header, composed on the server page. */
  children: ReactNode;
};

/**
 * Tasks 19.1–19.12/19.14 (read half) and 19.7–19.11 (C3, write half) — the
 * `/assistant` conversation shell.
 *
 * The server page owns access and the data reads (`listConversations`,
 * `listMessages` for the `?c=` selection) and hands this client boundary the
 * finished, serializable contract. Selection stays URL state
 * (`/assistant?c=<id>`), resolved by the server, so every read continues under
 * RLS and no client cache can disagree with it.
 *
 * Composing (19.7–19.11) lives in `useAssistantTurn` + `AssistantComposer`:
 * a send appends the optimistic turn, streams `POST /api/assistant/turn`
 * through C1's frame vocabulary, then reconciles with the server
 * (`router.refresh()`, plus `router.replace` when `start` created a
 * conversation) so the stored rows are the source of truth. The composer
 * targets the selected conversation, or — with no selection — sends
 * `conversationId: null`, which is how the pipeline creates the first
 * conversation of an account. The explicit "New conversation" control is still
 * 19.2/C4's; C3's first send is what starts one.
 *
 * Where the composer is deliberately absent:
 * - a guest gets the guest empty state and no composer (no data, no send);
 * - `?c=` naming an unavailable conversation gets no composer: a send there
 *   would either drop the conversation the URL names or silently start a
 *   different one behind an error message, and both would be dishonest about
 *   which conversation the caller is writing to.
 *
 * Honesty rules this shell keeps:
 * - the `26.1` provider verdict is reported as-is (`data-assistant-status` plus
 *   the visible unconfigured explanation) — an unconfigured environment never
 *   implies the assistant can answer, and no bubble is ever fabricated here;
 * - a conversation with no stored turns renders "no messages yet", never a
 *   placeholder reply; the live turn only ever shows delivered frames;
 * - `?c=` naming an id the account does not own renders an unavailable state
 *   with no message read, rather than silently switching to another row;
 * - a guest sees the real shell, the sign-in copy and no data read at all.
 *
 * Motion: the sidebar (slot 1, from the left) and the conversation panel
 * (slot 2, with depth) follow the page header's slot 0 on the shared entrance
 * ladder; each message row is a mount-time `MotionReveal` (see `MessageList`
 * for why the single-observer group is not used on a list that grows), and the
 * live turn joins as two more rows on the same vocabulary.
 */
export function AssistantWorkspace({
  conversations,
  selected,
  messages,
  selectionUnavailable,
  guest,
  configured,
  unconfiguredCopy,
  failedCopy,
  children,
}: AssistantWorkspaceProps) {
  const { turn, busy, send } = useAssistantTurn({
    conversationId: selected?.id ?? null,
    failedCopy,
    messages,
  });
  const showComposer = !guest && !selectionUnavailable;

  const statusLine = selected
    ? `Updated ${selected.updatedLabel}`
    : guest
      ? "Sign in to start one"
      : selectionUnavailable
        ? "That conversation isn't available"
        : "No conversation selected";

  return (
    <div
      data-assistant-status={configured ? "configured" : "unconfigured"}
      className="flex min-w-0 flex-col gap-6 md:gap-8"
    >
      {children}

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <ConversationSidebar
          conversations={conversations}
          selectedId={selected?.id ?? null}
          guest={guest}
        />

        <Card
          data-enter="scale"
          style={motionIndex(2)}
          className="flex min-w-0 flex-1 flex-col gap-4 bg-glass p-4 backdrop-blur-md md:p-5"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="min-w-0 truncate font-heading text-body-lg font-semibold text-foreground">
                {selected?.title ?? "Conversation"}
              </h2>
              <p className="font-mono text-label-sm text-muted-foreground">
                {statusLine}
              </p>
            </div>
            <Badge
              variant="outline"
              size="sm"
              className="font-mono uppercase"
              data-assistant-provider=""
            >
              {configured ? "Configured" : "Unconfigured"}
            </Badge>
          </div>

          <Divider />

          {!guest && unconfiguredCopy !== null ? (
            <MotionNotice
              data-assistant-unconfigured=""
              className="rounded-base border border-dashed border-border bg-glass-subtle px-3 py-2.5 text-label-sm text-muted-foreground"
            >
              {unconfiguredCopy}
            </MotionNotice>
          ) : null}

          <div
            data-assistant-conversation=""
            className="min-w-0 lg:max-h-[60vh] lg:overflow-y-auto"
          >
            <ConversationBody
              guest={guest}
              selected={selected}
              messages={messages}
              selectionUnavailable={selectionUnavailable}
              pending={turn}
            />
          </div>

          {showComposer ? (
            <AssistantComposer
              conversationId={selected?.id ?? null}
              busy={busy}
              onSend={(content) => void send(content)}
            />
          ) : null}
        </Card>
      </div>
    </div>
  );
}

type ConversationBodyProps = Pick<
  AssistantWorkspaceProps,
  "guest" | "selected" | "messages" | "selectionUnavailable"
> & {
  /** The live turn this tab is receiving, or null. */
  pending: LocalTurn | null;
};

/**
 * The honest empty state per situation, the stored turns, or the stored turns
 * plus the live one. While a live turn exists it is the only body — an empty
 * conversation is not empty while a message is being written into it — and the
 * empty states return as soon as it is retired.
 */
function ConversationBody({
  guest,
  selected,
  messages,
  selectionUnavailable,
  pending,
}: ConversationBodyProps) {
  if (guest) {
    return (
      <EmptyState
        data-assistant-empty="guest"
        icon={<Sparkles aria-hidden="true" />}
        title="Ask about your workspace"
        description="Sign in to start a conversation with the assistant."
        className="py-10"
        action={
          <SignInAction
            size="sm"
            reason="Sign in to start a conversation with the assistant."
            guest
          >
            Sign in
          </SignInAction>
        }
      />
    );
  }

  if (selectionUnavailable) {
    return (
      <EmptyState
        data-assistant-empty="unavailable"
        icon={<TriangleAlert aria-hidden="true" />}
        title="Conversation unavailable"
        description="That conversation isn't available. It may have been deleted, or it belongs to another account."
        className="py-10"
      />
    );
  }

  if (selected === null && pending === null) {
    return (
      <EmptyState
        data-assistant-empty="none"
        icon={<MessagesSquare aria-hidden="true" />}
        title="No conversations yet"
        description="Your conversations will appear here. Sending the first message starts one."
        className="py-10"
      />
    );
  }

  if (selected !== null && messages.length === 0 && pending === null) {
    return (
      <EmptyState
        data-assistant-empty="empty-conversation"
        icon={<MessageSquareText aria-hidden="true" />}
        title="No messages yet"
        description="This conversation doesn't have any messages yet."
        className="py-10"
      />
    );
  }

  return <MessageList messages={messages} pending={pending} />;
}
