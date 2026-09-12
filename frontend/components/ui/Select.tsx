import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

type SelectSize = "sm" | "md" | "lg";

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: SelectSize;
};

/**
 * `Input`'s classes, minus the native arrow. `appearance-none` drops the arrow
 * each browser draws differently and this renders one chevron in its place, so a
 * select and a text field are the same control at different jobs.
 */
const baseClasses =
  "w-full appearance-none rounded-base border border-border bg-card text-card-foreground transition-colors focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/** `Input`'s heights, with the right padding widened to clear the chevron. */
const sizeClasses: Record<SelectSize, string> = {
  sm: "h-9 pl-3 pr-9 text-label-sm",
  md: "h-11 pl-3.5 pr-10 text-body-md",
  lg: "h-14 pl-4 pr-11 text-body-lg",
};

export function Select({
  size = "md",
  className,
  children,
  ...props
}: SelectProps) {
  return (
    // The wrapper is what the chevron is positioned against. It carries no
    // styling of its own, so `className` still lands on the control.
    <div className="relative">
      <select
        className={`${baseClasses} ${sizeClasses[size]}${className ? ` ${className}` : ""}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        // `pointer-events-none` so a click on the chevron opens the select
        // underneath rather than landing on the icon.
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export type { SelectProps, SelectSize };
