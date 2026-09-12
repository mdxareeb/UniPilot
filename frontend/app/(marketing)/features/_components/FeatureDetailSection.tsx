import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Divider } from "@/components/ui/Divider";
import { Section } from "@/components/ui/Section";

export type Capability = {
  term: string;
  detail: string;
  /* Set only when this specific capability is not built. An unlabelled row
     reads as shipped, so anything that is not gets a badge here rather than a
     hedge buried in the sentence. */
  status?: string;
};

type FeatureSectionHeaderProps = {
  icon: LucideIcon;
  eyebrow: string;
  status?: string;
  title: string;
  description: string;
  /**
   * Every section on the features page now sits inside a numbered part whose
   * header owns the `h2`, so `3` is the default. `2` is for a section that is
   * the top level of its own page.
   */
  headingLevel?: 2 | 3;
};

/* Icon + eyebrow + optional status, then the heading and lede. Same order and
   same parts as the homepage feature card header. `SectionHeader` cannot carry
   the icon or the status badge, so the markup is written out rather than forced
   through it.

   The two type steps are one step apart, which is what keeps a part header and
   the sections under it readable as a hierarchy rather than as two headings of
   the same rank. */
const headingClasses: Record<2 | 3, string> = {
  2: "text-headline-lg-mobile md:text-headline-lg",
  3: "text-headline-md md:text-headline-lg-mobile",
};

/**
 * The header of one section, as the first member of the section's reveal group.
 *
 * It rises; the cards under it arrive with depth and the figure beside it comes
 * in from the right. Three entrances in one section, one observer, one timeline
 * — the group around the grid owns all of it, so this component names no delay.
 */
export function FeatureSectionHeader({
  icon: Icon,
  eyebrow,
  status,
  title,
  description,
  headingLevel = 3,
}: FeatureSectionHeaderProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3";

  return (
    <MotionRevealItem>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="text-label-caps uppercase text-muted-foreground">
            {eyebrow}
          </span>
        </div>
        {status ? (
          <Badge size="sm" variant="outline">
            {status}
          </Badge>
        ) : null}
      </div>
      <Heading
        className={`mt-3 tracking-tight text-foreground ${headingClasses[headingLevel]}`}
      >
        {title}
      </Heading>
      <p className="mt-3 max-w-prose text-body-lg text-muted-foreground">
        {description}
      </p>
    </MotionRevealItem>
  );
}

type CapabilityListProps = {
  capabilities: Capability[];
};

export function CapabilityList({ capabilities }: CapabilityListProps) {
  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {capabilities.map((capability) => (
        /* Members of the enclosing group, not reveals of their own: the plain
           `ul` between them and the group does not interrupt Motion's variant
           propagation, so the rows still inherit the section's timeline and
           keep their DOM order in the stagger.

           The reveal sits on the `li` and the hover on the `Card`: a single
           element carrying both would let the reveal's transform fight the
           `hover-lift` utility's transition. */
        <MotionRevealItem
          as="li"
          key={capability.term}
          variant="scale"
          className="flex min-w-0"
        >
          <Card
            variant="compact"
            className="flex min-w-0 flex-1 flex-col gap-1.5 bg-glass p-4 hover-lift hover:border-foreground"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
              <span className="text-body-md font-medium text-foreground">
                {capability.term}
              </span>
              {capability.status ? (
                <Badge size="sm" variant="outline" className="shrink-0">
                  {capability.status}
                </Badge>
              ) : null}
            </div>
            <p className="text-label-sm text-muted-foreground">
              {capability.detail}
            </p>
          </Card>
        </MotionRevealItem>
      ))}
    </ul>
  );
}

type FeaturePreviewCardProps = {
  meta: string;
  children: ReactNode;
};

/* The preview is a figure, not a control: same translucent surface as every
   other card on the page, but no hover treatment, because nothing happens when
   you click it.

   It arrives from the right — the last member of the group, sliding in beside
   copy that has already filled in, which is the reading order the two-column
   layout implies. */
export function FeaturePreviewCard({
  meta,
  children,
}: FeaturePreviewCardProps) {
  return (
    <MotionRevealItem variant="right" className="flex min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-1 flex-col bg-glass p-4"
      >
        {children}
        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Divider />
          <span className="font-mono text-label-caps text-muted-foreground">
            {meta}
          </span>
        </div>
      </Card>
    </MotionRevealItem>
  );
}

export type FeatureDetailSectionProps = FeatureSectionHeaderProps & {
  id: string;
  /* A second anchor pointing at the same section, for a link that already
     exists elsewhere on the site and must keep working. */
  aliasId?: string;
  capabilities: Capability[];
  meta: string;
  preview: ReactNode;
  /* Rendered under the capability grid — used for a scope note that belongs to
     the whole section rather than one capability. */
  footnote?: ReactNode;
};

export function FeatureDetailSection({
  id,
  aliasId,
  icon,
  eyebrow,
  status,
  title,
  description,
  headingLevel,
  capabilities,
  meta,
  preview,
  footnote,
}: FeatureDetailSectionProps) {
  return (
    <Section
      id={id}
      className="scroll-mt-24 border-t border-border [--section-padding:40px] md:[--section-padding:64px]"
    >
      <Container>
        {aliasId ? (
          <span id={aliasId} aria-hidden="true" className="block" />
        ) : null}
        <MotionRevealGroup
          repeat
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10"
        >
          <div className="min-w-0">
            <FeatureSectionHeader
              icon={icon}
              eyebrow={eyebrow}
              status={status}
              title={title}
              description={description}
              headingLevel={headingLevel}
            />
            <CapabilityList capabilities={capabilities} />
            {footnote}
          </div>
          <FeaturePreviewCard meta={meta}>{preview}</FeaturePreviewCard>
        </MotionRevealGroup>
      </Container>
    </Section>
  );
}
