"use client";

import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Modal } from "@/components/ui/Modal";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";
import { sanitizeRedirectPath } from "@/lib/auth/redirects";

const DEFAULT_REASON = "Sign in to use this part of your workspace.";

/**
 * The skippable sign-in prompt (TASK.md 0.17, extended to the workspace
 * routes).
 *
 * One shared dialog for every guest attempt to use a surface: a short reason
 * naming what the action needs an account for, the primary "Sign in" (a real
 * link to `/login?next=<current path>`, validated by `sanitizeRedirectPath`
 * exactly like every other `?next=`), and the secondary "Continue browsing"
 * that closes. Escape, the close button and a backdrop press all dismiss it —
 * `Modal` already routes all three through `onOpenChange`.
 *
 * There is no persistence and no redirect: dismissing is a real answer, and
 * the guest stays on the page they were browsing.
 */
export function SignInPrompt({
  open,
  reason,
  onOpenChange,
}: {
  open: boolean;
  /** The reason the action was blocked; null renders the generic line. */
  reason: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const next = sanitizeRedirectPath(pathname);
  const signInHref = `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(next)}`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Sign in to continue"
      description={reason ?? DEFAULT_REASON}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={signInHref} size="sm">
          Sign in
        </ButtonLink>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Continue browsing
        </Button>
      </div>
    </Modal>
  );
}
