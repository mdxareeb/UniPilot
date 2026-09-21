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
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import type { MessageItem } from "@/lib/data/assistantValues";
import type { ConversationItem } from "@/lib/data/conversations";
import { ConversationSidebar } from "./ConversationSidebar";
import { MessageList } from "./MessageList";

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
  /** The page header, composed on the server page. */
  children: ReactNode;
};

/**
 * Tasks 19.1–19.6/19.12/19.14 (read half) — the `/assistant` conversation shell.
 *
 * The server page owns access and the data reads (`listConversations`,
 * `listMessages` for the `?c=` selection) and hands this client boundary the
 * finished, serializable contract: nothing here fetches, mutates or streams —
 * composing is 19.7–19.11 and the conversation verbs are 19.2/19.4's later
 * tasks. Selection is URL state (`/assistant?c=<id>`), resolved by the server,
 * so every read stays under RLS and no client cache can disagree with it.
 *
 * Honesty rules this shell keeps:
 * - the `26.1` provider verdict is reported as-is (`data-assistant-status` plus
 *   the visible unconfigured explanation) — an unconfigured environment never
 *   implies the assistant can answer, and no bubble is ever fabricated here;
 * - a conversation with no stored turns renders "no messages yet", never a
 *   placeholder reply;
 * - `?c=` naming an id the account does not own renders an unavailable state
 *   with no message read, rather than silently switching to another row;
 * - a guest sees the real shell, the sign-in copy and no data read at all.
 *
 * Motion: the sidebar (slot 1, from the left) and the conversation panel
 * (slot 2, with depth) follow the page header's slot 0 on the shared entrance
 * ladder; the message list reveals as one composition through the shared
 * `MotionRevealGroup` vocabulary.
 */
export function AssistantWorkspace({
  conversations,
  selected,
  messages,
  selectionUnavailable,
  guest,
  configured,
  unconfiguredCopy,
  children,
}: AssistantWorkspaceProps) {
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
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

type ConversationBodyProps = Pick<
  AssistantWorkspaceProps,
  "guest" | "selected" | "messages" | "selectionUnavailable"
>;

/** The honest empty state per situation, or the stored turns. */
function ConversationBody({
  guest,
  selected,
  messages,
  selectionUnavailable,
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

  if (selected === null) {
    return (
      <EmptyState
        data-assistant-empty="none"
        icon={<MessagesSquare aria-hidden="true" />}
        title="No conversations yet"
        description="Your conversations will appear here."
        className="py-10"
        action={
          <div className="flex flex-col items-center gap-2">
            <Button
              size="sm"
              disabled
              aria-describedby="assistant-new-conversation-note"
            >
              <Sparkles aria-hidden="true" className="size-4" />
              New conversation
            </Button>
            <p
              id="assistant-new-conversation-note"
              className="text-label-sm text-muted-foreground"
            >
              Starting a conversation isn&apos;t available yet.
            </p>
          </div>
        }
      />
    );
  }

  if (messages.length === 0) {
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

  return <MessageList messages={messages} />;
}
