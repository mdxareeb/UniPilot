"use client";

/**
 * The client-side quiet window for a just-changed engine image source (Task
 * D3). The owner-gated asset proxy only serves a user-data path once the
 * stored deck references it, so an image inserted in the editor would 404
 * during the autosave debounce — a console error whose only purpose is to be
 * retried. Deferring the first proxy request for a source that changed while
 * the component was mounted lets the save land first; an initial page load
 * (viewer, reload) never defers because its source was already referenced.
 *
 * Pure UI state: the source bytes and the wire `data` are untouched. The one
 * exemption is the engine-public mounts (`/static/**`, `/vendor/**`,
 * `/app_data/fonts/**`): the proxy serves those with the traversal guard alone
 * (spec §6.9), so a runtime-changed icon or vendored font renders immediately
 * instead of waiting out a save it does not depend on.
 */
import { useEffect, useState } from "react";
import { isEnginePublicImageSource } from "@/lib/presentation/imageScope";

/** The editor's autosave debounce is 2 s; allow the write a small margin. */
export const ASSET_INSERT_QUIET_MS = 2_500;

/** True for sources that go through the owner-gated asset proxy. */
export function isProxiedSource(source: string | null): boolean {
  return source !== null && source.startsWith("/api/presentation/");
}

/** True while a runtime-changed proxied source waits for its slide save. */
export function useDeferredImageSource(
  source: string | null,
  data: string,
): boolean {
  const [trackedData, setTrackedData] = useState(data);
  const [deferred, setDeferred] = useState(false);

  if (trackedData !== data) {
    setTrackedData(data);
    setDeferred(isProxiedSource(source) && !isEnginePublicImageSource(data));
  }

  useEffect(() => {
    if (!deferred) return;
    const timer = window.setTimeout(
      () => setDeferred(false),
      ASSET_INSERT_QUIET_MS,
    );
    return () => window.clearTimeout(timer);
  }, [deferred, trackedData]);

  return deferred;
}
