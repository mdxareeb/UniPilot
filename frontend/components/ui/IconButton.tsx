import type { ComponentPropsWithRef } from "react";

type IconButtonVariant = "default" | "outline" | "primary" | "outline-inverted";
type IconButtonSize = "sm" | "md" | "lg";

/* `ComponentPropsWithRef` rather than `ButtonHTMLAttributes` so a caller that
   needs to move focus back to the button can pass a `ref` — React 19 treats it
   as an ordinary prop, so the existing spread already forwards it. */
type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "size"> & {
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

const baseClasses =
  "inline-flex items-center justify-center shrink-0 rounded-base press-feedback focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none";

/* Text colour belongs to the variant rather than the base: `primary` inverts it,
   and two colour utilities on one element are resolved by their order in the
   emitted stylesheet, not by the order they appear in the class attribute. */
const variantClasses: Record<IconButtonVariant, string> = {
  default: "bg-transparent text-foreground hover:bg-muted focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  outline: "border border-border bg-card text-foreground hover:border-foreground focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  /* Matches `Button`'s primary so the two read as the same control. */
  primary: "bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  /* Task 3.13 — the inverted-context variant (DESIGN.md §Inverted): a ring
     tuned for light surfaces is invisible on near-black, which is an
     accessibility failure, not a cosmetic one. On inverted fills the ring
     takes `--ring-inverted` and the offset takes the inverted fill itself,
     so the ring reads against its actual surface. */
  "outline-inverted":
    "border border-border-inverted bg-transparent text-surface-inverted-foreground hover:border-surface-inverted-foreground focus-visible:ring-ring-inverted focus-visible:ring-offset-2 focus-visible:ring-offset-surface-inverted",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "size-10",
  md: "size-11",
  lg: "size-12",
};

export function IconButton({
  variant = "default",
  size = "md",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { IconButtonProps, IconButtonVariant, IconButtonSize };
