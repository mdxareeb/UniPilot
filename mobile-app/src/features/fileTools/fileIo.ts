import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { supabase } from "@/lib/supabase";
import type { QueryResult } from "@/features/agenda/queries";
import {
  CONVERT_MAX_BYTES,
  CONVERT_PICKER_TYPES,
  PDF_MIME,
  convertKindOf,
  type PickedConvertFile,
  type PickedPdf,
  type PdfImagePage,
} from "./fileValues";
import { bytesToArrayBuffer } from "./fileBytes";

/**
 * Native file I/O for the File Tools.
 *
 * Images are decoded, resized and re-encoded to JPEG (which bakes EXIF
 * orientation into the pixels) before they enter the PDF. PDFs are read as
 * base64 for pdf-lib, written to the cache for sharing, and written through
 * Android's Storage Access Framework when saving to device storage.
 */

const IMAGE_MAX_WIDTH = 1600;
const IMAGE_QUALITY = 0.82;
const MAX_IMAGES = 20;
const MAX_PDFS = 10;

export type PickImagesResult = {
  pages: PdfImagePage[];
  error: string | null;
};

async function normalizeImage(
  asset: ImagePicker.ImagePickerAsset,
  index: number,
): Promise<PdfImagePage> {
  const actions =
    asset.width > IMAGE_MAX_WIDTH
      ? [{ resize: { width: IMAGE_MAX_WIDTH } }]
      : [];
  const result = await manipulateAsync(asset.uri, actions, {
    compress: IMAGE_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!result.base64) {
    throw new Error("The image couldn't be prepared.");
  }
  return {
    id: `${Date.now()}-${index}`,
    uri: result.uri,
    base64: result.base64,
    width: result.width,
    height: result.height,
    fileName: asset.fileName ?? `image-${index + 1}.jpg`,
    mimeType: "image/jpeg",
  };
}

async function fromAssets(
  assets: readonly ImagePicker.ImagePickerAsset[],
): Promise<PickImagesResult> {
  if (assets.length > MAX_IMAGES) {
    return {
      pages: [],
      error: `Choose up to ${MAX_IMAGES} images at a time.`,
    };
  }
  try {
    const pages: PdfImagePage[] = [];
    for (let index = 0; index < assets.length; index += 1) {
      pages.push(await normalizeImage(assets[index], index));
    }
    return { pages, error: null };
  } catch {
    return {
      pages: [],
      error: "One of those images couldn't be prepared. Try another photo.",
    };
  }
}

export async function pickImagesFromLibrary(): Promise<PickImagesResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      pages: [],
      error: "Allow photo access to choose pages for the PDF.",
    };
  }
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES,
      orderedSelection: true,
      quality: 1,
    });
    if (result.canceled) return { pages: [], error: null };
    return fromAssets(result.assets);
  } catch {
    return { pages: [], error: "The photo picker couldn't open. Try again." };
  }
}

export async function takeImageWithCamera(): Promise<PickImagesResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { pages: [], error: "Allow camera access to photograph a page." };
  }
  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled) return { pages: [], error: null };
    return fromAssets(result.assets.slice(0, 1));
  } catch {
    return { pages: [], error: "The camera couldn't open. Try again." };
  }
}

export async function cachePickedFile(uri: string, name: string): Promise<string> {
  if (uri.startsWith("file://")) return uri;
  const directory = FileSystem.cacheDirectory;
  if (directory === null) return uri;
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, "-").slice(-80);
  const destination = `${directory}picked-${Date.now()}-${safeName}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

export async function pickPdfFiles(): Promise<QueryResult<PickedPdf>> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: PDF_MIME,
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return { rows: [], error: null };
    const rows: PickedPdf[] = [];
    for (const asset of result.assets.slice(0, MAX_PDFS)) {
      const isPdf =
        asset.mimeType === PDF_MIME ||
        asset.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        return { rows: [], error: "Choose PDF files only." };
      }
      rows.push({
        id: `${Date.now()}-${rows.length}`,
        uri: await cachePickedFile(asset.uri, asset.name),
        name: asset.name,
        sizeBytes: asset.size ?? null,
      });
    }
    return { rows, error: null };
  } catch {
    return { rows: [], error: "The file picker couldn't open. Try again." };
  }
}

export async function pickConvertFile(): Promise<{
  file: PickedConvertFile | null;
  error: string | null;
}> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: [...CONVERT_PICKER_TYPES],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return { file: null, error: null };
    const asset = result.assets[0];
    const kind = convertKindOf(asset.name, asset.mimeType ?? null);
    if (kind === null) {
      return { file: null, error: "Choose a DOCX, PPTX or TXT file." };
    }
    if (asset.size !== undefined && asset.size > CONVERT_MAX_BYTES) {
      return { file: null, error: "That file is larger than the 10 MB limit." };
    }
    return {
      file: {
        uri: await cachePickedFile(asset.uri, asset.name),
        name: asset.name,
        sizeBytes: asset.size ?? null,
        mimeType: asset.mimeType ?? null,
        kind,
      },
      error: null,
    };
  } catch {
    return { file: null, error: "The file picker couldn't open. Try again." };
  }
}

export async function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export type CachedPdf = { uri: string; error: string | null };

export async function writePdfToCache(
  base64: string,
  name: string,
): Promise<CachedPdf> {
  const directory = FileSystem.cacheDirectory;
  if (directory === null) {
    return { uri: "", error: "This device has no cache directory." };
  }
  try {
    const safeName = name.replace(/\s+/g, "-");
    const uri = `${directory}${safeName}`;
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri, error: null };
  } catch {
    return { uri: "", error: "The PDF couldn't be written on this device." };
  }
}

export async function sharePdf(uri: string): Promise<{ error: string | null }> {
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) return { error: "Sharing isn't available on this device." };
    await Sharing.shareAsync(uri, {
      mimeType: PDF_MIME,
      UTI: "com.adobe.pdf",
      dialogTitle: "Share PDF",
    });
    return { error: null };
  } catch {
    return { error: "The share sheet couldn't open. Try again." };
  }
}

export async function savePdfToDevice(
  base64: string,
  name: string,
): Promise<{ error: string | null }> {
  if (Platform.OS !== "android") {
    const cached = await writePdfToCache(base64, name);
    if (cached.error !== null) return { error: cached.error };
    return sharePdf(cached.uri);
  }

  try {
    const permission =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) {
      return { error: "Save cancelled." };
    }
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(
      permission.directoryUri,
      name,
      PDF_MIME,
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { error: null };
  } catch {
    return { error: "The PDF couldn't be saved to that folder. Try again." };
  }
}

export async function uploadDocument(
  uploadPath: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ error: string | null }> {
  if (supabase === null) return { error: "This build isn't configured." };
  const { error } = await supabase.storage
    .from("documents")
    .upload(uploadPath, bytesToArrayBuffer(bytes), {
      contentType: mimeType,
      upsert: false,
    });
  if (error) return { error: "The file couldn't be uploaded. Try again." };
  return { error: null };
}

export async function uploadPdf(
  uploadPath: string,
  bytes: Uint8Array,
): Promise<{ error: string | null }> {
  return uploadDocument(uploadPath, bytes, PDF_MIME);
}
