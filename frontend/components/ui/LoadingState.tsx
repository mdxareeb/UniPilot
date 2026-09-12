import type { HTMLAttributes, ReactNode } from "react";

type LoadingStateProps = HTMLAttributes<HTMLElement> & {
  label?: ReactNode;
};

export function LoadingState({
  label,
  children,
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div aria-busy="true" className={className} {...props}>
      {label && <span className="sr-only">{label}</span>}
      {children}
    </div>
  );
}

export type { LoadingStateProps };
