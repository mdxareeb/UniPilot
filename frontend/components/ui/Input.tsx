import type { ComponentPropsWithRef } from "react";

type InputSize = "sm" | "md" | "lg";

type InputProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  size?: InputSize;
};

const baseClasses =
  "w-full rounded-base border border-border bg-card text-card-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const sizeClasses: Record<InputSize, string> = {
  sm: "h-9 px-3 text-label-sm",
  md: "h-11 px-3.5 text-body-md",
  lg: "h-14 px-4 text-body-lg",
};

export function Input({ size = "md", className, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      className={`${baseClasses} ${sizeClasses[size]}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { InputProps, InputSize };
