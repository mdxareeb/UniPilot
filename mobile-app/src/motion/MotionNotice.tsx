import { useEffect } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT } from "./presets";
import { useReduceMotion } from "./useReduceMotion";

type MotionNoticeProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * The native equivalent of `MotionNotice` (MOTION.md §"MotionNotice — inline
 * feedback"): fade + 4px drop at 180ms with **no delay**, mount-only — a
 * dismissed message unmounts instantly. Under reduced motion it renders in
 * place with no animation. The text is in the tree at mount either way.
 */
export function MotionNotice({ children, style }: MotionNoticeProps) {
  const reduced = useReduceMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.set(1);
      return;
    }
    progress.set(
      withTiming(1, {
        duration: DURATION.popover,
        easing: Easing.bezier(...EASE_OUT),
      }),
    );
  }, [progress, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 4 }],
  }));

  return (
    <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
  );
}
