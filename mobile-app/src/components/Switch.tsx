import { Switch as NativeSwitch } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Read out by screen readers; the visible label lives beside the switch. */
  accessibilityLabel: string;
};

/**
 * The one on/off control. The platform switch carries its own (reduced-motion
 * aware) thumb animation and accessibility role; this only applies the tokens.
 */
export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: SwitchProps) {
  const theme = useTheme();
  return (
    <NativeSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
      thumbColor={theme.colors.card}
      ios_backgroundColor={theme.colors.border}
    />
  );
}
