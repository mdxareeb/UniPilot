/**
 * POST /api/integrations/whatsapp-groups/disconnect
 *
 * Disconnect (or cancel an unfinished link) for the signed-in student. With a
 * running bridge it logs the device out and forgets every secret; without one
 * the secrets are forgotten here and the response says to also remove the
 * device from WhatsApp > Linked devices. Captured message text is deleted now;
 * tasks, events and files already saved stay.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { isGroupSyncEnabled, requestGroupDisconnect } from "@/lib/data/groupSync";
import {
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_GROUPS_DISABLED_ERROR,
  WHATSAPP_GROUPS_FORGOTTEN_NOTE,
} from "@/lib/data/integrationErrors";

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;
  if (!isGroupSyncEnabled()) {
    return noStoreJson({ error: WHATSAPP_GROUPS_DISABLED_ERROR }, 404);
  }

  try {
    const outcome = await requestGroupDisconnect(auth.user.id);
    return noStoreJson(
      outcome === "forgotten"
        ? { ok: true, notice: WHATSAPP_GROUPS_FORGOTTEN_NOTE }
        : { ok: true },
    );
  } catch {
    return noStoreJson({ error: WHATSAPP_GENERIC_ERROR }, 500);
  }
}
