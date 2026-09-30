import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

import { useTheme } from "@/theme/ThemeProvider";

/**
 * The fixed backdrop stack (DESIGN.md §Task 3.13): base floor + one very
 * low-contrast neutral ambient field (the single permitted gradient, ±1.5%
 * lightness) + the swappable dot motif (32px pitch, 1px mark). Non-scrolling,
 * non-interactive, transform-free — nothing animates it.
 */
export function Backdrop() {
  const theme = useTheme();
  const field: [string, string, string] = theme.isDark
    ? ["#131316", "#16161b", "#131316"]
    : ["#f4f4f5", "#f8f8f9", "#f4f4f5"];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.colors.background },
        ]}
      />
      <LinearGradient
        colors={field}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id="unipilot-dot-grid"
            width={theme.layout.motifSpacing}
            height={theme.layout.motifSpacing}
            patternUnits="userSpaceOnUse"
          >
            <Circle
              cx={theme.layout.motifSpacing / 2}
              cy={theme.layout.motifSpacing / 2}
              r={theme.layout.motifDotRadius}
              fill={theme.colors.motif}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#unipilot-dot-grid)" />
      </Svg>
    </View>
  );
}
