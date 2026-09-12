"use client";

import { Button } from "@/components/ui/Button";

/**
 * Fallback for an unexpected throw anywhere in the auth routes.
 *
 * Without this boundary an unhandled error reaches Next.js's own error screen,
 * which is a stack trace in development and a bare "Application error" in
 * production — neither of which is something to show someone trying to sign in.
 *
 * Only `error.digest` is rendered. It is a hash used to find the matching
 * server-side log entry; `error.message` is deliberately not shown, since for
 * client-side errors it carries the original text.
 */
export default function AuthErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="w-full max-w-[420px] text-center">
      <p className="font-mono text-label-caps uppercase text-muted-foreground">
        Something went wrong
      </p>
      <h1 className="mt-3 text-headline-lg-mobile text-foreground md:text-headline-lg">
        We hit a snag
      </h1>
      <p className="mt-3 text-body-md text-muted-foreground">
        That request didn&apos;t go through. Your account is unaffected — try
        again, or return to sign in.
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => retry()}
        >
          Try again
        </Button>
        <a
          href="/login"
          className="rounded-base py-2 text-body-md text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to sign in
        </a>
      </div>
      {error.digest ? (
        <p className="mt-8 font-mono text-label-caps uppercase text-muted-foreground">
          Ref {error.digest}
        </p>
      ) : null}
    </div>
  );
}
