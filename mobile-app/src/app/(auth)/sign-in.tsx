import { useCallback, useState } from "react";
import { View } from "react-native";

import { AUTH_COPY } from "@/auth/authErrors";
import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { Screen } from "@/components/Screen";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Sign-in (M2a) — the app's first screen by design: there is no guest mode
 * (approved product decision). Email + password against the LOCAL Supabase;
 * every failure renders the sanitized copy, and an unconfigured build renders
 * the honest state instead of a form that could never work.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unconfigured = status === "unconfigured";

  const submit = useCallback(async () => {
    if (busy || unconfigured) return;
    if (email.trim() === "" || password === "") {
      setError(AUTH_COPY.MISSING_FIELDS);
      return;
    }
    setError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (result.error !== null) setError(result.error);
    // On success the root guard swaps to the app; nothing else to do here.
  }, [busy, email, password, signIn, unconfigured]);

  return (
    <Screen scroll={false} contentStyle={{ justifyContent: "center" }}>
      <MotionEnter index={0} style={{ gap: theme.spacing.xs }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          UniPilot
        </AppText>
        <AppText variant="headlineLgMobile">Sign in</AppText>
        <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
          Your workspace, from your phone.
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
          {unconfigured ? (
            <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
              {AUTH_COPY.UNCONFIGURED}
            </AppText>
          ) : (
            <>
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                editable={!busy}
                testID="sign-in-email"
              />
              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                editable={!busy}
                onSubmitEditing={() => void submit()}
                testID="sign-in-password"
              />
              <Button
                label={busy ? "Signing in…" : "Sign in"}
                onPress={() => void submit()}
                disabled={busy}
                style={{ alignSelf: "stretch" }}
              />
            </>
          )}
        </Surface>
      </MotionEnter>

      {error !== null ? (
        <View style={{ marginTop: theme.spacing.lg }}>
          <Notice tone="error">{error}</Notice>
        </View>
      ) : null}

      <MotionEnter index={2} style={{ marginTop: theme.spacing.xxl }}>
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          Local Supabase · adb reverse 54937 · M2a
        </AppText>
      </MotionEnter>
    </Screen>
  );
}
