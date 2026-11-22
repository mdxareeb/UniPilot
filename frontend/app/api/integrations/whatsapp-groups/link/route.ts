/**
 * POST /api/integrations/whatsapp-groups/link   { "phone": "+91 98765 43210" }
 *
 * Starts a PAIRING-CODE link for the signed-in student (the mobile flow: a QR on
 * the phone cannot be scanned by the same phone). The number is sanitised to
 * digits-only E.164 (`919876543210`), validated again in the database, stored
 * encrypted next to the session secrets and deleted when the attempt ends. The
 * bridge then asks WhatsApp for the 8-character code, which the app reads from
 * GET /api/integrations/whatsapp-groups while the state is `code_ready`.
 *
 * Responses never echo the number. A malformed one is a 400 with plain-language
 * copy; a second request while one is in flight is a 429; an already-linked
 * account is a 409.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  GroupAlreadyLinkedError,
  GroupLinkThrottledError,
  InvalidPhoneError,
  isGroupSyncEnabled,
  requestGroupLink,
} from "@/lib/data/groupSync";
import { PHONE_REJECTION_COPY } from "@/lib/data/groupSyncValues";
import {
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_GROUPS_DISABLED_ERROR,
} from "@/lib/data/integrationErrors";

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;
  if (!isGroupSyncEnabled()) {
    return noStoreJson({ error: WHATSAPP_GROUPS_DISABLED_ERROR }, 404);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return noStoreJson({ error: "That request is too large." }, 413);
  }

  let phone: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return noStoreJson({ error: "That request is too large." }, 413);
    }
    const body: unknown = JSON.parse(text);
    phone =
      typeof body === "object" && body !== null
        ? (body as { phone?: unknown }).phone
        : undefined;
  } catch {
    return noStoreJson({ error: PHONE_REJECTION_COPY.empty, field: "phone" }, 400);
  }

  try {
    await requestGroupLink(auth.user.id, { method: "pairing_code", phone });
    return noStoreJson({ ok: true });
  } catch (error) {
    if (error instanceof InvalidPhoneError) {
      return noStoreJson(
        { error: PHONE_REJECTION_COPY[error.reason], field: "phone" },
        400,
      );
    }
    if (error instanceof GroupAlreadyLinkedError) {
      return noStoreJson({ error: "WhatsApp is already linked. Disconnect first." }, 409);
    }
    if (error instanceof GroupLinkThrottledError) {
      return noStoreJson(
        { error: "A link request is already in progress. Wait a few seconds." },
        429,
      );
    }
    return noStoreJson({ error: WHATSAPP_GENERIC_ERROR }, 500);
  }
}
