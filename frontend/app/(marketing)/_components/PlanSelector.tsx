"use client";

import { useState } from "react";
import { MotionRevealGroup } from "@/components/motion/MotionRevealGroup";
import { FreePlanCard } from "../pricing/_components/FreePlanCard";
import { ProPlanCard } from "../pricing/_components/ProPlanCard";
import { TeamPlanCard } from "../pricing/_components/TeamPlanCard";

type Plan = "free" | "pro" | "team";

/**
 * The three plans are one comparison, so they reveal as one composition: the
 * grid is the `MotionRevealGroup` and each card is a member, arriving with depth
 * (`scale`) in reading order. One observer for the row instead of three, and the
 * order is orchestrated rather than three delays that happen to agree.
 *
 * Selection is a shared-layout ring (`layoutId="plan-selection"`, rendered by
 * whichever card is selected) so the choice visibly travels between cards
 * instead of blinking off one and on to another.
 */
export function PlanSelector() {
  const [selectedPlan, setSelectedPlan] = useState<Plan>("pro");

  return (
    <MotionRevealGroup
      repeat
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
    >
      <FreePlanCard
        selected={selectedPlan === "free"}
        onSelect={() => setSelectedPlan("free")}
      />
      <ProPlanCard
        selected={selectedPlan === "pro"}
        onSelect={() => setSelectedPlan("pro")}
      />
      <TeamPlanCard
        selected={selectedPlan === "team"}
        onSelect={() => setSelectedPlan("team")}
      />
    </MotionRevealGroup>
  );
}

export type { Plan };
