import { useCallback, useEffect, useState } from "react";
import { Image, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowDown, ArrowUp, Camera, Images, Trash2 } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  pickImagesFromLibrary,
  savePdfToDevice,
  sharePdf,
  takeImageWithCamera,
  writePdfToCache,
} from "@/features/fileTools/fileIo";
import {
  moveListItem,
  removeListItem,
  sanitizePdfFileName,
  type GeneratedPdf,
  type PdfImagePage,
} from "@/features/fileTools/fileValues";
import {
  normalizeRouteParam,
  withExtension,
} from "@/features/fileTools/fileInspector";
import { prepareImageForPdf } from "@/features/fileTools/fileStudio";
import { GeneratedPdfCard, type PdfActionBusy } from "@/features/fileTools/components/GeneratedPdfCard";
import { IconAction } from "@/features/fileTools/components/IconAction";
import { SaveToMaterialsSheet } from "@/features/fileTools/components/SaveToMaterialsSheet";
import { buildImagePdf } from "@/features/fileTools/pdfBuilder";
import { useSaveToMaterials } from "@/features/fileTools/useSaveToMaterials";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Image to PDF: pick or photograph pages, normalize orientation/quality,
 * reorder, assemble on-device, then save/share locally or make it searchable
 * in Course Materials through Gemini OCR.
 */
