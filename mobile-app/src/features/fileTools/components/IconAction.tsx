import { Pressable } from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";

/** A compact square control for reorder/remove actions inside a list row. */
export function IconAction({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(!disabled);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={4}
        style={{
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: theme.radii.control,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        {icon}
      </Pressable>
    </Animated.View>
  );
}
