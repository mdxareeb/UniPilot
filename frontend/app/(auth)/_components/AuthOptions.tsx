"use client";

import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Collapsible } from "@/components/motion/Collapsible";
import { signInWithGoogle } from "@/lib/auth/actions";

/**
 * The one sanctioned exception to the monochrome icon rule (DESIGN.md, "The
 * Icon Rule"): a brand sign-in mark. Google's branding guidelines require the
 * official multi-colour "G" on the sign-in control, so it is inlined here —
 * no external asset, CDN or dependency — exactly sized to the button's icon
 * slot. `aria-hidden` because the visible label already names the control.
 */
function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 18 18"
      className="size-4 shrink-0"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GoogleButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full"
      disabled={pending || blocked}
      aria-busy={pending}
    >
      <GoogleMark />
      {pending ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}

type AuthOptionsProps = {
  /** Small caps label for the top of the expanded email panel. */
  emailLabel: string;
  /** Question introducing the opposite auth page, e.g. "Need an account?". */
  altPrompt: string;
  altHref: string;
  altLabel: string;
  /**
   * True while the email form is submitting or navigating. Lets the email flow
   * lock the Google flow, the mirror of what `googleBusy` does below.
   */
  busy?: boolean;
  children: ReactNode;
};

/**
 * Shared authentication shell for /login and /signup: Google as the primary
 * action, with the email form behind a disclosure so neither page opens with a
 * long form. Each page passes only its own fields as children, so the two
 * routes stay two states of one experience rather than two implementations.
 *
 * Whichever flow starts first locks the other: two auth attempts in flight from
 * one page would race for the same session cookie, and the loser's redirect
 * could land the user somewhere they did not ask for.
 */
export function AuthOptions({
  emailLabel,
  altPrompt,
  altHref,
  altLabel,
  busy = false,
  children,
}: AuthOptionsProps) {
  const [open, setOpen] = useState(false);
  // `useFormStatus` only reports inside its own form, so the Google button reads
  // its pending state there while this flag is what the sibling controls can see.
  // It is never reset: the action always ends in a redirect away from this page.
  const [googleBusy, setGoogleBusy] = useState(false);
  const panelId = useId();
  const anyBusy = busy || googleBusy;

  return (
    <div className="flex flex-col gap-4">
      <form action={signInWithGoogle} onSubmit={() => setGoogleBusy(true)}>
        <GoogleButton blocked={busy} />
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-label-caps uppercase text-muted-foreground">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Trigger and panel share one flex item so the collapsed panel costs no
          vertical space: it stays in the DOM to animate out, and a bare sibling
          would leave the parent's `gap-4` doubled below the trigger. The open
          gap comes from the content's own `mt-4` instead. */}
      <div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={anyBusy}
          onClick={() => setOpen(!open)}
        >
          Continue with Email
          <ChevronDown
            aria-hidden="true"
            className={`size-4 icon-turn${open ? " rotate-180" : ""}`}
          />
        </Button>

        {/* `variant="scale"` because this panel reads as a surface arriving,
            not a paragraph unfolding. Its padding and border live on the
            content: the panel itself collapses to zero height, and its own box
            would survive that as a visible sliver. */}
        <Collapsible open={open} variant="scale" id={panelId}>
          <div className="mt-4 rounded-card border border-border bg-glass p-5 backdrop-blur-md">
            <p className="mb-4 text-center font-mono text-label-caps uppercase text-muted-foreground">
              {emailLabel}
            </p>
            {/* A disabled fieldset disables every control inside it, which is how the
                Google flow freezes the email fields without this shell needing to
                know anything about them. The email form disables its own controls
                from its own pending state. */}
            <fieldset disabled={googleBusy} className="min-w-0 border-0 p-0">
              {children}
            </fieldset>
          </div>
        </Collapsible>
      </div>

      <p className="text-center text-body-md text-muted-foreground">
        {altPrompt}{" "}
        <a
          href={altHref}
          className="rounded-base font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {altLabel}
        </a>
      </p>
    </div>
  );
}
