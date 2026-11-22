import { useEffect } from "react";
import { useRouter } from "expo-router";

import { AppText } from "@/components/AppText";
import { Screen } from "@/components/Screen";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The deep-link landing for `unipilot://oauth/google?status=…` — the browser
 * sends the user here after the server-side token exchange. Only a status
 * word travels: no code, no token, ever. The screen settles the user into
 * the Google Calendar screen, which re-reads the real connection state.
 */
export default function GoogleOauthCallbackScreen() {
  const theme = useTheme();
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/google-calendar");
    }, 900);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <Screen scroll={false}>
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        Finishing the Google link…
      </AppText>
    </Screen>
  );
}
