/**
 * POST /api/integrations/google-calendar/connect
 *
 * Start the mobile OAuth link: mint a single-use hashed state row and answer
 * with Google's consent URL. The app opens the system browser; the code
 * exchange happens server-side in the callback, which returns the app via
 * `unipilot://oauth/google`. No OAuth code or token ever crosses this route.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { mintGoogleOAuthState } from "@/lib/data/googleCalendar";
import { GCAL_ERRORS } from "@/lib/data/googleCalendar";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const link = await mintGoogleOAuthState(auth.user.id);
    if (link === null) {
      return noStoreJson({ error: GCAL_ERRORS.NOT_CONFIGURED }, 503);
    }
    return noStoreJson({ authorizationUrl: link.authorizationUrl });
  } catch {
    return noStoreJson({ error: GCAL_ERRORS.GENERIC }, 500);
  }
}
