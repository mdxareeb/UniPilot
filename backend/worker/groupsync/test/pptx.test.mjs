import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractPptx, PptxUnreadableError, slideXmlToText } from "../../extract/pptx.mjs";

const slide = (...paragraphs) =>
  `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${paragraphs
    .map((runs) => `<a:p>${runs.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join("")}</a:p>`)
    .join("")}</p:spTree></p:cSld></p:sld>`;

function deck(parts) {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
}

describe("slideXmlToText", () => {
  it("joins runs within a paragraph and puts paragraphs on lines", () => {
    assert.equal(
      slideXmlToText(slide(["Midterm ", "syllabus"], ["Chapters 1-4"])),
      "Midterm syllabus\nChapters 1-4",
    );
  });

  it("decodes XML entities", () => {
    assert.equal(slideXmlToText(slide(["Q&amp;A &lt;draft&gt; &#169; &#x41;"])), "Q&A <draft> © A");
  });

  it("ignores empty paragraphs and attributes on runs", () => {
    assert.equal(
      slideXmlToText('<a:p><a:r><a:t xml:space="preserve"> hi </a:t></a:r></a:p><a:p></a:p>'),
      "hi",
    );
  });
});

describe("extractPptx", () => {
  it("returns one string per slide in slide order, not archive order", async () => {
    const file = deck({
      "ppt/slides/slide10.xml": slide(["ten"]),
      "ppt/slides/slide2.xml": slide(["two"]),
      "ppt/slides/slide1.xml": slide(["one"]),
      "[Content_Types].xml": "<Types/>",
      "ppt/media/image1.png": "not text",
    });
    const result = await extractPptx(file);
    assert.deepEqual(result.pages, ["one", "two", "ten"]);
    assert.equal(result.pageCount, 3);
  });

  it("appends speaker notes to their slide", async () => {
    const file = deck({
      "ppt/slides/slide1.xml": slide(["Exam on Friday"]),
      "ppt/notesSlides/notesSlide1.xml": slide(["Remind them: bring ID"]),
    });
    const result = await extractPptx(file);
    assert.equal(result.pages[0], "Exam on Friday\n[notes] Remind them: bring ID");
  });

  it("rejects something that is not a zip", async () => {
    await assert.rejects(extractPptx(Buffer.from("not a zip at all")), PptxUnreadableError);
  });

  it("rejects an archive with no slides", async () => {
    await assert.rejects(extractPptx(deck({ "readme.txt": "hi" })), /No slides/);
  });

  it("rejects an oversized part before inflating it", async () => {
    const big = "x".repeat(8 * 1024 * 1024 + 1);
    await assert.rejects(extractPptx(deck({ "ppt/slides/slide1.xml": big })), /unreasonably large/);
  });
});
