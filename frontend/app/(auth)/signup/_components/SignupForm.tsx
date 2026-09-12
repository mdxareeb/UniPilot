"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { signUpWithEmail, type AuthActionResult } from "@/lib/auth/actions";
import { POST_AUTH_REDIRECT } from "@/lib/auth/constants";
import { PASSWORD_MISMATCH } from "@/lib/auth/errors";
import { AuthOptions } from "../../_components/AuthOptions";

async function signupAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  return signUpWithEmail(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
  );
}

export function SignupForm() {
  const router = useRouter();
  const submitted = useRef(false);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(signupAction, { error: null });

  const confirmed = state.needsEmailConfirmation === true;

  useEffect(() => {
    if (
      submitted.current &&
      state.error === null &&
      !state.needsEmailConfirmation
    ) {
      setNavigating(true);
      router.push(POST_AUTH_REDIRECT);
    }
  }, [state, router]);

  // Held through the route change so the form cannot be submitted twice in the
  // window between a successful signup and the dashboard actually rendering.
  const busy = isPending || navigating;
  const error = mismatchError ?? state?.error ?? null;

  if (confirmed) {
    return (
      /* The form is gone and a different surface has taken its place, which is
         the one state change in signup worth animating. `data-enter="scale"`
         because it mounts rather than scrolls into view: the same CSS keyframe
         the marketing heroes use, so the panel arrives with depth and the
         reduced-motion gate is already handled for it. */
      <div
        data-enter="scale"
        className="flex flex-col gap-4 rounded-card border border-border bg-glass p-5"
      >
        <h2 className="text-headline-md text-foreground">Check your email</h2>
        <p className="text-body-md text-muted-foreground">
          We&apos;ve sent a confirmation link to{" "}
          <span className="font-medium text-foreground">{submittedEmail}</span>.
          Confirm your account before signing in.
        </p>
        <p className="text-body-md text-muted-foreground">
          Already confirmed?{" "}
          <a
            href="/login"
            className="rounded-base font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Log in
          </a>
        </p>
      </div>
    );
  }

  return (
    <AuthOptions
      emailLabel="Sign up with email"
      altPrompt="Already have an account?"
      altHref="/login"
      altLabel="Log in"
      busy={busy}
    >
      <form
        action={formAction}
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          const form = event.currentTarget;
          const password = new FormData(form).get("password");
          const confirmPassword = new FormData(form).get("confirmPassword");
          if (password !== confirmPassword) {
            event.preventDefault();
            setMismatchError(PASSWORD_MISMATCH);
            return;
          }
          setMismatchError(null);
          submitted.current = true;
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-label-sm font-medium text-foreground"
          >
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@university.edu"
            disabled={busy}
            onChange={(event) => setSubmittedEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-label-sm font-medium text-foreground"
          >
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={busy}
            onChange={() => setMismatchError(null)}
          />
          <p className="text-label-sm text-muted-foreground">
            At least 8 characters.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="confirmPassword"
            className="text-label-sm font-medium text-foreground"
          >
            Confirm password
          </label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={busy}
            onChange={() => setMismatchError(null)}
          />
        </div>
        {/* Covers both the server error and the client-side password mismatch.
            No delay and no exit: the mismatch clears the moment either password
            field is edited, and animating away an error you have just fixed
            would slow down the correction. */}
        {error ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {error}
          </MotionNotice>
        ) : null}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthOptions>
  );
}
