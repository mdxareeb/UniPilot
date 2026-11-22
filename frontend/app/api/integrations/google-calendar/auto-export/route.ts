/**
 * POST /api/integrations/google-calendar/auto-export
 *
 * The outbound opt-in: push confirmed/auto-approved UniPilot deadlines to the
 * dedicated "UniPilot" calendar on the next sync. Never exports rows that were
 * imported FROM Google (the worker's loop guard).
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { setGcalAutoExport } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  let enabled: boolean;
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 400);
    }
    enabled = body.enabled;
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 400);
  }

  try {
    await setGcalAutoExport(auth.user.id, enabled);
    return noStoreJson({ ok: true, enabled });
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
