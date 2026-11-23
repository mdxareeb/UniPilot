import { useCallback, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Download, FileUp, Images, Share2 } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/Input";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useTheme } from "@/theme/ThemeProvider";
import {
  COMPRESSION_PRESETS,
  type CompressionPreset,
  type ConversionOption,
  type FileActionId,
} from "@/features/fileTools/fileCapabilities";
import {
  fileToolsApi,
  saveFileToMaterials,
  savePdfWithAutoMode,
  waitForDocumentIndexed,
  type MaterialsMimeType,
  type OcrPageFile,
  type SaveToMaterialsResult,
} from "@/features/fileTools/fileToolsApi";
import {
  buildPdfFromImage,
  compressStudioImage,
  convertStudioImage,
  inspectStudioFile,
  pickAnyStudioFile,
  pickStudioImage,
  prepareOcrImage,
  readStudioBytes,
  renameStudioFile,
  saveStudioFileToDevice,
  shareStudioFile,
  writeBase64ToCache,
  writeTextToCache,
  type StudioFile,
  type StudioOutput,
} from "@/features/fileTools/fileStudio";
import {
  compressionDelta,
  compressionPlan,
  formatStudioSize,
  withExtension,
} from "@/features/fileTools/fileInspector";
import { SaveToMaterialsSheet } from "@/features/fileTools/components/SaveToMaterialsSheet";
import { FileInspectorCard } from "@/features/fileTools/components/FileInspectorCard";
import {
  ContextualActionRow,
  ConvertTargetRow,
} from "@/features/fileTools/components/StudioRows";
import { StudioResultCard } from "@/features/fileTools/components/StudioResultCard";
import { useSaveToMaterials } from "@/features/fileTools/useSaveToMaterials";

type Busy =
  | "pick"
  | "gallery"
  | "convert"
  | "share"
  | "device"
  | "ask"
  | null;

type Sheet = "ocr" | "compress" | "rename" | "metadata" | null;

type PendingMaterials =
  | {
      kind: "direct";
      bytes: Uint8Array;
      name: string;
      mimeType: MaterialsMimeType;
      mode: "process" | "ocr";
      pages?: OcrPageFile[];
    }
  | {
      kind: "pdf-auto";
      uri: string;
      name: string;
      mimeType: string | null;
    }
  | { kind: "image-direct"; file: StudioFile }
  | { kind: "convert-then-save"; file: StudioFile };

const SAVEABLE_MIME = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim() !== ""
    ? caught.message
    : fallback;
}

