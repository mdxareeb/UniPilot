/**
 * The job enqueue helper (Task 29.1) — server-only.
 *
 * Decision (recorded in TASK.md 29.1): enqueue writes through the **service
 * role**, not the session. `jobs` deliberately has no client INSERT policy —
 * a student's browser (or even a session-scoped server read) cannot create
 * work — so the only honest writer is the server process that owns the
 * service key. Call `enqueueJob` from a Server Action *after* its own
 * `requireOnboardedUser` gate; the action keeps its sanitized error contract
 * by catching this helper's internal throw.
 *
 * `userId` is the owner the job will be visible to (RLS SELECT) and whose
 * deletion cascades the job; omit it for system jobs. `runAfter` schedules
 * the earliest claim time. `payload` must be JSON-serializable and must never
 * carry secrets — the worker's logging contract assumes ids, not credentials.
 */
import { createServiceClient } from "@/lib/supabase/service";

export type EnqueueJobOptions = {
  /** Earliest time the worker may claim the job. Defaults to now. */
  runAfter?: Date;
  /** The job's owner (for RLS visibility and cascade); null = system job. */
  userId?: string | null;
};

const JOB_KIND_MAX_LENGTH = 100;

/**
 * Inserts one queued job and returns its id. Throws an internal Error on
 * invalid input or a failed write; the caller (a Server Action) maps that to
 * its own sanitized copy. No raw Postgres/PostgREST message ever leaves here.
 */
export async function enqueueJob(
  kind: string,
  payload: Record<string, unknown> = {},
  options: EnqueueJobOptions = {},
): Promise<string> {
  const trimmedKind = kind.trim();
  if (trimmedKind === "" || trimmedKind.length > JOB_KIND_MAX_LENGTH) {
    throw new Error("Failed to enqueue job.");
  }

  const runAfter = options.runAfter ?? new Date();
  if (!(runAfter instanceof Date) || Number.isNaN(runAfter.getTime())) {
    throw new Error("Failed to enqueue job.");
  }

  // Round-trip the payload so a circular reference (or a top-level undefined)
  // is rejected here rather than by JSONB on the wire.
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("Failed to enqueue job.");
  }
  if (typeof serialized !== "string") {
    throw new Error("Failed to enqueue job.");
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      kind: trimmedKind,
      payload: JSON.parse(serialized),
      user_id: options.userId ?? null,
      run_after: runAfter.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Failed to enqueue job.");
  }

  return data.id;
}
