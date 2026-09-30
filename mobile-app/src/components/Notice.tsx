import { View } from "react-native";
import { CircleAlert, Info } from "lucide-react-native";

import { MotionNotice } from "@/motion/MotionNotice";
import { useTheme } from "@/theme/ThemeProvider";
import { AppText } from "./AppText";

type NoticeProps = {
  children: string;
  tone?: "info" | "error";
};

/**
 * Inline feedback (the native `MotionNotice`): mounted content, enter-only
 * animation, live-region announcement in place of the web's `role="alert"`.
 * The destructive colour is the only "functional" colour and stays confined
 * to the icon + text, per DESIGN.md's restrained-states rule.
 */
export function Notice({ children, tone = "info" }: NoticeProps) {
  const theme = useTheme();
  const color =
    tone === "error" ? theme.colors.destructive : theme.colors.mutedForeground;

  return (
    <MotionNotice>
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: theme.spacing.sm,
          padding: theme.spacing.md,
          borderRadius: theme.radii.nested,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.muted,
        }}
      >
        {tone === "error" ? (
          <CircleAlert size={16} color={color} />
        ) : (
          <Info size={16} color={color} />
        )}
        <AppText variant="bodyMd" color={color} style={{ flex: 1 }}>
          {children}
        </AppText>
      </View>
    </MotionNotice>
  );
}
