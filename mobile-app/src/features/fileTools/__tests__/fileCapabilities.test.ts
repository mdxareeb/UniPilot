import {
  COMPRESSION_PRESETS,
  categoryOf,
  detectFileFormat,
  fileCapabilitiesFor,
  isImageFormat,
  targetOption,
} from "../fileCapabilities";

describe("detectFileFormat", () => {
  it("uses the extension before the MIME type", () => {
    expect(detectFileFormat("notes.PDF", "application/octet-stream")).toBe("pdf");
    expect(detectFileFormat("slides.pptx", null)).toBe("pptx");
    expect(detectFileFormat("report.docx", null)).toBe("docx");
    expect(detectFileFormat("readme.md", "text/plain")).toBe("md");
    expect(detectFileFormat("rows.csv", null)).toBe("csv");
    expect(detectFileFormat("data.json", null)).toBe("json");
    expect(detectFileFormat("photo.HEIC", null)).toBe("heic");
  });

  it("falls back to MIME and otherwise stays binary", () => {
    expect(detectFileFormat("file", "application/pdf")).toBe("pdf");
    expect(detectFileFormat("file", "image/png")).toBe("png");
    expect(detectFileFormat("archive.zip", "application/zip")).toBe("unknown");
    expect(categoryOf(detectFileFormat("archive.zip", null))).toBe("binary");
  });
});

describe("fileCapabilitiesFor", () => {
  it("maps PDFs to text, markdown and Word server conversions", () => {
    const caps = fileCapabilitiesFor("notes.pdf", "application/pdf");
    expect(caps.category).toBe("pdf");
    expect(caps.badge).toBe("PDF");
    expect(caps.targets.map((target) => target.target)).toEqual([
      "txt",
      "md",
      "docx",
    ]);
    expect(caps.targets.every((target) => target.executor === "server")).toBe(
      true,
    );
    expect(caps.saveStrategy).toBe("direct-pdf");
    expect(caps.actions.map((action) => action.id)).toEqual([
      "pdf-extract-pages",
      "pdf-merge",
      "save-index",
    ]);
  });

  it("maps images to on-device PDF/JPEG/PNG/WEBP and provider OCR", () => {
    const caps = fileCapabilitiesFor("photo.jpg", "image/jpeg");
    expect(caps.category).toBe("image");
    expect(caps.targets.map((target) => target.target)).toEqual([
      "pdf",
      "png",
      "webp",
      "txt",
    ]);
    expect(caps.targets.find((target) => target.target === "pdf")?.executor).toBe(
      "on-device",
    );
    expect(caps.targets.find((target) => target.target === "txt")?.executor).toBe(
      "provider",
    );
    expect(caps.saveStrategy).toBe("direct-image");
    expect(caps.supportsOcr).toBe(true);
    expect(caps.actions.map((action) => action.id)).toEqual([
      "image-compress",
      "image-to-pdf",
      "image-ocr",
      "save-index",
    ]);
  });

  it("keeps HEIC input and offers every image output", () => {
    const caps = fileCapabilitiesFor("camera.heic", "image/heic");
    expect(isImageFormat(caps.format)).toBe(true);
    expect(caps.targets.map((target) => target.target)).toEqual([
      "pdf",
      "jpeg",
      "png",
      "webp",
      "txt",
    ]);
  });

  it("maps Office documents to PDF/Markdown/Text and the right save copy", () => {
    const docx = fileCapabilitiesFor("essay.docx", null);
    expect(docx.category).toBe("document");
    expect(docx.badge).toBe("Document");
    expect(docx.targets.map((target) => target.target)).toEqual([
      "pdf",
      "md",
      "txt",
    ]);
    expect(docx.saveStrategy).toBe("direct-docx");
    expect(docx.saveAsPdfCopy).toBe(false);

    const pptx = fileCapabilitiesFor("deck.pptx", null);
    expect(pptx.category).toBe("presentation");
    expect(pptx.saveStrategy).toBe("convert-to-pdf");
    expect(pptx.saveAsPdfCopy).toBe(true);
    expect(pptx.actions.map((action) => action.id)).toContain("ask-ai");
  });

  it("offers text formats without duplicating the source format", () => {
    const txt = fileCapabilitiesFor("notes.txt", "text/plain");
    expect(txt.targets.map((target) => target.target)).toEqual([
      "pdf",
      "md",
      "docx",
    ]);

    const md = fileCapabilitiesFor("notes.md", "text/markdown");
    expect(md.targets.map((target) => target.target)).toEqual([
      "pdf",
      "docx",
      "txt",
    ]);

    const csv = fileCapabilitiesFor("rows.csv", "text/csv");
    expect(csv.targets.map((target) => target.target)).toEqual([
      "pdf",
      "md",
      "docx",
      "txt",
    ]);
    expect(csv.saveStrategy).toBe("convert-to-pdf");
  });

  it("refuses arbitrary binaries and legacy Office files honestly", () => {
    for (const [name, mime] of [
      ["archive.zip", "application/zip"],
      ["movie.mp4", "video/mp4"],
      ["legacy.doc", "application/msword"],
      ["legacy.ppt", "application/vnd.ms-powerpoint"],
    ] as const) {
      const caps = fileCapabilitiesFor(name, mime);
      expect(caps.targets).toEqual([]);
      expect(caps.canSaveToMaterials).toBe(false);
      expect(caps.saveStrategy).toBe("unsupported");
      expect(caps.actions.map((action) => action.id)).toEqual([
        "binary-metadata",
        "binary-rename-share",
      ]);
    }
  });

  it("exposes the target MIME and extension used by the renderer", () => {
    expect(targetOption("pdf")).toMatchObject({
      extension: "pdf",
      mimeType: "application/pdf",
    });
    expect(targetOption("docx").mimeType).toContain("wordprocessingml");
    expect(targetOption("md")).toMatchObject({
      extension: "md",
      mimeType: "text/markdown",
    });
  });
});

describe("compression presets", () => {
  it("provides three bounded, documented presets", () => {
    expect(COMPRESSION_PRESETS.map((preset) => preset.id)).toEqual([
      "balanced",
      "compact",
      "web",
    ]);
    for (const preset of COMPRESSION_PRESETS) {
      expect(preset.quality).toBeGreaterThan(0);
      expect(preset.quality).toBeLessThanOrEqual(1);
      expect(preset.width).toBeGreaterThanOrEqual(1280);
      expect(preset.width).toBeLessThanOrEqual(1600);
    }
  });
});