export default function ImageToPdfScreen() {
  const theme = useTheme();
  const router = useRouter();
  const save = useSaveToMaterials();
  const [pages, setPages] = useState<PdfImagePage[]>([]);
  const [fileName, setFileName] = useState("scanned-notes");
  const [built, setBuilt] = useState<GeneratedPdf | null>(null);
  const [busy, setBusy] = useState<
    "gallery" | "camera" | "build" | PdfActionBusy
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const params = useLocalSearchParams<{ imageUri?: string; name?: string }>();

  /** A studio preload becomes the first page once, after the first paint. */
  useEffect(() => {
    const uri = normalizeRouteParam(params.imageUri);
    if (uri === null) return;
    const name = normalizeRouteParam(params.name) ?? "image.jpg";
    let active = true;
    const load = async () => {
      setBusy("gallery");
      const result = await prepareImageForPdf(uri, name);
      if (!active) return;
      setBusy(null);
      if (result.page === null) {
        setError(result.error ?? "That image couldn't be prepared.");
        return;
      }
      setPages([
        {
          id: `preload-${Date.now()}`,
          uri: result.page.uri,
          base64: result.page.base64,
          width: result.page.width,
          height: result.page.height,
          fileName: result.page.fileName,
          mimeType: "image/jpeg",
        },
      ]);
      setFileName(withExtension(name, "pdf").replace(/\.pdf$/i, ""));
      setBuilt(null);
      setNotice(null);
    };
    void Promise.resolve().then(load);
    return () => {
      active = false;
    };
  }, [params.imageUri, params.name]);

  const invalidate = useCallback(() => {
    setBuilt(null);
    setNotice(null);
  }, []);

  const addPages = useCallback(
    (incoming: PdfImagePage[]) => {
      const next = [...pages, ...incoming];
      if (next.length > 20) {
        setError("Choose up to 20 pages at a time.");
        return;
      }
      setError(null);
      setPages(next);
      invalidate();
    },
    [invalidate, pages],
  );

  const chooseGallery = useCallback(async () => {
    if (busy !== null) return;
    setBusy("gallery");
    setError(null);
    const result = await pickImagesFromLibrary();
    setBusy(null);
    if (result.error !== null) setError(result.error);
    else addPages(result.pages);
  }, [addPages, busy]);

  const chooseCamera = useCallback(async () => {
    if (busy !== null) return;
    setBusy("camera");
    setError(null);
    const result = await takeImageWithCamera();
    setBusy(null);
    if (result.error !== null) setError(result.error);
    else addPages(result.pages);
  }, [addPages, busy]);

  const build = useCallback(async () => {
    if (pages.length === 0 || busy !== null) return;
    const name = sanitizePdfFileName(fileName);
    setBusy("build");
    setError(null);
    setNotice(null);
    try {
      const pdf = await buildImagePdf(
        pages.map((page) => ({
          base64: page.base64,
          mimeType: page.mimeType,
          width: page.width,
          height: page.height,
        })),
        name,
      );
      const cached = await writePdfToCache(pdf.base64, name);
      if (cached.error !== null) {
        setError(cached.error);
        return;
      }
      setFileName(name.replace(/\.pdf$/i, ""));
      setBuilt({
        uri: cached.uri,
        name,
        pageCount: pdf.pageCount,
        sizeBytes: pdf.bytes.byteLength,
        bytes: pdf.bytes,
        base64: pdf.base64,
      });
      setNotice("PDF ready. Save it locally or add it to Course Materials.");
    } catch {
      setError("The PDF couldn't be built. Try fewer or smaller images.");
    } finally {
      setBusy(null);
    }
  }, [busy, fileName, pages]);

  const share = useCallback(async () => {
    if (built === null || busy !== null) return;
    setBusy("share");
    setError(null);
    const result = await sharePdf(built.uri);
    setBusy(null);
    if (result.error !== null) setError(result.error);
  }, [built, busy]);

  const saveDevice = useCallback(async () => {
    if (built === null || busy !== null) return;
    setBusy("device");
    setError(null);
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
        title="Image to PDF"
        description="Turn lecture photos and scans into one clean PDF."
      />

      {error !== null && built === null ? (
        <Notice tone="error">{error}</Notice>
      ) : null}
      {notice !== null && built === null ? <Notice>{notice}</Notice> : null}

      {pages.length === 0 ? (
        <EmptyState
          icon={<Images size={24} color={theme.colors.mutedForeground} />}
          title="Add your pages"
          body="Choose photos from your gallery or photograph a page. UniPilot normalizes orientation and quality before building the PDF."
          footnote="Up to 20 images · JPEG/PNG"
        />
      ) : (
        <>
          <View style={{ gap: theme.spacing.sm }}>
            <SectionHeader label={`${pages.length} pages`} />
            <Card elevation="flush">
              {pages.map((page, index) => (
                <View key={page.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: theme.spacing.sm,
                      padding: theme.spacing.md,
                    }}
                  >
                    <Image
                      source={{ uri: page.uri }}
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: theme.radii.control,
                        backgroundColor: theme.colors.muted,
                      }}
                    />
                    <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                      <AppText variant="mono">
                        Page {index + 1}
                      </AppText>
                      <AppText
                        variant="mono"
                        color={theme.colors.mutedForeground}
                        numberOfLines={1}
                      >
                        {page.fileName}
                      </AppText>
                    </View>
                    <View style={{ flexDirection: "row", gap: theme.spacing.xs }}>
                      <IconAction
                        label={`Move page ${index + 1} up`}
                        disabled={index === 0 || busy !== null}
                        icon={
                          <ArrowUp
                            size={16}
                            color={theme.colors.foreground}
                          />
                        }
                        onPress={() => {
                          setPages(moveListItem(pages, index, -1));
                          invalidate();
                        }}
                      />
                      <IconAction
                        label={`Move page ${index + 1} down`}
                        disabled={index === pages.length - 1 || busy !== null}
                        icon={
                          <ArrowDown
                            size={16}
                            color={theme.colors.foreground}
                          />
                        }
                        onPress={() => {
                          setPages(moveListItem(pages, index, 1));
                          invalidate();
                        }}
                      />
                      <IconAction
                        label={`Remove page ${index + 1}`}
                        disabled={busy !== null}
                        icon={
                          <Trash2
                            size={16}
                            color={theme.colors.mutedForeground}
                          />
                        }
                        onPress={() => {
                          setPages(removeListItem(pages, index));
                          invalidate();
                        }}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          </View>

          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label="Add photos"
                variant="secondary"
                loading={busy === "gallery"}
                disabled={busy !== null || pages.length >= 20}
                onPress={() => void chooseGallery()}
                fullWidth
                leading={<Images size={15} color={theme.colors.foreground} />}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton
                label="Take photo"
                variant="secondary"
                loading={busy === "camera"}
                disabled={busy !== null || pages.length >= 20}
                onPress={() => void chooseCamera()}
                fullWidth
                leading={<Camera size={15} color={theme.colors.foreground} />}
              />
            </View>
          </View>
        </>
      )}

      {pages.length === 0 ? (
        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <AppButton
              label="Choose photos"
              variant="primary"
              loading={busy === "gallery"}
              disabled={busy !== null}
              onPress={() => void chooseGallery()}
              fullWidth
              leading={<Images size={15} color={theme.colors.onPrimary} />}
            />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton
              label="Take photo"
              variant="secondary"
              loading={busy === "camera"}
              disabled={busy !== null}
              onPress={() => void chooseCamera()}
              fullWidth
              leading={<Camera size={15} color={theme.colors.foreground} />}
            />
          </View>
        </View>
      ) : null}

      {pages.length > 0 ? (
        <>
          <Input
            label="PDF name"
            value={fileName}
            onChangeText={(value) => {
              setFileName(value);
              invalidate();
            }}
            placeholder="scanned-notes"
            autoCapitalize="sentences"
          />
          <AppButton
            label={busy === "build" ? "Building PDF…" : "Create PDF"}
            variant="primary"
            loading={busy === "build"}
            disabled={busy !== null || pages.length === 0}
            onPress={() => void build()}
            fullWidth
          />
        </>
      ) : null}

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

      {built !== null ? (
        <AppButton
          label="Back to Home"
          variant="ghost"
          onPress={() => router.back()}
          style={{ alignSelf: "center" }}
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
            mode: "ocr",
            pages: pages.map((page) => ({
              uri: page.uri,
              name: page.fileName,
              type: page.mimeType,
            })),
          });
        }}
      />
    </Screen>
  );
}
