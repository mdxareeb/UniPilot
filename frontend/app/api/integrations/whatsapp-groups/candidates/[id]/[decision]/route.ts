/**
 * POST /api/integrations/whatsapp-groups/candidates/{id}/{decision}
 *
 * `decision` is `confirm` (add the suggestion to tasks/calendar, creating a
 * proposed NEW course only now) or `reject` (dismiss it for good: the same
 * message is never suggested again). Same service functions as the web's Server
 * Actions, behind Bearer authentication. An id that is malformed, not the
 * caller's, or already decided is a 404 with no way to tell which.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { confirmGroupCandidate, isGroupSyncEnabled } from "@/lib/data/groupSync";
import {
  WHATSAPP_CANDIDATE_NOT_FOUND_ERROR,
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_GROUPS_DISABLED_ERROR,
} from "@/lib/data/integrationErrors";
import { rejectCandidate } from "@/lib/data/integrations";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; decision: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;
  if (!isGroupSyncEnabled()) {
    return noStoreJson({ error: WHATSAPP_GROUPS_DISABLED_ERROR }, 404);
  }

  const { id, decision } = await params;
  if (!UUID_PATTERN.test(id) || (decision !== "confirm" && decision !== "reject")) {
    return noStoreJson({ error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR }, 404);
  }

  try {
    if (decision === "confirm") {
      const result = await confirmGroupCandidate(auth.user.id, id);
      if (result.status === "not-found") {
        return noStoreJson({ error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR }, 404);
      }
    } else {
      const rejected = await rejectCandidate(auth.user.id, id);
      if (!rejected) {
        return noStoreJson({ error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR }, 404);
      }
    }
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson({ error: WHATSAPP_GENERIC_ERROR }, 500);
  }
}
