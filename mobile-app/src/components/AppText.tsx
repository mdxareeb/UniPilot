import { Text, type TextProps } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";
import type { TypeVariantName } from "@/theme/tokens";

export type AppTextProps = TextProps & {
  /** The type-scale role; family and weight come from the token. */
  variant?: TypeVariantName;
  /** Explicit colour; defaults to the foreground token. */
  color?: string;
  /** Allow the caller to compact a tight layout without forking the token. */
  tight?: boolean;
};

/**
 * The one text primitive. Every piece of copy renders through a type-scale
 * role — no ad-hoc font sizes and no `fontWeight` on the family instances
 * (the weight lives in the loaded file, per `src/theme/fonts.ts`).
 */
export function AppText({
  variant = "bodyMd",
  color,
  tight = false,
  style,
  children,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const type = theme.type[variant];

  return (
    <Text
      {...rest}
      style={[
        type,
        {
          color: color ?? theme.colors.foreground,
          ...(tight ? { includeFontPadding: false } : null),
          ...(variant === "caps" ? { textTransform: "uppercase" } : null),
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
