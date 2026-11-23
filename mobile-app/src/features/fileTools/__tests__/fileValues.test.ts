import {
  convertKindOf,
  moveListItem,
  parsePageRanges,
  removeListItem,
  sanitizePdfFileName,
} from "../fileValues";
import { bytesToBase64 } from "../fileBytes";

describe("sanitizePdfFileName", () => {
  it("keeps a clean name and forces the PDF extension", () => {
    expect(sanitizePdfFileName("Week 3 notes")).toBe("Week 3 notes.pdf");
    expect(sanitizePdfFileName("Week 3 notes.PDF")).toBe("Week 3 notes.pdf");
  });

  it("removes path separators and control characters", () => {
    expect(sanitizePdfFileName("../my/notes\u0000")).toBe("my notes.pdf");
    expect(sanitizePdfFileName("  ")).toBe("scanned-notes.pdf");
    expect(sanitizePdfFileName("", "lecture")).toBe("lecture.pdf");
  });

  it("bounds the base name", () => {
    expect(sanitizePdfFileName("x".repeat(300)).length).toBeLessThanOrEqual(104);
  });
});

describe("parsePageRanges", () => {
  it("parses a mixed range in the order typed", () => {
    expect(parsePageRanges("1-3, 5", 8)).toEqual({
      ok: true,
      pages: [1, 2, 3, 5],
    });
    expect(parsePageRanges("5, 1-2", 8)).toEqual({
      ok: true,
      pages: [5, 1, 2],
    });
  });

  it("deduplicates repeated pages and accepts en dashes", () => {
    expect(parsePageRanges("1–2, 2, 3", 5)).toEqual({
      ok: true,
      pages: [1, 2, 3],
    });
  });

  it("rejects out-of-bounds and reversed ranges", () => {
    expect(parsePageRanges("1-9", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("9", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("4-2", 5)).toMatchObject({ ok: false });
  });

  it("rejects empty and malformed input", () => {
    expect(parsePageRanges("", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("1-", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("one", 5)).toMatchObject({ ok: false });
    expect(parsePageRanges("1", 0)).toMatchObject({ ok: false });
  });
});

describe("list transitions", () => {
  const pages = ["a", "b", "c"];

  it("moves an item up and down without mutating the source", () => {
    expect(moveListItem(pages, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveListItem(pages, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveListItem(pages, 0, -1)).toEqual(pages);
    expect(moveListItem(pages, 2, 1)).toEqual(pages);
    expect(pages).toEqual(["a", "b", "c"]);
  });

  it("removes one item and leaves out-of-bounds untouched", () => {
    expect(removeListItem(pages, 1)).toEqual(["a", "c"]);
    expect(removeListItem(pages, 9)).toEqual(pages);
  });
});

describe("convertKindOf", () => {
  it("accepts the three supported extensions", () => {
    expect(convertKindOf("notes.docx", null)).toBe("docx");
    expect(convertKindOf("deck.PPTX", null)).toBe("pptx");
    expect(convertKindOf("readme.txt", null)).toBe("txt");
    expect(convertKindOf("photo.png", "image/png")).toBeNull();
  });
});

describe("bytesToBase64", () => {
  it("encodes every byte remainder correctly", () => {
    const encode = (text: string) => bytesToBase64(new TextEncoder().encode(text));
    expect(encode("")).toBe("");
    expect(encode("a")).toBe("YQ==");
    expect(encode("ab")).toBe("YWI=");
    expect(encode("abc")).toBe("YWJj");
    expect(encode("hello world")).toBe("aGVsbG8gd29ybGQ=");
  });
});
