import { WhatsAppApiError, type WhatsAppApi } from "./api";
import type { GroupCandidateItem } from "./types";

/**
 * Add / Dismiss on a suggestion. A suggestion leaves the list only when the
 * server said it is settled: a success, or a 404 (already decided or no longer
 * yours, which the API deliberately does not distinguish). Any other failure
 * keeps it on screen with the reason, so nothing is lost on a bad connection.
 */
export type DecisionOutcome = {
  review: GroupCandidateItem[];
  /** Plain copy to show, or null on a clean success. */
  message: string | null;
  tone: "info" | "error" | null;
};

export const REVIEW_COPY = {
  ADDED: "Added.",
  DISMISSED: "Dismissed. It won't be suggested again.",
  GONE: "That suggestion was already handled.",
  FAILED: "Couldn't save that. Try again.",
} as const;

export async function decideCandidate(
  api: Pick<WhatsAppApi, "decide">,
  review: GroupCandidateItem[],
  id: string,
  decision: "confirm" | "reject",
): Promise<DecisionOutcome> {
  const without = review.filter((item) => item.id !== id);
  try {
    await api.decide(id, decision);
    return {
      review: without,
      message: decision === "confirm" ? REVIEW_COPY.ADDED : REVIEW_COPY.DISMISSED,
      tone: "info",
    };
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.kind === "not_found") {
      return { review: without, message: REVIEW_COPY.GONE, tone: "info" };
    }
    const message =
      error instanceof WhatsAppApiError && error.kind !== "server"
        ? error.message
        : REVIEW_COPY.FAILED;
    return { review, message, tone: "error" };
  }
}

/** One line under the title: when it is due (or "No date") and the course. */
export function candidateMeta(item: GroupCandidateItem): string {
  const course = item.subjectName ?? item.proposedSubjectName;
  const parts = [item.typeLabel, item.whenLabel ?? "No date"];
  if (course) {
    parts.push(item.subjectName === null ? `New course: ${course}` : course);
  }
  return parts.join(" · ");
}
