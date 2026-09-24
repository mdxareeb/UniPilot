"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { templateAssetUrl } from "@/lib/presentation/assets";

/**
 * One template's art, shared by the templates browser (Task E2) and the
 * generator's Templates split (T2, generate redesign).
 *
 * Extracted from `templates/_components/TemplatesBrowser.tsx` with identical
 * markup and data attributes (the browser's live cases assert
 * `[data-template-thumb]`/`[data-template-thumb-fallback]`): the template
 * asset route is session-gated, so a signed-in reader sees the engine's own
 * thumbnail; when the engine stored none, or the bytes fail to load, the card
 * shows a neutral placeholder — never a broken image and never invented art.
 */
export function TemplateThumb({
  template,
}: {
  template: { id: string; thumbnail: string | null };
}) {
  const [failed, setFailed] = useState(false);
  const src = templateAssetUrl(template.thumbnail);

  return (
    <span className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-base border border-border bg-muted">
      {src === null || failed ? (
        <span
          data-template-thumb-fallback={template.id}
          className="flex items-center justify-center text-muted-foreground"
        >
          <ImageOff aria-hidden="true" className="size-5" />
        </span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element -- engine bytes
           stream through the session-gated template-asset route; the optimizer
           cannot carry the session and has nothing to optimize here. */
        <img
          data-template-thumb={template.id}
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}
