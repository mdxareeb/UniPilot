/**
 * The Universal File Studio's native side.
 *
 * Selection, inspection, on-device image work, generic cache/share/save and
 * the image-PDF bridge live here so the screen stays a state machine over
 * capability data. Nothing in this module talks to the network; the Bearer
 * client owns conversion and Course Materials.
 */
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { Image, Platform } from "react-native";

import {
  fileCapabilitiesFor,
  type CompressionPreset,
  type FileCapabilities,
} from "./fileCapabilities";
import { bytesToBase64, utf8ToBytes } from "./fileBytes";
import { cachePickedFile, readBase64 } from "./fileIo";
import {
  CHECKSUM_MAX_BYTES,
  checksumEligible,
  compressionPlan,
  safeLocalName,
  withExtension,
} from "./fileInspector";
import { buildImagePdf, pdfPageCount, type BuiltPdf } from "./pdfBuilder";

export type StudioFile = {
  uri: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
  capabilities: FileCapabilities;
  pageCount: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  checksumSkipped: boolean;
};

export type StudioOutput = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64: string | null;
  bytes: Uint8Array | null;
};

export type StudioImage = {
  uri: string;
  name: string;
  mimeType: "image/jpeg" | "image/png";
};

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

function extensionOf(name: string): string {
  const match = /\.([^./\\]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

async function fileSize(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || typeof info.size !== "number") {
      return null;
    }
    return info.size;
  } catch {
    return null;
  }
}

async function imageDimensions(
  uri: string,
): Promise<{ width: number; height: number } | null> {
  try {
    return await new Promise((resolve) => {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve(null),
      );
    });
  } catch {
    return null;
  }
}

async function sha256(uri: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await new File(uri).arrayBuffer());
    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      bytes,
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/** Observe one selected file once; the screen stores this shape. */
export async function inspectStudioFile(input: {
  uri: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
}): Promise<StudioFile> {
  const capabilities = fileCapabilitiesFor(input.name, input.mimeType);
  const sizeBytes = input.sizeBytes ?? (await fileSize(input.uri));

  let pageCount: number | null = null;
  if (
    capabilities.format === "pdf" &&
    sizeBytes !== null &&
    sizeBytes <= CHECKSUM_MAX_BYTES
  ) {
    try {
      pageCount = await pdfPageCount(await readBase64(input.uri));
    } catch {
      pageCount = null;
    }
  }

  let width: number | null = null;
  let height: number | null = null;
  if (capabilities.category === "image") {
    const dimensions = await imageDimensions(input.uri);
    if (dimensions !== null) {
      width = dimensions.width;
      height = dimensions.height;
    }
  }

  const checksum = checksumEligible(sizeBytes) ? await sha256(input.uri) : null;

  return {
    ...input,
    sizeBytes,
    capabilities,
    pageCount,
    width,
    height,
    checksum,
    checksumSkipped: checksumEligible(sizeBytes) && checksum === null,
  };
}

export async function pickAnyStudioFile(): Promise<{
  file: StudioFile | null;
  error: string | null;
}> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return { file: null, error: null };
    const asset = result.assets[0];
    const uri = await cachePickedFile(asset.uri, asset.name);
    return {
      file: await inspectStudioFile({
        uri,
        name: asset.name,
        sizeBytes: asset.size ?? null,
        mimeType: asset.mimeType ?? null,
      }),
      error: null,
    };
  } catch {
    return { file: null, error: "The file picker couldn't open. Try again." };
  }
}

export async function pickStudioImage(): Promise<{
  file: StudioFile | null;
  error: string | null;
}> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { file: null, error: "Allow photo access to choose an image." };
  }
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled) return { file: null, error: null };
    const asset = result.assets[0];
    const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
    const mimeType =
      asset.mimeType ?? IMAGE_MIME[extensionOf(name)] ?? "image/jpeg";
    const uri = await cachePickedFile(asset.uri, name);
    return {
      file: await inspectStudioFile({
        uri,
        name,
        sizeBytes: asset.fileSize ?? null,
        mimeType,
      }),
      error: null,
    };
  } catch {
    return { file: null, error: "The photo picker couldn't open. Try again." };
  }
}

/** Feed an arbitrary image URI into the Image-to-PDF receiver. */
export async function prepareImageForPdf(
  uri: string,
  name: string,
): Promise<{ page: { uri: string; base64: string; width: number; height: number; fileName: string } | null; error: string | null }> {
  try {
    const result = await manipulateAsync(uri, [], {
      compress: 0.82,
      format: SaveFormat.JPEG,
      base64: true,
    });
    if (!result.base64) {
      return { page: null, error: "That image couldn't be prepared." };
    }
    return {
      page: {
        uri: result.uri,
        base64: result.base64,
        width: result.width,
        height: result.height,
        fileName: withExtension(name, "jpg"),
      },
      error: null,
    };
  } catch {
    return { page: null, error: "That image couldn't be prepared." };
  }
}

export async function buildPdfFromImage(
  uri: string,
  name: string,
): Promise<{
  output: (StudioOutput & { pdf: BuiltPdf }) | null;
  error: string | null;
}> {
  const prepared = await prepareImageForPdf(uri, name);
  if (prepared.page === null) {
    return { output: null, error: prepared.error };
  }
  try {
    const title = withExtension(name, "pdf");
    const pdf = await buildImagePdf(
      [
        {
          base64: prepared.page.base64,
          mimeType: "image/jpeg",
          width: prepared.page.width,
          height: prepared.page.height,
        },
      ],
      title,
    );
    const written = await writeBase64ToCache(pdf.base64, title);
    if (written.error !== null) {
      return { output: null, error: written.error };
    }
    return {
      output: {
        uri: written.uri,
        name: title,
        mimeType: "application/pdf",
        sizeBytes: pdf.bytes.byteLength,
        base64: pdf.base64,
        bytes: pdf.bytes,
        pdf,
      },
      error: null,
    };
  } catch {
    return {
      output: null,
      error: "The PDF couldn't be built from that image.",
    };
  }
}

