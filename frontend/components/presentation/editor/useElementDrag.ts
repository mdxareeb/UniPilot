"use client";

/**
 * Pointer-drag machinery for the editor's selection layer (Task D1, spec
 * §6.3/§8.5): pointer deltas are divided by the live stage scale so every
 * gesture lands in stage pixels, a movement threshold keeps a click separate
 * from a drag, Escape cancels without committing and the commit happens once
 * on release.
 *
 * The hook owns nothing but the gesture: the caller decides what the offset
 * means (move frames live during the drag, write `position` on commit).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Screen pixels of movement before a press becomes a drag (not a click). */
export const DRAG_START_THRESHOLD_PX = 3;

export type DragPointerEvent = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

export type ElementDrag = {
  /** Pointer id of the active gesture, or null. */
  pointerId: number | null;
  /**
   * Pointer offset since the gesture started, in stage pixels. Updated while
   * the drag is live and reset on release/cancel.
   */
  offset: { dx: number; dy: number };
  /** True once the gesture moved past the threshold. */
  dragging: boolean;
  /**
   * True once a gesture moved past the threshold; stays true until the next
   * gesture starts. The hit-target click handler reads it to suppress the
   * click that follows a drag.
   */
  draggedRef: React.MutableRefObject<boolean>;
  start: (event: DragPointerEvent) => void;
  move: (event: DragPointerEvent) => void;
  /** Releases the gesture and commits the offset (once). */
  end: () => void;
  /** Cancels the gesture without committing. */
  cancel: () => void;
  /** Starts a fresh gesture unless one is already past the threshold. */
  begin: (event: DragPointerEvent) => void;
};

export function useElementDrag(options: {
  /** The live stage scale (screen px per stage px). */
  scale: number | null;
  /** Called once on release with the stage-pixel offset. */
  onCommit: (offset: { dx: number; dy: number }) => void;
}): ElementDrag {
  const { scale, onCommit } = options;
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);
  const [pointerId, setPointerId] = useState<number | null>(null);

  const activeRef = useRef(false);
  const pointerRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ dx: 0, dy: 0 });
  const draggedRef = useRef(false);
  const cancelRef = useRef(false);
  const scaleRef = useRef(scale);
  const commitRef = useRef(onCommit);

  useEffect(() => {
    scaleRef.current = scale;
    commitRef.current = onCommit;
  }, [onCommit, scale]);

  const reset = useCallback(() => {
    activeRef.current = false;
    pointerRef.current = null;
    draggedRef.current = false;
    cancelRef.current = false;
    offsetRef.current = { dx: 0, dy: 0 };
    setOffset({ dx: 0, dy: 0 });
    setDragging(false);
    setPointerId(null);
  }, []);

  /* Escape cancels an in-progress drag (spec §8.5). A focused inline text
     editor stops the event before it reaches this window listener (it keeps
     its own Escape semantics), so the two never fight. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeRef.current) return;
      cancelRef.current = true;
      reset();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reset]);

  const start = useCallback((event: DragPointerEvent) => {
    activeRef.current = true;
    pointerRef.current = event.pointerId;
    startRef.current = { x: event.clientX, y: event.clientY };
    offsetRef.current = { dx: 0, dy: 0 };
    draggedRef.current = false;
    cancelRef.current = false;
    setOffset({ dx: 0, dy: 0 });
    setDragging(false);
    setPointerId(event.pointerId);
  }, []);

  const move = useCallback((event: DragPointerEvent) => {
    if (!activeRef.current || event.pointerId !== pointerRef.current) return;
    const screenDx = event.clientX - startRef.current.x;
    const screenDy = event.clientY - startRef.current.y;
    if (
      !draggedRef.current &&
      Math.hypot(screenDx, screenDy) < DRAG_START_THRESHOLD_PX
    ) {
      return;
    }
    if (!draggedRef.current) {
      draggedRef.current = true;
      setDragging(true);
    }
    const divisor =
      scaleRef.current !== null && scaleRef.current > 0 ? scaleRef.current : 1;
    const next = { dx: screenDx / divisor, dy: screenDy / divisor };
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    const moved = draggedRef.current;
    const wasCancelled = cancelRef.current;
    const committed = offsetRef.current;
    activeRef.current = false;
    pointerRef.current = null;
    cancelRef.current = false;
    setDragging(false);
    setPointerId(null);
    setOffset({ dx: 0, dy: 0 });
    offsetRef.current = { dx: 0, dy: 0 };
    if (moved && !wasCancelled) commitRef.current(committed);
  }, []);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    /* The flag survives `reset` so a pointerup that arrives after Escape
       (pointer capture still holds) resolves as cancelled, not committed. */
    cancelRef.current = true;
    const cancelled = { dx: 0, dy: 0 };
    offsetRef.current = cancelled;
    setOffset(cancelled);
    setDragging(false);
    activeRef.current = false;
    pointerRef.current = null;
  }, []);

  /* The grab handle and the element hit target both start a gesture; a
     running gesture wins so its drag surface keeps ownership. */
  const begin = useCallback(
    (event: DragPointerEvent) => {
      if (activeRef.current) return;
      start(event);
    },
    [start],
  );

  return {
    pointerId,
    offset,
    dragging,
    draggedRef,
    start,
    move,
    end,
    cancel,
    begin,
  };
}
