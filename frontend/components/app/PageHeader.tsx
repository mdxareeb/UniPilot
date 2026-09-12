import type { ReactNode } from "react";
import { motionIndex } from "@/components/motion/stagger";
import { Skeleton } from "@/components/ui/Skeleton";

type PageHeaderProps = {
  /** Mono eyebrow above the title — e.g. "Tasks". Rendered as <p> with label-caps. */
  eyebrow?: ReactNode;
  /** Page title — rendered as a single <h1> with Bricolage. */
  title: ReactNode;
  /** Short supporting sentence below the title. */
  description?: ReactNode;
  /** Primary call to action — e.g. <Button>+ New task</Button>. Real button/link, not a div. */
  primaryAction?: ReactNode;
  /** Optional secondary action beside the primary. */
  secondaryAction?: ReactNode;
  /** Optional trailing controls (filters, view toggles, etc.) */
  trailing?: ReactNode;
  /** When true, title/description/actions render as skeletons but keep layout. */
  isLoading?: boolean;
};

/**
 * Shared premium page-header for the authenticated workspace.
 *
 * Intentionally compact — the workspace is opened daily, so the header must not
 * feel like a marketing hero. It reuses the existing workspace tokens:
 * - Bricolage Grotesque for the title (`text-headline-md` 24px), Geist for
 *   description/actions, Geist Mono for the eyebrow (`text-label-caps`)
 * - monochrome `foreground` / `muted-foreground` / `border`
 * - no glass, no opaque white block, no gradient — the fixed `bg-dotted-grid`
 *   canvas stays the single background source and shows through
 * - subtle spacing (`gap-4` on the page, `gap-3` inside the text block) that
 *   matches `Container py-6 md:py-8` used by `InitialDashboard`
 *
 * Layout:
 * - mobile: natural stack, title block then actions, gap-4, actions wrap
 * - desktop (`md`): `flex-row items-start justify-between`, title on the left,
 *   actions trailing on the right with no vertical drift (both `self-start`).
 *   No fixed heights — long titles `wrap-anywhere` and actions `flex-wrap`.
 *
 * Accessibility:
 * - exactly one `<h1>` per page (this component), semantic `p` for eyebrow/
 *   description, no unnecessary ARIA, no positive tabindex, real interactive
 *   elements for actions, `focus-visible` from `Button`/`ButtonLink`.
 * - when `isLoading`, skeletons are `aria-hidden` and the header is `aria-busy`.
 *
 * Motion:
 * - the header owns slot 0 of its page's entrance ladder, so every workspace
 *   page — and every tool page built on this component later — leads with its
 *   own title and lets its content follow at slot 1 and beyond. Pages set
 *   `motionIndex` on their own sections; none of them has to remember to
 *   animate the header.
 * - `data-enter` rather than `data-reveal`: a page header is above the fold by
 *   definition, and a CSS keyframe cannot leave it blank if an observer never
 *   runs or hydration is delayed. `RouteTransition` supplies the page-level
 *   arrival around it; this is the composition inside it.
 * - the entrance's `animation-fill-mode: both` pins `transform: none` when it
 *   finishes, which is why nothing here may take a hover transform. The actions
 *   are `Button`/`ButtonLink` children with their own transforms, and those are
 *   on descendants, so they are unaffected.
 * - no entrance while `isLoading`. `(app)/loading.tsx` renders this component as
 *   a skeleton, and animating a fallback in means the reader waits 400ms to be
 *   told to wait — then watches the same header rise a second time when the real
 *   one replaces it. The skeleton appears immediately; the header it becomes is
 *   the thing worth animating.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  trailing,
  isLoading = false,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryAction || trailing);

  return (
    <header
      data-enter={isLoading ? undefined : true}
      style={motionIndex(0)}
      aria-busy={isLoading || undefined}
      className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6"
    >
      {/* Text block — left on desktop, top on mobile */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {eyebrow ? (
          isLoading ? (
            <Skeleton aria-hidden="true" className="h-3 w-16" />
          ) : (
            <p className="font-mono text-label-caps uppercase text-muted-foreground">
              {eyebrow}
            </p>
          )
        ) : null}

        {isLoading ? (
          <Skeleton aria-hidden="true" className="h-7 w-48 md:h-8 md:w-64" />
        ) : (
          <h1 className="wrap-anywhere font-heading text-headline-md font-semibold leading-tight text-foreground">
            {title}
          </h1>
        )}

        {description ? (
          isLoading ? (
            <Skeleton
              aria-hidden="true"
              className="h-4 w-full max-w-[36ch] md:h-5"
            />
          ) : (
            <p className="max-w-[56ch] text-body-md text-muted-foreground">
              {description}
            </p>
          )
        ) : null}
      </div>

      {/* Actions — right on desktop, below title on mobile, wrap cleanly */}
      {hasActions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 self-start md:self-start">
          {isLoading ? (
            <>
              {primaryAction ? (
                <Skeleton
                  aria-hidden="true"
                  className="h-10 w-28 rounded-pill md:h-11 md:w-32"
                />
              ) : null}
              {secondaryAction ? (
                <Skeleton
                  aria-hidden="true"
                  className="h-10 w-24 rounded-pill"
                />
              ) : null}
              {trailing ? (
                <Skeleton aria-hidden="true" className="h-10 w-20 rounded-base" />
              ) : null}
            </>
          ) : (
            <>
              {secondaryAction}
              {primaryAction}
              {trailing}
            </>
          )}
        </div>
      ) : null}
    </header>
  );
}
