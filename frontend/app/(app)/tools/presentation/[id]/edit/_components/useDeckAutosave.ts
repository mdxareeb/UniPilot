"use client";

/**
 * The editor's autosave (Task C4, spec §7.10): a 2 s debounce, exactly one
 * in-flight mutation, visible Saving/Saved/Error states, and a stale-revision
 * guard.
 *
 * Callers mark targets dirty — a single slide (`text`/`notes` writes), deck
 * metadata (title/theme) or the structural array — and the hook coalesces a
 * debounce window into one save. A target whose revision no longer matches is
 * dropped (its content was carried by a newer write). A structural save
 * crosses the wire with rotating slide ids, so its acknowledgement hands the
 * hook an `ack` binding: pending targets that landed **during** the write are
 * re-keyed onto the fresh ids and re-based onto the new revision, so they
 * re-save instead of being dropped or aimed at dead ids (review fix). When
 * edits land during any save they are kept pending and flushed immediately
 * after; a failure keeps its targets so the UI can retry the exact batch.
 *
 * The save callback and the revision are read through refs that effects keep
 * current, so the flush always sees the latest props without re-creating the
 * timer machinery on every render.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveTarget =
  | { kind: "slide"; slideId: string }
  | { kind: "meta" }
  | { kind: "structure" };

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const FALLBACK_ERROR = "We couldn't save that change. Try again in a moment.";

const targetKey = (target: SaveTarget): string =>
  target.kind === "slide" ? `slide:${target.slideId}` : target.kind;

type PendingEntry = { target: SaveTarget; revision: number };

/**
 * What a structural write tells the autosave once it resolves (review fix):
 * the engine rotated every slide id, and targets scheduled **while the write
 * was in flight** were not carried by it. Pending slide targets are re-keyed
 * onto the fresh ids and re-based onto the new revision so they re-save;
 * when a newer structural edit landed during the save those per-slide writes
 * are superseded by it and dropped instead.
 */
export type StructuralAckBinding = {
  /** Old slide id → the id the engine now stores, by slide position. */
  idMap: Map<string, string>;
  /** True when a newer structural edit supersedes the pending slide writes. */
  dropSlideTargets: boolean;
  /** The new loaded revision the surviving pending targets are based on. */
  revision: number;
};

export type SaveOutcome = {
  /** The sanitized error copy, or null when the write reached the engine. */
  error: string | null;
  /** Present on a structural ack; absent for slide/metadata writes. */
  ack?: StructuralAckBinding;
};

type UseDeckAutosaveOptions = {
  /** Runs one coalesced batch; answers the outcome (error copy and any ack). */
  save: (targets: SaveTarget[]) => Promise<SaveOutcome>;
  /** The loaded deck revision; captured per target and compared at flush. */
  revision: number;
  delayMs?: number;
};

export type DeckAutosave = {
  status: SaveStatus;
  error: string | null;
  saving: boolean;
  /**
   * True while any change is queued, in flight, or failed (a retry is
   * required). The chat panel reads this so it never starts an engine-side
   * edit while a local change is still waiting to be stored.
   */
  dirty: boolean;
  schedule: (target: SaveTarget) => void;
  retry: () => void;
};

/**
 * The pending map after a structural acknowledgement (pure; exported for the
 * spec). Pending slide targets follow their slide's fresh id and are re-based
 * onto the acknowledged revision, so the next flush sends them; when the ack
 * reports a diverged state (a newer structural edit supersedes them) — or a
 * target's slide no longer exists — they are dropped. Metadata and structural
 * targets always survive, re-based.
 */
export function rebasePendingAfterAck(
  pending: Map<string, PendingEntry>,
  ack: StructuralAckBinding,
): Map<string, PendingEntry> {
  const rebased = new Map<string, PendingEntry>();
  for (const [key, entry] of pending) {
    if (entry.target.kind === "slide") {
      if (ack.dropSlideTargets) continue;
      const mapped = ack.idMap.get(entry.target.slideId);
      if (mapped === undefined) continue;
      rebased.set(`slide:${mapped}`, {
        target: { kind: "slide", slideId: mapped },
        revision: ack.revision,
      });
      continue;
    }
    rebased.set(key, { target: entry.target, revision: ack.revision });
  }
  return rebased;
}

export function useDeckAutosave({
  save,
  revision,
  delayMs = 2_000,
}: UseDeckAutosaveOptions): DeckAutosave {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const saveRef = useRef(save);
  const revisionRef = useRef(revision);
  const pendingRef = useRef(new Map<string, PendingEntry>());
  const failedRef = useRef<SaveTarget[] | null>(null);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    saveRef.current = save;
    revisionRef.current = revision;
  }, [save, revision]);

  /**
   * Applies a structural acknowledgement to the pending map (and the live
   * revision). The revision moves synchronously — a schedule in the same tick
   * must see the new revision, not the pre-ack one.
   */
  const applyAck = useCallback((ack: StructuralAckBinding) => {
    revisionRef.current = ack.revision;
    pendingRef.current = rebasePendingAfterAck(pendingRef.current, ack);
  }, []);

  /** Runs the next batch, if any. One in-flight mutation at a time. */
  const flush = useCallback(async () => {
    if (savingRef.current) return;

    const pending = pendingRef.current;
    pendingRef.current = new Map();
    const targets: SaveTarget[] = [];
    for (const entry of pending.values()) {
      if (entry.revision === revisionRef.current) targets.push(entry.target);
    }
    if (targets.length === 0) {
      if (pending.size > 0) {
        // The whole batch was scheduled before a newer revision's write.
        setStatus("saved");
      }
      setDirty(pendingRef.current.size > 0);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setStatus("saving");
    setError(null);

    let outcome: SaveOutcome;
    try {
      outcome = await saveRef.current(targets);
    } catch {
      outcome = { error: FALLBACK_ERROR };
    }
    savingRef.current = false;
    if (!mountedRef.current) return;
    setSaving(false);

    if (outcome.error !== null) {
      failedRef.current = targets;
      setStatus("error");
      setError(outcome.error);
      setDirty(true);
      return;
    }

    if (outcome.ack !== undefined) applyAck(outcome.ack);

    failedRef.current = null;
    setStatus("saved");
    if (pendingRef.current.size > 0) {
      // Edits arrived while saving: flush them now instead of waiting again.
      void flushRef.current();
    }
    setDirty(pendingRef.current.size > 0);
  }, [applyAck]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(
    (target: SaveTarget) => {
      pendingRef.current.set(targetKey(target), {
        target,
        revision: revisionRef.current,
      });
      setDirty(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flushRef.current();
      }, delayMs);
    },
    [delayMs],
  );

  const retry = useCallback(() => {
    const failed = failedRef.current;
    failedRef.current = null;
    if (!failed) return;
    for (const target of failed) {
      pendingRef.current.set(targetKey(target), {
        target,
        revision: revisionRef.current,
      });
    }
    setDirty(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    void flushRef.current();
  }, []);

  useEffect(() => {
    /* Re-arm on every mount: React's development StrictMode runs the mount
       effect, its cleanup, then the effect again on the same instance — a
       cleanup that only wrote `false` would leave the hook unable to settle
       its first save. */
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return { status, error, saving, dirty, schedule, retry };
}
