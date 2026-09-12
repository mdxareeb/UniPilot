"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MotionNotice } from "@/components/motion/MotionNotice";
import {
  requestPasswordReset,
  type AuthActionResult,
} from "@/lib/auth/actions";

type ResetRequestResult = AuthActionResult & { requested?: boolean };

async function resetRequestAction(
  _prev: ResetRequestResult,
  formData: FormData,
): Promise<ResetRequestResult> {
  const result = await requestPasswordReset(String(formData.get("email") ?? ""));
  if (result.error === null) {
    return { ...result, requested: true };
  }
  return result;
}

export function ForgotPasswordForm() {
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [state, formAction, isPending] = useActionState<
    ResetRequestResult,
    FormData
  >(resetRequestAction, { error: null });

  if (state.requested === true) {
    return (
      /* Rise, not scale: this confirmation is prose replacing a form rather
         than a surface arriving, so it takes the default entrance. Signup's
         equivalent panel is a bordered card and scales instead. */
      <div data-enter className="flex flex-col gap-4">
        <h2 className="text-headline-md text-foreground">Check your email</h2>
        <p className="text-body-md text-muted-foreground">
          If an account exists for{" "}
          <span className="font-medium text-foreground">{submittedEmail}</span>,
          we&apos;ve sent instructions to reset your password.
        </p>
        <p className="text-body-md text-muted-foreground">
          <a
            href="/login"
            className="rounded-base font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Back to login
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-label-sm font-medium text-foreground">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@university.edu"
            disabled={isPending}
            onChange={(event) => setSubmittedEmail(event.target.value)}
          />
        </div>
        {state?.error ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {state.error}
          </MotionNotice>
        ) : null}
        <Button type="submit" className="w-full" disabled={isPending} aria-busy={isPending}>
          {isPending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="text-center text-body-md text-muted-foreground">
        Remembered it?{" "}
        <a
          href="/login"
          className="rounded-base font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to login
        </a>
      </p>
    </div>
  );
}
