/**
 * POST /api/integrations/google-calendar/disconnect
 *
 * Revoke the stored Google token (best-effort), forget the encrypted
 * credentials, wipe the calendars/cursors and settle the row `disconnected`.
 * Imported events keep their rows; events already exported to the user's
 * Google Calendar are left in place - the response says so.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { disconnectGoogleCalendar } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const { notice } = await disconnectGoogleCalendar(auth.user.id);
    return noStoreJson({ ok: true, notice });
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
