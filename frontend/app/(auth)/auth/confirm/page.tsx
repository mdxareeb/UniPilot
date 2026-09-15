import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { ConfirmEmail } from "./_components/ConfirmEmail";

export const metadata: Metadata = {
  title: "Confirm your email",
  description: "Confirm your UniPilot account.",
};

export default function AuthConfirmPage() {
  return (
    <Card className="w-full max-w-[420px] bg-glass p-6 backdrop-blur-md md:p-8">
      <header className="mb-6">
        <p className="text-label-caps uppercase text-muted-foreground">
          Email verification
        </p>
        <h1 className="mt-2 text-headline-lg-mobile tracking-tight text-foreground md:text-headline-lg">
          Confirming your email
        </h1>
      </header>
      <ConfirmEmail />
    </Card>
  );
}
