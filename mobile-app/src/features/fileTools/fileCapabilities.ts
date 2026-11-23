/**
 * Universal File Studio's pure capability matrix.
 *
 * The screen never invents an action: a file is detected once, then the
 * inspector card, Convert To list and contextual actions are all derived from
 * this module. Server targets are the generalized Bearer converter; on-device
 * targets use the packages already shipped (pdf-lib / expo-image-manipulator);
 * image text uses the OCR provider route.
 */

export type FileCategory =
  | "pdf"
  | "document"
  | "presentation"
  | "image"
  | "text"
  | "binary";

export type FileFormat =
  | "pdf"
  | "docx"
  | "pptx"
  | "doc"
  | "ppt"
  | "txt"
  | "md"
  | "csv"
  | "json"
  | "jpeg"
  | "png"
  | "webp"
  | "heic"
  | "unknown";

export type TargetFormat =
  | "pdf"
  | "txt"
  | "md"
  | "docx"
  | "jpeg"
  | "png"
  | "webp";

export type ConversionExecutor = "on-device" | "server" | "provider";

export type SaveStrategy =
  | "direct-pdf"
  | "direct-docx"
  | "direct-image"
  | "convert-to-pdf"
  | "unsupported";

export type CompressionPreset = "balanced" | "compact" | "web";

export type FileActionId =
  | "pdf-extract-pages"
  | "pdf-merge"
  | "save-index"
  | "ask-ai"
  | "image-compress"
  | "image-to-pdf"
  | "image-ocr"
  | "binary-metadata"
  | "binary-rename-share";

export type FileAction = {
  id: FileActionId;
  label: string;
  description: string;
};

export type ConversionOption = {
  target: TargetFormat;
  label: string;
  extension: string;
  mimeType: string;
  executor: ConversionExecutor;
  description: string;
};

export type FileCapabilities = {
  format: FileFormat;
  category: FileCategory;
  badge: string;
  targets: ConversionOption[];
  actions: FileAction[];
  saveStrategy: SaveStrategy;
  canSaveToMaterials: boolean;
  /** A generated PDF copy is uploaded instead of the source file. */
  saveAsPdfCopy: boolean;
  /** Image text extraction uses the provider-backed OCR route. */
  supportsOcr: boolean;
};

const TARGETS: Record<TargetFormat, Omit<ConversionOption, "target">> = {
  pdf: {
    label: "PDF",
    extension: "pdf",
    mimeType: "application/pdf",
    executor: "server",
    description: "Clean paginated PDF with a real text layer.",
  },
  txt: {
    label: "Plain Text",
    extension: "txt",
    mimeType: "text/plain",
    executor: "server",
    description: "The readable text only, without layout.",
  },
  md: {
    label: "Markdown",
    extension: "md",
    mimeType: "text/markdown",
    executor: "server",
    description: "Plain text with simple page/slide headings.",
  },
  docx: {
    label: "Word",
    extension: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    executor: "server",
    description: "A valid Word document with the readable text.",
  },
  jpeg: {
    label: "JPEG",
    extension: "jpg",
    mimeType: "image/jpeg",
    executor: "on-device",
    description: "Re-encoded image, suitable for sharing.",
  },
  png: {
    label: "PNG",
    extension: "png",
    mimeType: "image/png",
    executor: "on-device",
    description: "Lossless image output.",
  },
  webp: {
    label: "WEBP",
    extension: "webp",
    mimeType: "image/webp",
    executor: "on-device",
    description: "Smaller web-friendly image.",
  },
};

const IMAGE_FORMATS: readonly FileFormat[] = [
  "jpeg",
  "png",
  "webp",
  "heic",
];

const TEXT_FORMATS: readonly FileFormat[] = ["txt", "md", "csv", "json"];

const BADGES: Record<FileCategory, string> = {
  pdf: "PDF",
  document: "Document",
  presentation: "Presentation",
  image: "Image",
  text: "Text/Data",
  binary: "Binary",
};

