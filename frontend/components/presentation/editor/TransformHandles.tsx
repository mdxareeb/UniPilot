"use client";

/**
 * The selected frame's transform handles (Task D1, spec §5.4 "Drag / resize /
 * rotate | Konva handles").
 *
 * Eight resize handles on the frame's corners and edge midpoints plus one
 * rotate handle above the top edge, all sized in inverse stage pixels so a
 * scaled stage keeps a constant on-screen size. Every handle is a real button
 * (`aria-label`, `data-editor-transform-handle`) with pointer handlers wired
 * to the selection layer — the same gestures are keyboard-reachable through
 * the stage's arrow equivalents (spec §8.5).
 *
 * Vector elements render drag + rotate only: their frame comes from `points`,
 * so a frame resize has no honest wire meaning (recorded in the D1 report).
 * Rotated elements resize like any other: the gesture composes the rotation
 * in the element's local axes (D1b), so no handle is ever disabled by
 * rotation.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeHandle } from "@/lib/presentation/editorOps";

const CORNER_SIZE = 10;
const EDGE_LENGTH = 20;
const EDGE_THICKNESS = 6;
const ROTATE_SIZE = 22;
const ROTATE_OFFSET = 22;
const HANDLE_STROKE = 2;
const GRAB_SIZE = 26;
const GRAB_OFFSET = 3;
/**
 * A frame thinner than this on screen (either axis) drops the matching edge
 * handles: they would otherwise cover the whole frame and intercept clicks
 * meant for its content (a 6px-tall text frame, for one). Corners stay.
 */
const EDGE_HANDLE_MIN_SCREEN = 14;

const CORNER_HANDLES = ["nw", "ne", "se", "sw"] as const;
const EDGE_HANDLES = ["n", "e", "s", "w"] as const;

const HANDLE_LABELS: Record<ResizeHandle, string> = {
  nw: "Resize top left",
  n: "Resize top",
  ne: "Resize top right",
  e: "Resize right",
  se: "Resize bottom right",
  s: "Resize bottom",
  sw: "Resize bottom left",
  w: "Resize left",
};

type HandlePoint = { left: number; top: number };

/**
 * Handle centers as percentages of the frame, so the handles follow a live
 * frame without the parent re-measuring anything.
 */
function handleCenters(): Record<ResizeHandle, HandlePoint> {
  return {
    nw: { left: 0, top: 0 },
    n: { left: 50, top: 0 },
    ne: { left: 100, top: 0 },
    e: { left: 100, top: 50 },
    se: { left: 100, top: 100 },
    s: { left: 50, top: 100 },
    sw: { left: 0, top: 100 },
    w: { left: 0, top: 50 },
  };
}

const HANDLE_CENTERS = handleCenters();

function handleRect(handle: ResizeHandle, scale: number): {
  width: number;
  height: number;
} {
  if ((CORNER_HANDLES as readonly string[]).includes(handle)) {
    return { width: CORNER_SIZE / scale, height: CORNER_SIZE / scale };
  }
  if (handle === "n" || handle === "s") {
    return { width: EDGE_LENGTH / scale, height: EDGE_THICKNESS / scale };
  }
  return { width: EDGE_THICKNESS / scale, height: EDGE_LENGTH / scale };
}

function cursorForHandle(handle: ResizeHandle): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    default:
      return "ew-resize";
  }
}

