import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { tapFeedback } from "@/lib/haptics";
import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "@/components/AppText";

export type AppButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type AppButtonSize = "md" | "sm";

type AppButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** A decorative glyph rendered before the label. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Stretch to the container width (the common form/action footer case). */
  fullWidth?: boolean;
};

/**
 * The one action primitive. Every variant keeps a 44dp minimum target, the
 * shared 0.97 press scale, a visible pressed step that survives reduced motion,
 * and a built-in loading state that disables double taps. Action labels stay
 * Bricolage per DESIGN.md; no variant introduces a new colour.
 */
export function AppButton({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  leading,
  trailing,
  style,
  accessibilityLabel,
  fullWidth = false,
}: AppButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(!inactive);
  const [pressed, setPressed] = useState(false);

  const colors = {
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.onPrimary,
      spinner: theme.colors.onPrimary,
    },
    secondary: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.border,
      borderWidth: 1,
      text: theme.colors.foreground,
      spinner: theme.colors.foreground,
    },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.foreground,
      spinner: theme.colors.foreground,
    },
    destructive: {
      backgroundColor: theme.colors.destructive,
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.onDestructive,
      spinner: theme.colors.onDestructive,
    },
  }[variant];

  return (
    <Animated.View
      style={[animatedStyle, fullWidth ? { alignSelf: "stretch" } : null, style]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          onPressIn();
          if (variant === "primary" || variant === "destructive") tapFeedback();
        }}
        onPressOut={() => {
          setPressed(false);
          onPressOut();
        }}
        style={[
          {
            minHeight: size === "sm" ? 44 : 48,
            justifyContent: "center",
            alignItems: "center",
            borderRadius: theme.radii.pill,
            paddingHorizontal: size === "sm" ? theme.spacing.lg : theme.spacing.xl,
            paddingVertical: size === "sm" ? theme.spacing.sm : theme.spacing.md,
            backgroundColor: colors.backgroundColor,
            borderColor: colors.borderColor,
            borderWidth: colors.borderWidth,
          },
          pressed && !inactive ? { opacity: 0.86 } : null,
          inactive ? { opacity: 0.5 } : null,
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: theme.spacing.sm,
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.spinner} />
          ) : leading ? (
            <View>{leading}</View>
          ) : null}
          <AppText variant="label" color={colors.text}>
            {label}
          </AppText>
          {!loading && trailing ? <View>{trailing}</View> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}
