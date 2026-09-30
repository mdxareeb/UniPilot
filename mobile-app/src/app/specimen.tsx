import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { ColorsSection, RadiusElevationSection } from "@/features/specimen/ColorsSection";
import { ControlsSection } from "@/features/specimen/ControlsSection";
import { StatesSection } from "@/features/specimen/StatesSection";
import { SurfacesSection } from "@/features/specimen/SurfacesSection";
import { TypeScaleSection } from "@/features/specimen/TypeScaleSection";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The design specimen (M1 deliverable): type scale, colour tokens, surfaces,
 * controls, list rows, empty/error states, radius/elevation and the motion
 * ladder — so the design language is verifiable before any feature exists.
 * Reachable from More.
 */
export default function SpecimenScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to More"
        onPress={() => router.back()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs,
          alignSelf: "flex-start",
        }}
      >
        <ChevronLeft size={16} color={theme.colors.mutedForeground} />
        <AppText variant="label" color={theme.colors.mutedForeground}>
          More
        </AppText>
      </Pressable>

      <PageHeading
        eyebrow="Design"
        title="Specimen"
        description="The UniPilot design language in native tokens — monochrome, light and dark."
      />

      {lastAction ? (
        <Notice>{lastAction}</Notice>
      ) : null}

      <TypeScaleSection index={1} />
      <ColorsSection index={2} />
      <SurfacesSection index={3} />
      <ControlsSection index={4} onAction={setLastAction} />
      <StatesSection index={5} />
      <RadiusElevationSection index={6} />

      <View style={{ gap: theme.spacing.xs }}>
        <AppText
          variant="caps"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          Tokens mirror frontend/app/globals.css
        </AppText>
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          style={{ textAlign: "center" }}
        >
          mobile-app/src/theme/tokens.ts
        </AppText>
      </View>
    </Screen>
  );
}
