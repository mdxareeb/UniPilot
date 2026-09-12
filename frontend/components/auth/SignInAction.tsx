"use client";

import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { useSignInPrompt } from "./SignInPromptProvider";

type SignInActionProps = Omit<ButtonProps, "onClick"> & {
  /** The short reason the prompt shows when a guest presses this control. */
  reason: string;
  /**
   * The server's verdict, already known when this control renders. Preferred
   * over the streamed context flag so a guest's first click can never race
   * hydration; the context fallback keeps the control safe if it is ever
   * mounted without the prop.
   */
  guest?: boolean;
  children: ReactNode;
};

/**
 * A page-level action that asks for a session before it does anything.
 *
 * Used by the guest-viewable surfaces whose feature is not implemented yet
 * (`/documents` upload, `/assistant` new conversation): for a signed-in
 * student the control behaves exactly as before (there is no action behind it
 * yet), while a guest gets the shared skippable prompt instead of a dead
 * button. Once the real action lands it runs in the `requireAuth` branch, so
 * the guest path stays the same.
 */
export function SignInAction({
  reason,
  guest = false,
  children,
  ...props
}: SignInActionProps) {
  const { openPrompt, requireAuth } = useSignInPrompt();

  return (
    <Button
      {...props}
      onClick={() => {
        if (guest) {
          openPrompt(reason);
          return;
        }
        requireAuth(reason);
      }}
    >
      {children}
    </Button>
  );
}
