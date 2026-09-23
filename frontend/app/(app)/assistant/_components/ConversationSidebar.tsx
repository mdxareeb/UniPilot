"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import type { ConversationItem } from "@/lib/data/conversations";

type ConversationSidebarProps = {
  /** The caller's conversations, in `listConversations` order (newest first). */
  conversations: ConversationItem[];
  /** The conversation the main pane is showing, or null when none is. */
  selectedId: string | null;
  /** True for a visitor without a session — no conversation is listed. */
  guest: boolean;
  /** 19.2 — asks the 26.x action for a real conversation row. */
  onCreate: () => void;
  /** True while that request is in flight; the control blocks repeats. */
  creating: boolean;
  /** The create verb's sanitized failure copy, or null when there is none. */
  createError: string | null;
  /** A polite list-level outcome, e.g. a confirmed deletion. */
  notice: string | null;
};

/**
 * Task 19.1 — the conversation sidebar, with 19.2's create control.
 *
 * Rows are the service's own order (most recently active first) and each row is
 * a real `Link` to `/assistant?c=<id>`, so selection is URL state the server
 * resolves — keyboard access is the browser's, not a synthetic handler's. The
 * selected row carries `aria-current` and the shared `MotionSelectionRing`
 * (`layoutId="assistant-conversation"`, `softSpring`) so the selection travels
 * from row to row instead of blinking; `bg-glass-strong` marks the same state
 * for pointer users. Titles truncate; the updated label is mono metadata.
 *
 * 19.2: the header's "New conversation" control is a real button wired to
 * `createConversationAction` — it creates a row server-side, never a local
 * placeholder. It is absent for a guest (the header's sign-in action and the
 * panel's guest empty state are the guest's real affordances), blocks a repeat
 * request while one is in flight (`aria-busy`), and its only failure copy is
 * the action's sanitized string, shown in place as an alert. The polite
 * `notice` line reports a confirmed outcome (a deletion) without colouring a
 * failure as a success.
 *
 * Responsive, same idiom as the viewer's slide rail: a horizontal strip below
 * `lg` (where a full-height rail would push the messages off-screen) and a
 * vertical, independently scrollable rail from `lg` up. Every state is
 * structurally rendered — the empty line is honest copy, never a skeleton
 * pretending data is on its way.
 */
export function ConversationSidebar({
  conversations,
  selectedId,
  guest,
  onCreate,
  creating,
  createError,
  notice,
}: ConversationSidebarProps) {
  return (
    <aside
      data-enter="left"
      style={motionIndex(1)}
      className="min-w-0 lg:w-72 lg:shrink-0"
    >
      <Card className="flex min-w-0 flex-col gap-3 bg-glass p-3 backdrop-blur-md md:p-4">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="font-mono text-label-caps uppercase text-muted-foreground">
            Conversations
          </h2>
          <div className="flex min-w-0 items-center gap-2">
            {conversations.length > 0 ? (
              <span className="font-mono text-label-sm text-muted-foreground">
                {conversations.length}
              </span>
            ) : null}
            {guest ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-assistant-new="sidebar"
                aria-label="New conversation"
                onClick={onCreate}
                disabled={creating}
                aria-busy={creating}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                New
              </Button>
            )}
          </div>
        </div>

        {createError !== null ? (
          <MotionNotice
            role="alert"
            data-assistant-create-error=""
            className="text-label-sm text-destructive"
          >
            {createError}
          </MotionNotice>
        ) : null}

        {notice !== null ? (
          <MotionNotice
            role="status"
            data-assistant-notice=""
            className="text-label-sm text-muted-foreground"
          >
            {notice}
          </MotionNotice>
        ) : null}

        <Divider />

        {conversations.length === 0 ? (
          <p className="px-0.5 pb-1 text-label-sm text-muted-foreground">
            {guest
              ? "Sign in to see your conversations here."
              : "No conversations yet."}
          </p>
        ) : (
          <nav aria-label="Conversations" className="min-w-0">
            <ul className="flex list-none gap-2 overflow-x-auto pb-1 lg:max-h-[60vh] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
              {conversations.map((conversation) => {
                const selected = conversation.id === selectedId;
                return (
                  <MotionListItem
                    key={conversation.id}
                    className="shrink-0 lg:w-full"
                  >
                    <Link
                      href={{
                        pathname: "/assistant",
                        query: { c: conversation.id },
                      }}
                      data-conversation-id={conversation.id}
                      aria-current={selected ? "true" : undefined}
                      className={`relative flex w-56 min-w-0 flex-col gap-1 rounded-base border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background lg:w-full ${
                        selected
                          ? "border-foreground bg-glass-strong"
                          : "border-border bg-glass-subtle hover:border-foreground"
                      }`}
                    >
                      {selected ? (
                        <MotionSelectionRing
                          layoutId="assistant-conversation"
                          radiusClass="rounded-base"
                        />
                      ) : null}
                      <span className="relative truncate text-label-sm font-medium text-foreground">
                        {conversation.title}
                      </span>
                      <span className="relative font-mono text-label-sm text-muted-foreground">
                        {conversation.updatedLabel}
                      </span>
                    </Link>
                  </MotionListItem>
                );
              })}
            </ul>
          </nav>
        )}
      </Card>
    </aside>
  );
}
