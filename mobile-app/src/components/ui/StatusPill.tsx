import { View } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "@/components/AppText";

export type StatusTone =
  | "neutral"
  | "solid"
  | "outline"
  | "warning"
  | "danger"
  | "planned";

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
  /** A small leading dot, useful for connection states. */
  dot?: boolean;
};

/**
 * Compact status vocabulary. The palette stays monochrome: emphasis comes from
 * an inverted fill, a hairline outline or the one functional (destructive)
 * colour. Labels are mono caps so every screen reads the same way.
 */
export function StatusPill({ label, tone = "neutral", dot = false }: StatusPillProps) {
  const theme = useTheme();

  const styles = {
    neutral: {
      backgroundColor: theme.colors.muted,
      borderColor: "transparent",
      color: theme.colors.mutedForeground,
    },
    solid: {
      backgroundColor: theme.colors.inverted,
      borderColor: "transparent",
      color: theme.colors.onInverted,
    },
    outline: {
      backgroundColor: "transparent",
      borderColor: theme.colors.border,
      color: theme.colors.mutedForeground,
    },
    warning: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.foreground,
      color: theme.colors.foreground,
    },
    danger: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.destructive,
      color: theme.colors.destructive,
    },
    planned: {
      backgroundColor: "transparent",
      borderColor: theme.colors.border,
      color: theme.colors.mutedForeground,
    },
  }[tone];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs,
        alignSelf: "flex-start",
        borderWidth: 1,
        borderStyle: tone === "planned" ? "dashed" : "solid",
        borderColor: styles.borderColor,
        backgroundColor: styles.backgroundColor,
        borderRadius: theme.radii.pill,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 3,
      }}
    >
      {dot ? (
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: styles.color,
          }}
        />
      ) : null}
      <AppText variant="caps" color={styles.color}>
        {label}
      </AppText>
    </View>
  );
}
