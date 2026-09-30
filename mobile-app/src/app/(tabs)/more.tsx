import { useRouter } from "expo-router";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { ListRow } from "@/components/ListRow";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { Surface } from "@/components/Surface";
import { MotionEnter } from "@/motion/MotionEnter";
import { appIdentity, isSupabaseConfigured } from "@/lib/supabase";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * More — Integrations, Settings and the design specimen (decision (b)).
 * Every row states its real state: the specimen works, everything else says
 * honestly that it is not built or not connected yet.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <PageHeading
        eyebrow="More"
        title="More"
        description="Integrations, settings and the design specimen."
      />

      <MotionEnter index={1}>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={0}
          style={{ overflow: "hidden" }}
        >
          <ListRow
            title="Design specimen"
            subtitle="Native tokens, controls and states"
            onPress={() => router.push("/specimen")}
          />
          <Divider />
          <ListRow
            title="Integrations"
            subtitle="WhatsApp · Google Calendar · Outlook"
            value="Not connected yet"
            disabled
          />
          <Divider />
          <ListRow
            title="Settings"
            subtitle="Profile and preferences"
            value="Arrives with M2"
            disabled
          />
        </Surface>
      </MotionEnter>

      <MotionEnter index={2}>
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

      <MotionEnter index={3}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          UniPilot mobile · M1 shell
        </AppText>
      </MotionEnter>
    </Screen>
  );
}
