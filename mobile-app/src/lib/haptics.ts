import { Platform, Vibration } from "react-native";

/**
 * The one haptic vocabulary. Core React Native only (no new native module), so
 * the current APK keeps working. Android is the target platform; a short pulse
 * is used for primary actions and toggles, never for every tap. Failures are
 * swallowed: haptics must never break an interaction.
 */
export function tapFeedback(): void {
  if (Platform.OS !== "android") return;
  try {
    Vibration.vibrate(8);
  } catch {
    /* no vibrator, or the platform refused */
  }
}

/** A slightly longer confirmation pulse for a destructive action that ran. */
export function confirmFeedback(): void {
  if (Platform.OS !== "android") return;
  try {
    Vibration.vibrate(14);
  } catch {
    /* no vibrator, or the platform refused */
  }
}
