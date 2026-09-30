import { useState } from "react";
import {
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * The one button primitive: pill-shaped, Bricolage action label (Task 3.14),
 * press feedback at scale 0.97 / 140ms with a colour/opacity step that
 * survives reduced motion. Variants map to the token fills exactly:
 * primary = `primary` fill, outline = card + border, ghost = no fill,
 * destructive = the one functional colour.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(!disabled);
  const [pressed, setPressed] = useState(false);

  const colors = {
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.onPrimary,
    },
    outline: {
      backgroundColor: theme.colors.card,
      borderColor: theme.colors.border,
      borderWidth: 1,
      text: theme.colors.foreground,
    },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.foreground,
    },
    destructive: {
      backgroundColor: theme.colors.destructive,
      borderColor: "transparent",
      borderWidth: 0,
      text: theme.colors.onDestructive,
    },
  }[variant];

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          onPressIn();
        }}
        onPressOut={() => {
          setPressed(false);
          onPressOut();
        }}
        style={[
          {
            alignItems: "center",
            justifyContent: "center",
            borderRadius: theme.radii.pill,
            paddingVertical: size === "sm" ? theme.spacing.sm : theme.spacing.md,
            paddingHorizontal:
              size === "sm" ? theme.spacing.lg - 2 : theme.spacing.xl,
            backgroundColor: colors.backgroundColor,
            borderColor: colors.borderColor,
            borderWidth: colors.borderWidth,
          },
          pressed && !disabled ? { opacity: 0.88 } : null,
          disabled ? { opacity: 0.5 } : null,
        ]}
      >
        <AppText variant="label" color={colors.text}>
          {label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}
