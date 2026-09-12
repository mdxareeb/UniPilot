import type { HTMLAttributes } from "react";

type DividerOrientation = "horizontal" | "vertical";

type DividerProps = HTMLAttributes<HTMLElement> & {
  orientation?: DividerOrientation;
};

export function Divider({
  orientation = "horizontal",
  className,
  ...props
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={`self-stretch border-l border-border${className ? ` ${className}` : ""}`}
        {...props}
      />
    );
  }

  return (
    <hr
      className={`w-full border-t border-border${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { DividerProps, DividerOrientation };
