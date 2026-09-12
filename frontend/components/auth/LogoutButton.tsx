"use client";

import { useActionState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { signOut, type AuthActionResult } from "@/lib/auth/actions";

type LogoutButtonProps = {
  /** Wording for the control. The pending state is derived from the action. */
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Applied to the button, so a caller can size it to its container. */
  className?: string;
};

/**
 * Sign-out, as a form posting the existing `signOut` Server Function.
 *
 * A form rather than a click handler because signing out is a state change, and
 * the action already owns the whole sequence: clear the Supabase session,
 * revalidate the layout so a Back navigation cannot render signed-in content
 * from cache, then redirect to /login. Nothing here duplicates that, and the
 * appearance props below do not touch it.
 *
 * Mounted in the workspace sidebar's user area. `AuthActionResult` only ever
 * carries a sanitized message — the raw Supabase error never reaches the page.
 */
export function LogoutButton({
  label = "Sign out",
  variant = "outline",
  size = "md",
  className,
}: LogoutButtonProps = {}) {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(async () => signOut(), { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button
        type="submit"
        variant={variant}
        size={size}
        disabled={isPending}
        aria-busy={isPending}
        className={className}
      >
        {isPending ? "Signing out…" : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-label-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export type { LogoutButtonProps };
