"use client";

import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquareText,
  MessagesSquare,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { SignInAction } from "@/components/auth/SignInAction";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { motionIndex } from "@/components/motion/stagger";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createConversationAction,
  deleteConversationAction,
  renameConversationAction,
} from "@/lib/data/assistantActions";
import type {
  AssistantActionItem,
  AssistantActionMutationResult,
  MessageItem,
} from "@/lib/data/assistantValues";
import type { ConversationItem } from "@/lib/data/conversations";
import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import { MessageList } from "@/components/assistant/MessageList";
import {
  useAssistantTurn,
  type LocalTurn,
} from "@/components/assistant/useAssistantTurn";
import { ConversationPanelHeader } from "./ConversationPanelHeader";
import { ConversationSidebar } from "./ConversationSidebar";

type AssistantWorkspaceProps = {
  /** The caller's conversations, newest first (the 26.3 service order). */
  conversations: ConversationItem[];
  /** The conversation the main pane shows, or null when none is selected. */
  selected: ConversationItem | null;
  /** The selected conversation's messages, in stored order. */
  messages: MessageItem[];
  /**
   * The selected conversation's action log (T27-C), oldest first. Each
   * assistant message renders the cards whose `messageId` names it.
   */
  actions: AssistantActionItem[];
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
 * Tasks 19.1–19.3/19.7–19.12/19.14 — the `/assistant` conversation shell.
 *
 * The server page owns access and the data reads (`listConversations`,
 * `listMessages` for the `?c=` selection) and hands this client boundary the
 * finished, serializable contract. Selection stays URL state
 * (`/assistant?c=<id>`), resolved by the server, so every read continues under
 * RLS and no client cache can disagree with it.
 *
 * 19.2/19.3 (C4) adds the conversation verbs, all through the committed 26.x
 * Server Actions (`assistantActions.ts`) — never a client write and never a
 * fabricated row:
 * - **create** asks the action for a real row, inserts the returned item at the
 *   top of the local list and pushes `?c=<id>`; the composer is focused only
 *   once the selection has actually committed that id (C6), so the caret can
 *   never land in the previous conversation's composer on a fast paste+Enter.
 *   A failure shows the action's sanitized copy and leaves the list untouched.
 * - **rename** is optimistic with rollback (the documents-hub precedent): the
 *   title changes in the sidebar and the panel immediately, the settled row
 *   reconciles from the action's response, and a refusal restores the snapshot
 *   and surfaces the copy. `router.refresh()` follows a refusal because the
 *   server read is the authority again afterwards.
 * - **delete** removes the row optimistically, confirms through the shared
 *   `Modal`, and on success selects the next most recent conversation — or the
 *   honest no-conversation state when that was the last one. A refusal restores
 *   the snapshot, refreshes and returns the action's own copy ("That
 *   conversation no longer exists."); nothing switches behind the caller's back.
 *
 * The local list mirrors the documents workspace: the refreshed server render
 * is authoritative at rest, and local state only carries an in-flight verb's
 * optimism. `selectedItem` is the local copy of the selected row so an
 * optimistic rename lands in the panel title as well as the sidebar.
 *
 * Composing (19.7–19.11) lives in the shared pieces under
 * `frontend/components/assistant/` — `useAssistantTurn` + `AssistantComposer`
 * + `MessageList` — so the 19.16 launcher panel renders the exact same turn
 * pipeline: a send appends the optimistic turn, streams
 * `POST /api/assistant/turn` through C1's frame vocabulary, then reconciles
 * with the server (`router.refresh()`, plus the URL moving to `?c=` when
 * `start` created a conversation) so the stored rows are the source of truth.
 *
 * T27-C adds the confirmation cards: the page's owner-scoped action read
 * arrives as `actions`, and each stored assistant bubble renders the proposals
 * that name its message. A card settles through the real Server Actions; this
 * shell then refreshes so the stored log and the created task/event become the
 * authority again. The shell never executes an action itself (27.6).
 *
 * C6 closes the two deferred C4 review findings here. The hook is given a
 * synchronous `selectionIntent` (the verb ref above plus the live URL) so a
 * settle that lands between a create/delete and its committed render compares
 * against where the caller actually is, never the last committed prop. And the
 * composer's `stop` is wired through, so a stream that never settles can be
 * left from either surface; the hook settles it as a sanitized failure.
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
  actions,
  selectionUnavailable,
  guest,
  configured,
  unconfiguredCopy,
  failedCopy,
  children,
}: AssistantWorkspaceProps) {
  const router = useRouter();
  const selectedId = selected?.id ?? null;
  /* C6 (deferred C4) — the selection *intent*, read synchronously at settle.
     `router.push`/`replace` update the address bar before the server render
     commits, so the live URL is the authority; the verb ref covers the instant
     between a create/delete resolving and that navigation reaching the URL. It
     is only consulted while the URL still names the selection the verb ran
     against, so a later move by the caller always wins. */
  const intentRef = useRef<{ id: string | null; at: string | null } | null>(null);
  const liveSelection = useCallback(
    () => new URLSearchParams(window.location.search).get("c"),
    [],
  );
  const selectionIntent = useCallback((): string | null => {
    const live = liveSelection();
    const intent = intentRef.current;
    if (intent !== null && live === intent.at) return intent.id;
    return live;
  }, [liveSelection]);

  /* The create verb's new conversation until the selection commits (C6). The
     composer may not focus before `selectedId` equals this id, and while it is
     pending it is the honest send target: the returned row is real, so a send
     before the URL commits belongs to it, never to the previous conversation. */
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
  const createOriginRef = useRef<string | null>(null);

  const { turn, busy, send, stop } = useAssistantTurn({
    conversationId: pendingCreateId ?? selectedId,
    failedCopy,
    messages,
    /* The page owns its URL: a `start` frame for a conversation the send did
       not target moves `?c=` here (guarded by the hook against a caller who
       has meanwhile selected another conversation). The 19.16 launcher panel
       passes its own state setter instead — same hook, one settle contract. */
    onConversationStarted: (conversationId) =>
      router.replace(`/assistant?c=${encodeURIComponent(conversationId)}`, {
        scroll: false,
      }),
    selectionIntent,
  });
  const showComposer = !guest && !selectionUnavailable;

  /* T27-C — a confirmation card's settle re-reads the server truth: the log
     row's settled status and, on success, the created task/event. The card
     shows the returned row immediately; this refresh is what makes the
     stored read the authority again afterwards. */
  const onActionSettled = useCallback(() => {
    router.refresh();
  }, [router]);

  /* The local list the verbs mutate optimistically. The server render replaces
     it whenever a new one arrives (the documents-workspace idiom: derived
     during render, so the refreshed props are the authority at rest). */
  const [list, setList] = useState<ConversationItem[]>(conversations);
  const [serverSnapshot, setServerSnapshot] = useState(conversations);
  if (conversations !== serverSnapshot) {
    setServerSnapshot(conversations);
    setList(conversations);
  }

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  /* C6 — the create verb's selection lands as a real navigation: focus the
     composer only once the URL/selection has actually committed the created
     id, so a fast paste+Enter can never write into the conversation the caller
     just left. If the caller picks another row first, the intent is abandoned
     rather than stealing focus later. React's documented render-phase
     adjustment (the same idiom the list above uses) keeps the focus request in
     the very commit that carries the new selection. */
  const [trackedSelectionId, setTrackedSelectionId] = useState(selectedId);
  if (trackedSelectionId !== selectedId) {
    setTrackedSelectionId(selectedId);
    if (pendingCreateId !== null) {
      if (selectedId === pendingCreateId) {
        setPendingCreateId(null);
        setFocusRequest((request) => request + 1);
      } else if (selectedId !== createOriginRef.current) {
        setPendingCreateId(null);
      }
    }
  }

  /* The optimistic copy of the selected row (a rename lands here before the
     server render does), falling back to the server's own item. */
  const selectedItem =
    selected === null
      ? null
      : (list.find((conversation) => conversation.id === selected.id) ??
        selected);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setNotice(null);

    let result: Awaited<ReturnType<typeof createConversationAction>> | null =
      null;
    try {
      result = await createConversationAction(undefined);
    } catch {
      // A transport failure has no action copy; use the server-passed one.
      result = null;
    }

    setCreating(false);
    if (
      result === null ||
      result.error !== null ||
      result.conversation === null
    ) {
      setCreateError(result === null ? failedCopy : (result.error ?? failedCopy));
      return;
    }

    const created = result.conversation;
    /* The returned row is real (the action inserted it), so showing it now is
       not a fabricated success — and the URL moves with it. C6: the composer
       focus waits for the selection commit (the render-phase adjustment
       above), and until then the created id is what a send targets and what a
       settle guard compares against — never the conversation the caller just
       left. */
    setList((current) => [
      created,
      ...current.filter((conversation) => conversation.id !== created.id),
    ]);
    createOriginRef.current = selectionIntent();
    intentRef.current = { id: created.id, at: createOriginRef.current };
    setPendingCreateId(created.id);
    router.push(`/assistant?c=${encodeURIComponent(created.id)}`, {
      scroll: false,
    });
  }, [creating, failedCopy, router, selectionIntent]);

  const rename = useCallback(
    async (id: string, title: string): Promise<string | null> => {
      const previous = list;
      setNotice(null);
      setCreateError(null);
      setList((current) =>
        current.map((conversation) =>
          conversation.id === id ? { ...conversation, title } : conversation,
        ),
      );

      let result: Awaited<ReturnType<typeof renameConversationAction>> | null =
        null;
      try {
        result = await renameConversationAction(id, title);
      } catch {
        result = null;
      }

      if (
        result === null ||
        result.error !== null ||
        result.conversation === null
      ) {
        setList(previous);
        router.refresh();
        return result === null ? failedCopy : (result.error ?? failedCopy);
      }

      const settled = result.conversation;
      setList((current) =>
        current.map((conversation) =>
          conversation.id === id ? settled : conversation,
        ),
      );
      return null;
    },
    [list, failedCopy, router],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const previous = list;
      setNotice(null);
      setCreateError(null);
      const moveSelection = selectedId === id;
      const next =
        list.find((conversation) => conversation.id !== id) ?? null;
      setList((current) =>
        current.filter((conversation) => conversation.id !== id),
      );

      let result: Awaited<ReturnType<typeof deleteConversationAction>> | null =
        null;
      try {
        result = await deleteConversationAction(id);
      } catch {
        result = null;
      }

      if (result === null || result.error !== null) {
        setList(previous);
        router.refresh();
        return result === null ? failedCopy : result.error;
      }

      setNotice("Conversation deleted.");
      if (moveSelection) {
        /* The next most recent conversation, or the honest no-selection state
           — the URL and the selection move together, never silently to a row
           the caller did not ask for. C6: the intent is recorded
           synchronously, so a turn that settles before this navigation
           commits can never pull the selection back to the deleted id. */
        intentRef.current = {
          id: next?.id ?? null,
          at: liveSelection(),
        };
        router.replace(
          next === null
            ? "/assistant"
            : `/assistant?c=${encodeURIComponent(next.id)}`,
          { scroll: false },
        );
      } else {
        router.refresh();
      }
      return null;
    },
    [list, selectedId, failedCopy, router, liveSelection],
  );

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
          conversations={list}
          selectedId={selectedId}
          guest={guest}
          onCreate={() => void create()}
          creating={creating}
          createError={createError}
          notice={notice}
        />

        <Card
          data-enter="scale"
          style={motionIndex(2)}
          className="flex min-w-0 flex-1 flex-col gap-4 bg-glass p-4 backdrop-blur-md md:p-5"
        >
          <ConversationPanelHeader
            conversation={selectedItem}
            statusLine={statusLine}
            configured={configured}
            onRename={rename}
            onDelete={remove}
          />

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
              actions={actions}
              selectionUnavailable={selectionUnavailable}
              pending={turn}
              onActionSettled={onActionSettled}
              creating={creating}
              onCreate={() => void create()}
            />
          </div>

          {showComposer ? (
            <AssistantComposer
              conversationId={pendingCreateId ?? selectedId}
              busy={busy}
              onStop={stop}
              focusRequest={focusRequest}
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
  "guest" | "selected" | "messages" | "actions" | "selectionUnavailable"
> & {
  /** The live turn this tab is receiving, or null. */
  pending: LocalTurn | null;
  /** T27-C — a card's settle re-reads the server truth. */
  onActionSettled: (result: AssistantActionMutationResult) => void;
  /** True while 19.2's create request is in flight. */
  creating: boolean;
  /** 19.2 — the empty state's real "New conversation" control. */
  onCreate: () => void;
};

/**
 * The honest empty state per situation, the stored turns, or the stored turns
 * plus the live one. While a live turn exists it is the only body — an empty
 * conversation is not empty while a message is being written into it — and the
 * empty states return as soon as it is retired.
 *
 * The no-conversations state carries 19.2's real create control, so the
 * explicit path and the composer's first-send path are both offered and both
 * create a real row.
 */
function ConversationBody({
  guest,
  selected,
  messages,
  actions,
  selectionUnavailable,
  pending,
  onActionSettled,
  creating,
  onCreate,
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
        description="Your conversations will appear here. Start one now, or send the first message below."
        className="py-10"
        action={
          <Button
            type="button"
            data-assistant-new="empty"
            onClick={onCreate}
            disabled={creating}
            aria-busy={creating}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {creating ? "Creating…" : "New conversation"}
          </Button>
        }
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

  return (
    <MessageList
      messages={messages}
      actions={actions}
      pending={pending}
      onActionSettled={onActionSettled}
    />
  );
}
