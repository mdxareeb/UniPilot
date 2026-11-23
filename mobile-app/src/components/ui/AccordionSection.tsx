import { useEffect, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChevronDown } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Card } from "@/components/ui/Card";
import { DURATION, EASE_OUT } from "@/motion/presets";
import { useReduceMotion } from "@/motion/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

type AccordionSectionProps = {
  title: string;
  subtitle?: string;
  /** A registry glyph, already coloured by the caller. */
  icon?: React.ReactNode;
  /** A status pill or count shown before the chevron. */
  trailing?: React.ReactNode;
  defaultOpen?: boolean;
  accessibilityLabel?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * One collapsible workspace section: the shared Home/More disclosure.
 *
 * Content is always mounted and measured; only its height and opacity are
 * animated, so animation never decides whether the content exists. The closed
 * state removes it from the accessibility tree and the touch path. Reduced
 * motion swaps the timing for an instant state change. The chevron rotates
 * with the panel, the header keeps a 44dp target and announces its expanded
 * state.
 */
export function AccordionSection({
  title,
  subtitle,
  icon,
  trailing,
  defaultOpen = false,
  accessibilityLabel,
  children,
  style,
}: AccordionSectionProps) {
  const theme = useTheme();
  const reduced = useReduceMotion();
  const [open, setOpen] = useState(defaultOpen);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(defaultOpen ? 1 : 0);

  useEffect(() => {
    progress.value = reduced
      ? open
        ? 1
        : 0
      : withTiming(open ? 1 : 0, {
          duration: open ? DURATION.panel : DURATION.panelExit,
          easing: Easing.bezier(...EASE_OUT),
        });
  }, [open, progress, reduced]);

  const bodyStyle = useAnimatedStyle(() => ({
    // Until the content has been measured, an open panel must lay out
    // naturally (height undefined) so its child can report a real height.
    // A closed panel stays at zero; once measured, the animation has a target.
    height:
      contentHeight > 0
        ? contentHeight * progress.value
        : open
          ? undefined
          : 0,
    opacity: progress.value,
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));

  return (
    <Card padding={0} style={style}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ expanded: open }}
        accessibilityHint="Expands or collapses this section"
        style={{
          minHeight: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        }}
      >
        {icon ? (
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.colors.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </View>
        ) : null}
        <View style={{ flex: 1, gap: theme.spacing.xxs }}>
          <AppText variant="bodyMd">{title}</AppText>
          {subtitle ? (
            <AppText
              variant="mono"
              color={theme.colors.mutedForeground}
              numberOfLines={1}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing ? <View>{trailing}</View> : null}
        <Animated.View style={chevronStyle}>
          <ChevronDown size={18} color={theme.colors.mutedForeground} />
        </Animated.View>
      </Pressable>

      <Animated.View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        pointerEvents={open ? "auto" : "none"}
        style={[{ overflow: "hidden" }, bodyStyle]}
      >
        <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>
          <Divider />
          <View
            style={{
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.md,
              paddingBottom: theme.spacing.lg,
              gap: theme.spacing.sm,
            }}
          >
            {children}
          </View>
        </View>
      </Animated.View>
    </Card>
  );
}
