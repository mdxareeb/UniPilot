import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { AppText } from "@/components/AppText";
import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";

type FilterChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  /** A subject dot or a count glyph. */
  leading?: React.ReactNode;
  accessibilityLabel?: string;
};

/** The horizontal filter control used by Tasks and the week strip reset. */
export function FilterChip({
  label,
  active,
  onPress,
  leading,
  accessibilityLabel,
}: FilterChipProps) {
  const theme = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(true);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={accessibilityLabel ?? label}
        style={{
          minHeight: 44,
          justifyContent: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radii.pill,
          borderWidth: 1,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          backgroundColor: active ? theme.colors.primary : theme.colors.card,
        }}
      >
        {leading ? <View>{leading}</View> : null}
        <AppText variant="label" color={active ? theme.colors.onPrimary : undefined}>
          {label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}
