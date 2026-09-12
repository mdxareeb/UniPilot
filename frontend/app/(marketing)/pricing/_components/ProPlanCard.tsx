"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check, CircleDashed } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MotionRevealItem } from "@/components/motion/MotionRevealGroup";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";

/* One row is marked `planned` rather than dropped or quietly checked off.
   File conversion — converting, merging, splitting — is not built, so a
   checkmark next to it would say it ships with the plan today. The dashed mark
   and the badge are the same honesty treatment the homepage feature grid gives
   the tool families, and the specific converters stay unnamed until they run. */
const proFeatures: { label: string; planned?: boolean }[] = [
  { label: "Unlimited document uploads" },
  { label: "Advanced task extraction" },
  { label: "Full AI assistant" },
  { label: "Smart search" },
  { label: "Workload intelligence" },
  { label: "Calendar-aware planning" },
  { label: "File converters", planned: true },
];

type ProPlanCardProps = {
  selected: boolean;
  onSelect: () => void;
};

export function ProPlanCard({ selected, onSelect }: ProPlanCardProps) {
  const router = useRouter();

  return (
    /* Reveal on the wrapper, hover on the card — see FreePlanCard. */
    <MotionRevealItem variant="scale" className="flex min-w-0">
      <Card
        variant="compact"
        onClick={onSelect}
        className={`relative flex min-w-0 flex-1 cursor-pointer flex-col gap-4 p-5 hover-lift${
          selected ? " bg-glass-strong" : " border-foreground/25 bg-glass"
        }`}
      >
        {selected && <MotionSelectionRing layoutId="plan-selection" />}
        <div>
          <h2 className="text-label-caps uppercase text-muted-foreground">
            Pro
          </h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-1">
            <span className="text-headline-lg-mobile text-foreground">$2</span>
            <span className="text-label-sm text-muted-foreground">/month</span>
          </div>
        </div>

        <ul className="flex flex-grow flex-col gap-2.5">
          {proFeatures.map((feature) => (
            <li
              key={feature.label}
              className="flex flex-wrap items-start gap-x-2.5 gap-y-1 text-label-sm text-muted-foreground"
            >
              {feature.planned ? (
                <CircleDashed
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-foreground"
                />
              )}
              <span className="min-w-0">{feature.label}</span>
              {feature.planned && (
                <Badge size="sm" variant="outline" className="shrink-0">
                  Planned
                </Badge>
              )}
            </li>
          ))}
        </ul>

        <Button
          variant="primary"
          size="md"
          aria-pressed={selected}
          onClick={() => {
            onSelect();
            router.push("/signup");
          }}
          className="w-full"
        >
          Start Pro
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </Card>
    </MotionRevealItem>
  );
}

export type { ProPlanCardProps };
