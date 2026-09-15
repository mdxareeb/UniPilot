"use server";

/**
 * The presentation generator's Server Actions (Task 31.x), following the repo
 * pattern (`documentActions.ts`, `taskActions.ts`): the gate runs first and
 * outside the try block, untrusted payloads are parsed on the server, the
 * service does the work, and only sanitized copy travels back to the client.
 *
 * The gate is `requireOnboardedUser("/tools/presentation")`. Writes go through
 * the service role inside the service layer (the `presentations` table exposes
 * no client write path — TASK.md 31.x decision), and the enqueue rides the
 * 29.1 runner with an ids-only payload.
 *
 * Not-connected posture (GATE 1): when `PRESENTON_URL` is unset, this action
 * writes nothing and answers the honest "not connected" copy — no row, no job,
 * no fake deck. With a configured service, the flow is: row (`queued`) →
 * `presentation.generate` job → worker drives Presenton → `/documents` gains
 * the exported deck.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import { enqueueJob } from "./jobs";
import { getDocument } from "./documents";
import {
  PRESENTATION_INVALID_INPUT_ERROR,
  PRESENTATION_NOT_CONNECTED_ERROR,
  PRESENTATION_QUEUE_ERROR,
  PRESENTATION_SAVE_ERROR,
  PRESENTATION_SOURCE_NOT_FOUND_ERROR,
  PRESENTATION_SOURCE_UNSUPPORTED_ERROR,
} from "./presentationErrors";
import {
  parsePresentationRequest,
  type PresentationDraft,
} from "./presentationValues";
import { insertPresentation, markPresentationFailed } from "./presentations";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type CreatePresentationResult = {
  error: string | null;
  /** The created request's id on success; null on every failure. */
  presentationId: string | null;
};

/**
 * Validates and queues one generation request. The topic+options shape is
 * documented in `docs/integrations/presenton.md` §3.1; this action's job is to
 * write the row and hand the runner an id, nothing more.
 */
export async function createPresentationAction(
  payload: unknown,
): Promise<CreatePresentationResult> {
  const user = await requireOnboardedUser("/tools/presentation");

  if (!isPresentonConfigured()) {
    return { error: PRESENTATION_NOT_CONNECTED_ERROR, presentationId: null };
  }

  const draft: PresentationDraft | null = parsePresentationRequest(payload);
  if (draft === null) {
    return { error: PRESENTATION_INVALID_INPUT_ERROR, presentationId: null };
  }

  // A source document must be the caller's own and readable by the service.
  // The worker re-checks ownership before it hands any bytes to Presenton.
  if (draft.sourceDocumentId !== null) {
    let source: Awaited<ReturnType<typeof getDocument>>;
    try {
      source = await getDocument(user.id, draft.sourceDocumentId);
    } catch {
      return { error: PRESENTATION_SAVE_ERROR, presentationId: null };
    }
    if (source === null) {
      return { error: PRESENTATION_SOURCE_NOT_FOUND_ERROR, presentationId: null };
    }
    if (source.mimeType !== "application/pdf" && source.mimeType !== DOCX_MIME) {
      return {
        error: PRESENTATION_SOURCE_UNSUPPORTED_ERROR,
        presentationId: null,
      };
    }
  }

  let created: { id: string };
  try {
    created = await insertPresentation(user.id, draft);
  } catch {
    return { error: PRESENTATION_SAVE_ERROR, presentationId: null };
  }

  try {
    await enqueueJob(
      "presentation.generate",
      { presentationId: created.id },
      { userId: user.id },
    );
  } catch {
    // A request with no job would sit at `queued` forever; settle it honestly.
    await markPresentationFailed(user.id, created.id, PRESENTATION_QUEUE_ERROR);
    return { error: PRESENTATION_QUEUE_ERROR, presentationId: null };
  }

  revalidatePath("/tools/presentation");
  return { error: null, presentationId: created.id };
}
