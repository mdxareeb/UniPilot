/**
 * Task B2 — the owner-gated asset proxy (spec §6.9).
 *
 * GET /api/presentation/{id}/asset?src=<path>
 *
 * The browser cannot put the adapter's bearer token on `<img>`/`@font-face`
 * requests, and Presenton is shared across UniPilot accounts, so every asset
 * byte reaches the native viewer through this one route:
 *
 * 1. session gate — no session → 401;
 * 2. owner read (`getPresentation`, RLS) — not owned/unknown → 404, before
 *    any engine call and with no existence oracle;
 * 3. missing row deck id → 404;
 * 4. missing or unsafe `src` (shape/prefix/traversal per `isSafeAssetPath`) →
 *    400 before any engine call;
 * 5. deck read through the adapter; engine 4xx → 404, engine/transport failure
 *    → 502 with sanitized copy;
 * 6. `classifyAssetPath` (§6.9's policy: deck membership for user-data paths,
 *    the deck's template id for `/app_data/templates/**`, engine-public
 *    `/app_data/fonts/**`, `/static/**` and `/vendor/**`) — anything not
 *    allowed → 404;
 * 7. adapter fetch — engine 4xx → 404, engine 5xx/unreachable → 502 — and the
 *    bytes come back with their extension's content type and a private cache
 *    header.
 *
 * The policy lives in `lib/presentation/assets.ts`; this file is only the
 * handler and exports only `GET`.
 */
import { sessionUser } from "@/lib/auth/session";
import { PRESENTATION_NOT_FOUND_ERROR } from "@/lib/data/presentationErrors";
import { getPresentation } from "@/lib/data/presentations";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import {
  fetchPresentationAsset,
  getPresentationDeck,
  PresentonError,
  type PresentonAsset,
} from "@/lib/integrations/presenton";
import { classifyAssetPath, isSafeAssetPath } from "@/lib/presentation/assets";
import type { PresentationDeck } from "@/lib/presentation/types";

const INVALID_SRC_ERROR = "The requested asset path isn't valid.";
const ASSET_UNAVAILABLE_ERROR =
  "This presentation's content couldn't be loaded right now. Try again in a moment.";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Engine 4xx (the asset or the deck is gone) → 404; anything else → 502. */
function engineFailure(error: unknown): Response {
  if (error instanceof PresentonError && error.code === "rejected") {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }
  return jsonError(ASSET_UNAVAILABLE_ERROR, 502);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { user } = await sessionUser();
  if (!user) {
    return jsonError("Sign in to view this presentation.", 401);
  }

  const { id } = await params;
  // `isPresentationUuid` trims before matching; the owner read must receive
  // the same trimmed value or PostgREST rejects a padded uuid with a 500.
  const presentationId = id.trim();
  if (!isPresentationUuid(presentationId)) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  const presentation = await getPresentation(user.id, presentationId);
  if (!presentation) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  const presentonPresentationId = presentation.presentonPresentationId;
  if (!presentonPresentationId) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  const src = new URL(request.url).searchParams.get("src");
  if (src === null || !isSafeAssetPath(src)) {
    return jsonError(INVALID_SRC_ERROR, 400);
  }

  let deck: PresentationDeck;
  try {
    deck = await getPresentationDeck(presentonPresentationId);
  } catch (error) {
    return engineFailure(error);
  }

  const templateId = deck.slides[0]?.layout_group ?? null;
  if (classifyAssetPath(src, deck, templateId) !== "allowed") {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  let asset: PresentonAsset;
  try {
    asset = await fetchPresentationAsset(src);
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
