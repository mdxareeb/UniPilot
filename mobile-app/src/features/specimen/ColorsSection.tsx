import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";
import { radii, type ThemeColors } from "@/theme/tokens";
import { SpecimenSection } from "./SpecimenSection";

/** Every semantic colour token, with its live value and a swatch. */
export function ColorsSection({ index }: { index: number }) {
  const theme = useTheme();
  const entries = Object.entries(theme.colors) as [keyof ThemeColors, string][];

  return (
    <SpecimenSection title="Colour tokens" index={index}>
      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={0}
        style={{ overflow: "hidden" }}
      >
        {entries.map(([name, value], i) => (
          <View key={name}>
            {i > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: theme.radii.control,
                  backgroundColor: value,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              />
              <AppText variant="mono" style={{ flex: 1 }}>
                {name}
              </AppText>
              <AppText variant="mono" color={theme.colors.mutedForeground}>
                {value}
              </AppText>
            </View>
          </View>
        ))}
      </Surface>
    </SpecimenSection>
  );
}

/** The five radius steps and the four elevation recipes. */
export function RadiusElevationSection({ index }: { index: number }) {
  const theme = useTheme();
  const radiusEntries = Object.entries(radii) as [string, number][];
  const elevationNames = ["flush", "raised", "floating", "overlay"] as const;

  return (
    <SpecimenSection title="Radius & elevation" index={index}>
      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={theme.spacing.lg}
        style={{ gap: theme.spacing.lg }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            Radius scale
          </AppText>
          {radiusEntries.map(([name, value]) => (
            <View
              key={name}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 32,
                  borderRadius: Math.min(value, 16),
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.muted,
                }}
              />
              <AppText variant="mono">
                {name} · {value === 9999 ? "pill" : value}
              </AppText>
            </View>
          ))}
        </View>
        <Divider />
        <View style={{ gap: theme.spacing.md }}>
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            Elevation
          </AppText>
          {elevationNames.map((name) => (
            <View
              key={name}
              style={[
                {
                  borderRadius: theme.radii.nested,
                  padding: theme.spacing.md,
                  backgroundColor: theme.colors.card,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                },
                theme.elevation[name],
              ]}
            >
              <AppText variant="mono">{name}</AppText>
            </View>
          ))}
        </View>
      </Surface>
    </SpecimenSection>
  );
}
