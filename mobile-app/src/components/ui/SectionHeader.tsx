import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { useTheme } from "@/theme/ThemeProvider";

type SectionHeaderProps = {
  label: string;
  trailing?: React.ReactNode;
};

/** The mono eyebrow that opens a section; the only section-level label style. */
export function SectionHeader({ label, trailing }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing.md,
      }}
    >
      <AppText variant="caps" color={theme.colors.mutedForeground}>
        {label}
      </AppText>
      {trailing ? <View>{trailing}</View> : null}
    </View>
  );
}
