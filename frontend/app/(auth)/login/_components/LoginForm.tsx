"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { signInWithEmail, type AuthActionResult } from "@/lib/auth/actions";
import { AuthOptions } from "../../_components/AuthOptions";

async function loginAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  return signInWithEmail(
    String(formData.get("email") ?? ""),
    String(formData.get("password") ?? ""),
  );
}

export function LoginForm({
  notice,
  redirectTo,
}: {
  /** Pre-sanitized copy for a failure that happened before this page loaded. */
  notice: string | null;
  redirectTo: string;
}) {
  const router = useRouter();
  const submitted = useRef(false);
  const [navigating, setNavigating] = useState(false);
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(loginAction, { error: null });

  useEffect(() => {
    if (submitted.current && state.error === null) {
      setNavigating(true);
      router.push(redirectTo);
    }
  }, [state, router, redirectTo]);

  // `isPending` drops the moment the action resolves, but the route change it
  // triggers is still in flight. Staying busy through the navigation keeps the
  // controls locked instead of briefly re-enabling a form that already succeeded.
  const busy = isPending || navigating;

  return (
    <div className="flex flex-col gap-4">
      {/* Belongs to the Google flow, so it sits with the Google button rather
          than inside the email panel, which starts collapsed.

          The 4px drop is the whole animation: an error has to be readable the
          instant it exists, so it arrives at popover speed with no delay and
          nothing that could be mistaken for the form still working. */}
      {notice ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {notice}
        </MotionNotice>
      ) : null}

      <AuthOptions
        emailLabel="Sign in with email"
        altPrompt="Don't have an account?"
        altHref="/signup"
        altLabel="Sign up"
        busy={busy}
      >
        <form
          action={formAction}
          className="flex flex-col gap-3.5"
          onSubmit={() => {
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
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="password"
                className="text-label-sm font-medium text-foreground"
              >
                Password
              </label>
              <a
                href="/forgot-password"
                className="rounded-base text-label-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Forgot password?
              </a>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              disabled={busy}
            />
          </div>
          {state?.error ? (
            <MotionNotice
              role="alert"
              className="text-label-sm text-destructive"
            >
              {state.error}
            </MotionNotice>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </AuthOptions>
    </div>
  );
}