function extensionOf(name: string): string {
  const match = /\.([^./\\]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

/** The format is decided by name first, then MIME; unknown stays honest. */
export function detectFileFormat(
  name: string,
  mimeType: string | null,
): FileFormat {
  const extension = extensionOf(name);
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  if (extension === "doc") return "doc";
  if (extension === "ppt") return "ppt";
  if (extension === "txt") return "txt";
  if (extension === "md" || extension === "markdown") return "md";
  if (extension === "csv") return "csv";
  if (extension === "json") return "json";
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png") return "png";
  if (extension === "webp") return "webp";
  if (extension === "heic" || extension === "heif") return "heic";

  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (mime === "text/plain") return "txt";
  if (mime === "text/markdown") return "md";
  if (mime === "text/csv") return "csv";
  if (mime === "application/json") return "json";
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return "unknown";
}

export function categoryOf(format: FileFormat): FileCategory {
  if (format === "pdf") return "pdf";
  if (format === "docx" || format === "doc") return "document";
  if (format === "pptx" || format === "ppt") return "presentation";
  if (IMAGE_FORMATS.includes(format)) return "image";
  if (TEXT_FORMATS.includes(format)) return "text";
  return "binary";
}

export function isImageFormat(format: FileFormat): boolean {
  return IMAGE_FORMATS.includes(format);
}

export function isSupportedDocumentFormat(format: FileFormat): boolean {
  return format === "docx" || format === "pptx";
}

export function targetOption(target: TargetFormat): ConversionOption {
  return { target, ...TARGETS[target] };
}

function targetsFor(format: FileFormat): TargetFormat[] {
  if (format === "pdf") return ["txt", "md", "docx"];

  if (format === "docx" || format === "pptx") return ["pdf", "md", "txt"];

  if (IMAGE_FORMATS.includes(format)) {
    const imageTargets: TargetFormat[] = ["pdf", "jpeg", "png", "webp"];
    if (format === "jpeg") {
      return [...imageTargets.filter((t) => t !== "jpeg"), "txt"];
    }
    if (format === "png") {
      return [...imageTargets.filter((t) => t !== "png"), "txt"];
    }
    if (format === "webp") {
      return [...imageTargets.filter((t) => t !== "webp"), "txt"];
    }
    return [...imageTargets, "txt"];
  }

  if (TEXT_FORMATS.includes(format)) {
    const textTargets: TargetFormat[] = ["pdf", "md", "docx", "txt"];
    const same: TargetFormat | null =
      format === "txt"
        ? "txt"
        : format === "md"
          ? "md"
          : null;
    return same === null ? textTargets : textTargets.filter((t) => t !== same);
  }

  return [];
}

function actionsFor(
  category: FileCategory,
  format: FileFormat,
): FileAction[] {
  if (format === "doc" || format === "ppt") {
    return binaryActions();
  }

  if (category === "pdf") {
    return [
      {
        id: "pdf-extract-pages",
        label: "Extract / split pages",
        description: "Choose pages and create a new PDF.",
      },
      {
        id: "pdf-merge",
        label: "Merge with other PDFs",
        description: "Combine this PDF with more files.",
      },
      {
        id: "save-index",
        label: "Save & index for Ask AI",
        description: "Add this PDF to Course Materials.",
      },
    ];
  }

  if (category === "image") {
    return [
      {
        id: "image-compress",
        label: "Compress & resize",
        description: "Compare presets before sharing.",
      },
      {
        id: "image-to-pdf",
        label: "Build a PDF",
        description: "Open Image to PDF with this page.",
      },
      {
        id: "image-ocr",
        label: "Extract text",
        description: "Read the image with AI OCR.",
      },
      {
        id: "save-index",
        label: "Save to Course Materials",
        description: "Upload this image and make it searchable.",
      },
    ];
  }

  if (category === "document" || category === "presentation" || category === "text") {
    return [
      {
        id: "save-index",
        label: "Save to Course Materials",
        description:
          format === "docx"
            ? "Upload the Word document and index it."
            : "Upload a generated PDF copy and index it.",
      },
      {
        id: "ask-ai",
        label: "Ask AI about this file",
        description: "Index it, then open Ask AI scoped to it.",
      },
    ];
  }

  return binaryActions();
}

function binaryActions(): FileAction[] {
  return [
    {
      id: "binary-metadata",
      label: "File metadata & checksum",
      description: "Inspect this binary without converting it.",
    },
    {
      id: "binary-rename-share",
      label: "Rename & share",
      description: "Keep the file local and share it safely.",
    },
  ];
}

function saveStrategyFor(format: FileFormat): SaveStrategy {
  if (format === "pdf") return "direct-pdf";
  if (format === "docx") return "direct-docx";
  if (IMAGE_FORMATS.includes(format)) return "direct-image";
  if (
    format === "pptx" ||
    TEXT_FORMATS.includes(format)
  ) {
    return "convert-to-pdf";
  }
  return "unsupported";
}

export function fileCapabilitiesFor(
  name: string,
  mimeType: string | null,
): FileCapabilities {
  const format = detectFileFormat(name, mimeType);
  const category = categoryOf(format);
  const targets = targetsFor(format).map((target) => {
    const option = targetOption(target);
    if (category === "image" && target === "pdf") {
      return {
        ...option,
        executor: "on-device" as const,
        description: "Build a paginated PDF on this device.",
      };
    }
    if (category === "image" && target === "txt") {
      return {
        ...option,
        executor: "provider" as const,
        description: "Read the image with AI OCR, then copy or share the text.",
      };
    }
    return option;
  });
  const saveStrategy = saveStrategyFor(format);

  return {
    format,
    category,
    badge: BADGES[category],
    targets,
    actions: actionsFor(category, format),
    saveStrategy,
    canSaveToMaterials: saveStrategy !== "unsupported",
    saveAsPdfCopy: saveStrategy === "convert-to-pdf",
    supportsOcr: category === "image" || category === "pdf",
  };
}

export const COMPRESSION_PRESETS = [
  {
    id: "balanced" as const,
    label: "Balanced 80%",
    description: "Good quality, smaller than the original.",
    quality: 0.8,
    width: 1600,
  },
  {
    id: "compact" as const,
    label: "Compact 60%",
    description: "Smaller file for sharing.",
    quality: 0.6,
    width: 1400,
  },
  {
    id: "web" as const,
    label: "Web 1280px",
    description: "Fits a web page at 1280px wide.",
    quality: 0.75,
    width: 1280,
  },
];
