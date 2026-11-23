import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { FileText } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";
import { citationPillLabel, type CitationGroup } from "../citations";

/** Compact source pills under an assistant answer. */
export function CitationPills({
  groups,
  onPress,
}: {
  groups: readonly CitationGroup[];
  onPress: (group: CitationGroup) => void;
}) {
  const theme = useTheme();
  if (groups.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: theme.spacing.sm,
      }}
    >
      {groups.map((group) => (
        <CitationPill key={group.key} group={group} onPress={onPress} />
      ))}
    </View>
  );
}

function CitationPill({
  group,
  onPress,
}: {
  group: CitationGroup;
  onPress: (group: CitationGroup) => void;
}) {
  const theme = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(true);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open citation ${citationPillLabel(group)}`}
        onPress={() => onPress(group)}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        hitSlop={6}
        style={{
          minHeight: 38,
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.xs + 2,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radii.pill,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
        }}
      >
        <FileText size={12} color={theme.colors.mutedForeground} />
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          style={{ flexShrink: 1 }}
          numberOfLines={1}
        >
          {citationPillLabel(group)}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}
