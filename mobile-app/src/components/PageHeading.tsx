import { View } from "react-native";

import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

type PageHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  /** The entrance-ladder slot; the heading owns slot 0 by convention. */
  index?: number;
  /** A right-aligned action (e.g. the Ask AI history button). */
  trailing?: React.ReactNode;
};

/** The page header: mono eyebrow, Bricolage title, body description. */
export function PageHeading({
  eyebrow,
  title,
  description,
  index = 0,
  trailing,
}: PageHeadingProps) {
  const theme = useTheme();

  return (
    <MotionEnter
      index={index}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xs }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          {eyebrow}
        </AppText>
        <AppText variant="headlineLgMobile">{title}</AppText>
        {description ? (
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            {description}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View>{trailing}</View> : null}
    </MotionEnter>
  );
}
