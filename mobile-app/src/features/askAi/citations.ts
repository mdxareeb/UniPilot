/**
 * Citation grouping for Ask AI.
 *
 * The server returns one source per retrieved chunk. The thread shows compact
 * pills, so chunks on one page collapse into a single citation; documents
 * without pages keep one pill per chunk (there is no section to group by).
 * Duplicate chunk rows and repeated snippets are removed before rendering.
 */
import type { ChatSource } from "./chatValues";

export type CitationGroup = {
  key: string;
  documentId: string;
  documentName: string;
  page: number | null;
  chunkIndexes: number[];
  snippet: string;
};

function keyFor(source: ChatSource): string {
  return source.page === undefined
    ? `${source.documentId}:chunk:${source.chunkIndex}`
    : `${source.documentId}:page:${source.page}`;
}

/** Group by document + page; dedupe identical chunks and snippets. */
export function groupCitations(
  sources: readonly ChatSource[],
): CitationGroup[] {
  const groups = new Map<
    string,
    Omit<CitationGroup, "snippet"> & { snippets: string[]; seenChunks: Set<number> }
  >();

  for (const source of sources) {
    const key = keyFor(source);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        documentId: source.documentId,
        documentName: source.documentName,
        page: source.page ?? null,
        chunkIndexes: [],
        snippets: [],
        seenChunks: new Set<number>(),
      };
      groups.set(key, group);
    }

    if (!group.seenChunks.has(source.chunkIndex)) {
      group.seenChunks.add(source.chunkIndex);
      group.chunkIndexes.push(source.chunkIndex);
    }
    const snippet = source.snippet.trim();
    if (snippet !== "" && !group.snippets.includes(snippet)) {
      group.snippets.push(snippet);
    }
  }

  return [...groups.values()].map((group) => ({
    key: group.key,
    documentId: group.documentId,
    documentName: group.documentName,
    page: group.page,
    chunkIndexes: group.chunkIndexes,
    snippet: group.snippets.join("\n\n"),
  }));
}

function where(group: CitationGroup): string {
  if (group.page !== null) return `p.${group.page}`;
  const first = group.chunkIndexes[0] ?? 0;
  return `chunk ${first + 1}`;
}

/** The compact pill label, e.g. `OS M2.docx • p.2`. */
export function citationPillLabel(group: CitationGroup): string {
  return `${group.documentName} • ${where(group)}`;
}

/** The sheet's location label, e.g. `Page 2` / `Chunk 3`. */
export function citationWhereLabel(group: CitationGroup): string {
  if (group.page !== null) return `Page ${group.page}`;
  const first = group.chunkIndexes[0] ?? 0;
  return `Chunk ${first + 1}`;
}
