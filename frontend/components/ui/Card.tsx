import type { HTMLAttributes } from "react";

type CardVariant =
  | "default"
  | "compact"
  | "raised"
  | "inverted"
  | "inverted-nested"
  | "ghost";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
};

const baseClasses = "bg-card text-card-foreground border border-border";

const variantClasses: Record<CardVariant, string> = {
  default: "rounded-card",
  compact: "rounded-base",
  raised: "rounded-card shadow-raised",
  /* Task 3.13 — the three-fill system as Card variants. `inverted` is the
     rationed emphasis device (DESIGN.md §Inverted): opaque near-black, light
     text, its own border token, one shadow level. `inverted-nested` is a
     surface INSIDE an inverted card — separation by a lighter fill step and
     one radius step down, never by a shadow (§Nested Surfaces). `ghost` is
     the fill-less dashed "add a new item" slot, same radius as its siblings
     (§Ghost Surface). A surface uses exactly one fill; there is no
     glass-with-solid-header combination. Glass stays a caller-applied
     `bg-glass` (a transparency level, not a variant) as before. */
  inverted:
    "rounded-card border-border-inverted bg-surface-inverted text-surface-inverted-foreground shadow-raised",
  "inverted-nested":
    "rounded-nested border-border-inverted bg-surface-inverted-nested text-surface-inverted-foreground",
  ghost:
    "rounded-card border-dashed bg-transparent text-foreground hover:bg-muted/50 focus-visible:bg-muted/50",
};

/**
 * Bordered surface. Supplies the border, radius and text colour but no padding.
 *
 * Surface convention: the default background is solid `bg-card`, which is right
 * for a card layered over other content (a dropdown, a dialog, a row inside
 * another panel). A card sitting directly on the page — on the fixed dotted
 * canvas — passes `bg-glass` plus `backdrop-blur-md` instead, so the page reads
 * faintly through it; `bg-glass-strong` is its selected/emphasised state, and a
 * card nested inside a glass panel takes `bg-glass-subtle` (the parent is
 * already frosted). Those are the only transparency levels in the project; they
 * are defined once in `app/globals.css` and must not be re-derived as one-off
 * alpha-modifier backgrounds on individual cards.
 */
export function Card({ variant = "default", className, ...props }: CardProps) {
  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { CardProps, CardVariant };
