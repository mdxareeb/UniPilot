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
