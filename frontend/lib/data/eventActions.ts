"use server";

/**
 * The events Server Actions (Tasks 22.1/22.x), the repo pattern of
 * `lib/data/taskActions.ts`: the gate runs first and outside the try block,
 * untrusted payloads are parsed and validated on the server, the service does
 * the write, and only sanitized copy ever travels back to the client.
 *
 * The gate is `requireOnboardedUser("/calendar")` — the same session +
 * completion check the page itself runs. Ownership comes from the session
 * (`user.id`); RLS on `events` is the enforcement layer, and the service's
 * request-scoped client is the authenticated one — the service role is never
 * used here.
 *
 * Mutations answer with the settled row mapped to the calendar contract, so a
 * future optimistic UI can reconcile or roll back; "no owned row matched" is
 * reported as the not-found copy rather than a fabricated success.
 * `revalidatePath("/calendar")` drops the page's cached render after a write.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  EVENT_DELETE_ERROR,
  EVENT_INVALID_INPUT_ERROR,
  EVENT_NOT_FOUND_ERROR,
  EVENT_SAVE_ERROR,
} from "./eventErrors";
import {
  parseEventDraft,
  type EventItem,
} from "./eventValues";
import {
  createEvent,
  deleteEvent,
  getEvent,
  updateEvent,
} from "./events";
import { getDocument } from "./documents";

export type EventActionResult = {
  error: string | null;
  /** The settled row on success; null on every failure. */
  event: EventItem | null;
};

export type EventDeleteResult = {
  error: string | null;
};

function parseEventId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  )
    ? id
    : null;
}

/**
 * The detail/refresh read: resolves one event by immutable id through the
 * same session gate, so a fabricated, altered or another user's id answers
 * `EVENT_NOT_FOUND_ERROR` — ownership is the server's, never the URL.
 */
export async function getEventAction(
  eventId: unknown,
): Promise<EventActionResult> {
  const user = await requireOnboardedUser("/calendar");

  const id = parseEventId(eventId);
  if (id === null) return { error: EVENT_NOT_FOUND_ERROR, event: null };

  let event: EventItem | null;
  try {
    event = await getEvent(user.id, id);
  } catch {
    return { error: EVENT_SAVE_ERROR, event: null };
  }

  if (event === null) return { error: EVENT_NOT_FOUND_ERROR, event: null };
  return { error: null, event };
}

/** 22.3 Create. */
export async function createEventAction(
  payload: unknown,
): Promise<EventActionResult> {
  const user = await requireOnboardedUser("/calendar");

  const draft = parseEventDraft(payload);
  if (draft === null) return { error: EVENT_INVALID_INPUT_ERROR, event: null };

  // 27.5 (R2): the provenance link is owner-verified before the write — the
  // executor takes the same route through `getDocument`.
  if (draft.sourceDocumentId != null) {
    let source: Awaited<ReturnType<typeof getDocument>>;
    try {
      source = await getDocument(user.id, draft.sourceDocumentId);
    } catch {
      return { error: EVENT_SAVE_ERROR, event: null };
    }
    if (source === null) {
      return { error: EVENT_INVALID_INPUT_ERROR, event: null };
    }
  }

  let event: EventItem;
  try {
    event = await createEvent(user.id, draft);
  } catch {
    return { error: EVENT_SAVE_ERROR, event: null };
  }

  revalidatePath("/calendar");
  return { error: null, event };
}

/** 22.4 Update — the validated draft replaces the editable fields. */
export async function updateEventAction(
  eventId: unknown,
  payload: unknown,
): Promise<EventActionResult> {
  const user = await requireOnboardedUser("/calendar");

  const id = parseEventId(eventId);
  const draft = parseEventDraft(payload);
  if (id === null || draft === null) {
    return { error: EVENT_INVALID_INPUT_ERROR, event: null };
  }

  let event: EventItem | null;
  try {
    event = await updateEvent(user.id, id, draft);
  } catch {
    return { error: EVENT_SAVE_ERROR, event: null };
  }

  if (event === null) return { error: EVENT_NOT_FOUND_ERROR, event: null };

  revalidatePath("/calendar");
  return { error: null, event };
}

/** 22.5 Delete. */
export async function deleteEventAction(
  eventId: unknown,
): Promise<EventDeleteResult> {
  const user = await requireOnboardedUser("/calendar");

  const id = parseEventId(eventId);
  if (id === null) return { error: EVENT_INVALID_INPUT_ERROR };

  let deleted: boolean;
  try {
    deleted = await deleteEvent(user.id, id);
  } catch {
    return { error: EVENT_DELETE_ERROR };
  }

  if (!deleted) return { error: EVENT_NOT_FOUND_ERROR };

  revalidatePath("/calendar");
  return { error: null };
}
