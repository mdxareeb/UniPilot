import type { HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={`motion-safe:animate-pulse rounded-base bg-muted${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
}

export type { SkeletonProps };
