import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { Container } from "@/components/ui/Container";
import {
  ASSISTANT_UNCONFIGURED_COPY,
  providerStatus,
} from "@/lib/ai/provider";
import { ASSISTANT_COPY } from "@/lib/data/assistant";
import type { MessageItem } from "@/lib/data/assistantValues";
import {
  listConversations,
  type ConversationItem,
} from "@/lib/data/conversations";
import { listMessages } from "@/lib/data/messages";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { AssistantWorkspace } from "./_components/AssistantWorkspace";

export const metadata: Metadata = {
  title: "Assistant",
  description: "Ask questions and work with your workspace.",
};

/**
 * Assistant (19.x conversation shell; 26.x backend binding).
 *
 * The server page owns access and the data reads, in that order: the
 * `getWorkspaceAccess` gate runs first (`requireOnboardedUser("/assistant")`
 * stays the Server Actions' hard fallback), then the caller's real
 * conversations load through the request-scoped, RLS-enforced client. The
 * selection is URL state — `/assistant?c=<id>` — and only an id that is one of
 * the caller's own conversations resolves; anything else renders the honest
 * unavailable state instead of reading, or silently loading, a different
 * conversation. With no `?c=` the most recently active conversation is
 * selected, because that is what returning to the assistant should show.
 *
 * The 26.1 provider verdict is read here and passed down as data: this
 * environment has no provider configured, so the shell renders the honest
 * unconfigured state (`data-assistant-status="unconfigured"`), streams the
 * real endpoint's unconfigured answer when a turn is sent, and never
 * fabricates a reply. `ASSISTANT_COPY.FAILED` is passed the same way: the
 * client's transport-failure fallback is the server's sanitized copy, not a
 * second string invented in the browser. The conversation verbs (19.2/19.4)
 * are later 19.x tasks; this page is a server component and hands the client
 * boundary only serializable data.
 *
 * A visitor without a session renders the same header with the sign-in action
 * and the real shell with its guest empty state, and no data call happens at
 * all (the anon role is revoked, so a guest query would fail by design).
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getWorkspaceAccess();
  const assistant = providerStatus();
  const params = await searchParams;
  const requestedId =
    typeof params.c === "string" && params.c !== "" ? params.c : null;

  let conversations: ConversationItem[] = [];
  let selected: ConversationItem | null = null;
  let messages: MessageItem[] = [];
  let selectionUnavailable = false;

  if (user) {
    conversations = await listConversations(user.id);

    if (requestedId !== null) {
      selected = conversations.find((c) => c.id === requestedId) ?? null;
      selectionUnavailable = selected === null;
    } else {
      selected = conversations[0] ?? null;
    }

    if (selected !== null) {
      messages = await listMessages(user.id, selected.id);
    }
  }

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <AssistantWorkspace
        conversations={conversations}
        selected={selected}
        messages={messages}
        selectionUnavailable={selectionUnavailable}
        guest={!user}
        configured={assistant.configured}
        unconfiguredCopy={
          assistant.configured ? null : ASSISTANT_UNCONFIGURED_COPY
        }
        failedCopy={ASSISTANT_COPY.FAILED}
      >
        <PageHeader
          eyebrow="Assistant"
          title="Assistant"
          description="Ask questions and work with your workspace."
          primaryAction={
            user ? undefined : (
              <SignInAction
                size="sm"
                aria-label="New conversation"
                reason="Sign in to start a conversation with the assistant."
                guest
              >
                <Sparkles aria-hidden="true" className="size-4" />
                New conversation
              </SignInAction>
            )
          }
        />
      </AssistantWorkspace>
    </Container>
  );
}
