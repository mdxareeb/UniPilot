import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "outline" | "ghost" | "cta" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-pill font-heading text-label-sm press-feedback focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline:
    "border border-border bg-card text-foreground hover:border-foreground hover:bg-muted",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  /* The light pill on the charcoal closing CTA band. A variant of its own so
     the fill and text are the band's own tokens and cannot drift from the
     surface they sit on; the band's theme-stable in both colour schemes. */
  cta: "bg-surface-cta-foreground text-surface-cta hover:opacity-90",
  /* Destructive confirmation (16.8): the one action that removes data. Token
     driven so it stays legible in both themes; never used outside a confirm. */
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-label-caps",
  md: "h-11 px-5",
  lg: "h-12 px-7",
};

type ButtonAppearance = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/**
 * The button's class string on its own, so something that is not a `<button>`
 * can still look like one.
 *
 * Exists for `ButtonLink`: a call to action that navigates has to be a real
 * anchor, and a `<button>` inside an anchor is invalid markup — so the classes
 * are what gets shared rather than the element. Nothing else should re-derive
 * the pill, the sizes or the press feedback.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: ButtonAppearance = {}): string {
  return `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]}${className ? ` ${className}` : ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}

export type { ButtonProps, ButtonVariant, ButtonSize, ButtonAppearance };
