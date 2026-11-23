/**
 * GET /api/mobile/health
 *
 * The mobile diagnostics probe. Bearer-authenticated (so it also proves the
 * Supabase session path works) and intentionally tiny: no secrets, no model
 * names, only booleans the More panel can render honestly.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  return noStoreJson({
    ok: true,
    aiConfigured: Boolean(
      process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_MODEL?.trim(),
    ),
    serverTime: new Date().toISOString(),
  });
}
