/**
 * The presentations service (Task 31.x) — server-only.
 *
 * Same split as `documents.ts` and `jobs.ts` combine:
 * - **reads** use the request-scoped cookie client: the owner-SELECT RLS
 *   policy on `public.presentations` is the enforcement layer;
 * - **writes** use the service role, exactly like `enqueueJob` — the table has
 *   no client write policy (mirroring `public.jobs`, 29.1), so the only honest
 *   writers are this module (called from a gated Server Action) and the Node
 *   worker. A caller's `userId` always comes from the verified session; the
 *   service role is never reachable from the browser.
 *
 * The worker cannot import this module (`backend/worker` is plain `.mjs`, no
 * TS build step); it reads and settles the row through its own service client,
 * mirroring these shapes. `docs/integrations/presenton.md` is the shared
 * contract.
 */
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readProfileTimeZone } from "./profileTime";
import {
  presentationRowToItem,
  type PresentationDocumentRow,
  type PresentationDraft,
  type PresentationItem,
  type PresentationRow,
} from "./presentationValues";

/**
 * The row + its generated-document embed (many-to-one: an object or null at
 * runtime; the array case is defensive only). Written as one literal — a
 * concatenated string would widen to `string` and lose supabase-js's typed
 * parse of the embedded select.
 */
const PRESENTATION_SELECT =
  "id, prompt, template, n_slides, format, status, error_message, slides_done, slides_total, document_id, presenton_presentation_id, created_at, export_status, export_error_message, exported_at, document:documents!presentations_document_id_fkey ( id, name, mime_type, size_bytes )";

type PresentationQueryRow = PresentationRow & {
  document: PresentationDocumentRow | PresentationDocumentRow[] | null;
};

function toItem(row: PresentationQueryRow, timeZone: string): PresentationItem {
  const embed = row.document;
  const document = Array.isArray(embed) ? (embed[0] ?? null) : embed;
  return presentationRowToItem(row, document, timeZone);
}

/** One owned presentation by immutable id, or null when it is not ours. */
export async function getPresentation(
  userId: string,
  presentationId: string,
): Promise<PresentationItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("presentations")
      .select(PRESENTATION_SELECT)
      .eq("id", presentationId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load presentation.");
  return result.data ? toItem(result.data as PresentationQueryRow, timeZone) : null;
}

/**
 * The most recent request, whatever its state — what the tool page shows when
 * the student returns mid-generation or after a failure.
 */
export async function getLatestPresentation(
  userId: string,
): Promise<PresentationItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("presentations")
      .select(PRESENTATION_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load presentation.");
  return result.data ? toItem(result.data as PresentationQueryRow, timeZone) : null;
}

/** The decks list's page bound (Task F1): `listPresentations` refuses more. */
const PRESENTATION_LIST_MAX = 100;

/**
 * The owner's requests, newest first (Task F1) — the tool page's "My decks".
 *
 * Same read posture as `getPresentation`/`getLatestPresentation`: the
 * request-scoped cookie client, with the owner-SELECT RLS policy as the
 * enforcement layer, selecting the item fields plus the generated-document
 * embed and mapping through `presentationRowToItem` — so a list row renders
 * from exactly the shape the run panel uses, never a second mapping.
 *
 * `limit` is validated rather than clamped: the only caller passes the page's
 * own size, and a bad value there is a programming error that must be loud,
 * not a silently different list.
 */
export async function listPresentations(
  userId: string,
  limit = 20,
): Promise<PresentationItem[]> {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > PRESENTATION_LIST_MAX
  ) {
    throw new Error(
      `Presentation list limit must be a whole number from 1 to ${PRESENTATION_LIST_MAX}.`,
    );
  }

  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("presentations")
      .select(PRESENTATION_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(limit),
  ]);

  if (result.error) throw new Error("Failed to load presentations.");
  return (result.data ?? []).map((row) =>
    toItem(row as PresentationQueryRow, timeZone),
  );
}

/**
 * The `documentId → presentationId` links behind `/documents` provenance
 * (Task F2, spec §9).
 *
 * The documents hub needs exactly one fact per generated deck — which
 * presentation owns this document — so this read selects two columns instead
 * of `listPresentations`'s full item payload + document embed, through the
 * same owner-scoped request client (the owner-SELECT RLS policy is the
 * enforcement layer). Rows without a stored document are dropped by the
 * query; the result is a plain serializable record because it crosses the
 * server → client boundary as a workspace prop.
 *
 * Newest first, bounded by the deck list's own cap: a user's generated
 * documents are already bounded by the free-tier document guard (23.12,
 * 50 rows), so the cap is comfortably above anything this map can hold.
 */
export async function listPresentationDocumentLinks(
  userId: string,
): Promise<Record<string, string>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("presentations")
    .select("id, document_id")
    .eq("user_id", userId)
    .not("document_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(PRESENTATION_LIST_MAX);

  if (error) throw new Error("Failed to load presentation documents.");

  const links: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.document_id !== null) links[row.document_id] = row.id;
  }
  return links;
}

/**
 * Whether the owner has an export in flight that the mirror does not show yet
 * (Task C4).
 *
 * The `export_status` mirror is worker-written (C1): between the editor's
 * `requestExportAction` enqueue and the worker's first mirror write the row
 * still reads null/old, so the editor would look idle although a real job is
 * queued. This read consults the owner-visible `jobs` row itself (RLS
 * `jobs_select_own`, select-only) instead of inventing a second writer for the
 * mirror. A read failure answers `false` — the editor then falls back to the
 * mirror's own state rather than claiming an export it cannot prove.
 */
export async function hasPendingPresentationExport(
  userId: string,
  presentationId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "presentation.export")
    .in("status", ["queued", "running"])
    .contains("payload", { presentationId })
    .limit(1);

  if (error) return false;
  return (data ?? []).length > 0;
}

/** Creates the request row the worker will claim. Service role (no client write). */
export async function insertPresentation(
  userId: string,
  draft: PresentationDraft,
): Promise<{ id: string }> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("presentations")
    .insert({
      user_id: userId,
      prompt: draft.prompt,
      template: draft.template,
      n_slides: draft.nSlides,
      format: draft.format,
      language: draft.language,
      instructions: draft.instructions,
      tone: draft.tone,
      verbosity: draft.verbosity,
      include_table_of_contents: draft.includeTableOfContents,
      include_title_slide: draft.includeTitleSlide,
      source_document_ids: draft.sourceDocumentIds,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error("Failed to create presentation.");
  return { id: data.id };
}

/**
 * The enqueue-failure settle: a row whose job never started must not sit at
 * `queued` forever pretending something is working. Best-effort by design —
 * the action already has its error to return; a failed settle is logged by the
 * caller's catch, not surfaced as a second failure.
 */
export async function markPresentationFailed(
  userId: string,
  presentationId: string,
  message: string,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase
      .from("presentations")
      .update({ status: "failed", error_message: message })
      .eq("id", presentationId)
      .eq("user_id", userId);
  } catch {
    // Best effort; the action's error response is the user-facing outcome.
  }
}

/** The generated-document join type exported for the tool page's clarity. */
export type PresentationItemRow = Database["public"]["Tables"]["presentations"]["Row"];
