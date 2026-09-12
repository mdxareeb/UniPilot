import type { Metadata } from "next";
import { REDIRECT_PARAM } from "@/lib/auth/constants";
import { AUTH_NOTICE_PARAM, authNoticeMessage } from "@/lib/auth/errors";
import { sanitizeRedirectPath } from "@/lib/auth/redirects";
import { motionIndex } from "@/components/motion/stagger";
import { LoginForm } from "./_components/LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your UniPilot workspace.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // Resolved on the server so the client only ever receives finished copy —
  // failed OAuth, an expired verification link, and an expired session all
  // arrive here as opaque codes and are mapped to one of our own messages.
  const notice = authNoticeMessage(params[AUTH_NOTICE_PARAM]);
  const nextParam = params[REDIRECT_PARAM];
  const redirectTo = sanitizeRedirectPath(
    typeof nextParam === "string" ? nextParam : null,
  );

  return (
    <div className="w-full max-w-[420px]">
      <div className="text-center">
        <p
          data-enter
          style={motionIndex(0)}
          className="font-mono text-label-caps uppercase text-muted-foreground"
        >
          Sign in
        </p>
        <h1
          data-enter
          style={motionIndex(1)}
          className="mt-3 text-headline-lg-mobile text-foreground md:text-headline-lg"
        >
          Welcome back
        </h1>
        <p
          data-enter
          style={motionIndex(2)}
          className="mt-3 text-body-md text-muted-foreground"
        >
          Sign in to your UniPilot workspace.
        </p>
      </div>
      <div data-enter style={motionIndex(3)} className="mt-8">
        <LoginForm notice={notice} redirectTo={redirectTo} />
      </div>
    </div>
  );
}
