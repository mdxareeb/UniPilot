import type { AssistantSource } from "@/lib/data/assistantValues";

/**
 * Task 19.11 — the workspace chunks one assistant turn cited. Shared by the
 * `/assistant` conversation and the 19.16 launcher panel.
 *
 * The contract is the stored one (`AssistantSource`, 26.7): a document name, an
 * optional page and the chunk index. The page and the chunk index are
 * provenance metadata, so they wear the mono role (`font-mono text-label-sm`),
 * the same division the sidebar and the bubbles already use; the document name
 * is the content of the row and stays in the body voice.
 *
 * Rendering rules:
 * - an empty (or absent) list renders nothing at all — no "0 sources" chrome,
 *   because "no sources" is the absence of a citation, not a citation;
 * - the list is printed exactly as delivered/persisted, in order, never
 *   re-ranked here;
 * - `page` appears only when the stored source carries one — a document whose
 *   chunks have no pages must not be given a guessed page number;
 * - `data-assistant-sources` / `data-assistant-source` are the test markers
 *   the UI spec asserts (streaming and stored bubbles share this component).
 *
 * Used by both halves of the conversation: the stored assistant bubble
 * (`MessageBubble`) and the live streaming turn (`AssistantBubble`).
 */
export function SourceReferences({
  sources,
}: {
  /** The cited sources; an empty/absent list renders nothing. */
  sources?: AssistantSource[];
}) {
  if (sources === undefined || sources.length === 0) return null;

  return (
    <div
      data-assistant-sources=""
      className="flex min-w-0 flex-col gap-1.5 rounded-base border border-border bg-card px-3 py-2"
    >
      <p className="font-mono text-label-caps uppercase text-muted-foreground">
        Sources
      </p>
      <ul className="flex min-w-0 list-none flex-col gap-1">
        {sources.map((source) => (
          <li
            key={`${source.documentId}:${source.chunkIndex}`}
            data-assistant-source=""
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
          >
            <span className="min-w-0 max-w-full truncate text-label-sm text-foreground">
              {source.documentName}
            </span>
            {source.page !== undefined ? (
              <span
                data-assistant-source-page=""
                className="font-mono text-label-sm text-muted-foreground"
              >
                p. {source.page}
              </span>
            ) : null}
            <span
              data-assistant-source-chunk=""
              className="font-mono text-label-sm text-muted-foreground"
            >
              chunk {source.chunkIndex}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
