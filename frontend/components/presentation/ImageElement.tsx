/**
 * `image` elements (Task B3, spec §6.5; icon recolor added in D4).
 *
 * The fork's `renderImage`: `object-fit` from `fit`, `object-position` from
 * `focus_x/y` (clamped, 50% defaults), `crop_scale` as an overflow-hidden
 * wrapper with a scaled image, `clip_path` validated to the five shape
 * functions, radius/flip/opacity from `boxStyle`.
 *
 * Icon images (`is_icon: true`) with a `color` are fetched through the asset
 * proxy, recolored client-side and rendered from a sanitized data URI
 * (`useRecoloredIconSource`, spec §6.5/§7.4); every other icon and every image
 * renders exactly as before. A fetch failure falls back to the plain source —
 * never a blank or a fabricated glyph.
 *
 * One editor-driven behavior (Task D3): the asset proxy only serves a user-data
 * path once the stored deck references it, so an image inserted in the editor
 * would fail its first proxy request while the slide save is still in flight.
 * A source that changed at runtime waits out the autosave debounce
 * (`useDeferredImageSource`); if a load still fails (a slow save, a genuinely
 * missing asset) the `<img>` retries a bounded number of times with a
 * cache-busting query — the same URL starts resolving the moment the save
 * lands — and then stops instead of hammering.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { deckAssetUrl, elementBox } from "@/lib/presentation/elements";
import type { ImageElement as ImageElementModel } from "@/lib/presentation/types";
import { useRecoloredIconSource } from "./useRecoloredIcon";
import { useDeckStage } from "./StageContext";
import {
  boxStyle,
  clipPathCss,
  frameStyle,
  type RenderMode,
} from "./style";
import { useDeferredImageSource } from "./useDeferredImageSource";

/** How many times a failed asset load is retried, and the wait between tries. */
const ASSET_RETRY_LIMIT = 3;
const ASSET_RETRY_MS = 2_000;

function objectPosition(element: ImageElementModel): string | undefined {
  if (element.focus_x == null && element.focus_y == null) return undefined;
  const x = Math.min(Math.max(element.focus_x ?? 50, 0), 100);
  const y = Math.min(Math.max(element.focus_y ?? 50, 0), 100);
  return `${x}% ${y}%`;
}

function cropScale(element: ImageElementModel): number {
  if (element.crop_scale == null) return 1;
  return Math.min(Math.max(element.crop_scale, 1), 6);
}

export function ImageElement({
  element,
  mode,
}: {
  element: ImageElementModel;
  mode: RenderMode;
}) {
  const { id } = useDeckStage();
  const source = deckAssetUrl(id, element.data);
  const [attempts, setAttempts] = useState(0);
  const retryTimer = useRef<number | null>(null);
  /* A runtime-changed proxied source (an editor insert) waits for its slide
     save so the first proxy request is already allowed — see the hook. */
  const deferred = useDeferredImageSource(source, element.data);
  /* A colored icon renders from a recolored data URI; every other source and
     every failure reads back as the plain source (D4, spec §6.5). */
  const icon = useRecoloredIconSource({
    source,
    data: element.data,
    color: element.color,
    isIcon: element.is_icon === true,
    deferred,
  });

  /* A replaced source is a fresh load: its failure budget restarts. */
  const [trackedSource, setTrackedSource] = useState(source);
  if (trackedSource !== source) {
    setTrackedSource(source);
    setAttempts(0);
  }

  useEffect(
    () => () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    [],
  );

  if (!source || deferred) return null;

  /* Bounded retry of a failed load; the query makes the retry a new request
     even when the browser heuristically cached the failure. A recolored data
     URI has no load to retry and is never cache-busted. */
  const recolored = icon.recolored && icon.src !== null;
  const retrySrc =
    attempts === 0
      ? source
      : `${source}${source.includes("?") ? "&" : "?"}asset-retry=${attempts}`;
  const src: string =
    icon.recolored && icon.src !== null ? icon.src : retrySrc;
  const onAssetError = recolored
    ? undefined
    : () => {
        if (attempts >= ASSET_RETRY_LIMIT || retryTimer.current !== null) return;
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = null;
          setAttempts((current) => current + 1);
        }, ASSET_RETRY_MS);
      };

  const box = elementBox(element);
  const frame = frameStyle(box, mode);
  const boxCss = boxStyle(element);
  const clip = clipPathCss(element.clip_path);
  const fit =
    element.fit === "cover" || element.fit === "fill" ? element.fit : "contain";
  const position = objectPosition(element);
  const scale = cropScale(element);
  const imageStyle: CSSProperties = {
    display: "block",
    maxWidth: "none",
    maxHeight: "none",
    objectFit: fit,
    ...(position ? { objectPosition: position } : {}),
  };
  const clipStyle: CSSProperties = clip
    ? { clipPath: clip, WebkitClipPath: clip }
    : {};

  if (scale > 1 || clip) {
    return (
      <div
        style={{
          ...frame,
          ...boxCss,
          ...clipStyle,
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- deck bytes
            stream through the owner-gated asset proxy (spec §6.9); the optimizer
            cannot re-request them and crop/clip semantics are exact here. */}
        <img
          alt=""
          draggable={false}
          data-deck-icon={element.is_icon ? "true" : undefined}
          data-deck-icon-recolored={recolored ? "true" : undefined}
          src={src}
          onError={onAssetError}
          style={{
            ...imageStyle,
            width: "100%",
            height: "100%",
            ...(scale > 1
              ? {
                  transform: `scale(${scale})`,
                  transformOrigin: position ?? "center",
                }
              : {}),
          }}
        />
      </div>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- deck bytes stream
       through the owner-gated asset proxy (spec §6.9); the optimizer cannot
       re-request them and crop/clip semantics are exact here. */
    <img
      alt=""
      draggable={false}
      data-deck-icon={element.is_icon ? "true" : undefined}
      data-deck-icon-recolored={recolored ? "true" : undefined}
      src={src}
      onError={onAssetError}
      style={{ ...frame, ...boxCss, ...imageStyle }}
    />
  );
}
