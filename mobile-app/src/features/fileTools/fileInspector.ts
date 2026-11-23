/**
 * The Universal File Studio's pure inspection rules.
 *
 * The native side only supplies observed values (bytes, page count, pixels,
 * digest); this module decides what is worth showing. SHA-256 is deliberately
 * capped so a 2 GB video never becomes a stalled hash job, and route params are
 * normalized once so re-renders cannot re-apply a preloaded file.
 */
import { COMPRESSION_PRESETS, type CompressionPreset } from "./fileCapabilities";

/** Hash the bytes of files up to this size; larger files show metadata only. */
export const CHECKSUM_MAX_BYTES = 25 * 1024 * 1024;

export type CompressionPlan = {
  preset: CompressionPreset;
  width: number;
  height: number;
  quality: number;
  resized: boolean;
};

export type CompressionDelta = {
  savedBytes: number;
  savedPercent: number;
  label: string;
};

export function checksumEligible(sizeBytes: number | null): boolean {
  return (
    sizeBytes !== null &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > 0 &&
    sizeBytes <= CHECKSUM_MAX_BYTES
  );
}

/** The honest reason the inspector omitted the checksum. */
export function checksumSkipCopy(sizeBytes: number | null): string | null {
  if (checksumEligible(sizeBytes)) return null;
  return `SHA-256 is skipped above ${Math.round(
    CHECKSUM_MAX_BYTES / (1024 * 1024),
  )} MB so large files stay fast.`;
}

export function formatStudioSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes < 100 ? kibibytes.toFixed(1) : Math.round(kibibytes)} KB`;
  }
  const mebibytes = kibibytes / 1024;
  return `${mebibytes < 100 ? mebibytes.toFixed(1) : Math.round(mebibytes)} MB`;
}

/** A route param is a string, a repeated array, or absent. Keep the first. */
export function normalizeRouteParam(
  value: string | string[] | undefined | null,
): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Only the two PDF Utilities modes are accepted from another screen. */
export function parsePdfMode(
  value: string | string[] | undefined | null,
): "merge" | "extract" | null {
  const mode = normalizeRouteParam(value);
  return mode === "merge" || mode === "extract" ? mode : null;
}

/** Pure geometry for the three compression presets. */
export function compressionPlan(
  width: number,
  height: number,
  preset: CompressionPreset,
): CompressionPlan {
  const option =
    COMPRESSION_PRESETS.find((entry) => entry.id === preset) ??
    COMPRESSION_PRESETS[0];
  const safeWidth = Number.isFinite(width) && width > 0 ? width : option.width;
  const safeHeight =
    Number.isFinite(height) && height > 0
      ? height
      : Math.round(option.width * 0.75);
  const targetWidth = Math.min(safeWidth, option.width);
  const targetHeight = Math.max(
    1,
    Math.round((safeHeight * targetWidth) / safeWidth),
  );
  return {
    preset: option.id,
    width: targetWidth,
    height: targetHeight,
    quality: option.quality,
    resized: targetWidth < safeWidth,
  };
}

/** The exact before/after line shown under a compression result. */
export function compressionDelta(
  beforeBytes: number,
  afterBytes: number,
): CompressionDelta {
  const safeBefore =
    Number.isFinite(beforeBytes) && beforeBytes > 0 ? beforeBytes : 0;
  const safeAfter =
    Number.isFinite(afterBytes) && afterBytes >= 0 ? afterBytes : 0;
  const savedBytes = Math.max(0, safeBefore - safeAfter);
  const savedPercent =
    safeBefore === 0 ? 0 : Math.round((savedBytes / safeBefore) * 100);
  return {
    savedBytes,
    savedPercent,
    label:
      savedBytes === 0
        ? `No size change · ${formatStudioSize(safeAfter)}`
        : `${savedPercent}% smaller · ${formatStudioSize(savedBytes)} saved`,
  };
}

/** Replace any extension with the target one, keeping the readable base. */
export function withExtension(name: string, extension: string): string {
  const trimmed = name.trim();
  const withoutExtension = /\.[^./\\]+$/.test(trimmed)
    ? trimmed.replace(/\.[^./\\]+$/, "").trim()
    : trimmed;
  const base = withoutExtension.trim() === "" ? "converted-file" : withoutExtension;
  return `${base}.${extension.replace(/^\./, "")}`;
}

/** A local cache name that no filesystem or share target can reject. */
export function safeLocalName(
  name: string,
  extension: string,
  fallback = "unipilot-file",
): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  if (cleaned === "") return withExtension(fallback, extension);
  return withExtension(cleaned, extension);
}
