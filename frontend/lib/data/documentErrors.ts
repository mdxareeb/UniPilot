/**
 * The documents domain's sanitized user-facing copy (Task 23.x), the same
 * discipline as `lib/auth/errors.ts`, `taskErrors.ts` and `eventErrors.ts`:
 * every message a document action or the upload pipeline can show lives here,
 * so a raw Supabase/Storage error, a policy name, a constraint or a stack
 * trace is never rendered. The service throws plain internal errors; the
 * actions and the client pipeline catch them and answer with these strings.
 *
 * Free of server imports so client components can use the constants without
 * pulling the server client into the browser bundle.
 */

export const DOCUMENT_INVALID_INPUT_ERROR =
  "That file isn't supported. Use PDF, DOCX, PNG or JPEG up to 25 MiB.";

export const DOCUMENT_SAVE_ERROR =
  "We couldn't save that document. Please try again.";

export const DOCUMENT_UPLOAD_ERROR =
  "We couldn't upload that file. Please try again.";

export const DOCUMENT_RENAME_ERROR =
  "We couldn't rename that document. Please try again.";

export const DOCUMENT_DELETE_ERROR =
  "We couldn't delete that document. Please try again.";

export const DOCUMENT_NOT_FOUND_ERROR = "That document no longer exists.";

export const DOCUMENT_QUOTA_ERROR =
  "You've reached the free document limit (50 documents or 250 MB). Delete a document to upload another.";
