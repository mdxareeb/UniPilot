import type { Metadata } from "next";
import { motionIndex } from "@/components/motion/stagger";
import { SignupForm } from "./_components/SignupForm";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create your UniPilot workspace.",
};

export default function SignupPage() {
  return (
    <div className="w-full max-w-[420px]">
      <div className="text-center">
        <p
          data-enter
          style={motionIndex(0)}
          className="font-mono text-label-caps uppercase text-muted-foreground"
        >
          Get started
        </p>
        <h1
          data-enter
          style={motionIndex(1)}
          className="mt-3 text-headline-lg-mobile text-foreground md:text-headline-lg"
        >
          Create your account
        </h1>
        <p
          data-enter
          style={motionIndex(2)}
          className="mt-3 text-body-md text-muted-foreground"
        >
          Create your UniPilot workspace and bring your college work into one
          place.
        </p>
      </div>
      <div data-enter style={motionIndex(3)} className="mt-8">
        <SignupForm />
      </div>
    </div>
  );
}
