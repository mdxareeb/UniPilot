/**
 * The presentation tool's sanitized copy (Task 31.x) — the same posture as
 * `documentErrors.ts`: only these strings ever reach a student. Provider
 * detail, Postgres/PostgREST messages and Presenton responses stay in server
 * logs; the UI renders these verbatim.
 */
export const PRESENTATION_NOT_CONNECTED_ERROR =
  "Presentation generation isn't connected yet. It needs a configured Presenton service, and this environment doesn't have one.";

export const PRESENTATION_INVALID_INPUT_ERROR =
  "Check the topic and options, then try again.";

export const PRESENTATION_SAVE_ERROR =
  "We couldn't save this request. Try again in a moment.";

export const PRESENTATION_QUEUE_ERROR =
  "We couldn't start generating this deck. Try again in a moment.";

export const PRESENTATION_NOT_FOUND_ERROR =
  "This presentation couldn't be found.";

export const PRESENTATION_SOURCE_NOT_FOUND_ERROR =
  "The source document couldn't be found. Pick another one.";

export const PRESENTATION_SOURCE_UNSUPPORTED_ERROR =
  "Source documents must be a PDF or DOCX.";

/**
 * Task F4 — the delete flow's sanitized copy. The unreachable line is the
 * permanent honest failure: the engine did not confirm the deck's removal, so
 * nothing local was removed either and the deck row survives for a retry. The
 * document line is the same posture for the half that runs after the engine
 * delete answered (a retry is idempotent there — the engine answers 404).
 */
export const PRESENTATION_DELETE_ERROR =
  "We couldn't delete this deck. Try again in a moment.";

export const PRESENTATION_DELETE_DOCUMENT_ERROR =
  "This deck's file couldn't be removed from Documents, so the deck is still listed. Try again to finish deleting it.";

export const PRESENTATION_DELETE_UNREACHABLE_ERROR =
  "The presentation service didn't answer, so this deck wasn't deleted. Try again in a moment.";

export const PRESENTATION_DELETE_IN_FLIGHT_ERROR =
  "This deck is still being generated or exported. Try again once it has finished.";
