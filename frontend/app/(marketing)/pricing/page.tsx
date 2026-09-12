import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { motionIndex } from "@/components/motion/stagger";
import { PlanSelector } from "../_components/PlanSelector";

export default function PricingPage() {
  return (
    <>
      <div className="pt-10 pb-10 md:pt-14 md:pb-12">
        <Container className="flex flex-col items-center text-center">
          <span
            data-enter
            style={motionIndex(0)}
            className="text-label-caps uppercase text-muted-foreground"
          >
            Pricing
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mt-4 max-w-3xl text-headline-lg-mobile text-foreground md:text-headline-lg"
          >
            Start free. Upgrade when you need more.
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mt-4 max-w-2xl text-body-lg text-muted-foreground"
          >
            One workspace for tasks, deadlines, documents and your AI
            assistant — with a plan for every stage of college.
          </p>
        </Container>
      </div>

      <Container className="max-w-[960px] pb-14 md:pb-16">
        <PlanSelector />

        <p className="mt-8 text-center text-body-md text-muted-foreground">
          Have questions? Check our{" "}
          <Link
            href="/faq"
            className="action-arrow inline-flex items-center gap-1 rounded-base px-1 py-2.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            FAQ
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </p>
      </Container>
    </>
  );
}
