import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import * as SystemUI from "expo-system-ui";

import { AuthProvider, useAuth } from "@/auth/AuthProvider";
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
  const { status } = useAuth();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // Cosmetic only (kills the white frame behind the root view).
    });
  }, [theme.colors.background]);

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
        </Stack.Protected>
        <Stack.Protected guard={status !== "signed_in"}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
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
