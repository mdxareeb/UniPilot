import { useEffect } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/AppText";
import { DURATION, EASE_DRAWER } from "@/motion/presets";
import { useReduceMotion } from "@/motion/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Optional one-line context under the title. */
  subtitle?: string;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * The one bottom sheet. It is a real modal (Android back closes it), the scrim
 * is the only dismiss surface, and the panel has a drawer-eased entrance that
 * is skipped under reduced motion. Content is always mounted with the sheet;
 * animation never decides whether it exists.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  contentStyle,
}: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!visible) {
      progress.set(0);
      return;
    }
    if (reduced) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: DURATION.panel,
        easing: Easing.bezier(...EASE_DRAWER),
      }),
    );
  }, [progress, reduced, visible]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 28 }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{
            ...StyleSheetAbsolute,
            backgroundColor: theme.colors.scrim,
          }}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            panelStyle,
            {
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: theme.radii.frame,
              borderTopRightRadius: theme.radii.frame,
              borderTopWidth: 1,
              borderColor: theme.colors.border,
              maxHeight: "88%",
              paddingBottom: insets.bottom + theme.spacing.lg,
            },
          ]}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.border,
              marginTop: theme.spacing.sm,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: theme.spacing.md,
              paddingHorizontal: theme.spacing.xl,
              paddingTop: theme.spacing.lg,
              paddingBottom: theme.spacing.md,
            }}
          >
            <View style={{ flex: 1, gap: theme.spacing.xxs }}>
              <AppText variant="headlineMd">{title}</AppText>
              {subtitle ? (
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={{ padding: theme.spacing.xs }}
            >
              <X size={20} color={theme.colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              {
                paddingHorizontal: theme.spacing.xl,
                paddingBottom: theme.spacing.lg,
                gap: theme.spacing.md,
              },
              contentStyle,
            ]}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const StyleSheetAbsolute = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};
