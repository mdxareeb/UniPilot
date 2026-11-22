import { useCallback, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { Divider } from "@/components/Divider";
import { ListRow } from "@/components/ListRow";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { Surface } from "@/components/Surface";
import { MotionEnter } from "@/motion/MotionEnter";
import { appIdentity, isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * More — profile (owner-scoped, RLS), sign-out, Integrations/Settings and the
 * design specimen. Every row states its real state: AUTH data comes from the
 * session, onboarding reads the real completion marker, and anything unbuilt
 * says so.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile, profileError, signOut } = useAuth();
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onSignOut = useCallback(async () => {
    if (signOutBusy) return;
    setSignOutError(null);
    setSignOutBusy(true);
    const result = await signOut();
    setSignOutBusy(false);
    if (result.error !== null) setSignOutError(result.error);
  }, [signOut, signOutBusy]);

  return (
    <Screen>
      <PageHeading
        eyebrow="More"
        title="More"
        description="Your profile, integrations and the design specimen."
      />

      <MotionEnter index={1}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ marginBottom: theme.spacing.sm }}
        >
          Profile
        </AppText>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          <ListRow
            title="Name"
            value={profile?.fullName ?? "No name yet"}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Timezone"
            subtitle="Every date the calendar renders uses this zone"
            value={profile?.timezone ?? "—"}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Onboarding"
            value={
              profile === null
                ? "Unavailable"
                : profile.onboardingComplete
                  ? "Complete"
                  : "Not finished"
            }
            disabled
            showChevron={false}
          />
        </Surface>
        {profileError !== null ? (
          <View style={{ marginTop: theme.spacing.sm }}>
            <Notice tone="error">{profileError}</Notice>
          </View>
        ) : null}
        {profile !== null && !profile.onboardingComplete ? (
          <View style={{ marginTop: theme.spacing.sm }}>
            <Notice>
              Setup isn&apos;t finished for this account. Finish it to unlock
              the workspace.
            </Notice>
          </View>
        ) : null}
      </MotionEnter>

      <MotionEnter index={2}>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          {profile !== null && !profile.onboardingComplete ? (
            <>
              <ListRow
                title="Finish setup"
                subtitle="Profile answers and subjects"
                onPress={() => router.push("/onboarding")}
              />
              <Divider />
            </>
          ) : null}
          <ListRow
            title="Design specimen"
            subtitle="Native tokens, controls and states"
            onPress={() => router.push("/specimen")}
          />
          <Divider />
          <ListRow
            title="WhatsApp groups"
            subtitle="Deadlines and files from your college groups"
            onPress={() => router.push("/whatsapp-groups")}
          />
          <Divider />
          <ListRow
            title="Course materials"
            subtitle="Files and summaries from your groups"
            onPress={() => router.push("/materials")}
          />
          <Divider />
          <ListRow
            title="Google Calendar · Outlook"
            subtitle="Calendar integrations"
            value="Not connected yet"
            disabled
          />
          <Divider />
          <ListRow
            title="Settings"
            subtitle="Profile and preferences"
            value="Arrives with M2b"
            disabled
          />
        </Surface>
      </MotionEnter>

      <MotionEnter index={3}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ marginBottom: theme.spacing.sm }}
        >
          Build
        </AppText>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          <ListRow
            title="Supabase"
            subtitle="Public anon client"
            value={isSupabaseConfigured ? "Configured" : "Not configured"}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Version"
            value={appIdentity.version}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Package"
            value={appIdentity.packageId}
            disabled
            showChevron={false}
          />
          <Divider />
          <ListRow
            title="Scheme"
            value={appIdentity.scheme}
            disabled
            showChevron={false}
          />
        </Surface>
      </MotionEnter>

      <MotionEnter index={4}>
        <Button
          label={signOutBusy ? "Signing out…" : "Sign out"}
          variant="outline"
          onPress={() => void onSignOut()}
          disabled={signOutBusy}
          style={{ alignSelf: "stretch" }}
        />
        {signOutError !== null ? (
          <View style={{ marginTop: theme.spacing.sm }}>
            <Notice tone="error">{signOutError}</Notice>
          </View>
        ) : null}
      </MotionEnter>

      <MotionEnter index={5}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          UniPilot mobile · M2
        </AppText>
      </MotionEnter>
    </Screen>
  );
}
