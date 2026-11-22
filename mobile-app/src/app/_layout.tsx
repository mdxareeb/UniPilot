import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import * as SystemUI from "expo-system-ui";

import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { authCallbackParams } from "@/auth/oauth";
import { AppText } from "@/components/AppText";
import { Backdrop } from "@/components/Backdrop";
import { fontAssets } from "@/theme/fonts";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash is cosmetic; never let it block the app.
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden, or the platform refused; nothing to recover.
      });
    }
  }, [fontsLoaded, fontError]);

  /* Without the three families the design language is not rendered — but a
     font failure must never hide the app, so the shell renders with the
     system fallback and the phase record records it as a defect. */
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedShell />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedShell() {
  const theme = useTheme();
  const { status, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigationKey = useRootNavigationState()?.key;
  const coldStartChecked = useRef(false);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // Cosmetic only (kills the white frame behind the root view).
    });
  }, [theme.colors.background]);

  /* The onboarding gate (M2b): a signed-in account with the completion marker
     NULL belongs in setup, and a completed one does not. Runs only after the
     navigator is mounted and the profile read settled, so no route flashes. */
  useEffect(() => {
    if (status !== "signed_in" || profile === null) return;
    if (!rootNavigationKey) return;
    const onOnboarding = segments[0] === "onboarding";
    if (!profile.onboardingComplete && !onOnboarding) {
      router.replace("/onboarding");
    } else if (profile.onboardingComplete && onOnboarding) {
      router.replace("/");
    }
  }, [profile, rootNavigationKey, router, segments, status]);

  /* Cold-start deep link (M2b Leg C): on Android the router can miss the
     launch URL — its `getInitialURL` races a 150 ms timeout, and the URL is
     consumed as the launch intent, so no later `url` event follows.
     expo-linking's native module still holds it; route to the callback once
     the navigator is ready. Warm deliveries are handled by the router and
     skip this one-shot check. */
  useEffect(() => {
    if (status === "loading" || !rootNavigationKey || coldStartChecked.current) {
      return;
    }
    coldStartChecked.current = true;
    const params = authCallbackParams(Linking.getLinkingURL());
    if (params === null) return;
    Linking.clearInitialURL();
    if (segments[0] === "auth-callback") return;
    router.replace({ pathname: "/auth-callback", params });
  }, [rootNavigationKey, router, segments, status]);

  /* The session restore is a brief, honest state of its own: the backdrop is
     real, the message is real, and neither group is mounted until the
     verdict exists — so the app never flashes the wrong surface. */
  if (status === "loading") {
    return (
      <View style={styles.loadingRoot}>
        <Backdrop />
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Restoring session…
        </AppText>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Protected guard={status === "signed_in"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="specimen" />
          <Stack.Screen name="whatsapp-groups" />
          <Stack.Screen name="materials" />
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={status !== "signed_in"}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* The OAuth landing must exist in both auth states: a cold-start
            deep link arrives before the session verdict does. */}
        <Stack.Screen name="auth-callback" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
