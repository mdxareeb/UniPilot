/**
 * The 29.1 job-lease heartbeat (extracted from `whatsappJobs.mjs` so every
 * long-running handler shares one implementation).
 *
 * Long handlers outlive the 5-minute claim lease; `touch_job` extends it so
 * the runner's stale-lock reclaim never steals a job that is still working.
 * A reclaimed lease is reported by `finish_job`; a heartbeat failure is never
 * fatal here.
 */
const HEARTBEAT_MS = 60_000;

export function startJobHeartbeat(ctx, intervalMs = HEARTBEAT_MS) {
  const timer = setInterval(async () => {
    try {
      await ctx.client.rpc("touch_job", {
        p_job_id: ctx.jobId,
        p_worker_id: ctx.workerId,
      });
    } catch {
      // A reclaimed lease is reported by finish_job; never fatal here.
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
