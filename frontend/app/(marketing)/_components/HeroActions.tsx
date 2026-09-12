"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { motionIndex } from "@/components/motion/stagger";

export function HeroActions() {
  const router = useRouter();

  return (
    <div
      data-enter
      style={motionIndex(3)}
      className="flex flex-col items-center justify-center gap-4 sm:flex-row"
    >
      <Button
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => router.push("/signup")}
      >
        Start free — build my dashboard
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => router.push("/how-it-works")}
      >
        <PlayCircle aria-hidden="true" className="size-4" />
        See how it works
      </Button>
    </div>
  );
}
