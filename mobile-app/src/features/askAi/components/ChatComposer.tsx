import { Pressable, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { ArrowUp } from "lucide-react-native";

import { tapFeedback } from "@/lib/haptics";
import { usePressScale } from "@/motion/pressFeedback";
import { useTheme } from "@/theme/ThemeProvider";
import { CHAT_MESSAGE_MAX_LENGTH } from "../chatValues";

type ChatComposerProps = {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  /** A truthful reason shown as the field's placeholder when disabled. */
  placeholder: string;
};

/** The pinned Ask AI input: Geist text, one circular send action. */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  disabled,
  placeholder,
}: ChatComposerProps) {
  const theme = useTheme();
  const canSend = !disabled && value.trim() !== "";
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(canSend);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
      }}
    >
      <TextInput
        accessibilityLabel="Ask AI question"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        editable={!disabled}
        multiline
        maxLength={CHAT_MESSAGE_MAX_LENGTH}
        textAlignVertical="top"
        style={{
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          paddingHorizontal: theme.spacing.sm,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          color: theme.colors.foreground,
          fontFamily: theme.fontFamily.bodyRegular,
          fontSize: 16,
          lineHeight: 22,
          opacity: disabled ? 0.55 : 1,
        }}
      />
      <Animated.View style={animatedStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send question"
          accessibilityState={{ disabled: !canSend, busy: disabled }}
          disabled={!canSend}
          onPress={() => {
            tapFeedback();
            onSend();
          }}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend
              ? theme.colors.primary
              : theme.colors.muted,
          }}
        >
          <ArrowUp
            size={20}
            color={
              canSend ? theme.colors.onPrimary : theme.colors.mutedForeground
            }
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}
