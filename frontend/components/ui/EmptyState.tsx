import type { HTMLAttributes, ReactNode } from "react";

type EmptyStateProps = HTMLAttributes<HTMLElement> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <section
      className={`flex flex-col items-center justify-center gap-4 text-center${className ? ` ${className}` : ""}`}
      {...props}
    >
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-card bg-muted text-muted-foreground [&_svg]:size-6">
          {icon}
        </span>
      )}
      <h3 className="text-headline-md text-foreground">{title}</h3>
      {description && (
        <p className="max-w-md text-body-md text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

export type { EmptyStateProps };
