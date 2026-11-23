/**
 * Ask AI's client-safe contract: session/message shapes, bounds and copy.
 *
 * Server modules import these values; the mobile app has its own mirror (it
 * does not import web code) but the JSON produced here is the wire contract
 * both sides follow.
 */
import type { SearchHit } from "./searchValues";
import type { AssistantContextChunk } from "@/lib/ai/prompt";

export const STUDY_CHAT_MESSAGE_MAX_LENGTH = 4_000;
export const STUDY_CHAT_TITLE_MAX_LENGTH = 120;
export const STUDY_CHAT_SESSIONS_LIMIT = 50;
export const STUDY_CHAT_SOURCE_SNIPPET_MAX_LENGTH = 280;

export type StudyChatRole = "user" | "assistant";
export type StudyChatStatus = "complete" | "failed";

/** One citation the mobile sheet renders: where and the supporting excerpt. */
export type StudyChatSource = {
  documentId: string;
  documentName: string;
  page?: number;
  chunkIndex: number;
  snippet: string;
};

export type StudyChatMessage = {
  id: string;
  role: StudyChatRole;
  content: string;
  status: StudyChatStatus;
  sources: StudyChatSource[];
  createdAt: string;
};

export type StudyChatSessionSummary = {
  id: string;
  title: string;
  scopeSubjectId: string | null;
  scopeDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudyChatSessionDetail = StudyChatSessionSummary & {
  messages: StudyChatMessage[];
};

export const STUDY_CHAT_COPY = {
  INVALID: `Send a question between 1 and ${STUDY_CHAT_MESSAGE_MAX_LENGTH} characters.`,
  INVALID_TITLE: `A chat title must be between 1 and ${STUDY_CHAT_TITLE_MAX_LENGTH} characters.`,
  INVALID_SCOPE:
    "Choose either one subject or one document for a chat, never both.",
  SCOPE_UNAVAILABLE: "That subject or document is not available.",
  NOT_FOUND: "That chat no longer exists.",
  GENERIC: "Something went wrong. Please try again.",
  UNCONFIGURED:
    "The study assistant isn't configured on this server yet, so I can't answer questions.",
  EMPTY_RETRIEVAL:
    "I couldn't find anything in your course materials about that. Try a different question, or upload the reading first.",
  RATE_LIMITED:
    "You're sending messages faster than the limit allows. Wait a moment and try again.",
  SPEND_LIMIT:
    "The study assistant's usage limit for this month has been reached. It resets next month.",
  FAILED:
    "The study assistant couldn't answer that just now. Please try again.",
} as const;

/** The bounded, single-line title derived from a first question. */
export function titleFromQuestion(content: string): string {
  const collapsed = content.trim().replace(/\s+/g, " ");
  if (collapsed === "") return "New chat";
  return collapsed.length > 60 ? `${collapsed.slice(0, 57).trimEnd()}…` : collapsed;
}

/** Strip search highlight markers and clamp a citation excerpt. */
export function citationSnippet(value: string): string {
  const plain = value
    .replaceAll("[[", "")
    .replaceAll("]]", "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > STUDY_CHAT_SOURCE_SNIPPET_MAX_LENGTH
    ? `${plain.slice(0, STUDY_CHAT_SOURCE_SNIPPET_MAX_LENGTH - 1).trimEnd()}…`
    : plain;
}

/**
 * Turn the retrieved hits into the citation array the mobile sheet renders.
 * The excerpt is the search snippet (highlight markers stripped), not the
 * whole chunk, so a citation stays readable; provenance is kept per chunk.
 */
export function buildStudyChatSources(
  hits: readonly SearchHit[],
  chunks: readonly AssistantContextChunk[],
): StudyChatSource[] {
  const snippetByChunk = new Map(
    hits.map((hit) => [
      `${hit.documentId}:${hit.chunkIndex}`,
      citationSnippet(hit.snippet),
    ]),
  );

  return chunks.map((chunk) => {
    const source: StudyChatSource = {
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      chunkIndex: chunk.chunkIndex,
      snippet:
        snippetByChunk.get(`${chunk.documentId}:${chunk.chunkIndex}`) ??
        citationSnippet(chunk.content),
    };
    if (chunk.page !== undefined) source.page = chunk.page;
    return source;
  });
}
