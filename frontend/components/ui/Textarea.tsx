import type { ComponentPropsWithRef } from "react";

type TextareaProps = ComponentPropsWithRef<"textarea">;

/**
 * Multi-line counterpart of `Input`, sharing its exact surface contract: solid
 * `--card` fill, 1px `--border`, Control radius, the same focus ring and
 * disabled treatment (`Input`'s classes, with vertical padding). Used where a
 * single line would compress the input — a generation prompt, a brief.
 */
const baseClasses =
  "w-full rounded-base border border-border bg-card px-3.5 py-3 text-body-md text-card-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export function Textarea({ className, ref, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={`${baseClasses}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { TextareaProps };
