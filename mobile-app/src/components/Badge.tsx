import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

type BadgeProps = {
  children: string;
  tone?: "muted" | "inverted";
};

/** A pill status/badge; one fill, no border, mono caps label. */
export function Badge({ children, tone = "muted" }: BadgeProps) {
  const theme = useTheme();
  const inverted = tone === "inverted";

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs + 1,
        backgroundColor: inverted ? theme.colors.inverted : theme.colors.muted,
      }}
    >
      <AppText
        variant="caps"
        color={
          inverted ? theme.colors.onInverted : theme.colors.mutedForeground
        }
      >
        {children}
      </AppText>
    </View>
  );
}
