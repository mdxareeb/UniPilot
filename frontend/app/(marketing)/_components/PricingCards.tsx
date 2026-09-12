import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { PlanSelector } from "./PlanSelector";

type PricingCardsProps = {
  showFaqLink?: boolean;
};

export function PricingCards({ showFaqLink = false }: PricingCardsProps) {
  return (
    <Container className="max-w-[960px]">
      <PlanSelector />

      {showFaqLink && (
        <p className="mt-8 text-center text-body-md text-muted-foreground">
          Have questions? Check our{" "}
          <Link
            href="/faq"
            className="action-arrow inline-flex items-center gap-1 rounded-base text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            FAQ
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </p>
      )}
    </Container>
  );
}

export type { PricingCardsProps };
