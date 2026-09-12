"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MotionRevealItem } from "@/components/motion/MotionRevealGroup";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";

const freeFeatures = [
  "Basic task management",
  "Limited document uploads",
  "Basic document indexing",
  "Basic search",
  "Basic AI assistant",
  "Academic calendar",
];

type FreePlanCardProps = {
  selected: boolean;
  onSelect: () => void;
};

export function FreePlanCard({ selected, onSelect }: FreePlanCardProps) {
  const router = useRouter();

  return (
    /* Reveal on the wrapper, hover on the card. The reveal's transform and the
       `hover-lift` utility's transition would fight over the same element —
       the lift would run for 380ms and the border would snap. The wrapper is a
       member of `PlanSelector`'s group, so its delay comes from there. */
    <MotionRevealItem variant="scale" className="flex min-w-0">
      <Card
        variant="compact"
        onClick={onSelect}
        className={`relative flex min-w-0 flex-1 cursor-pointer flex-col gap-4 p-5 hover-lift${
          selected ? " bg-glass-strong" : " bg-glass"
        }`}
      >
        {selected && <MotionSelectionRing layoutId="plan-selection" />}
        <div>
          <h2 className="text-label-caps uppercase text-muted-foreground">
            Free
          </h2>
          {/* 32px, not the 48px display size. Three prices side by side are a
              comparison, and a comparison does not need billboards. */}
          <div className="mt-2 flex flex-wrap items-baseline gap-1">
            <span className="text-headline-lg-mobile text-foreground">$0</span>
            <span className="text-label-sm text-muted-foreground">/month</span>
          </div>
        </div>

        <ul className="flex flex-grow flex-col gap-2.5">
          {freeFeatures.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2.5 text-label-sm text-muted-foreground"
            >
              <Check
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-foreground"
              />
              <span className="min-w-0">{feature}</span>
            </li>
          ))}
        </ul>

        <Button
          variant="outline"
          size="md"
          aria-pressed={selected}
          onClick={() => {
            onSelect();
            router.push("/signup");
          }}
          className="w-full"
        >
          Start free
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </Card>
    </MotionRevealItem>
  );
}

export type { FreePlanCardProps };
