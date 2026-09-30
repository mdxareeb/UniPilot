import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/** One labelled specimen band; each band is an entrance-ladder slot. */
export function SpecimenSection({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <MotionEnter index={index} style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xxs }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          {title}
        </AppText>
      </View>
      {children}
    </MotionEnter>
  );
}
