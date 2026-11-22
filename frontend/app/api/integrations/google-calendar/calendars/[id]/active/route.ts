/**
 * POST /api/integrations/google-calendar/calendars/[id]/active
 *
 * The owner's per-calendar import toggle. Scoped by id+user through the
 * service client; an id that is malformed, not the caller's, or already
 * gone is a 404 with no way to tell which.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { setGoogleCalendarActive } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 404);
  }

  let active: boolean;
  try {
    const body = (await request.json()) as { active?: unknown };
    if (typeof body.active !== "boolean") {
      return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 400);
    }
    active = body.active;
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 400);
  }

  try {
    const ok = await setGoogleCalendarActive(auth.user.id, id, active);
    if (!ok) return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 404);
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
