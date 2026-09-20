/**
 * Task E2 — the session-gated template-asset route (spec §5.1 rows 7–8).
 *
 * GET /api/presentation/template-asset?src=<path>
 *
 * Template thumbnails and preview assets are engine-public (`/static/**`,
 * `/app_data/templates/**`, `/app_data/fonts/**`, `/vendor/**`): they are the
 * engine's packaged template art and fonts, shared across every deck that
 * uses the template and carrying no deck or user data. The browser cannot put
 * the adapter's bearer on `<img>`/`@font-face` requests, so those bytes reach
 * it through this one route — with a session gate (UniPilot's own auth), but
 * without the owner-gated proxy's deck-membership check, which exists to
 * protect user-data paths and has nothing to protect here.
 *
 * Order of decisions:
 * 1. session gate — no session → 401;
 * 2. missing or unsafe `src` (shape/prefix/traversal per `isSafeAssetPath`) →
 *    400 before any engine call;
 * 3. `src` outside the engine-public mounts (`/app_data/templates/**`,
 *    `/app_data/fonts/**`, `/static/**`, `/vendor/**`) → 404. Everything else
 *    under `/app_data/` (images, uploads, exports, `pptx-to-*`) is user data
 *    and is not reachable here at all — it belongs to the owner-gated proxy;
 * 4. adapter fetch — the adapter re-enforces the same guard, engine 4xx →
 *    404, engine/transport failure → 502 with sanitized copy;
 * 5. bytes come back with their extension's content type and a private cache
 *    header (the same policy as the owner-gated proxy).
 *
 * The policy lives in `lib/presentation/assets.ts`; this file is only the
 * handler and exports only `GET`.
 */
import { sessionUser } from "@/lib/auth/session";
import {
  fetchPresentationTemplateAsset,
  PresentonError,
  type PresentonAsset,
} from "@/lib/integrations/presenton";
import { isEnginePublicAssetPath, isSafeAssetPath } from "@/lib/presentation/assets";

const INVALID_SRC_ERROR = "The requested asset path isn't valid.";
const NOT_A_TEMPLATE_ASSET_ERROR = "This template asset couldn't be found.";
const ASSET_UNAVAILABLE_ERROR =
  "This template's art couldn't be loaded right now. Try again in a moment.";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Engine 4xx (the asset is gone) → 404; anything else → 502. */
function engineFailure(error: unknown): Response {
  if (error instanceof PresentonError && error.code === "rejected") {
    return jsonError(NOT_A_TEMPLATE_ASSET_ERROR, 404);
  }
  return jsonError(ASSET_UNAVAILABLE_ERROR, 502);
}

export async function GET(request: Request): Promise<Response> {
  const { user } = await sessionUser();
  if (!user) {
    return jsonError("Sign in to view templates.", 401);
  }

  const src = new URL(request.url).searchParams.get("src");
  if (src === null || !isSafeAssetPath(src)) {
    return jsonError(INVALID_SRC_ERROR, 400);
  }
  if (!isEnginePublicAssetPath(src)) {
    return jsonError(NOT_A_TEMPLATE_ASSET_ERROR, 404);
  }

  let asset: PresentonAsset;
  try {
    asset = await fetchPresentationTemplateAsset(src);
  } catch (error) {
    return engineFailure(error);
  }

  return new Response(asset.bytes, {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "cache-control": "private, max-age=300",
    },
  });
}
