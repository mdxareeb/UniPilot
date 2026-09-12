import type { HTMLAttributes } from "react";

type PageSectionProps = HTMLAttributes<HTMLElement>;

/**
 * The homepage's section band. Same `overflow-x-clip` guard as the shared
 * `Section` primitive, and for the same reason: the directional reveals start
 * 24px off-axis inside a 20px gutter, and without the clip that briefly adds a
 * horizontal scrollbar at 320px. `clip`, not `hidden`, so no scroll container is
 * created.
 */
export function PageSection({ className, ...props }: PageSectionProps) {
  return (
    <section
      className={`scroll-mt-28 overflow-x-clip py-14 md:py-20${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { PageSectionProps };
