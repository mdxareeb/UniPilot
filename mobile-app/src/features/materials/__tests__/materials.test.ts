import {
  filterMaterials,
  formatMaterialSize,
  materialTypeLabel,
  subjectFilters,
  toMaterialItem,
  type MaterialRowInput,
} from "../materials";

const row = (over: Partial<MaterialRowInput>): MaterialRowInput => ({
  id: "d",
  name: "Week 8 slides.pptx",
  storage_path: "user/doc/slides.pptx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  size_bytes: 12_700,
  status: "indexed",
  created_at: "2026-11-19T20:00:00Z",
  ai_summary: "Covers normalisation and BCNF.",
  topic_tags: ["Normalisation", "BCNF"],
  source: "whatsapp_group",
  subject_id: "s-1",
  subject: { name: "Databases", color_tag: "CS301" },
  ...over,
});

describe("toMaterialItem", () => {
  it("maps a captured file with its summary, tags, course and marker", () => {
    const item = toMaterialItem(row({}), "Asia/Kolkata");
    expect(item.name).toBe("Week 8 slides.pptx");
    expect(item.typeLabel).toBe("PPTX");
    expect(item.sizeLabel).toBe("12.4 KB");
    // 2026-11-19T20:00Z is already Nov 20 in Asia/Kolkata (UTC+5:30).
    expect(item.addedLabel).toBe("Fri, Nov 20");
    expect(item.statusValue).toBe("indexed");
    expect(item.statusLabel).toBe("Searchable");
    expect(item.summary).toBe("Covers normalisation and BCNF.");
    expect(item.tags).toEqual(["Normalisation", "BCNF"]);
    expect(item.subjectName).toBe("Databases");
    expect(item.subjectColorTag).toBe("CS301");
    expect(item.fromWhatsApp).toBe(true);
    expect(item.canOpen).toBe(true);
  });

  it("omits an empty summary and blank tags, and never invents a course", () => {
    const item = toMaterialItem(
      row({
        ai_summary: "   ",
        topic_tags: ["  ", ""],
        subject: null,
        subject_id: null,
        source: "upload",
      }),
      "UTC",
    );
    expect(item.summary).toBeNull();
    expect(item.tags).toEqual([]);
    expect(item.subjectName).toBeNull();
    expect(item.subjectColorTag).toBeNull();
    expect(item.fromWhatsApp).toBe(false);
  });

  it("falls back honestly for an unknown status, type or missing size", () => {
    const item = toMaterialItem(
      row({ status: "queued", mime_type: "application/zip", size_bytes: null, storage_path: null }),
      "UTC",
    );
    expect(item.statusValue).toBe("uploaded");
    expect(item.statusLabel).toBe("Uploaded");
    expect(item.typeLabel).toBe("File");
    expect(item.sizeLabel).toBeNull();
    expect(item.canOpen).toBe(false);
  });

  it("labels the types the bridge captures", () => {
    expect(materialTypeLabel("application/pdf")).toBe("PDF");
    expect(materialTypeLabel("image/png")).toBe("PNG");
    expect(materialTypeLabel("image/jpeg")).toBe("JPEG");
    expect(materialTypeLabel(null)).toBe("File");
    expect(materialTypeLabel("text/plain")).toBe("File");
  });
});

describe("formatMaterialSize", () => {
  it("uses the web's size rules", () => {
    expect(formatMaterialSize(824)).toBe("824 B");
    expect(formatMaterialSize(12_700)).toBe("12.4 KB");
    expect(formatMaterialSize(106_954_342)).toBe("102 MB");
  });
});

describe("subject filters", () => {
  it("lists the courses present, A to Z, with file counts", () => {
    const items = [
      toMaterialItem(row({ id: "1", subject_id: "s-2", subject: { name: "Physics" } }), "UTC"),
      toMaterialItem(row({ id: "2", subject_id: "s-1", subject: { name: "Databases" } }), "UTC"),
      toMaterialItem(row({ id: "3", subject_id: "s-1", subject: { name: "Databases" } }), "UTC"),
      toMaterialItem(row({ id: "4", subject_id: null, subject: null }), "UTC"),
    ];
    expect(subjectFilters(items)).toEqual([
      { id: "s-1", name: "Databases", count: 2 },
      { id: "s-2", name: "Physics", count: 1 },
    ]);
  });

  it("filters to one course, or shows everything for null", () => {
    const items = [
      toMaterialItem(row({ id: "1", subject_id: "s-2", subject: { name: "Physics" } }), "UTC"),
      toMaterialItem(row({ id: "2", subject_id: "s-1", subject: { name: "Databases" } }), "UTC"),
    ];
    expect(filterMaterials(items, null).map((item) => item.id)).toEqual(["1", "2"]);
    expect(filterMaterials(items, "s-1").map((item) => item.id)).toEqual(["2"]);
    expect(filterMaterials(items, "missing")).toEqual([]);
  });
});
