import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { ChevronRight } from "lucide-react-native";

import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

type ListRowProps = {
  /** A row title reads as content (Geist), not as an action label. */
  title: string;
  subtitle?: string;
  /** A mono right-hand value, e.g. a status word. */
  value?: string;
  disabled?: boolean;
  onPress?: () => void;
  showChevron?: boolean;
};

/**
 * One list row; rows live inside a `Surface` card and are separated by the
 * parent's `Divider`. Press feedback is the shared scale primitive.
 */
export function ListRow({
  title,
  subtitle,
  value,
  disabled = false,
  onPress,
  showChevron = true,
}: ListRowProps) {
  const theme = useTheme();
  const interactive = Boolean(onPress) && !disabled;
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(interactive);

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.lg - 2,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText
          variant="bodyMd"
          color={disabled ? theme.colors.mutedForeground : undefined}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {value}
        </AppText>
      ) : interactive && showChevron ? (
        <ChevronRight size={16} color={theme.colors.mutedForeground} />
      ) : null}
    </View>
  );

  if (!interactive) {
    return content;
  }

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}
