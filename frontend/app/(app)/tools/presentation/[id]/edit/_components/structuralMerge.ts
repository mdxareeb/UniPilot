/**
 * The structural-save acknowledgement merge (Task C4 review fix).
 *
 * A full-array save rotates every slide id (the engine's replace path
 * re-inserts the rows), and the request crosses the network: edits can land
 * while it is in flight. Applying the acknowledgement naively — replacing the
 * local deck with the pre-await snapshot and its fresh ids — would silently
 * drop those edits (their slide ids no longer exist) even though the autosave
 * reports "Saved".
 *
 * This module is the pure reconciliation: given the snapshot that was sent,
 * the same content returned with fresh ids, and the latest local state, it
 * answers
 *
 * - the local slides after the ack (`slides`),
 * - the old-id → new-id map by position (`idMap`), and
 * - which slides carry newer content that the write did not include and must
 *   be saved again (`resaveSlideIds`).
 *
 * When a **newer structural edit** landed during the save (the id sequence
 * changed: add/delete/reorder), the acknowledgement cannot be mapped onto the
 * local state positionally. The newer local state is the newest intent, so it
 * is returned untouched (`diverged: true`); the pending structural target
 * re-fires and rewrites the whole array, and the editor drops the pending
 * per-slide targets that the newer full-array write supersedes.
 *
 * Pure and client-safe: no React, no I/O, no mutation of its inputs.
 */
import type { DeckSlide } from "@/lib/presentation/types";

export type StructuralAckMerge = {
  /** The local slides to adopt after the acknowledgement. */
  slides: DeckSlide[];
  /** Every old slide id that stayed by position, mapped to its fresh id. */
  idMap: Map<string, string>;
  /** True when a newer structural edit supersedes the acknowledgement. */
  diverged: boolean;
  /** New ids of slides whose newer content must be re-saved. */
  resaveSlideIds: string[];
};

function sameIdSequence(a: DeckSlide[], b: DeckSlide[]): boolean {
  return a.length === b.length && a.every((slide, index) => slide.id === b[index].id);
}

export function mergeStructuralAck(input: {
  /** The slides the structural request carried (their original ids). */
  snapshot: DeckSlide[];
  /** The same content with the fresh ids the request sent. */
  acknowledged: DeckSlide[];
  /** The editor's state once the request resolved. */
  latest: DeckSlide[];
}): StructuralAckMerge {
  const { snapshot, acknowledged, latest } = input;

  const idMap = new Map<string, string>();
  const pairs = Math.min(snapshot.length, acknowledged.length);
  for (let index = 0; index < pairs; index += 1) {
    idMap.set(snapshot[index].id, acknowledged[index].id);
  }

  if (!sameIdSequence(snapshot, latest)) {
    // A newer structural edit landed during the save: keep its state, let the
    // pending structural target re-save it, and leave the id map for the
    // editor's diagnostics only (positions no longer line up).
    return { slides: latest, idMap, diverged: true, resaveSlideIds: [] };
  }

  const resaveSlideIds: string[] = [];
  const slides = acknowledged.map((fresh, index) => {
    const latestSlide = latest[index];
    if (latestSlide === snapshot[index]) return fresh;
    // Content edited during the save: keep the newer object, adopt the fresh
    // id so the follow-up `slide_update` targets the row the engine stores.
    resaveSlideIds.push(fresh.id);
    return { ...latestSlide, id: fresh.id, index };
  });

  return { slides, idMap, diverged: false, resaveSlideIds };
}
