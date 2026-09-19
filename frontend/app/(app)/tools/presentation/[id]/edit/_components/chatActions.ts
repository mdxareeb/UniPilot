"use server";

/**
 * Task D8 — the chat panel's Server Actions (spec §7.8, §5.4).
 *
 * The browser never holds `PRESENTON_API_KEY` and never calls the adapter, so
 * conversation listing, history reads and the post-chat deck re-read all
 * travel through these actions, following the repo pattern
 * (`presentationActions.ts`): gate first (`requireOnboardedUser`), parse the
 * untrusted payload on the server, resolve the engine deck id from the
 * caller's own `presentations` row (never from the request), then call the
 * adapter. Failures answer sanitized copy; provider or database internals
 * never travel back.
 *
 * The chat stream itself is not an action: SSE has to reach the browser as it
 * arrives, so it lives in the Node route (`app/api/presentation/[id]/chat`).
 */
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  getPresentationChatMessages,
  getPresentationDeck,
  listPresentationChatConversations,
  PresentonError,
  type PresentonChatConversation,
  type PresentonChatMessage,
} from "@/lib/integrations/presenton";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import { getPresentation } from "@/lib/data/presentations";
import type { PresentationDeck } from "@/lib/presentation/types";

const CHAT_INVALID_INPUT_ERROR = "That chat request isn't valid.";
const CHAT_DECK_NOT_FOUND_ERROR =
  "This deck couldn't be found. Reload the page and try again.";
const CHAT_DECK_NOT_READY_ERROR =
  "This deck has no stored deck on the presentation service, so the assistant can't edit it.";
const CHAT_UNREACHABLE_ERROR =
  "The presentation service didn't answer. Try again in a moment.";
const CHAT_NOT_CONNECTED_ERROR =
  "The presentation service isn't connected in this environment.";
const CHAT_CONVERSATIONS_ERROR =
  "The conversations couldn't be loaded right now. Try again in a moment.";
const CHAT_HISTORY_ERROR =
  "That conversation couldn't be loaded right now. Try again in a moment.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Maps an adapter throw to the chat surface's sanitized copy. */
function chatFailureCopy(error: unknown, fallback: string): string {
  if (error instanceof PresentonError) {
    if (error.code === "not-configured") return CHAT_NOT_CONNECTED_ERROR;
    if (error.code === "rejected") return fallback;
  }
  return CHAT_UNREACHABLE_ERROR;
}

/** The owner row + its engine deck id, or the sanitized failure to answer. */
async function requireEngineDeck(
  userId: string,
  presentationId: string,
): Promise<{ error: null; engineDeckId: string } | { error: string }> {
  let presentation: Awaited<ReturnType<typeof getPresentation>>;
  try {
    presentation = await getPresentation(userId, presentationId);
  } catch {
    return { error: CHAT_UNREACHABLE_ERROR };
  }
  if (presentation === null) return { error: CHAT_DECK_NOT_FOUND_ERROR };

  const engineDeckId = presentation.presentonPresentationId;
  if (!engineDeckId) return { error: CHAT_DECK_NOT_READY_ERROR };
  return { error: null, engineDeckId };
}

export type ChatConversationsActionResult = {
  error: string | null;
  conversations: PresentonChatConversation[];
};

/** §5.4 — one owned deck's chat conversations (newest metadata first). */
export async function listChatConversationsAction(
  payload: unknown,
): Promise<ChatConversationsActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload) || !isPresentationUuid(payload.presentationId)) {
    return { error: CHAT_INVALID_INPUT_ERROR, conversations: [] };
  }

  const owned = await requireEngineDeck(user.id, payload.presentationId.trim());
  if (owned.error !== null) return { error: owned.error, conversations: [] };

  try {
    return {
      error: null,
      conversations: await listPresentationChatConversations(owned.engineDeckId),
    };
  } catch (error) {
    return {
      error: chatFailureCopy(error, CHAT_CONVERSATIONS_ERROR),
      conversations: [],
    };
  }
}

export type ChatMessagesActionResult = {
  error: string | null;
  messages: PresentonChatMessage[];
};

/** §5.4 — one owned deck's stored conversation messages. */
export async function getChatMessagesAction(
  payload: unknown,
): Promise<ChatMessagesActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (
    !isRecord(payload) ||
    !isPresentationUuid(payload.presentationId) ||
    typeof payload.conversationId !== "string" ||
    !UUID_PATTERN.test(payload.conversationId.trim())
  ) {
    return { error: CHAT_INVALID_INPUT_ERROR, messages: [] };
  }

  const owned = await requireEngineDeck(user.id, payload.presentationId.trim());
  if (owned.error !== null) return { error: owned.error, messages: [] };

  try {
    return {
      error: null,
      messages: await getPresentationChatMessages({
        presentationId: owned.engineDeckId,
        conversationId: payload.conversationId.trim(),
      }),
    };
  } catch (error) {
    return { error: chatFailureCopy(error, CHAT_HISTORY_ERROR), messages: [] };
  }
}

export type ChatDeckActionResult = {
  error: string | null;
  deck: PresentationDeck | null;
};

/**
 * §7.8/§7.10 — re-read the stored deck after a mutating chat turn. The engine
 * (through its own chat tools) is the writer for those mutations; this action
 * only reads, so the editor can replace its local state with the stored truth
 * and offer undo against the pre-chat snapshot.
 */
export async function getPresentationDeckAction(
  payload: unknown,
): Promise<ChatDeckActionResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isRecord(payload) || !isPresentationUuid(payload.presentationId)) {
    return { error: CHAT_INVALID_INPUT_ERROR, deck: null };
  }

  const owned = await requireEngineDeck(user.id, payload.presentationId.trim());
  if (owned.error !== null) return { error: owned.error, deck: null };

  try {
    return {
      error: null,
      deck: await getPresentationDeck(owned.engineDeckId),
    };
  } catch (error) {
    return {
      error: chatFailureCopy(error, CHAT_UNREACHABLE_ERROR),
      deck: null,
    };
  }
}