/** Universal File Studio: inspect, convert, save and hand a file to Ask AI. */
export default function ConvertScreen() {
  const theme = useTheme();
  const router = useRouter();
  const save = useSaveToMaterials();

  const [file, setFile] = useState<StudioFile | null>(null);
  const [output, setOutput] = useState<StudioOutput | null>(null);
  const [outputLabel, setOutputLabel] = useState("File");
  const [outputMode, setOutputMode] = useState<"process" | "ocr">("process");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pending, setPending] = useState<PendingMaterials | null>(null);

  const [ocr, setOcr] = useState<{
    text: string;
    charCount: number;
    error: string | null;
  } | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrAction, setOcrAction] = useState<"share" | "device" | null>(null);
  const [ocrCopied, setOcrCopied] = useState(false);

  const [compress, setCompress] = useState<StudioOutput | null>(null);
  const [compressPreset, setCompressPreset] =
    useState<CompressionPreset>("balanced");
  const [compressBusy, setCompressBusy] = useState<CompressionPreset | null>(
    null,
  );
  const [compressAction, setCompressAction] = useState<
    "share" | "device" | null
  >(null);

  const [renameValue, setRenameValue] = useState("");
  const [renameShare, setRenameShare] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const busyNow = busy !== null || save.saving;

  const adopt = useCallback((next: StudioFile | null) => {
    setFile(next);
    setOutput(null);
    setOutputMode("process");
    setError(null);
    setNotice(null);
    setOcr(null);
    setOcrCopied(false);
    setCompress(null);
    setSheet(null);
  }, []);

  const choose = useCallback(
    async (source: "file" | "image") => {
      if (busyNow) return;
      setBusy(source === "file" ? "pick" : "gallery");
      setError(null);
      const result =
        source === "file" ? await pickAnyStudioFile() : await pickStudioImage();
      setBusy(null);
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      if (result.file !== null) adopt(result.file);
    },
    [adopt, busyNow],
  );

  const openOcr = useCallback(async () => {
    if (file === null || busyNow) return;
    setError(null);
    setSheet("ocr");
    setOcr(null);
    setOcrCopied(false);
    setOcrBusy(true);
    try {
      const prepared = await prepareOcrImage(
        file.uri,
        file.name,
        file.mimeType,
      );
      if (prepared.image === null) {
        setOcr({
          text: "",
          charCount: 0,
          error: prepared.error ?? "That image couldn't be prepared.",
        });
        return;
      }
      const preview = await fileToolsApi.ocrPreview({
        uri: prepared.image.uri,
        name: prepared.image.name,
        type: prepared.image.mimeType,
      });
      setOcr({
        text: preview.text,
        charCount: preview.charCount,
        error: preview.configured
          ? null
          : preview.error ?? "AI OCR isn't configured on this server.",
      });
    } catch (caught) {
      setOcr({
        text: "",
        charCount: 0,
        error: messageOf(caught, "The image text couldn't be read."),
      });
    } finally {
      setOcrBusy(false);
    }
  }, [busyNow, file]);

  const runTarget = useCallback(
    async (option: ConversionOption) => {
      if (file === null || busyNow) return;
      setError(null);
      setNotice(null);
      setOutput(null);

      if (file.capabilities.category === "image" && option.target === "txt") {
        void openOcr();
        return;
      }

      setBusy("convert");
      try {
        if (file.capabilities.category === "image") {
          if (option.target === "pdf") {
            const built = await buildPdfFromImage(file.uri, file.name);
            if (built.output === null) {
              setError(built.error ?? "The PDF couldn't be built.");
              return;
            }
            setOutput(built.output);
            setOutputLabel("PDF");
            setOutputMode("ocr");
            setNotice("PDF ready. Share it, save it, or index it from this file.");
            return;
          }
          if (
            option.target === "jpeg" ||
            option.target === "png" ||
            option.target === "webp"
          ) {
            const converted = await convertStudioImage(
              file.uri,
              file.name,
              option.target,
            );
            if (converted.output === null) {
              setError(converted.error ?? "That image couldn't be converted.");
              return;
            }
            setOutput(converted.output);
            setOutputLabel(option.extension.toUpperCase());
            setOutputMode("process");
            setNotice("Image ready. Share it or save it to this device.");
            return;
          }
          return;
        }

        const converted = await fileToolsApi.convert({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType,
          targetFormat: option.target as "pdf" | "txt" | "md" | "docx",
        });
        const written = await writeBase64ToCache(
          converted.base64,
          converted.name,
        );
        if (written.error !== null) {
          setError(written.error);
          return;
        }
        setOutput({
          uri: written.uri,
          name: converted.name,
          mimeType: converted.mimeType,
          sizeBytes: converted.bytes.byteLength,
          base64: converted.base64,
          bytes: converted.bytes,
        });
        setOutputLabel(option.extension.toUpperCase());
        setOutputMode("process");
        setNotice("Converted on the server. Nothing was added to Course Materials.");
      } catch (caught) {
        setError(messageOf(caught, "That file couldn't be converted."));
      } finally {
        setBusy(null);
      }
    },
    // `openOcr` is a stable dependency of this event handler.
    [busyNow, file, openOcr],
  );

  const copyOcr = useCallback(async () => {
    if (ocr === null || ocr.text === "") return;
    await Clipboard.setStringAsync(ocr.text);
    setOcrCopied(true);
    setTimeout(() => setOcrCopied(false), 2_000);
  }, [ocr]);

  const exportOcr = useCallback(
    async (destination: "share" | "device") => {
      if (file === null || ocr === null || ocr.text === "") return;
      setOcrAction(destination);
      const name = withExtension(file.name, "txt");
      const written = await writeTextToCache(ocr.text, name);
      if (written.error !== null) {
        setOcr((current) =>
          current === null
            ? current
            : { ...current, error: written.error },
        );
        setOcrAction(null);
        return;
      }
      const result =
        destination === "share"
          ? await shareStudioFile(written.uri, "text/plain")
          : await saveStudioFileToDevice(written.uri, name, "text/plain");
      setOcrAction(null);
      if (result.error !== null && result.error !== "Save cancelled.") {
        setOcr((current) =>
          current === null ? current : { ...current, error: result.error },
        );
      }
    },
    [file, ocr],
  );

  const applyCompression = useCallback(
    async (preset: CompressionPreset) => {
      if (file === null || compressBusy !== null) return;
      setCompressPreset(preset);
      setCompressBusy(preset);
      setCompress(null);
      const result = await compressStudioImage(
        file.uri,
        file.width ?? 0,
        file.height ?? 0,
        preset,
        file.name,
      );
      setCompressBusy(null);
      if (result.output === null) {
        setError(result.error ?? "That image couldn't be compressed.");
        return;
      }
      setCompress(result.output);
    },
    [compressBusy, file],
  );

  const openCompression = useCallback(() => {
    if (file === null || busyNow) return;
    setError(null);
    setSheet("compress");
    setCompress(null);
    void applyCompression("balanced");
  }, [applyCompression, busyNow, file]);

  const runCompressionAction = useCallback(
    async (destination: "share" | "device") => {
      if (compress === null || compressAction !== null) return;
      setCompressAction(destination);
      const result =
        destination === "share"
          ? await shareStudioFile(compress.uri, compress.mimeType)
          : await saveStudioFileToDevice(
              compress.uri,
              compress.name,
              compress.mimeType,
            );
      setCompressAction(null);
      if (result.error !== null && result.error !== "Save cancelled.") {
        setError(result.error);
      }
    },
    [compress, compressAction],
  );

  const openRename = useCallback(
    (shareAfter: boolean) => {
      if (file === null || busyNow) return;
      setError(null);
      setRenameValue(file.name);
      setRenameShare(shareAfter);
      setSheet("rename");
    },
    [busyNow, file],
  );

  const applyRename = useCallback(async () => {
    if (file === null || renaming) return;
    const requested = renameValue.trim();
    if (requested === "") {
      setError("Enter a file name.");
      return;
    }
    setRenaming(true);
    const renamed = await renameStudioFile(file.uri, requested);
    if (renamed.error !== null) {
      setRenaming(false);
      setError(renamed.error);
      return;
    }
    const inspected = await inspectStudioFile({
      uri: renamed.uri,
      name: requested,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
    });
    setFile(inspected);
    setOutput(null);
    setSheet(null);
    setNotice(`Renamed to ${requested}.`);
    setRenaming(false);
    if (renameShare) {
      const shared = await shareStudioFile(
        renamed.uri,
        inspected.mimeType ?? "application/octet-stream",
      );
      if (shared.error !== null) setError(shared.error);
    }
  }, [file, renameShare, renameValue, renaming]);

  const openMaterials = useCallback(
    (next: PendingMaterials) => {
      setPending(next);
      save.open();
    },
    [save],
  );

  const saveOutputMaterials = useCallback(async () => {
    if (output === null || output.bytes === null || busyNow) return;
    if (!SAVEABLE_MIME.has(output.mimeType)) return;

    let pages: OcrPageFile[] | undefined;
    if (outputMode === "ocr" && file !== null) {
      const prepared = await prepareOcrImage(
        file.uri,
        file.name,
        file.mimeType,
      );
      if (prepared.image === null) {
        setError(prepared.error ?? "The page image wasn't available for OCR.");
        return;
      }
      pages = [
        {
          uri: prepared.image.uri,
          name: prepared.image.name,
          type: prepared.image.mimeType,
        },
      ];
    }

    openMaterials({
      kind: "direct",
      bytes: output.bytes,
      name: output.name,
      mimeType: output.mimeType as MaterialsMimeType,
      mode: outputMode,
      ...(pages === undefined ? {} : { pages }),
    });
  }, [busyNow, file, openMaterials, output, outputMode]);

  const runAction = useCallback(
    async (action: FileActionId) => {
      if (file === null || busyNow) return;
      setError(null);
      setNotice(null);

      if (action === "pdf-extract-pages" || action === "pdf-merge") {
        router.push({
          pathname: "/tools/pdf-utils",
          params: {
            mode: action === "pdf-merge" ? "merge" : "extract",
            uri: file.uri,
            name: file.name,
          },
        });
        return;
      }

      if (action === "image-to-pdf") {
        router.push({
          pathname: "/tools/image-to-pdf",
          params: { imageUri: file.uri, name: file.name },
        });
        return;
      }

      if (action === "image-compress") {
        openCompression();
        return;
      }

      if (action === "image-ocr") {
        void openOcr();
        return;
      }

      if (action === "binary-metadata") {
        setSheet("metadata");
        return;
      }

      if (action === "binary-rename-share") {
        openRename(true);
        return;
      }

      if (action === "save-index") {
        if (file.capabilities.category === "pdf") {
          openMaterials({
            kind: "pdf-auto",
            uri: file.uri,
            name: file.name,
            mimeType: file.mimeType,
          });
        } else if (file.capabilities.category === "image") {
          openMaterials({ kind: "image-direct", file });
        } else if (file.capabilities.format === "docx") {
          try {
            const bytes = await readStudioBytes(file.uri);
            openMaterials({
              kind: "direct",
              bytes,
              name: file.name,
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              mode: "process",
            });
          } catch {
            setError("That document couldn't be read.");
          }
        } else {
          openMaterials({ kind: "convert-then-save", file });
        }
        return;
      }

      if (action === "ask-ai") {
        setBusy("ask");
        setNotice("Saving and indexing this file for Ask AI…");
        let result: SaveToMaterialsResult;
        try {
          if (file.capabilities.category === "pdf") {
            const bytes = await readStudioBytes(file.uri);
            result = (
              await savePdfWithAutoMode(fileToolsApi, {
                uri: file.uri,
                bytes,
                name: file.name,
                mimeType: file.mimeType,
                subjectId: null,
              })
            ).result;
          } else if (file.capabilities.category === "image") {
            const prepared = await prepareOcrImage(
              file.uri,
              file.name,
              file.mimeType,
            );
            if (prepared.image === null) {
              throw new Error(
                prepared.error ?? "That image couldn't be prepared for OCR.",
              );
            }
            const bytes = await readStudioBytes(prepared.image.uri);
            result = await saveFileToMaterials(fileToolsApi, {
              bytes,
              name: prepared.image.name,
              mimeType: prepared.image.mimeType,
              subjectId: null,
              mode: "ocr",
              pages: [
                {
                  uri: prepared.image.uri,
                  name: prepared.image.name,
                  type: prepared.image.mimeType,
                },
              ],
            });
          } else if (file.capabilities.format === "docx") {
            const bytes = await readStudioBytes(file.uri);
            result = await saveFileToMaterials(fileToolsApi, {
              bytes,
              name: file.name,
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              subjectId: null,
              mode: "process",
            });
          } else {
            const converted = await fileToolsApi.convert({
              uri: file.uri,
              name: file.name,
              mimeType: file.mimeType,
              targetFormat: "pdf",
            });
            result = await saveFileToMaterials(fileToolsApi, {
              bytes: converted.bytes,
              name: converted.name,
              mimeType: "application/pdf",
              subjectId: null,
              mode: "process",
            });
          }
        } catch (caught) {
          setBusy(null);
          setNotice(null);
          setError(messageOf(caught, "That file couldn't be prepared for Ask AI."));
          return;
        }

        if (result.status === "error" || result.documentId === null) {
          setBusy(null);
          setNotice(null);
          setError(result.error ?? "That file couldn't be saved for Ask AI.");
          return;
        }
        if (result.status === "saved_not_searchable") {
          setBusy(null);
          setNotice(null);
          setError(
            result.error ??
              "The file was saved, but it couldn't be made searchable yet.",
          );
          return;
        }

        let timedOut = false;
        if (result.status !== "indexed") {
          const status = await waitForDocumentIndexed(result.documentId);
          if (status === "failed") {
            setBusy(null);
            setNotice(null);
            setError(
              "The file was saved, but indexing failed. Open Course Materials for details.",
            );
            return;
          }
          timedOut = status === "timeout";
        }

        setBusy(null);
        setNotice(null);
        router.push({
          pathname: "/ask",
          params: {
            documentId: result.documentId,
            name: file.name,
            ...(timedOut ? { indexing: "1" } : {}),
          },
        });
      }
    },
    [busyNow, file, openCompression, openMaterials, openOcr, openRename, router],
  );

  const onSaveMaterials = useCallback(() => {
    if (pending === null) return;
    if (pending.kind === "direct") {
      void save.save({
        bytes: pending.bytes,
        name: pending.name,
        mimeType: pending.mimeType,
        mode: pending.mode,
        ...(pending.pages === undefined ? {} : { pages: pending.pages }),
      });
      return;
    }
    if (pending.kind === "pdf-auto") {
      void save.saveCustom(async (subjectId) => {
        const bytes = await readStudioBytes(pending.uri);
        const { result } = await savePdfWithAutoMode(fileToolsApi, {
          uri: pending.uri,
          bytes,
          name: pending.name,
          mimeType: pending.mimeType,
          subjectId,
        });
        return result;
      });
      return;
    }
    if (pending.kind === "image-direct") {
      void save.saveCustom(async (subjectId) => {
        const prepared = await prepareOcrImage(
          pending.file.uri,
          pending.file.name,
          pending.file.mimeType,
        );
        if (prepared.image === null) {
          return {
            status: "error",
            error: prepared.error ?? "That image couldn't be prepared for OCR.",
            documentId: null,
          };
        }
        const bytes = await readStudioBytes(prepared.image.uri);
        return saveFileToMaterials(fileToolsApi, {
          bytes,
          name: prepared.image.name,
          mimeType: prepared.image.mimeType,
          subjectId,
          mode: "ocr",
          pages: [
            {
              uri: prepared.image.uri,
              name: prepared.image.name,
              type: prepared.image.mimeType,
            },
          ],
        });
      });
      return;
    }
    void save.saveCustom(async (subjectId) => {
      const converted = await fileToolsApi.convert({
        uri: pending.file.uri,
        name: pending.file.name,
        mimeType: pending.file.mimeType,
        targetFormat: "pdf",
      });
      return saveFileToMaterials(fileToolsApi, {
        bytes: converted.bytes,
        name: converted.name,
        mimeType: "application/pdf",
        subjectId,
        mode: "process",
      });
    });
  }, [pending, save]);

  const actions = file?.capabilities.actions ?? [];
  const targets = file?.capabilities.targets ?? [];
  const canSaveOutput =
    output !== null && SAVEABLE_MIME.has(output.mimeType);
  const compressedDelta =
    compress === null || file?.sizeBytes == null
      ? null
      : compressionDelta(file.sizeBytes, compress.sizeBytes);
  const compressionView =
    file?.width !== null &&
    file?.width !== undefined &&
    file.height !== null &&
    file.height !== undefined
      ? compressionPlan(file.width, file.height, compressPreset)
      : null;

  return (
    <Screen>
      <PageHeading
        eyebrow="File Tools"
        title="Universal File Studio"
        description="Inspect any file, convert what makes sense, and save it where you need it."
      />

      {error !== null && sheet === null && output === null ? (
        <Notice tone="error">{error}</Notice>
      ) : null}
      {notice !== null && sheet === null && output === null ? (
        <Notice>{notice}</Notice>
      ) : null}

      {file === null ? (
        <>
          <EmptyState
            icon={<FileUp size={24} color={theme.colors.mutedForeground} />}
            title="Choose any file"
            body="PDFs, Office documents, images, text and data all get the same inspector. Formats without a safe conversion still keep their metadata, checksum, rename and share."
            footnote="Any file · metadata-first · no silent uploads"
          />
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label={busy === "pick" ? "Opening…" : "Choose Any File"}
                variant="primary"
                loading={busy === "pick"}
                disabled={busyNow}
                onPress={() => void choose("file")}
                fullWidth
                leading={<FileUp size={15} color={theme.colors.onPrimary} />}
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton
                label={busy === "gallery" ? "Opening…" : "Pick from Gallery"}
                variant="secondary"
                loading={busy === "gallery"}
                disabled={busyNow}
                onPress={() => void choose("image")}
                fullWidth
                leading={<Images size={15} color={theme.colors.foreground} />}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <FileInspectorCard
            file={file}
            busy={busyNow}
            onReplace={() => void choose("file")}
            onGallery={() => void choose("image")}
          />

          {targets.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader label="Convert to" />
              <Card elevation="flush">
                {targets.map((option, index) => (
                  <View key={option.target}>
                    {index > 0 ? <Divider /> : null}
                    <ConvertTargetRow
                      option={option}
                      busy={busyNow}
                      onPress={() => void runTarget(option)}
                    />
                  </View>
                ))}
              </Card>
            </View>
          ) : (
            <Notice>
              This format can&apos;t be converted safely. Its metadata, checksum,
              local rename and share still work.
            </Notice>
          )}

          {actions.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader label="Relevant actions" />
              <Card elevation="flush">
                {actions.map((action, index) => (
                  <View key={action.id}>
                    {index > 0 ? <Divider /> : null}
                    <ContextualActionRow
                      action={action}
                      busy={busyNow}
                      onPress={() => void runAction(action.id)}
                    />
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {busy === "ask" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.sm,
              }}
            >
              <ActivityIndicator
                size="small"
                color={theme.colors.mutedForeground}
              />
              <AppText variant="mono" color={theme.colors.mutedForeground}>
                Saving and waiting for the indexer…
              </AppText>
            </View>
          ) : null}

          {output !== null ? (
            <StudioResultCard
              result={output}
              label={outputLabel}
              busy={
                save.saving
                  ? "materials"
                  : busy === "share" || busy === "device"
                    ? busy
                    : null
              }
              error={error}
              notice={notice}
              canSaveMaterials={canSaveOutput}
              onShare={() => {
                if (output === null || busyNow) return;
                setBusy("share");
                void shareStudioFile(output.uri, output.mimeType).then(
                  (result) => {
                    setBusy(null);
                    if (result.error !== null) setError(result.error);
                  },
                );
              }}
              onSaveDevice={() => {
                if (output === null || busyNow) return;
                setBusy("device");
                void saveStudioFileToDevice(
                  output.uri,
                  output.name,
                  output.mimeType,
                ).then((result) => {
                  setBusy(null);
                  if (result.error !== null && result.error !== "Save cancelled.") {
                    setError(result.error);
                  }
                });
              }}
              onSaveMaterials={() => void saveOutputMaterials()}
            />
          ) : null}

          <AppButton
            label="Choose another file"
            variant="ghost"
            disabled={busyNow}
            onPress={() => void choose("file")}
            style={{ alignSelf: "center" }}
          />
        </>
      )}

      <BottomSheet
        visible={sheet === "ocr"}
        onClose={() => setSheet(null)}
        title="Extracted text"
        subtitle="AI OCR preview · the file is not saved"
      >
        {ocrBusy ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Reading the image…
            </AppText>
          </View>
        ) : null}
        {ocr?.error !== undefined && ocr?.error !== null ? (
          <Notice tone="error">{ocr.error}</Notice>
        ) : null}
        {ocr !== null && ocr.text !== "" ? (
          <>
            <Card elevation="flush">
              <View style={{ padding: theme.spacing.md }}>
                <AppText variant="bodyMd">{ocr.text}</AppText>
              </View>
            </Card>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {ocr.charCount.toLocaleString()} characters
            </AppText>
            <AppButton
              label={ocrCopied ? "Copied" : "Copy text"}
              variant="secondary"
              onPress={() => void copyOcr()}
              fullWidth
            />
            <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  label={ocrAction === "share" ? "Sharing…" : "Share .txt"}
                  variant="primary"
                  loading={ocrAction === "share"}
                  disabled={ocrAction !== null}
                  onPress={() => void exportOcr("share")}
                  fullWidth
                  leading={<Share2 size={15} color={theme.colors.onPrimary} />}
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton
                  label={ocrAction === "device" ? "Saving…" : "Save .txt"}
                  variant="secondary"
                  loading={ocrAction === "device"}
                  disabled={ocrAction !== null}
                  onPress={() => void exportOcr("device")}
                  fullWidth
                  leading={<Download size={15} color={theme.colors.foreground} />}
                />
              </View>
            </View>
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={sheet === "compress"}
        onClose={() => setSheet(null)}
        title="Compress & resize"
        subtitle={file?.name}
      >
        {error !== null ? <Notice tone="error">{error}</Notice> : null}
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Original · {formatStudioSize(file?.sizeBytes ?? null)}
        </AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
          {COMPRESSION_PRESETS.map((preset) => (
            <FilterChip
              key={preset.id}
              label={preset.label}
              active={compressPreset === preset.id}
              disabled={compressBusy !== null}
              onPress={() => void applyCompression(preset.id)}
            />
          ))}
        </View>
        {compressBusy !== null ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: theme.spacing.sm,
            }}
          >
            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Re-encoding…
            </AppText>
          </View>
        ) : null}
        {compress !== null ? (
          <>
            <Card elevation="flush">
              <View style={{ padding: theme.spacing.md, gap: theme.spacing.xs }}>
                <AppText variant="bodyMd">{compress.name}</AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {formatStudioSize(compress.sizeBytes)}
                  {compressedDelta === null
                    ? ""
                    : ` · ${compressedDelta.label}`}
                </AppText>
                {compressionView !== null ? (
                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {compressionView.width} × {compressionView.height} px ·{" "}
                    {Math.round(compressionView.quality * 100)}% JPEG
                  </AppText>
                ) : null}
              </View>
            </Card>
            <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  label={compressAction === "device" ? "Saving…" : "Save"}
                  variant="secondary"
                  loading={compressAction === "device"}
                  disabled={compressAction !== null}
                  onPress={() => void runCompressionAction("device")}
                  fullWidth
                />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton
                  label={compressAction === "share" ? "Sharing…" : "Share"}
                  variant="primary"
                  loading={compressAction === "share"}
                  disabled={compressAction !== null}
                  onPress={() => void runCompressionAction("share")}
                  fullWidth
                />
              </View>
            </View>
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={sheet === "rename"}
        onClose={() => setSheet(null)}
        title={renameShare ? "Rename & share" : "Rename file"}
        subtitle="Changes the local copy only"
      >
        {error !== null ? <Notice tone="error">{error}</Notice> : null}
        <Input
          label="File name"
          value={renameValue}
          onChangeText={setRenameValue}
          autoCapitalize="none"
        />
        <AppButton
          label={renaming ? "Renaming…" : renameShare ? "Rename & share" : "Rename"}
          variant="primary"
          loading={renaming}
          disabled={renaming || renameValue.trim() === ""}
          onPress={() => void applyRename()}
          fullWidth
        />
      </BottomSheet>

      <BottomSheet
        visible={sheet === "metadata"}
        onClose={() => setSheet(null)}
        title="File metadata"
        subtitle="Observed on this device"
      >
        {file !== null ? (
          <Card elevation="flush">
            <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
              {[
                ["Name", file.name],
                ["Category", file.capabilities.badge],
                ["Size", formatStudioSize(file.sizeBytes)],
                ["MIME", file.mimeType ?? "Unknown"],
                [
                  "Pages",
                  file.pageCount === null ? "Not applicable" : String(file.pageCount),
                ],
                [
                  "Dimensions",
                  file.width === null || file.height === null
                    ? "Not applicable"
                    : `${file.width} × ${file.height} px`,
                ],
                ["SHA-256", file.checksum ?? "Skipped or unavailable"],
              ].map(([label, value]) => (
                <View key={label} style={{ gap: theme.spacing.xxs }}>
                  <AppText variant="caps" color={theme.colors.mutedForeground}>
                    {label}
                  </AppText>
                  <AppText variant="mono" numberOfLines={3}>
                    {value}
                  </AppText>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
        {file !== null ? (
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label="Save to device"
                variant="secondary"
                onPress={() => {
                  void saveStudioFileToDevice(
                    file.uri,
                    file.name,
                    file.mimeType ?? "application/octet-stream",
                  ).then((result) => {
                    if (result.error !== null && result.error !== "Save cancelled.") {
                      setError(result.error);
                    }
                  });
                }}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton
                label="Share"
                variant="primary"
                onPress={() => {
                  void shareStudioFile(
                    file.uri,
                    file.mimeType ?? "application/octet-stream",
                  ).then((result) => {
                    if (result.error !== null) setError(result.error);
                  });
                }}
                fullWidth
                leading={<Share2 size={15} color={theme.colors.onPrimary} />}
              />
            </View>
          </View>
        ) : null}
      </BottomSheet>

      <SaveToMaterialsSheet
        visible={save.visible}
        onClose={() => {
          setPending(null);
          save.close();
        }}
        subjects={save.subjects}
        loading={save.subjectsLoading}
        subjectsError={save.subjectsError}
        selectedSubjectId={save.subjectId}
        onSelectSubject={save.setSubjectId}
        saving={save.saving}
        result={save.result}
        onSave={onSaveMaterials}
      />
    </Screen>
  );
}
