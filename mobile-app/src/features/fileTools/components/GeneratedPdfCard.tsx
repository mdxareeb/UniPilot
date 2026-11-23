import { View } from "react-native";
import { Download, Share2, Upload } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Notice } from "@/components/Notice";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatMaterialSize } from "@/features/materials/materials";
import { useTheme } from "@/theme/ThemeProvider";
import type { GeneratedPdf } from "../fileValues";

export type PdfActionBusy = "share" | "device" | "materials" | null;

/** The post-build PDF card shared by all three tools. */
export function GeneratedPdfCard({
  result,
  busy,
  error,
  notice,
  onShare,
  onSaveDevice,
  onSaveMaterials,
}: {
  result: GeneratedPdf;
  busy: PdfActionBusy;
  error: string | null;
  notice: string | null;
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
            <AppText variant="bodyMd">{result.name}</AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {[
                result.pageCount === null ? null : `${result.pageCount} pages`,
                formatMaterialSize(result.sizeBytes),
              ]
                .filter(Boolean)
                .join(" · ")}
            </AppText>
          </View>
          <StatusPill label="PDF ready" tone="solid" dot />
        </View>

        {notice !== null ? <Notice>{notice}</Notice> : null}
        {error !== null ? <Notice tone="error">{error}</Notice> : null}

        <View style={{ gap: theme.spacing.sm }}>
          <AppButton
            label={busy === "materials" ? "Saving…" : "Save to Course Materials"}
            variant="primary"
            loading={busy === "materials"}
            disabled={disabled}
            onPress={onSaveMaterials}
            fullWidth
            leading={<Upload size={15} color={theme.colors.onPrimary} />}
          />
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label={busy === "device" ? "Saving…" : "Save to device"}
                variant="secondary"
                loading={busy === "device"}
                disabled={disabled}
                onPress={onSaveDevice}
                fullWidth
                leading={
                  <Download size={15} color={theme.colors.foreground} />
                }
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
      </View>
    </Card>
  );
}
