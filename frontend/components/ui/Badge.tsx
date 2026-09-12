import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "outline" | "dark";
type BadgeSize = "sm" | "md";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
};

const baseClasses =
  "inline-flex items-center gap-1.5 rounded-pill text-label-sm";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-muted text-foreground",
  outline: "border border-border bg-card text-foreground",
  dark: "bg-primary text-primary-foreground",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "px-2.5 py-0.5",
  md: "px-3 py-1",
};

export function Badge({
  variant = "default",
  size = "md",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { BadgeProps, BadgeVariant, BadgeSize };
