"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AUTH_CALLBACK_PATH, POST_AUTH_REDIRECT } from "@/lib/auth/constants";
import { VERIFICATION_LINK_INVALID } from "@/lib/auth/errors";

type FragmentTokens = {
  accessToken: string;
  refreshToken: string;
};

function parseFragmentTokens(): FragmentTokens | null {
  if (typeof window === "undefined" || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function ConfirmEmail() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fail = () => {
      if (!cancelled) setFailed(true);
    };

    /* Email links arrive in one of two shapes, depending on the project's
       auth flow. Supabase's implicit flow puts the tokens in the URL fragment
       (the hosted project's behaviour), which only this client page can read.
       A PKCE flow — the default for `@supabase/ssr`, and what the local stack
       sends — delivers a one-time `?code=` instead. That code is exchanged by
       the server route that already owns PKCE (`/auth/callback`), so this page
       forwards to it rather than duplicating the exchange here; `flow=signup`
       keeps the failure destination on the verification notice. */
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const callback = new URL(AUTH_CALLBACK_PATH, window.location.origin);
      callback.searchParams.set("code", code);
      callback.searchParams.set("flow", "signup");
      const flowId = params.get("sb_flow_id");
      if (flowId) callback.searchParams.set("sb_flow_id", flowId);
      window.location.replace(`${callback.pathname}${callback.search}`);
      return;
    }

    const supabase = createClient();

    const tokens = parseFragmentTokens();
    if (!tokens) {
      fail();
      return;
    }

    supabase.auth
      .setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data.session) {
          fail();
          return;
        }
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname,
        );
        router.replace(POST_AUTH_REDIRECT);
      })
      .catch(() => fail());

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (failed) {
    return (
      /* Replaces the "Confirming…" line once the link is known to be bad. The
         entrance is on the failure only: the pending state is what the page
         opens with, and animating that would delay the first thing anyone
         arriving here needs to read. */
      <div data-enter className="flex flex-col gap-4">
        <p className="text-body-md text-muted-foreground" role="alert">
          {VERIFICATION_LINK_INVALID}
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
    <p className="text-body-md text-muted-foreground" role="status">
      Confirming your email…
    </p>
  );
}
