import {
  CHECKSUM_MAX_BYTES,
  checksumEligible,
  checksumSkipCopy,
  compressionDelta,
  compressionPlan,
  formatStudioSize,
  normalizeRouteParam,
  parsePdfMode,
  safeLocalName,
  withExtension,
} from "../fileInspector";

describe("fileInspector", () => {
  test("formats byte sizes with the shared display contract", () => {
    expect(formatStudioSize(null)).toBe("Unknown size");
    expect(formatStudioSize(0)).toBe("0 B");
    expect(formatStudioSize(1024)).toBe("1.0 KB");
    expect(formatStudioSize(1024 * 1024 * 2.5)).toBe("2.5 MB");
  });

  test("caps SHA-256 at exactly 25 MiB", () => {
    expect(CHECKSUM_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(checksumEligible(CHECKSUM_MAX_BYTES)).toBe(true);
    expect(checksumEligible(CHECKSUM_MAX_BYTES + 1)).toBe(false);
    expect(checksumEligible(null)).toBe(false);
    expect(checksumSkipCopy(CHECKSUM_MAX_BYTES)).toBeNull();
    expect(checksumSkipCopy(CHECKSUM_MAX_BYTES + 1)).toContain("skipped");
  });

  test("normalizes route params and rejects empty or unknown values", () => {
    expect(normalizeRouteParam(" file:///a.pdf ")).toBe("file:///a.pdf");
    expect(normalizeRouteParam(["file:///first.pdf", "file:///second.pdf"])).toBe(
      "file:///first.pdf",
    );
    expect(normalizeRouteParam(undefined)).toBeNull();
    expect(normalizeRouteParam("   ")).toBeNull();
    expect(parsePdfMode("extract")).toBe("extract");
    expect(parsePdfMode("MERGE")).toBeNull();
    expect(parsePdfMode(undefined)).toBeNull();
  });

  test("compression presets resize proportionally and never upscale", () => {
    const wide = compressionPlan(3000, 2000, "balanced");
    expect(wide.width).toBe(1600);
    expect(wide.height).toBe(1067);
    expect(wide.resized).toBe(true);
    expect(wide.quality).toBe(0.8);

    const small = compressionPlan(800, 600, "web");
    expect(small.width).toBe(800);
    expect(small.height).toBe(600);
    expect(small.resized).toBe(false);
    expect(small.quality).toBe(0.75);
  });

  test("compression delta reports savings honestly", () => {
    expect(compressionDelta(2_000_000, 500_000)).toMatchObject({
      savedBytes: 1_500_000,
      savedPercent: 75,
    });
    expect(compressionDelta(1000, 1000).label).toContain("No size change");
    expect(compressionDelta(1000, 1500).savedPercent).toBe(0);
  });

  test("local names keep their readable base and target extension", () => {
    expect(withExtension("lecture-notes.pdf", "md")).toBe("lecture-notes.md");
    expect(withExtension("no-extension", "docx")).toBe("no-extension.docx");
    expect(withExtension("", "txt")).toBe("converted-file.txt");
    expect(safeLocalName("Week 9: Normalisation?.pdf", "pdf")).toBe(
      "Week 9 Normalisation.pdf",
    );
    expect(safeLocalName("   ", "pdf")).toBe("unipilot-file.pdf");
  });
});