export async function compressStudioImage(
  uri: string,
  width: number,
  height: number,
  preset: CompressionPreset,
  sourceName = "image",
): Promise<{ output: StudioOutput | null; error: string | null }> {
  const plan = compressionPlan(width, height, preset);
  const base = withExtension(sourceName, "jpg").replace(/\.jpg$/i, "");
  try {
    const result = await manipulateAsync(
      uri,
      plan.resized ? [{ resize: { width: plan.width } }] : [],
      { compress: plan.quality, format: SaveFormat.JPEG, base64: true },
    );
    const sizeBytes = (await fileSize(result.uri)) ?? 0;
    return {
      output: {
        uri: result.uri,
        name: `${base}-${preset}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes,
        base64: result.base64 ?? null,
        bytes: null,
      },
      error: null,
    };
  } catch {
    return { output: null, error: "That image couldn't be compressed." };
  }
}

export async function convertStudioImage(
  uri: string,
  name: string,
  target: "jpeg" | "png" | "webp",
): Promise<{ output: StudioOutput | null; error: string | null }> {
  const format =
    target === "png"
      ? SaveFormat.PNG
      : target === "webp"
        ? SaveFormat.WEBP
        : SaveFormat.JPEG;
  try {
    const result = await manipulateAsync(uri, [], {
      compress: target === "png" ? 1 : 0.9,
      format,
      base64: true,
    });
    const sizeBytes = (await fileSize(result.uri)) ?? 0;
    return {
      output: {
        uri: result.uri,
        name: safeLocalName(name, target === "jpeg" ? "jpg" : target),
        mimeType:
          target === "png"
            ? "image/png"
            : target === "webp"
              ? "image/webp"
              : "image/jpeg",
        sizeBytes,
        base64: result.base64 ?? null,
        bytes: null,
      },
      error: null,
    };
  } catch {
    return { output: null, error: "That image couldn't be converted." };
  }
}

/** OCR only accepts JPEG/PNG; HEIC and other formats are normalized first. */
export async function prepareOcrImage(
  uri: string,
  name: string,
  mimeType: string | null,
): Promise<{ image: StudioImage | null; error: string | null }> {
  if (mimeType === "image/png") {
    return { image: { uri, name, mimeType: "image/png" }, error: null };
  }
  if (mimeType === "image/jpeg") {
    return { image: { uri, name, mimeType: "image/jpeg" }, error: null };
  }
  const prepared = await prepareImageForPdf(uri, name);
  if (prepared.page === null) {
    return { image: null, error: prepared.error };
  }
  return {
    image: {
      uri: prepared.page.uri,
      name: withExtension(name, "jpg"),
      mimeType: "image/jpeg",
    },
    error: null,
  };
}

export async function readStudioBytes(uri: string): Promise<Uint8Array> {
  return new Uint8Array(await new File(uri).arrayBuffer());
}

export async function writeBase64ToCache(  base64: string,
  name: string,
): Promise<{ uri: string; error: string | null }> {
  const directory = FileSystem.cacheDirectory;
  if (directory === null) {
    return { uri: "", error: "This device has no cache directory." };
  }
  try {
    const uri = `${directory}${safeLocalName(name, extensionOf(name) || "bin")}`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri, error: null };
  } catch {
    return { uri: "", error: "The file couldn't be written on this device." };
  }
}

export async function writeBytesToCache(
  bytes: Uint8Array,
  name: string,
): Promise<{ uri: string; error: string | null }> {
  return writeBase64ToCache(bytesToBase64(bytes), name);
}

export async function writeTextToCache(
  text: string,
  name: string,
): Promise<{ uri: string; error: string | null }> {
  return writeBytesToCache(utf8ToBytes(text), name);
}

export async function renameStudioFile(
  uri: string,
  name: string,
): Promise<{ uri: string; error: string | null }> {
  const directory = FileSystem.cacheDirectory;
  if (directory === null) {
    return { uri: "", error: "This device has no cache directory." };
  }
  try {
    const destination = `${directory}${safeLocalName(
      name,
      extensionOf(name) || "bin",
    )}`;
    await FileSystem.copyAsync({ from: uri, to: destination });
    return { uri: destination, error: null };
  } catch {
    return { uri: "", error: "That file couldn't be renamed." };
  }
}

export async function shareStudioFile(
  uri: string,
  mimeType: string,
): Promise<{ error: string | null }> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) return { error: "Sharing isn't available on this device." };
    await Sharing.shareAsync(uri, { mimeType });
    return { error: null };
  } catch {
    return { error: "The share sheet couldn't open. Try again." };
  }
}

export async function saveStudioFileToDevice(
  uri: string,
  name: string,
  mimeType: string,
): Promise<{ error: string | null }> {
  if (Platform.OS !== "android") {
    return shareStudioFile(uri, mimeType);
  }
  try {
    const permission =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return { error: "Save cancelled." };
    const destination =
      await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        safeLocalName(name, extensionOf(name) || "bin"),
        mimeType,
      );
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.StorageAccessFramework.writeAsStringAsync(
      destination,
      base64,
      { encoding: FileSystem.EncodingType.Base64 },
    );
    return { error: null };
  } catch {
    return { error: "The file couldn't be saved to that folder. Try again." };
  }
}
