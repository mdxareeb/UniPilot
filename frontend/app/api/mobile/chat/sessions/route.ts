/**
 * GET  /api/mobile/chat/sessions — the caller's Ask AI threads, newest first.
 * POST /api/mobile/chat/sessions — create a thread, optionally scoped to one
 *   subject or one document.
 *
 * Bearer-authenticated; reads run with the caller's own JWT so owner RLS is
 * the authority. Responses are never cached.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  createStudyChatSession,
  listStudyChatSessions,
  parseStudyChatScope,
  parseStudyChatTitle,
  STUDY_CHAT_COPY,
} from "@/lib/data/studyChat";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  try {
    const sessions = await listStudyChatSessions(
      auth.user.client,
      auth.user.id,
    );
    return noStoreJson({ sessions });
  } catch {
    return noStoreJson({ error: STUDY_CHAT_COPY.GENERIC }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: STUDY_CHAT_COPY.INVALID_SCOPE }, 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const title = parseStudyChatTitle(record.title);
  if (!title.ok) {
    return noStoreJson({ error: STUDY_CHAT_COPY.INVALID_TITLE }, 400);
  }

  const scope = parseStudyChatScope({
    subjectId: record.subjectId,
    documentId: record.documentId,
  });
  if (!scope.ok) {
    return noStoreJson({ error: STUDY_CHAT_COPY.INVALID_SCOPE }, 400);
  }

  try {
    const result = await createStudyChatSession(auth.user.client, auth.user.id, {
      title: title.title,
      subjectId: scope.subjectId,
      documentId: scope.documentId,
    });

    if (result.status === "invalid_scope") {
      return noStoreJson({ error: STUDY_CHAT_COPY.INVALID_SCOPE }, 400);
    }
    if (result.status === "scope_unavailable") {
      return noStoreJson({ error: STUDY_CHAT_COPY.SCOPE_UNAVAILABLE }, 404);
    }
    return noStoreJson({ session: result.session }, 201);
  } catch {
    return noStoreJson({ error: STUDY_CHAT_COPY.GENERIC }, 500);
  }
}
