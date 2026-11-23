import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { ArrowDown, ArrowUp, FileText, Trash2 } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { formatMaterialSize } from "@/features/materials/materials";
import {
  pickPdfFiles,
  readBase64,
  savePdfToDevice,
  sharePdf,
  writePdfToCache,
} from "@/features/fileTools/fileIo";
import {
  moveListItem,
  parsePageRanges,
  removeListItem,
  type GeneratedPdf,
  type PickedPdf,
} from "@/features/fileTools/fileValues";
import {
  GeneratedPdfCard,
  type PdfActionBusy,
} from "@/features/fileTools/components/GeneratedPdfCard";
import { IconAction } from "@/features/fileTools/components/IconAction";
import { SaveToMaterialsSheet } from "@/features/fileTools/components/SaveToMaterialsSheet";
import { extractPdfPages, mergePdfs, pdfPageCount } from "@/features/fileTools/pdfBuilder";
import { useSaveToMaterials } from "@/features/fileTools/useSaveToMaterials";
import { useTheme } from "@/theme/ThemeProvider";

type Mode = "merge" | "extract";

/** Merge PDFs or keep only selected pages, all on-device. */
export default function PdfUtilsScreen() {
  const theme = useTheme();
  const save = useSaveToMaterials();
  const [mode, setMode] = useState<Mode>("merge");
  const [pdfs, setPdfs] = useState<PickedPdf[]>([]);
  const [extractFile, setExtractFile] = useState<PickedPdf | null>(null);
  const [extractPages, setExtractPages] = useState<number | null>(null);
  const [range, setRange] = useState("");
  const [built, setBuilt] = useState<GeneratedPdf | null>(null);
  const [busy, setBusy] = useState<"pick" | "build" | PdfActionBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rangeCheck = useMemo(
    () =>
      extractPages === null
        ? { ok: false as const, error: "" }
        : parsePageRanges(range, extractPages),
    [extractPages, range],
  );

  const invalidate = useCallback(() => {
    setBuilt(null);
    setNotice(null);
  }, []);

  const chooseMode = (next: Mode) => {
    if (busy !== null) return;
    setMode(next);
    setBuilt(null);
    setError(null);
    setNotice(null);
  };

  const pickMerge = useCallback(async () => {
    if (busy !== null) return;
    setBusy("pick");
    setError(null);
    const result = await pickPdfFiles();
    setBusy(null);
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    const next = [...pdfs, ...result.rows];
    if (next.length > 10) {
      setError("Choose up to 10 PDFs at a time.");
      return;
    }
    setPdfs(next);
    invalidate();
  }, [busy, invalidate, pdfs]);

  const pickExtract = useCallback(async () => {
    if (busy !== null) return;
    setBusy("pick");
    setError(null);
    const result = await pickPdfFiles();
    if (result.error !== null || result.rows.length === 0) {
      setBusy(null);
      if (result.error !== null) setError(result.error);
      return;
    }
    const file = result.rows[0];
    try {
      const count = await pdfPageCount(await readBase64(file.uri));
      setExtractFile(file);
      setExtractPages(count);
      setRange("");
      invalidate();
      setBusy(null);
    } catch {
      setBusy(null);
      setError("That PDF couldn't be read. Try another file.");
    }
  }, [busy, invalidate]);

  const buildMerge = useCallback(async () => {
    if (pdfs.length < 2 || busy !== null) return;
    setBusy("build");
    setError(null);
    setNotice(null);
    try {
      const sources: string[] = [];
      for (const file of pdfs) sources.push(await readBase64(file.uri));
      const pdf = await mergePdfs(sources, "Merged PDFs");
      const cached = await writePdfToCache(pdf.base64, "merged-pdfs.pdf");
      if (cached.error !== null) {
        setError(cached.error);
        return;
      }
      setBuilt({
        uri: cached.uri,
        name: "merged-pdfs.pdf",
        pageCount: pdf.pageCount,
        sizeBytes: pdf.bytes.byteLength,
        bytes: pdf.bytes,
        base64: pdf.base64,
      });
      setNotice("Merged PDF ready.");
    } catch {
      setError("Those PDFs couldn't be merged. Make sure they aren't damaged or locked.");
    } finally {
      setBusy(null);
    }
  }, [busy, pdfs]);

  const buildExtract = useCallback(async () => {
    if (extractFile === null || !rangeCheck.ok || busy !== null) return;
    setBusy("build");
    setError(null);
    setNotice(null);
    try {
      const source = await readBase64(extractFile.uri);
      const pdf = await extractPdfPages(source, rangeCheck.pages, "Extracted pages");
      const cached = await writePdfToCache(pdf.base64, "extracted-pages.pdf");
      if (cached.error !== null) {
        setError(cached.error);
        return;
      }
      setBuilt({
        uri: cached.uri,
        name: "extracted-pages.pdf",
        pageCount: pdf.pageCount,
        sizeBytes: pdf.bytes.byteLength,
        bytes: pdf.bytes,
        base64: pdf.base64,
      });
      setNotice("Extracted PDF ready.");
    } catch {
      setError("Those pages couldn't be extracted. Check the range and try again.");
    } finally {
      setBusy(null);
    }
  }, [busy, extractFile, rangeCheck]);

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
        title="PDF Utilities"
        description="Merge PDFs or keep only the pages you need."
      />

      <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
        <FilterChip
          label="Merge PDFs"
          active={mode === "merge"}
          onPress={() => chooseMode("merge")}
          disabled={busy !== null}
        />
        <FilterChip
          label="Extract pages"
          active={mode === "extract"}
          onPress={() => chooseMode("extract")}
          disabled={busy !== null}
        />
      </View>

      {error !== null && built === null ? (
        <Notice tone="error">{error}</Notice>
      ) : null}
      {notice !== null && built === null ? <Notice>{notice}</Notice> : null}

      {mode === "merge" ? (
        <>
          {pdfs.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} color={theme.colors.mutedForeground} />}
              title="Merge your PDFs"
              body="Choose two or more PDFs, put them in reading order, and UniPilot writes one combined PDF on this device."
              footnote="Up to 10 PDFs"
            />
          ) : (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader label={`${pdfs.length} PDFs`} />
              <Card elevation="flush">
                {pdfs.map((file, index) => (
                  <View key={file.id}>
                    {index > 0 ? <Divider /> : null}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: theme.spacing.sm,
                        padding: theme.spacing.md,
                      }}
                    >
                      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                        <AppText variant="bodyMd" numberOfLines={1}>
                          {file.name}
                        </AppText>
                        <AppText
                          variant="mono"
                          color={theme.colors.mutedForeground}
                        >
                          {file.sizeBytes === null
                            ? "PDF"
                            : formatMaterialSize(file.sizeBytes)}
                        </AppText>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: theme.spacing.xs,
                        }}
                      >
                        <IconAction
                          label={`Move ${file.name} up`}
                          disabled={index === 0 || busy !== null}
                          icon={
                            <ArrowUp
                              size={16}
                              color={theme.colors.foreground}
                            />
                          }
                          onPress={() => {
                            setPdfs(moveListItem(pdfs, index, -1));
                            invalidate();
                          }}
                        />
                        <IconAction
                          label={`Move ${file.name} down`}
                          disabled={index === pdfs.length - 1 || busy !== null}
                          icon={
                            <ArrowDown
                              size={16}
                              color={theme.colors.foreground}
                            />
                          }
                          onPress={() => {
                            setPdfs(moveListItem(pdfs, index, 1));
                            invalidate();
                          }}
                        />
                        <IconAction
                          label={`Remove ${file.name}`}
                          disabled={busy !== null}
                          icon={
                            <Trash2
                              size={16}
                              color={theme.colors.mutedForeground}
                            />
                          }
                          onPress={() => {
                            setPdfs(removeListItem(pdfs, index));
                            invalidate();
                          }}
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}

          <AppButton
            label="Add PDFs"
            variant="secondary"
            loading={busy === "pick"}
            disabled={busy !== null || pdfs.length >= 10}
            onPress={() => void pickMerge()}
            fullWidth
          />
          <AppButton
            label={busy === "build" ? "Merging…" : "Merge PDFs"}
            variant="primary"
            loading={busy === "build"}
            disabled={busy !== null || pdfs.length < 2}
            onPress={() => void buildMerge()}
            fullWidth
          />
        </>
      ) : (
        <>
          {extractFile === null ? (
            <EmptyState
              icon={<FileText size={24} color={theme.colors.mutedForeground} />}
              title="Keep selected pages"
              body="Choose one PDF, then enter the pages you want in the new file. The original is never changed."
              footnote="Example range: 1-3, 5"
            />
          ) : (
            <Card>
              <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
                <AppText variant="bodyMd" numberOfLines={1}>
                  {extractFile.name}
                </AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {extractPages === null ? "PDF" : `${extractPages} pages`}
                </AppText>
                <AppButton
                  label="Choose another PDF"
                  variant="ghost"
                  size="sm"
                  onPress={() => void pickExtract()}
                  disabled={busy !== null}
                  style={{ alignSelf: "flex-start" }}
                />
              </View>
            </Card>
          )}

          <AppButton
            label="Choose PDF"
            variant="secondary"
            loading={busy === "pick"}
            disabled={busy !== null}
            onPress={() => void pickExtract()}
            fullWidth
          />

          {extractFile !== null ? (
            <Input
              label="Pages to keep"
              value={range}
              onChangeText={(value) => {
                setRange(value);
                invalidate();
              }}
              placeholder="1-3, 5"
              autoCapitalize="none"
              error={
                range.trim() !== "" && !rangeCheck.ok
                  ? rangeCheck.error
                  : null
              }
            />
          ) : null}

          <AppButton
            label={busy === "build" ? "Extracting…" : "Extract pages"}
            variant="primary"
            loading={busy === "build"}
            disabled={
              busy !== null || extractFile === null || !rangeCheck.ok
            }
            onPress={() => void buildExtract()}
            fullWidth
          />
        </>
      )}

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
