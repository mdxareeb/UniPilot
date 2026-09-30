import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";
import { SpecimenSection } from "./SpecimenSection";

/** The three fills: solid (default), glass, inverted (rationed), and nesting. */
export function SurfacesSection({ index }: { index: number }) {
  const theme = useTheme();

  return (
    <SpecimenSection title="Surfaces" index={index}>
      <View style={{ gap: theme.spacing.md }}>
        <Surface
          fill="solid"
          elevation="raised"
          radius="card"
          padding={theme.spacing.lg}
          style={{ gap: theme.spacing.xs }}
        >
          <AppText variant="label">Solid</AppText>
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            The default content card: opaque fill, 1px border, Card radius.
          </AppText>
        </Surface>

        <Surface
          fill="glass"
          elevation="floating"
          radius="card"
          padding={theme.spacing.lg}
          style={{ gap: theme.spacing.xs }}
        >
          <AppText variant="label">Glass</AppText>
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            Translucent fill + blur where the platform provides it; without
            blur the fill alone stays legible.
          </AppText>
        </Surface>

        <Surface
          fill="inverted"
          elevation="raised"
          radius="card"
          padding={theme.spacing.lg}
          style={{ gap: theme.spacing.xs }}
        >
          <AppText variant="label" color={theme.colors.onInverted}>
            Inverted
          </AppText>
          <AppText variant="bodyMd" color={theme.colors.onInverted}>
            The emphasis device — at most one per view. Nested surfaces inside
            it step lighter, never shadowed.
          </AppText>
          <View
            style={{
              marginTop: theme.spacing.sm,
              borderRadius: theme.radii.nested,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.invertedNested,
            }}
          >
            <AppText variant="mono" color={theme.colors.onInverted}>
              nested well
            </AppText>
          </View>
        </Surface>
      </View>
    </SpecimenSection>
  );
}
