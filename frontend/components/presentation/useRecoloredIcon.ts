/**
 * Client-side icon recolor fetching (Task D4, spec §6.5).
 *
 * An icon element (`is_icon: true`) with a `color` renders the engine's SVG
 * with its fill/stroke rewritten to that color. The SVG bytes are fetched
 * through the owner-gated asset proxy (the same URL the plain `<img>` would
 * use), transformed by the pure `recoloredIconDataUri`, and served from a
 * data URI so no engine bytes are injected into the DOM as markup.
 *
 * Honest fallbacks: while the fetch runs, and whenever it fails (a missing
 * asset, an offline browser, a non-SVG source), the caller renders the plain
 * source exactly as before — never a blank or fabricated glyph. Results are
 * cached per (source, color) for the session, bounded so a long deck cannot
 * grow the map without limit.
 */
import { useEffect, useState } from "react";
import {
  isSvgIconSource,
  normalizeIconColor,
  recoloredIconDataUri,
} from "@/lib/presentation/icons";

/** How many recolored icons one session keeps in memory. */
const RECOLOR_CACHE_LIMIT = 80;

const recolorCache = new Map<string, string>();

function rememberRecoloredIcon(key: string, uri: string): void {
  if (recolorCache.size >= RECOLOR_CACHE_LIMIT) {
    const oldest = recolorCache.keys().next().value;
    if (oldest !== undefined) recolorCache.delete(oldest);
  }
  recolorCache.set(key, uri);
}

export type RecoloredIconSource = {
  /** The URL to render: the recolored data URI when ready, else the source. */
  src: string | null;
  /** True only while `src` is the sanitized, recolored data URI. */
  recolored: boolean;
};

/**
 * Resolves one icon element's render source. `data` is the wire source (the
 * engine path that says whether the bytes are SVG); `source` is the URL the
 * bytes are fetched from (the asset-proxy URL). `deferred` is the editor's
 * insert quiet window (the hook simply waits; the caller already withholds the
 * image while it is true).
 */
export function useRecoloredIconSource({
  source,
  data,
  color,
  isIcon,
  deferred,
}: {
  source: string | null;
  data: string;
  color: string | null | undefined;
  isIcon: boolean;
  deferred: boolean;
}): RecoloredIconSource {
  const normalizedColor = isIcon ? normalizeIconColor(color) : null;
  const eligible =
    source !== null &&
    source !== "" &&
    !deferred &&
    normalizedColor !== null &&
    isSvgIconSource(data);
  const key = `${source ?? ""}\u0000${normalizedColor ?? ""}`;

  const [resolved, setResolved] = useState<{ key: string; uri: string } | null>(
    null,
  );
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!eligible || source === null || normalizedColor === null) return;
    if (recolorCache.has(key)) return;

    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(source, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("icon fetch failed");
        const uri = recoloredIconDataUri(await response.text(), normalizedColor);
        if (uri === null) throw new Error("icon isn't recolorable");
        rememberRecoloredIcon(key, uri);
        if (!cancelled) setResolved({ key, uri });
      } catch {
        if (!cancelled) setFailedKey(key);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [eligible, key, normalizedColor, source]);

  if (!eligible) return { src: source, recolored: false };
  /* The cache is read during render so a previously recolored icon needs no
     state update; the effect only fetches on a miss. */
  const cached = recolorCache.get(key);
  if (cached !== undefined) return { src: cached, recolored: true };
  if (resolved !== null && resolved.key === key) {
    return { src: resolved.uri, recolored: true };
  }
  /* Pending or failed: the original source renders, exactly as before D4. */
  if (failedKey === key) return { src: source, recolored: false };
  return { src: source, recolored: false };
}
