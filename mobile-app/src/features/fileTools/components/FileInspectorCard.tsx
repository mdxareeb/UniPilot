import { View } from "react-native";
import { FileText, Image as ImageIcon } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import { useTheme } from "@/theme/ThemeProvider";
import type { StudioFile } from "../fileStudio";
import { checksumSkipCopy, formatStudioSize } from "../fileInspector";

/** The one file-inspection card: identity, observed metadata and checksum. */
export function FileInspectorCard({
  file,
  busy,
  onReplace,
  onGallery,
}: {
  file: StudioFile;
  busy: boolean;
  onReplace: () => void;
  onGallery: () => void;
}) {
  const theme = useTheme();
  const meta = [
    file.capabilities.badge,
    formatStudioSize(file.sizeBytes),
    file.pageCount === null ? null : `${file.pageCount} pages`,
    file.width === null || file.height === null
      ? null
      : `${file.width} × ${file.height} px`,
  ]
    .filter(Boolean)
    .join(" · ");
  const skipCopy = checksumSkipCopy(file.sizeBytes);

  return (
    <Card>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.md,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: theme.colors.muted,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {file.capabilities.category === "image" ? (
              <ImageIcon size={18} color={theme.colors.foreground} />
            ) : (
              <FileText size={18} color={theme.colors.foreground} />
            )}
          </View>
          <View style={{ flex: 1, gap: theme.spacing.xxs }}>
            <AppText variant="bodyMd" numberOfLines={2}>
              {file.name}
            </AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {meta}
            </AppText>
          </View>
          <StatusPill label={file.capabilities.badge} tone="solid" />
        </View>

        <Divider />

        <View style={{ gap: theme.spacing.xs }}>
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            SHA-256 checksum
          </AppText>
          <AppText
            variant="mono"
            color={
              file.checksum === null
                ? theme.colors.mutedForeground
                : theme.colors.foreground
            }
            numberOfLines={2}
          >
            {file.checksum ?? skipCopy ?? "Checksum unavailable for this file."}
          </AppText>
        </View>

        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton
              label="Choose another"
              variant="secondary"
              size="sm"
              disabled={busy}
              onPress={onReplace}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              label="Pick image"
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={onGallery}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Card>
  );
}
