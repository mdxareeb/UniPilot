"use client";

import { Button } from "@/components/ui/Button";

/**
 * Fallback for an unexpected throw inside the authenticated routes. Mirrors the
 * auth-route boundary: sanitized copy, a retry, and the error digest only —
 * never `error.message`, a stack trace, or any session detail.
 */
export default function AppErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <p className="font-mono text-label-caps uppercase text-muted-foreground">
        Something went wrong
      </p>
      <h1 className="text-headline-md text-foreground">
        This page didn&apos;t load
      </h1>
      <p className="max-w-[480px] text-body-md text-muted-foreground">
        Your work is safe. Try again, and if it keeps happening, sign out and
        back in.
      </p>
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
      {error.digest ? (
        <p className="font-mono text-label-caps uppercase text-muted-foreground">
          Ref {error.digest}
        </p>
      ) : null}
    </div>
  );
}
