import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";

import { useTheme } from "@/theme/ThemeProvider";
import type { ElevationName } from "@/theme/tokens";

export type SurfaceFillName = "glass" | "solid" | "inverted" | "none";

type SurfaceProps = {
  children: React.ReactNode;
  /** Exactly one fill per surface; glass/solid/inverted per the token system. */
  fill?: SurfaceFillName;
  /** One elevation level per surface; never two shadow utilities on one box. */
  elevation?: ElevationName;
  radius?: "frame" | "card" | "nested" | "control" | "pill";
  padding?: number;
  /** A surface nested inside a glass parent takes the subtler glass step. */
  subtle?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The one surface primitive: fill + radius + padding + elevation, mapped from
 * the web's three-fill system. Glass uses `expo-blur`; without blur support
 * the translucent fill alone stays legible — the honest-degradation rule.
 */
export function Surface({
  children,
  fill = "solid",
  elevation = "raised",
  radius = "card",
  padding = 20,
  subtle = false,
  style,
}: SurfaceProps) {
  const theme = useTheme();

  const backgroundColor =
    fill === "solid"
      ? theme.colors.card
      : fill === "inverted"
        ? theme.colors.inverted
        : fill === "glass"
          ? subtle
            ? theme.colors.glassSubtle
            : theme.colors.glass
          : "transparent";
  const borderColor =
    fill === "inverted" ? theme.colors.invertedBorder : theme.colors.border;

  const surfaceStyle: StyleProp<ViewStyle> = [
    {
      backgroundColor,
      borderRadius: theme.radii[radius],
      padding,
      ...(fill === "none"
        ? null
        : { borderWidth: 1, borderColor }),
      ...theme.elevation[elevation],
    },
    style,
  ];

  if (fill === "glass") {
    return (
      <BlurView
        intensity={28}
        tint={theme.isDark ? "dark" : "light"}
        experimentalBlurMethod={
          Platform.OS === "android" ? "dimezisBlurView" : undefined
        }
        style={surfaceStyle}
      >
        {children}
      </BlurView>
    );
  }

  return <View style={surfaceStyle}>{children}</View>;
}
