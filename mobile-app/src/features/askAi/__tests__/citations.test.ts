import {
  citationPillLabel,
  citationWhereLabel,
  groupCitations,
} from "../citations";
import type { ChatSource } from "../chatValues";

function source(overrides: Partial<ChatSource> = {}): ChatSource {
  return {
    documentId: "d1",
    documentName: "OS M2.docx",
    page: 2,
    chunkIndex: 0,
    snippet: "The scheduler chooses the next process.",
    ...overrides,
  };
}

describe("groupCitations", () => {
  it("deduplicates an identical chunk", () => {
    const groups = groupCitations([source(), source()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chunkIndexes).toEqual([0]);
    expect(groups[0].snippet).toBe("The scheduler chooses the next process.");
  });

  it("groups different chunks on the same page and keeps every unique excerpt", () => {
    const groups = groupCitations([
      source({ chunkIndex: 0, snippet: "First excerpt." }),
      source({ chunkIndex: 1, snippet: "Second excerpt." }),
      source({ chunkIndex: 1, snippet: "Second excerpt." }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chunkIndexes).toEqual([0, 1]);
    expect(groups[0].snippet).toBe("First excerpt.\n\nSecond excerpt.");
    expect(citationPillLabel(groups[0])).toBe("OS M2.docx • p.2");
  });

  it("keeps different pages as separate citations", () => {
    const groups = groupCitations([
      source({ page: 2, chunkIndex: 0 }),
      source({ page: 3, chunkIndex: 1, snippet: "Page three." }),
    ]);
    expect(groups.map((group) => group.page)).toEqual([2, 3]);
    expect(groups.map(citationWhereLabel)).toEqual(["Page 2", "Page 3"]);
  });

  it("keeps a page-less document's chunks separate", () => {
    const groups = groupCitations([
      source({ page: undefined, chunkIndex: 0 }),
      source({ page: undefined, chunkIndex: 1, snippet: "Second." }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(citationWhereLabel)).toEqual(["Chunk 1", "Chunk 2"]);
    expect(groups.map(citationPillLabel)).toEqual([
      "OS M2.docx • chunk 1",
      "OS M2.docx • chunk 2",
    ]);
  });

  it("returns no groups for no sources or blank excerpts", () => {
    expect(groupCitations([])).toEqual([]);
    const groups = groupCitations([source({ snippet: "   " })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].snippet).toBe("");
  });
});
