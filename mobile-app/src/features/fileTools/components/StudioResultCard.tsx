import { View } from "react-native";
import { Download, Share2, Upload } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Notice } from "@/components/Notice";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import { useTheme } from "@/theme/ThemeProvider";
import type { StudioOutput } from "../fileStudio";
import { formatStudioSize } from "../fileInspector";

export type StudioActionBusy = "share" | "device" | "materials" | null;

/** The generic converted-file card shared by every target. */
export function StudioResultCard({
  result,
  label,
  busy,
  error,
  notice,
  canSaveMaterials,
  onShare,
  onSaveDevice,
  onSaveMaterials,
}: {
  result: StudioOutput;
  label: string;
  busy: StudioActionBusy;
  error: string | null;
  notice: string | null;
  canSaveMaterials: boolean;
  onShare: () => void;
  onSaveDevice: () => void;
  onSaveMaterials: () => void;
}) {
  const theme = useTheme();
  const disabled = busy !== null;

  return (
    <Card>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <AppText variant="bodyMd" numberOfLines={2}>
              {result.name}
            </AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {label} · {formatStudioSize(result.sizeBytes)}
            </AppText>
          </View>
          <StatusPill label={label} tone="solid" />
        </View>

        {notice !== null ? <Notice>{notice}</Notice> : null}
        {error !== null ? <Notice tone="error">{error}</Notice> : null}

        {canSaveMaterials ? (
          <AppButton
            label={busy === "materials" ? "Saving…" : "Save to Course Materials"}
            variant="primary"
            loading={busy === "materials"}
            disabled={disabled}
            onPress={onSaveMaterials}
            fullWidth
            leading={<Upload size={15} color={theme.colors.onPrimary} />}
          />
        ) : null}

        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton
              label={busy === "device" ? "Saving…" : "Save to device"}
              variant="secondary"
              loading={busy === "device"}
              disabled={disabled}
              onPress={onSaveDevice}
              fullWidth
              leading={<Download size={15} color={theme.colors.foreground} />}
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              label={busy === "share" ? "Sharing…" : "Share"}
              variant="ghost"
              loading={busy === "share"}
              disabled={disabled}
              onPress={onShare}
              fullWidth
              leading={<Share2 size={15} color={theme.colors.foreground} />}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}
