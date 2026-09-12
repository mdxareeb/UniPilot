import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";

export type FeaturePartHeaderProps = {
  /* `01`–`05`. Written out rather than derived from the array index so the
     number in the markup is the number in the copy, and so a part cannot be
     reordered without someone deciding what its number should be. */
  number: string;
  label: string;
  id: string;
  title: string;
  description: string;
};

/**
 * The opening of one of the five parts of the catalogue.
 *
 * The number is real information here rather than decoration: the parts are
 * ordered by how far they are from the student's own material — the workspace
 * reads what you upload, the makers produce something new from it, the editors
 * change a file you have, the study tools turn it into revision, and the
 * assistant sits across all four. A reader who lands on `04 — Study` knows there
 * are three parts above it and one below.
 *
 * Larger vertical padding than the sections it introduces, and a heading one
 * step above theirs, so the boundary between parts is legible without a second
 * kind of rule.
 */
export function FeaturePartHeader({
  number,
  label,
  id,
  title,
  description,
}: FeaturePartHeaderProps) {
  return (
    <Section
      id={id}
      className="scroll-mt-24 border-t border-border [--section-padding:56px] md:[--section-padding:80px]"
    >
      <Container>
        {/* The one place on the site that uses the `down` direction, and the
            reason it exists: the part number settles from above while the title
            rises to meet it, so a part boundary reads as a chapter marker
            landing rather than as one more section fading up. */}
        <MotionRevealGroup repeat className="flex flex-col gap-3">
          <MotionRevealItem
            as="span"
            variant="down"
            className="font-mono text-label-caps text-muted-foreground"
          >
            {number} — {label}
          </MotionRevealItem>
          <MotionRevealItem
            as="h2"
            className="text-headline-lg-mobile tracking-tight text-foreground md:text-headline-lg"
          >
            {title}
          </MotionRevealItem>
          <MotionRevealItem
            as="p"
            className="max-w-prose text-body-lg text-muted-foreground"
          >
            {description}
          </MotionRevealItem>
        </MotionRevealGroup>
      </Container>
    </Section>
  );
}
