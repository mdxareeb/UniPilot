"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";

type TooltipSide = "top" | "right" | "bottom" | "left";

type TooltipProps = {
  children: ReactElement;
  content: ReactNode;
  side?: TooltipSide;
  delay?: number;
  disabled?: boolean;
  className?: string;
};

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function Tooltip({
  children,
  content,
  side = "top",
  delay = 200,
  disabled = false,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const tooltipId = useId();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (disabled) {
    return children;
  }

  const clearTimer = () => window.clearTimeout(timer.current);

  const showAfterDelay = () => {
    clearTimer();
    if (delay > 0) {
      timer.current = window.setTimeout(() => setVisible(true), delay);
    } else {
      setVisible(true);
    }
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Escape" && visible) {
      hide();
    }
  };

  const existingDescribedBy = isValidElement(children)
    ? (children.props as { "aria-describedby"?: string })["aria-describedby"]
    : undefined;

  const describedBy = visible
    ? existingDescribedBy
      ? `${existingDescribedBy} ${tooltipId}`
      : tooltipId
    : existingDescribedBy;

  const trigger = isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, { "aria-describedby": describedBy })
    : children;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={showAfterDelay}
      onMouseLeave={hide}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={hide}
      onKeyDownCapture={handleKeyDown}
    >
      {trigger}
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-64 rounded-base bg-primary px-2.5 py-1 text-label-sm text-primary-foreground shadow-subtle motion-safe:transition-opacity ${sideClasses[side]} ${
          visible ? "visible opacity-100" : "invisible opacity-0"
        }${className ? ` ${className}` : ""}`}
      >
        {content}
      </span>
    </span>
  );
}

export type { TooltipProps, TooltipSide };
