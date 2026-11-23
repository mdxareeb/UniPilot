/**
 * GET /api/mobile/health
 *
 * The mobile diagnostics probe. Bearer-authenticated (so it also proves the
 * Supabase session path works) and intentionally tiny: no secrets, no model
 * names, only the facts the More panel can render honestly.
 *
 * `supabase: "ok"` means this request completed on a verified session that
 * could read the caller's onboarding row. `aiConfigured` only reports whether
 * both Gemini variables are present; it does not claim the provider is
 * reachable.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { geminiChatStatus } from "@/lib/ai/geminiChat";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  return noStoreJson({
    ok: true,
    aiConfigured: geminiChatStatus().configured,
    supabase: "ok",
    serverTime: new Date().toISOString(),
  });
}
