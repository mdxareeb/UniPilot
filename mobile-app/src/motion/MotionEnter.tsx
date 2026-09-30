import { useEffect } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT, STAGGER } from "./presets";
import { useReduceMotion } from "./useReduceMotion";

export type MotionEnterVariant = "up" | "scale" | "none";

type MotionEnterProps = {
  children: React.ReactNode;
  /** The entrance-ladder slot: slot 0 has no delay, each next adds a stagger. */
  index?: number;
  variant?: MotionEnterVariant;
  style?: StyleProp<ViewStyle>;
};

/**
 * The native equivalent of the web's `[data-enter]` entrance ladder
 * (MOTION.md §"The workspace entrance ladder").
 *
 * Safety rules, carried over exactly:
 * - the content is always structurally rendered — only opacity and transform
 *   animate, so a failed effect can never hide anything;
 * - under reduced motion the element renders in its final position with no
 *   animation at all (no fade either), matching the web's inversion rule.
 */
export function MotionEnter({
  children,
  index = 0,
  variant = "up",
  style,
}: MotionEnterProps) {
  const reduced = useReduceMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(
      withDelay(
        index * STAGGER.md,
        withTiming(1, {
          duration: DURATION.entrance,
          easing: Easing.bezier(...EASE_OUT),
        }),
      ),
    );
  }, [index, progress, reduced]);

  const animatedStyle = useAnimatedStyle(() => {
    const translateY =
      variant === "up"
        ? (1 - progress.value) * 16
        : variant === "scale"
          ? (1 - progress.value) * 8
          : 0;
    const scale = variant === "scale" ? 1 - (1 - progress.value) * 0.04 : 1;
    return {
      opacity: progress.value,
      transform: [{ translateY }, { scale }],
    };
  });

  return (
    <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
  );
}
