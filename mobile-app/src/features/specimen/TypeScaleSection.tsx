import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";
import type { TypeVariantName } from "@/theme/tokens";
import { SpecimenSection } from "./SpecimenSection";

const SAMPLES: Record<TypeVariantName, string> = {
  display: "Display",
  headlineLg: "Headline large",
  headlineLgMobile: "Headline mobile",
  headlineMd: "Headline medium",
  bodyLg: "Body large — Geist 18",
  bodyMd: "Body — Geist 16",
  label: "Action label — Bricolage 13",
  labelBody: "Content label — Geist 13",
  caps: "Metadata caps — Geist Mono 12",
  mono: "Technical — Geist Mono 13",
};

/** The type scale, one row per token role, in its real family and weight. */
export function TypeScaleSection({ index }: { index: number }) {
  const theme = useTheme();
  const variants = Object.keys(theme.type) as TypeVariantName[];

  return (
    <SpecimenSection title="Type scale" index={index}>
      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={0}
        style={{ overflow: "hidden" }}
      >
        {variants.map((variant, i) => (
          <View key={variant}>
            {i > 0 ? <Divider /> : null}
            <View
              style={{
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                gap: theme.spacing.xs,
              }}
            >
              <AppText variant="caps" color={theme.colors.mutedForeground}>
                {`${variant} · ${theme.type[variant].fontSize}px`}
              </AppText>
              <AppText variant={variant}>{SAMPLES[variant]}</AppText>
            </View>
          </View>
        ))}
      </Surface>
    </SpecimenSection>
  );
}
