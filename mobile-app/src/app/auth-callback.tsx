import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AUTH_COPY } from "@/auth/authErrors";
import { useAuth } from "@/auth/AuthProvider";
import type { OAuthResult } from "@/auth/oauth";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Screen } from "@/components/Screen";
import { Surface } from "@/components/Surface";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The OAuth callback landing (M2b): the app scheme's deep link arrives here on
 * a cold or warm start (`unipilot://auth-callback?code=…`), the PKCE code is
 * exchanged, and the root guard takes over. Failures render sanitized copy —
 * never a spinner without a verdict.
 */
export default function AuthCallbackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { completeAuthCallback } = useAuth();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
    sb_flow_id?: string;
  }>();

  const [state, setState] = useState<"working" | "failed">("working");
  const [message, setMessage] = useState<string | null>(null);

  /* TEMPORARY DIAGNOSTIC (Leg A): the received parameter NAMES only — never
     values (no code/state/flow id). Remove together with the oauth.ts helper. */
  const paramNames =
    Object.keys(params)
      .sort()
      .join(",") || "(none)";
  console.log(`[UNIPILOT_AUTH_DEBUG] route params=${paramNames}`);

  const run = useCallback(async () => {
    const query = new URLSearchParams();
    if (typeof params.code === "string") query.set("code", params.code);
    if (typeof params.error === "string") query.set("error", params.error);
    if (typeof params.error_description === "string") {
      query.set("error_description", params.error_description);
    }
    if (typeof params.sb_flow_id === "string") {
      query.set("sb_flow_id", params.sb_flow_id);
    }

    const result: OAuthResult = await completeAuthCallback(
      `unipilot://auth-callback?${query.toString()}`,
    );

    if (result.status === "signed_in") {
      router.replace("/");
      return;
    }
    setState("failed");
    setMessage(
      result.status === "cancelled"
        ? AUTH_COPY.GOOGLE_CANCELLED
        : result.error,
    );
  }, [
    completeAuthCallback,
    params.code,
    params.error,
    params.error_description,
    params.sb_flow_id,
    router,
  ]);

  useEffect(() => {
    /* Processing an inbound deep link is an effect by nature: the exchange must
       run exactly once, on mount, against an external system (Supabase Auth). */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: "center" }}>
      <MotionEnter index={0} style={{ gap: theme.spacing.xs }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          UniPilot
        </AppText>
        <AppText variant="headlineLgMobile">
          {state === "working" ? "Completing sign-in…" : "Sign-in"}
        </AppText>
      </MotionEnter>

      <MotionEnter index={1} style={{ marginTop: theme.spacing.xxl }}>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={theme.spacing.xl}
          style={{ gap: theme.spacing.lg }}
        >
          {state === "working" ? (
            <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
              Finishing the secure exchange with your account.
            </AppText>
          ) : (
            <>
              <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
                {message ?? AUTH_COPY.GOOGLE_FAILED}
              </AppText>
              <Button
                label="Back to sign in"
                variant="outline"
                onPress={() => router.replace("/sign-in")}
                style={{ alignSelf: "stretch" }}
              />
            </>
          )}
        </Surface>
      </MotionEnter>

      {/* TEMPORARY DIAGNOSTIC (Leg A): parameter NAMES only, never values. */}
      <MotionEnter index={2} style={{ marginTop: theme.spacing.lg }}>
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          {`callback params: ${paramNames}`}
        </AppText>
      </MotionEnter>
    </Screen>
  );
}
