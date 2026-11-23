import { useCallback, useState } from "react";
import { View } from "react-native";
import { FileUp, FileText } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { formatMaterialSize } from "@/features/materials/materials";
import {
  pickConvertFile,
  savePdfToDevice,
  sharePdf,
  writePdfToCache,
} from "@/features/fileTools/fileIo";
import {
  convertKindLabel,
  type GeneratedPdf,
  type PickedConvertFile,
} from "@/features/fileTools/fileValues";
import {
  fileToolsApi,
} from "@/features/fileTools/fileToolsApi";
import {
  GeneratedPdfCard,
  type PdfActionBusy,
} from "@/features/fileTools/components/GeneratedPdfCard";
import { SaveToMaterialsSheet } from "@/features/fileTools/components/SaveToMaterialsSheet";
import { pdfPageCount } from "@/features/fileTools/pdfBuilder";
import { useSaveToMaterials } from "@/features/fileTools/useSaveToMaterials";
import { useTheme } from "@/theme/ThemeProvider";

/** Text-preserving DOCX / PPTX / TXT → PDF through the Bearer tool route. */
export default function ConvertScreen() {
  const theme = useTheme();
  const save = useSaveToMaterials();
  const [file, setFile] = useState<PickedConvertFile | null>(null);
  const [built, setBuilt] = useState<GeneratedPdf | null>(null);
  const [busy, setBusy] = useState<"pick" | "convert" | PdfActionBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pick = useCallback(async () => {
    if (busy !== null) return;
    setBusy("pick");
    setError(null);
    const result = await pickConvertFile();
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    if (result.file !== null) {
      setFile(result.file);
      setBuilt(null);
      setNotice(null);
    }
  }, [busy]);

  const convert = useCallback(async () => {
    if (file === null || busy !== null) return;
    setBusy("convert");
    setError(null);
    setNotice(null);
    try {
      const converted = await fileToolsApi.convert({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
      });
      const cached = await writePdfToCache(converted.base64, converted.name);
      if (cached.error !== null) {
        setError(cached.error);
        return;
      }
      let pages: number | null = null;
      try {
        pages = await pdfPageCount(converted.base64);
      } catch {
        pages = null;
      }
      setBuilt({
        uri: cached.uri,
        name: converted.name,
        pageCount: pages,
        sizeBytes: converted.bytes.byteLength,
        bytes: converted.bytes,
        base64: converted.base64,
      });
      setNotice("Converted PDF ready. The text is preserved for reading and search.");
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message !== ""
          ? caught.message
          : "The file couldn't be converted. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, file]);

  const share = useCallback(async () => {
    if (built === null || busy !== null) return;
    setBusy("share");
    const result = await sharePdf(built.uri);
    setBusy(null);
    if (result.error !== null) setError(result.error);
  }, [built, busy]);

  const saveDevice = useCallback(async () => {
    if (built === null || busy !== null) return;
    setBusy("device");
    const result = await savePdfToDevice(built.base64, built.name);
    setBusy(null);
    if (result.error !== null && result.error !== "Save cancelled.") {
      setError(result.error);
    }
  }, [built, busy]);

  const saveMaterials = useCallback(() => {
    if (built === null) return;
    save.open();
  }, [built, save]);

  return (
    <Screen>
      <PageHeading
        eyebrow="File Tools"
        title="Document Converter"
        description="Turn a course document into a clean, readable PDF."
      />

      <Card>
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
          <AppText variant="bodyMd">Text-preserving conversion</AppText>
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            DOCX, PPTX and TXT are extracted as text and laid out in a clean
            paginated PDF. Headings and paragraphs are kept; complex visual
            formatting, images and macros are not carried over.
          </AppText>
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Up to 10 MB · one file at a time
          </AppText>
        </View>
      </Card>

      {error !== null && built === null ? (
        <Notice tone="error">{error}</Notice>
      ) : null}
      {notice !== null && built === null ? <Notice>{notice}</Notice> : null}

      {file === null ? (
        <EmptyState
          icon={<FileUp size={24} color={theme.colors.mutedForeground} />}
          title="Choose a document"
          body="Pick a DOCX, PPTX or TXT file from your device. The converted PDF stays on your device unless you add it to Course Materials."
          footnote="DOCX · PPTX · TXT"
        />
      ) : (
        <Card>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: theme.spacing.sm,
              }}
            >
              <FileText size={18} color={theme.colors.mutedForeground} />
              <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                <AppText variant="bodyMd" numberOfLines={2}>
                  {file.name}
                </AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {convertKindLabel(file.kind)}
                  {file.sizeBytes === null
                    ? ""
                    : ` · ${formatMaterialSize(file.sizeBytes)}`}
                </AppText>
              </View>
            </View>
            <AppButton
              label="Choose another file"
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onPress={() => void pick()}
              style={{ alignSelf: "flex-start" }}
            />
          </View>
        </Card>
      )}

      {file === null ? (
        <AppButton
          label={busy === "pick" ? "Opening…" : "Choose file"}
          variant="secondary"
          loading={busy === "pick"}
          disabled={busy !== null}
          onPress={() => void pick()}
          fullWidth
          leading={<FileUp size={15} color={theme.colors.foreground} />}
        />
      ) : null}
      <AppButton
        label={busy === "convert" ? "Converting…" : "Convert to PDF"}
        variant="primary"
        loading={busy === "convert"}
        disabled={busy !== null || file === null}
        onPress={() => void convert()}
        fullWidth
      />

      {built !== null ? (
        <GeneratedPdfCard
          result={built}
          busy={
            save.saving
              ? "materials"
              : busy === "share" || busy === "device"
                ? busy
                : null
          }
          error={error}
          notice={notice}
          onShare={() => void share()}
          onSaveDevice={() => void saveDevice()}
          onSaveMaterials={saveMaterials}
        />
      ) : null}

      <SaveToMaterialsSheet
        visible={save.visible}
        onClose={save.close}
        subjects={save.subjects}
        loading={save.subjectsLoading}
        subjectsError={save.subjectsError}
        selectedSubjectId={save.subjectId}
        onSelectSubject={save.setSubjectId}
        saving={save.saving}
        result={save.result}
        onSave={() => {
          if (built === null) return;
          void save.save({
            bytes: built.bytes,
            name: built.name,
            mode: "process",
          });
        }}
      />
    </Screen>
  );
}
