import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_IN_OUT } from "./presets";
import { useReduceMotion } from "./useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

function Dot({ delay, reduced }: { delay: number; reduced: boolean }) {
  const theme = useTheme();
  const progress = useSharedValue(reduced ? 0.55 : 0.25);

  useEffect(() => {
    if (reduced) {
      progress.set(0.55);
      return;
    }
    progress.set(
      withDelay(
        delay,
        withRepeat(
          withTiming(1, {
            duration: DURATION.bar / 2,
            easing: Easing.bezier(...EASE_IN_OUT),
          }),
          -1,
          true,
        ),
      ),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress, reduced]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (0.55 - progress.value) * -4 }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: theme.colors.mutedForeground,
        },
        style,
      ]}
    />
  );
}

/**
 * The one thinking indicator. It is decorative (the thread announces its own
 * loading state), reuses the shared motion tokens, and becomes a static row
 * under reduced motion.
 */
export function TypingDots() {
  const reduced = useReduceMotion();
  const theme = useTheme();

  return (
    <View
      accessibilityLabel="Assistant is reading your materials"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.xs + 1,
        height: 18,
      }}
    >
      <Dot delay={0} reduced={reduced} />
      <Dot delay={140} reduced={reduced} />
      <Dot delay={280} reduced={reduced} />
    </View>
  );
}
