import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";
import { Badge } from "./Badge";

/**
 * A row's course: the name alone, or — when the subject carries a tag slug — a
 * subtle neutral dot with that slug. `color_tag` is a slug by schema design,
 * not a hue; the monochrome design system stays authoritative.
 */
export function SubjectTag({
  name,
  colorTag,
}: {
  name: string | null;
  colorTag: string | null;
}) {
  const theme = useTheme();
  if (name === null) return null;

  if (colorTag === null) {
    return (
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        {name}
      </AppText>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        flexWrap: "wrap",
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: theme.colors.mutedForeground,
        }}
      />
      <Badge>{colorTag}</Badge>
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        {name}
      </AppText>
    </View>
  );
}
