import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The one reduced-motion read. Mirrors the web's `useReducedMotion()`:
 * primitives zero their durations and skip transforms when it is true, and
 * content is always rendered in its final position.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
