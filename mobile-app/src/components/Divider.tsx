import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "@/theme/ThemeProvider";

/** A 1px hairline at the border token; the only separator between rows. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[{ height: 1, backgroundColor: theme.colors.border }, style]}
    />
  );
}