export type TransformHandlesProps = {
  /** Screen px per stage px; handle geometry divides by it. */
  scale: number;
  /** The frame's stage size; decides whether thin edge handles fit on screen. */
  frameWidth: number;
  frameHeight: number;
  /** The frame's stage top; decides whether the rotate arm fits above it. */
  frameTop: number;
  /** The element's current rotation (deg); the rotate affordance reflects it. */
  rotation: number;
  /** False for `vector` elements (no honest frame resize — recorded). */
  resizeEnabled: boolean;
  /** True while the inline editor owns the frame (only the grab shows). */
  editing: boolean;
  onResizeStart: (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onRotateStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** Starts the move gesture (the dedicated grab handle). */
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
};

export function TransformHandles({
  scale,
  frameWidth,
  frameHeight,
  frameTop,
  rotation,
  resizeEnabled,
  editing,
  onResizeStart,
  onRotateStart,
  onDragStart,
}: TransformHandlesProps) {
  const safeScale = scale > 0 ? scale : 1;
  const handleSize = ROTATE_SIZE / safeScale;
  const connectHeight = ROTATE_OFFSET / safeScale;
  /* The stage clips at its box: an arm that would render above the stage's
     top edge flips below the frame so it stays reachable. */
  const flipRotate =
    frameTop * safeScale < ROTATE_OFFSET + ROTATE_SIZE;
  const rotateCenter = flipRotate
    ? frameHeight + connectHeight
    : -connectHeight;
  const stemTop = flipRotate ? frameHeight : rotateCenter;
  const fitsVerticalEdges =
    frameHeight * safeScale >= EDGE_HANDLE_MIN_SCREEN;
  const fitsHorizontalEdges =
    frameWidth * safeScale >= EDGE_HANDLE_MIN_SCREEN;
  const shownHandles = [...EDGE_HANDLES, ...CORNER_HANDLES].filter(
    (handle) => {
      if ((handle === "n" || handle === "s") && !fitsVerticalEdges) {
        return false;
      }
      if ((handle === "e" || handle === "w") && !fitsHorizontalEdges) {
        return false;
      }
      return true;
    },
  );

  return (
    <div
      data-editor-transform-handles=""
      data-element-rotation={String(rotation)}
      style={{
        position: "absolute",
        inset: 0,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "center",
        pointerEvents: "none",
      }}
    >
      {/* A dedicated grab affordance inside the frame's top-left corner: a
          text element being edited is covered by its contenteditable, so the
          whole-frame drag surface cannot be reached without stealing caret
          placement. The handle drags through the same stage-routed gesture.
          It sits inside the frame because the stage clips at its edges. */}
      <div
        role="presentation"
        aria-label="Drag element"
        data-editor-drag-handle=""
        style={{
          position: "absolute",
          left: GRAB_OFFSET / safeScale,
          top: GRAB_OFFSET / safeScale,
          width: GRAB_SIZE / safeScale,
          height: GRAB_SIZE / safeScale,
          borderRadius: 4 / safeScale,
          border: `${HANDLE_STROKE / safeScale}px solid var(--color-foreground)`,
          background: "var(--color-background)",
          opacity: 0.9,
          cursor: "grab",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        onPointerDown={(event) => onDragStart(event)}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 12 / safeScale,
            height: HANDLE_STROKE / safeScale,
            transform: "translate(-50%, -50%)",
            background: "currentColor",
            color: "var(--color-foreground)",
          }}
        />
      </div>
      {/* Edges first, corners last: on a short frame the edge handles overlap
          the corner handles' hit areas, and the corner (which resizes both
          axes) must stay the topmost target. */}
      {resizeEnabled
        ? shownHandles.map((handle) => {
            const center = HANDLE_CENTERS[handle];
            const rect = handleRect(handle, safeScale);
            return (
              <button
                key={handle}
                type="button"
                aria-label={HANDLE_LABELS[handle]}
                data-editor-transform-handle={handle}
                className="absolute bg-background"
                style={{
                  left: `${center.left}%`,
                  top: `${center.top}%`,
                  width: rect.width,
                  height: rect.height,
                  transform: "translate(-50%, -50%)",
                  border: `${HANDLE_STROKE / safeScale}px solid var(--color-foreground)`,
                  borderRadius: 0,
                  cursor: cursorForHandle(handle),
                  pointerEvents: "auto",
                  touchAction: "none",
                }}
                onPointerDown={(event) => onResizeStart(handle, event)}
              />
            );
          })
        : null}

      {/* The rotate arm: a thin stem plus the round handle outside the frame
          (above it, or below when the stage's top edge would clip it). */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: stemTop,
          width: HANDLE_STROKE / safeScale,
          height: connectHeight,
          transform: "translateX(-50%)",
          background: "currentColor",
          color: "var(--color-foreground)",
        }}
      />
      {editing ? null : (
        <button
          type="button"
          aria-label="Rotate element"
          data-editor-rotate-handle=""
          data-editor-rotate-side={flipRotate ? "below" : "above"}
          className="absolute rounded-full bg-background"
          style={{
            left: "50%",
            top: rotateCenter,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
            border: `${HANDLE_STROKE / safeScale}px solid var(--color-foreground)`,
            cursor: "grab",
            pointerEvents: "auto",
            touchAction: "none",
          }}
          onPointerDown={(event) => onRotateStart(event)}
        />
      )}
    </div>
  );
}
