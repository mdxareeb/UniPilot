"use server";

/**
 * The assistant's Server Actions (Task 26.x): the non-streaming turn and the
 * conversation verbs. The streaming turn has its own route
 * (`/api/assistant/turn`); this action is the mechanical fallback 19.x can
 * call when streaming is undesirable, and it is what the committed spec
 * drives. Every action gates first and returns sanitized copy only.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  ASSISTANT_COPY,
  runAssistantTurn,
  type AssistantTurnResult,
} from "./assistant";
import {
  createConversation,
  deleteConversation,
  parseConversationTitle,
  renameConversation,
  type ConversationItem,
} from "./conversations";

export type ConversationActionResult = {
  error: string | null;
  conversation: ConversationItem | null;
};

export type ConversationDeleteResult = {
  error: string | null;
};

export async function sendAssistantMessageAction(input: {
  conversationId?: string | null;
  content: unknown;
}): Promise<AssistantTurnResult> {
  const user = await requireOnboardedUser("/assistant");

  const conversationId =
    typeof input?.conversationId === "string" && input.conversationId !== ""
      ? input.conversationId
      : null;

  const result = await runAssistantTurn(user.id, {
    conversationId,
    content: typeof input?.content === "string" ? input.content : "",
  });

  revalidatePath("/assistant");
  return result;
}

export async function createConversationAction(
  title: unknown,
): Promise<ConversationActionResult> {
  const user = await requireOnboardedUser("/assistant");

  const parsed = parseConversationTitle(title) ?? "New conversation";

  try {
    const conversation = await createConversation(user.id, parsed);
    revalidatePath("/assistant");
    return { error: null, conversation };
  } catch {
    return { error: ASSISTANT_COPY.FAILED, conversation: null };
  }
}

export async function renameConversationAction(
  conversationId: unknown,
  title: unknown,
): Promise<ConversationActionResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof conversationId === "string" ? conversationId.trim() : "";
  const parsed = parseConversationTitle(title);
  if (id === "" || parsed === null) {
    return { error: "Check the conversation name and try again.", conversation: null };
  }

  try {
    const conversation = await renameConversation(user.id, id, parsed);
    if (conversation === null) {
      return { error: "That conversation no longer exists.", conversation: null };
    }
    revalidatePath("/assistant");
    return { error: null, conversation };
  } catch {
    return { error: ASSISTANT_COPY.FAILED, conversation: null };
  }
}

export async function deleteConversationAction(
  conversationId: unknown,
): Promise<ConversationDeleteResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof conversationId === "string" ? conversationId.trim() : "";
  if (id === "") {
    return { error: "That conversation no longer exists." };
  }

  try {
    const deleted = await deleteConversation(user.id, id);
    if (!deleted) {
      return { error: "That conversation no longer exists." };
    }
    revalidatePath("/assistant");
    return { error: null };
  } catch {
    return { error: ASSISTANT_COPY.FAILED };
  }
}
