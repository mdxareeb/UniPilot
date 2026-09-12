"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function DevsNoteCta() {
  const router = useRouter();

  return (
    <Button size="lg" onClick={() => router.push("/signup")}>
      Try UniPilot free
      <ArrowRight aria-hidden="true" className="size-4" />
    </Button>
  );
}
