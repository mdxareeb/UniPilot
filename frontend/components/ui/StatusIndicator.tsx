import type { HTMLAttributes, ReactNode } from "react";

type StatusIndicatorStatus =
  | "neutral"
  | "active"
  | "success"
  | "warning"
  | "error";

type StatusIndicatorSize = "sm" | "md";

type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  status?: StatusIndicatorStatus;
  size?: StatusIndicatorSize;
  label: ReactNode;
  icon?: ReactNode;
};

const baseClasses = "inline-flex items-center gap-1.5 rounded-pill";

const statusClasses: Record<StatusIndicatorStatus, string> = {
  neutral: "bg-muted text-foreground",
  active: "border border-secondary bg-muted text-foreground",
  success: "border border-border bg-card text-foreground",
  warning: "border border-dashed border-secondary text-foreground",
  error: "border border-destructive bg-card text-destructive",
};

const sizeClasses: Record<StatusIndicatorSize, string> = {
  sm: "h-6 px-2.5 text-label-sm [&_svg]:size-3",
  md: "h-7 px-3 text-label-sm [&_svg]:size-3.5",
};

export function StatusIndicator({
  status = "neutral",
  size = "md",
  label,
  icon,
  className,
  ...props
}: StatusIndicatorProps) {
  return (
    <span
      className={`${baseClasses} ${statusClasses[status]} ${sizeClasses[size]}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {icon}
      {label}
    </span>
  );
}

export type {
  StatusIndicatorProps,
  StatusIndicatorStatus,
  StatusIndicatorSize,
};
