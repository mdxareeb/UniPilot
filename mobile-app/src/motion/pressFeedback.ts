import { useCallback } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { DURATION, EASE_OUT } from "./presets";
import { useReduceMotion } from "./useReduceMotion";

/**
 * Press feedback — the native equivalent of the web's `press-feedback`
 * utility (scale 0.97 at 140ms ease-out). Under reduced motion no transform
 * is applied; the pressed colour/opacity step remains (the web keeps colour
 * and opacity feedback under reduced motion too).
 */
export function usePressScale(enabled: boolean = true) {
  const reduced = useReduceMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = useCallback(() => {
    if (!enabled || reduced) return;
    scale.set(
      withTiming(0.97, {
        duration: DURATION.press,
        easing: Easing.bezier(...EASE_OUT),
      }),
    );
  }, [enabled, reduced, scale]);

  const onPressOut = useCallback(() => {
    if (!enabled || reduced) return;
    scale.set(
      withTiming(1, {
        duration: DURATION.press,
        easing: Easing.bezier(...EASE_OUT),
      }),
    );
  }, [enabled, reduced, scale]);

  return { animatedStyle, onPressIn, onPressOut };
}
