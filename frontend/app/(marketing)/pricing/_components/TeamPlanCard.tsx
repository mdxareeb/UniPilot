"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MotionRevealItem } from "@/components/motion/MotionRevealGroup";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";

const teamFeatures = [
  "Everything in Pro",
  "Shared workspaces",
  "Shared document library",
  "Group task management",
  "Collaborative academic workspace",
];

type TeamPlanCardProps = {
  selected: boolean;
  onSelect: () => void;
};

export function TeamPlanCard({ selected, onSelect }: TeamPlanCardProps) {
  const router = useRouter();

  return (
    /* Reveal on the wrapper, hover on the card — see FreePlanCard. The wrapper
       is the grid item now, so the tablet span sits here: two columns wide and
       centred at `md` where three cards will not fit, one column at `lg`. */
    <MotionRevealItem
      variant="scale"
      className="flex min-w-0 md:col-span-2 md:mx-auto md:w-full md:max-w-md lg:col-span-1 lg:mx-0 lg:max-w-none"
    >
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
            Team
          </h2>
          <div className="mt-2 flex flex-wrap items-baseline gap-1">
            <span className="text-headline-lg-mobile text-foreground">$10</span>
            <span className="text-label-sm text-muted-foreground">
              /member/month
            </span>
          </div>
          {/* The seat limits are the one thing about this plan the feature list
              cannot carry, so they stay as their own line. */}
          <p className="mt-2.5 flex flex-wrap items-center gap-2 rounded-base bg-muted px-2.5 py-1.5 text-label-sm text-muted-foreground">
            <UsersRound aria-hidden="true" className="size-3.5 shrink-0" />
            Up to 3 (Team) or 20 (Org) members
          </p>
        </div>

        <ul className="flex flex-grow flex-col gap-2.5">
          {teamFeatures.map((feature) => (
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
          variant="primary"
          size="md"
          aria-pressed={selected}
          onClick={() => {
            onSelect();
            router.push("/signup");
          }}
          className="w-full"
        >
          See team plans
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </Card>
    </MotionRevealItem>
  );
}

export type { TeamPlanCardProps };
