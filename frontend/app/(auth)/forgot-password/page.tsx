import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { ForgotPasswordForm } from "./_components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a password reset link for your UniPilot account.",
};

export default function ForgotPasswordPage() {
  // One card, one entrance. Staggering the lines inside a bordered surface
  // would animate the contents of something that has already arrived.
  return (
    <Card
      data-enter
      className="w-full max-w-[420px] bg-glass p-6 md:p-8"
    >
      <header className="mb-6">
        <p className="text-label-caps uppercase text-muted-foreground">
          Account recovery
        </p>
        <h1 className="mt-2 text-headline-lg-mobile tracking-tight text-foreground md:text-headline-lg">
          Forgot your password?
        </h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          Enter your email and we&apos;ll send you a link to reset your
          password.
        </p>
      </header>
      <ForgotPasswordForm />
    </Card>
  );
}
