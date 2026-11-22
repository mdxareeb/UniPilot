/**
 * POST /api/integrations/google-calendar/sync
 *
 * The manual Sync Now guard: at least five minutes between enqueued runs,
 * then the idempotent enqueue RPC (a live job is not replaced). The answer
 * is honest in every case - `throttled`, `not_connected` or `accepted`.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { requestGcalSync } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await requestGcalSync(auth.user.id);
    return noStoreJson(result);
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
