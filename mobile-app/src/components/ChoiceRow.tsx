import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { useTheme } from "@/theme/ThemeProvider";

type Choice<T extends string | number> = { label: string; value: T };

type ChoiceRowProps<T extends string | number> = {
  label: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
};

/**
 * A pill choice row — the native form of the web's segmented controls: action
 * labels (Bricolage), the selected option inverted, the inactive one outline.
 * One fill per chip, pressed feedback from the shared Button primitive.
 */
export function ChoiceRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: ChoiceRowProps<T>) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText variant="caps" color={theme.colors.mutedForeground}>
        {label}
      </AppText>
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={String(option.value)}
              label={option.label}
              size="sm"
              variant={selected ? "primary" : "outline"}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              accessibilityLabel={`${label}: ${option.label}`}
            />
          );
        })}
      </View>
    </View>
  );
}
