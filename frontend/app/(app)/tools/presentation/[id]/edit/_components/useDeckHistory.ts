"use client";

/**
 * Undo/redo for the native editor (Task C4, spec §5.4: client snapshots ≤30,
 * Mod+Z / Mod+Shift+Z / Mod+Y).
 *
 * Every edit commits a full editor state (slides + theme + title) through
 * `apply`; rapid edits of the same kind coalesce into one snapshot so a typing
 * burst is one undo step. Snapshots are references to immutable state — the
 * editor never mutates a slide in place — so a snapshot is simply a pointer.
 * `replace` applies an engine acknowledgement (fresh slide ids after a
 * structural save) without polluting history, and `bumpRevision` records that
 * the loaded deck revision moved, which the autosave hook uses to drop
 * debounced saves whose content a newer write already carried.
 *
 * `undo`/`redo` return the state they restored (or null), so a caller can act
 * on the result in the same tick instead of waiting for a re-render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
} from "@/lib/presentation/types";

export type DeckEditState = {
  slides: DeckSlide[];
  theme: DeckTheme | DeckThemePackage | null;
  title: string;
};

const HISTORY_LIMIT = 30;
const COALESCE_MS = 800;

type Snapshot = { state: DeckEditState; reason: string; at: number };

export type DeckHistory = {
  state: DeckEditState;
  /** Increments when the loaded deck revision changes (structural ack). */
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Records the previous state and applies the next one. */
  apply: (next: DeckEditState, reason: string) => void;
  /** Applies engine-acknowledged state without recording history. */
  replace: (next: DeckEditState) => void;
  /** Marks the loaded revision changed; returns the new revision number. */
  bumpRevision: () => number;
  /** Restores the previous snapshot; returns it for same-tick scheduling. */
  undo: () => DeckEditState | null;
  /** Re-applies the next snapshot; returns it for same-tick scheduling. */
  redo: () => DeckEditState | null;
  /** The latest state, readable synchronously from save callbacks. */
  getState: () => DeckEditState;
};

export function useDeckHistory(initial: DeckEditState): DeckHistory {
  const [state, setState] = useState(initial);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [revision, setRevision] = useState(0);

  const revisionRef = useRef(0);
  const stateRef = useRef(state);
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const apply = useCallback((next: DeckEditState, reason: string) => {
    const now = Date.now();
    const entries = pastRef.current;
    const last = entries[entries.length - 1];
    if (!(last && last.reason === reason && now - last.at < COALESCE_MS)) {
      const appended = [
        ...entries,
        { state: stateRef.current, reason, at: now },
      ];
      pastRef.current =
        appended.length > HISTORY_LIMIT
          ? appended.slice(appended.length - HISTORY_LIMIT)
          : appended;
      setPast(pastRef.current);
    }
    futureRef.current = [];
    setFuture(futureRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const replace = useCallback((next: DeckEditState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Marks the loaded revision changed and answers the new revision so a
      caller can re-base the targets the write did not supersede. */
  const bumpRevision = useCallback((): number => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    return revisionRef.current;
  }, []);

  const undo = useCallback((): DeckEditState | null => {
    const entries = pastRef.current;
    if (entries.length === 0) return null;
    const previous = entries[entries.length - 1];
    pastRef.current = entries.slice(0, -1);
    futureRef.current = [
      ...futureRef.current,
      { state: stateRef.current, reason: "undo", at: Date.now() },
    ].slice(-HISTORY_LIMIT);
    setPast(pastRef.current);
    setFuture(futureRef.current);
    stateRef.current = previous.state;
    setState(previous.state);
    return previous.state;
  }, []);

  const redo = useCallback((): DeckEditState | null => {
    const entries = futureRef.current;
    if (entries.length === 0) return null;
    const next = entries[entries.length - 1];
    futureRef.current = entries.slice(0, -1);
    pastRef.current = [
      ...pastRef.current,
      { state: stateRef.current, reason: "redo", at: Date.now() },
    ].slice(-HISTORY_LIMIT);
    setPast(pastRef.current);
    setFuture(futureRef.current);
    stateRef.current = next.state;
    setState(next.state);
    return next.state;
  }, []);

  const getState = useCallback(() => stateRef.current, []);

  return {
    state,
    revision,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    apply,
    replace,
    bumpRevision,
    undo,
    redo,
    getState,
  };
}
