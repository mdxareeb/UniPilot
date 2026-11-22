import { View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/components/AppText";
import { useTheme } from "@/theme/ThemeProvider";

type CardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `flush` is for cards whose rows own their padding. */
  padding?: number;
  elevation?: "raised" | "floating" | "flush";
};

/**
 * The one card container: solid fill, a 1px hairline border and the card radius.
 * Slots below give every card the same header/body/footer rhythm; nested
 * surfaces separate by fill + radius, never by a second shadow.
 */
export function Card({
  children,
  style,
  padding = 0,
  elevation = "raised",
}: CardProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.card,
          overflow: "hidden",
          padding,
        },
        elevation === "flush" ? null : theme.elevation[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );
}

type CardHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  trailing?: React.ReactNode;
};

export function CardHeader({ title, subtitle, eyebrow, trailing }: CardHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        {eyebrow ? (
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="bodyMd">{title}</AppText>
        {subtitle ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View>{trailing}</View> : null}
    </View>
  );
}

export function CardBody({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function CardFooter({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
      }}
    >
      {children}
    </View>
  );
}
