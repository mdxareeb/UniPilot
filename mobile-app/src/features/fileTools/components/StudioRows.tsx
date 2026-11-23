import { Pressable, View } from "react-native";
import {
  ChevronRight,
  Combine,
  FilePlus2,
  Fingerprint,
  Pencil,
  Scissors,
  ScanText,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { StatusPill } from "@/components/ui/StatusPill";
import { useTheme } from "@/theme/ThemeProvider";
import type {
  ConversionOption,
  FileAction,
  FileActionId,
} from "../fileCapabilities";

const ACTION_ICONS: Record<FileActionId, typeof Upload> = {
  "pdf-extract-pages": Scissors,
  "pdf-merge": Combine,
  "save-index": Upload,
  "ask-ai": Sparkles,
  "image-compress": SlidersHorizontal,
  "image-to-pdf": FilePlus2,
  "image-ocr": ScanText,
  "binary-metadata": Fingerprint,
  "binary-rename-share": Pencil,
};

const EXECUTOR_LABEL = {
  "on-device": "On-Device",
  server: "Server",
  provider: "AI Vision",
} as const;

/** One valid output target: the executor badge is never hidden. */
export function ConvertTargetRow({
  option,
  busy,
  onPress,
}: {
  option: ConversionOption;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Convert to ${option.label}, ${EXECUTOR_LABEL[option.executor]}`}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={{
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        opacity: busy ? 0.55 : 1,
      }}
    >
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
        <AppText variant="label">{option.extension.toUpperCase()}</AppText>
      </View>
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <AppText variant="bodyMd">{option.label}</AppText>
          <StatusPill label={EXECUTOR_LABEL[option.executor]} tone="outline" />
        </View>
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          numberOfLines={2}
        >
          {option.description}
        </AppText>
      </View>
      <ChevronRight size={16} color={theme.colors.mutedForeground} />
    </Pressable>
  );
}

/** One contextual action derived from the detected category. */
export function ContextualActionRow({
  action,
  busy,
  onPress,
}: {
  action: FileAction;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const Icon = ACTION_ICONS[action.id];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={{
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        opacity: busy ? 0.55 : 1,
      }}
    >
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
        <Icon size={17} color={theme.colors.foreground} />
      </View>
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText variant="bodyMd">{action.label}</AppText>
        <AppText
          variant="mono"
          color={theme.colors.mutedForeground}
          numberOfLines={2}
        >
          {action.description}
        </AppText>
      </View>
      <ChevronRight size={16} color={theme.colors.mutedForeground} />
    </Pressable>
  );
}
