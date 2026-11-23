import { formatMessage, parseInline } from "../messageFormatter";

describe("parseInline", () => {
  it("splits bold and inline code without leaving markers", () => {
    expect(parseInline("A **bold** and `code` line.")).toEqual([
      { text: "A ", bold: false, code: false },
      { text: "bold", bold: true, code: false },
      { text: " and ", bold: false, code: false },
      { text: "code", bold: false, code: true },
      { text: " line.", bold: false, code: false },
    ]);
  });

  it("keeps unmatched markers literal", () => {
    expect(parseInline("an **open marker and `open code")).toEqual([
      { text: "an **open marker and `open code", bold: false, code: false },
    ]);
  });

  it("merges adjacent spans with the same style", () => {
    expect(parseInline("**a****b**")).toEqual([
      { text: "ab", bold: true, code: false },
    ]);
  });
});

describe("formatMessage", () => {
  it("keeps paragraphs separate and preserves internal line breaks", () => {
    expect(formatMessage("First line\nsecond line.\n\nSecond paragraph.")).toEqual([
      {
        type: "paragraph",
        spans: [
          {
            text: "First line\nsecond line.",
            bold: false,
            code: false,
          },
        ],
      },
      {
        type: "paragraph",
        spans: [
          {
            text: "Second paragraph.",
            bold: false,
            code: false,
          },
        ],
      },
    ]);
  });

  it("groups consecutive bullets into one list", () => {
    expect(formatMessage("- one\n* two\n• three")).toEqual([
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          [{ text: "one", bold: false, code: false }],
          [{ text: "two", bold: false, code: false }],
          [{ text: "three", bold: false, code: false }],
        ],
      },
    ]);
  });

  it("keeps numbered list numbering and inline formatting", () => {
    const blocks = formatMessage("3. **Third** step\n4) `code` step");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [{ text: "Third", bold: true, code: false }, { text: " step", bold: false, code: false }],
          [{ text: "code", bold: false, code: true }, { text: " step", bold: false, code: false }],
        ],
      },
    ]);
  });

  it("captures fenced code verbatim and does not format inside it", () => {
    expect(formatMessage("```ts\nconst x = **not bold**;\n```")).toEqual([
      {
        type: "code",
        language: "ts",
        text: "const x = **not bold**;",
      },
    ]);
  });

  it("shows an unclosed fence as code rather than swallowing it", () => {
    expect(formatMessage("Intro\n```\nstill code")).toEqual([
      {
        type: "paragraph",
        spans: [{ text: "Intro", bold: false, code: false }],
      },
      { type: "code", language: null, text: "still code" },
    ]);
  });

  it("separates a list from surrounding paragraphs", () => {
    const blocks = formatMessage("Lead in.\n- a\n- b\nClose out.");
    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "list",
      "paragraph",
    ]);
  });

  it("returns no blocks for blank text", () => {
    expect(formatMessage("  \n\n ")).toEqual([]);
  });
});
