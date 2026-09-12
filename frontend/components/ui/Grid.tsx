import type { HTMLAttributes } from "react";

type GridColumns = 1 | 2 | 3 | 4;

type GridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: GridColumns;
};

const baseClasses = "grid gap-6";

const columnClasses: Record<GridColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
};

export function Grid({ columns = 3, className, ...props }: GridProps) {
  return (
    <div
      className={`${baseClasses} ${columnClasses[columns]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { GridProps, GridColumns };
