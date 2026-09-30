import { useState } from "react";
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

type InputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
  error?: string | null;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoComplete?: TextInputProps["autoComplete"];
  textContentType?: TextInputProps["textContentType"];
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmitEditing?: () => void;
  testID?: string;
};

/**
 * The one text-field control: a mono caps label above a card-filled field with
 * the Control radius and a 1px border that turns foreground on focus (the
 * web's input behaviour). Form text stays on Geist — fields are never
 * action labels, per the closed font-set rules.
 */
export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  editable = true,
  error = null,
  keyboardType,
  autoCapitalize = "none",
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  testID,
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText variant="caps" color={theme.colors.mutedForeground}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        secureTextEntry={secureTextEntry}
        editable={editable}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight: 48,
          borderRadius: theme.radii.control,
          borderWidth: 1,
          borderColor: error
            ? theme.colors.destructive
            : focused
              ? theme.colors.foreground
              : theme.colors.border,
          backgroundColor: theme.colors.card,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          color: theme.colors.foreground,
          fontFamily: theme.fontFamily.bodyRegular,
          fontSize: 16,
          opacity: editable ? 1 : 0.5,
        }}
      />
      {error ? (
        <AppText variant="mono" color={theme.colors.destructive}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
