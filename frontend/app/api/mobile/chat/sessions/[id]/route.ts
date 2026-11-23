/**
 * GET    /api/mobile/chat/sessions/{id} — one thread with its ordered turns.
 * DELETE /api/mobile/chat/sessions/{id} — owner-scoped delete (messages cascade).
 *
 * A malformed, missing or foreign id is the same 404: the route never reveals
 * whether another student's thread exists.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  deleteStudyChatSession,
  getStudyChatSession,
  isStudyChatId,
  STUDY_CHAT_COPY,
} from "@/lib/data/studyChat";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isStudyChatId(id)) {
    return noStoreJson({ error: STUDY_CHAT_COPY.NOT_FOUND }, 404);
  }

  try {
    const session = await getStudyChatSession(
      auth.user.client,
      auth.user.id,
      id,
    );
    if (session === null) {
      return noStoreJson({ error: STUDY_CHAT_COPY.NOT_FOUND }, 404);
    }
    return noStoreJson({ session });
  } catch {
    return noStoreJson({ error: STUDY_CHAT_COPY.GENERIC }, 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isStudyChatId(id)) {
    return noStoreJson({ error: STUDY_CHAT_COPY.NOT_FOUND }, 404);
  }

  try {
    const deleted = await deleteStudyChatSession(
      auth.user.client,
      auth.user.id,
      id,
    );
    if (!deleted) {
      return noStoreJson({ error: STUDY_CHAT_COPY.NOT_FOUND }, 404);
    }
    return noStoreJson({ ok: true });
  } catch {
    return noStoreJson({ error: STUDY_CHAT_COPY.GENERIC }, 500);
  }
}
