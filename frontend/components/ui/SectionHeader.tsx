import type { HTMLAttributes, ReactNode } from "react";

type SectionHeaderAlign = "left" | "center";

type SectionHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  align?: SectionHeaderAlign;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  align = "left",
  className,
  ...props
}: SectionHeaderProps) {
  const centered = align === "center";

  return (
    <header
      className={`${
        centered
          ? "flex flex-col items-center gap-6 text-center"
          : "flex flex-col gap-8 md:flex-row md:items-end md:justify-between"
      }${className ? ` ${className}` : ""}`}
      {...props}
    >
      <div
        className={`flex max-w-2xl flex-col gap-4${centered ? " items-center" : ""}`}
      >
        {eyebrow && (
          <span className="text-label-caps uppercase text-muted-foreground">
            {eyebrow}
          </span>
        )}
        <h2 className="text-foreground text-headline-lg-mobile md:text-headline-lg">
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground text-body-lg">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export type { SectionHeaderProps, SectionHeaderAlign };
