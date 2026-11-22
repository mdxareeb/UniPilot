/**
 * GET /api/integrations/whatsapp-groups
 *
 * The mobile app's read of the WhatsApp group-sync panel: link state, the live
 * pairing code with its expiry (only while `code_ready`), the student's groups
 * and the suggestions awaiting review. Bearer-authenticated (see
 * `lib/auth/apiAuth.ts`); every read runs with the caller's own JWT, so row
 * level security applies exactly as on the web.
 *
 * The QR the web flow uses is never returned here: a native client links with a
 * pairing code, and a login credential should not travel where it is not used.
 * Responses are never cached.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { getGroupSyncSnapshot, isGroupSyncEnabled } from "@/lib/data/groupSync";
import { WHATSAPP_GENERIC_ERROR } from "@/lib/data/integrationErrors";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const snapshot = await getGroupSyncSnapshot(auth.user.id, {
      client: auth.user.client,
    });
    return noStoreJson({
      enabled: isGroupSyncEnabled(),
      ...snapshot,
      qr: null,
    });
  } catch {
    return noStoreJson({ error: WHATSAPP_GENERIC_ERROR }, 500);
  }
}
