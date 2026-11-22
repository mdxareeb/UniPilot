/**
 * GET /api/integrations/google-calendar
 *
 * The mobile app's whole Google Calendar read: configured flag, connection
 * status, the calendar list with their import toggles, the export opt-in and
 * freshness. Bearer-authenticated; every read runs with the caller's own JWT
 * so RLS applies exactly as on the web. Never cached.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { getGoogleCalendarSnapshot } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await getGoogleCalendarSnapshot(auth.user.id, {
      client: auth.user.client,
    });
    return noStoreJson(snapshot);
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
