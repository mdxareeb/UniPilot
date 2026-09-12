import { FileText } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * One recent document, display-ready end to end (15.5 §4). No query supplies
 * these — no storage bucket, no documents table, no processing pipeline — so
 * nothing renders rows today and the shape is the whole of this task's data
 * work.
 *
 * Every field is a string the future document service formats: `updatedAt`
 * ("2h ago"), `size` ("1.2 MB") and `type` ("PDF") are display text, not
 * timestamps, bytes or enums the card has to interpret. The service owns
 * formatting for the same reason `dashboardDate` does — the card is a
 * presentational surface and never decides a timezone or a unit.
 *
 * `status` is the four states the processing pipeline (Phase 18) is planned to
 * produce. They arrive as text today's UI can show without a backend: a row
 * being uploaded or parsed is a fact the pipeline reported, not one this card
 * simulated.
 */
export type DashboardDocument = {
  /** Stable key for list identity. */
  id: string;
  /** Display-ready file name. */
  name: string;
  /** Display-ready file type, e.g. "PDF". */
  type: string;
  /** Display-ready relative or readable time, e.g. "2h ago". */
  updatedAt: string;
  /** The pipeline's state for this document. */
  status: "uploading" | "parsing" | "indexed" | "failed";
  /** Display-ready size, e.g. "1.2 MB". */
  size?: string;
};

type RecentDocumentsCardProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** Real documents, newest first. Empty renders the intentional empty state. */
  documents?: readonly DashboardDocument[];
  guest?: boolean;
};

/**
 * The recent-documents summary (Task 15.5): the student's latest materials as
 * a compact list — a summary of the documents hub, never a second copy of it.
 *
 * Two states, one structure: an eyebrow ("Documents"), a title ("Your recent
 * documents"), then either the rows a future document service sends or the
 * intentional empty state, then one trailing action to the real `/documents`
 * route. The empty state is the honest one today — there is no storage to
 * read, so it says what will fill the card rather than inventing a filename.
 *
 * A row is icon, name, and one line of mono metadata — type, status, and time
 * in label-caps, the same metadata slot every other card uses. Status is text,
 * never a coloured badge: "Indexed" in Geist Mono says the state as plainly as
 * the pipeline will report it, and a monochrome treatment keeps four states
 * from turning the dashboard into a traffic light. Rows carry no per-document
 * link yet — the documents hub (18.x) does not have a document view to link
 * to, and a row that goes nowhere is a lie; "View all documents" below the
 * list is the one destination that exists.
 *
 * Long names wrap rather than push: `wrap-anywhere` on the name, the same
 * guard the greeting uses for unbounded OAuth names. The metadata line sits
 * under the name, not beside it, so a long name never crowds its own status.
 *
 * Motion (15.5 §12): the section arrives from the left — the one full-width
 * section with a directional entrance, which is what a list surface reads as:
 * rows continue left to right, so the card assembles from the same edge its
 * content will. Distinct from every other section on the page: the primary
 * card and deadlines arrive with `scale`, the week and workload rise, the
 * stats strip assembles from its ends. Future rows are `MotionListItem`
 * inside `AnimatePresence` — the primitive exists for exactly this gain/lose
 * list — and the `ul`/`li` structure with `id` keys is kept so that migration
 * is mechanical, not a rewrite. No fake dynamic behaviour is built to
 * demonstrate it: animation never determines whether content exists, and today
 * the empty state is the truth.
 *
 * `hover-lift` is on the `Card`, the entrance on the wrapper — the same
 * layering every other dashboard card uses, because the entrance's fill mode
 * would otherwise pin `transform: none` and cancel the lift for good.
 */
export function RecentDocumentsCard({
  index,
  documents,
  guest = false,
}: RecentDocumentsCardProps) {
  const hasDocuments = Boolean(documents && documents.length > 0);
  const documentsHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/documents")}`
    : "/documents";

  return (
    <div data-enter="left" style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
      >
        <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
          <FileText aria-hidden="true" className="size-3.5 shrink-0" />
          Documents
        </span>
        <h3 className="text-body-lg font-semibold text-foreground">
          Your recent documents
        </h3>

        {hasDocuments && documents ? (
          /* The row path a future document service fills in. `id` keys keep
             list identity stable for the MotionListItem migration. */
          <ul className="flex min-w-0 flex-col gap-2.5 pt-1">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex min-w-0 flex-col gap-0.5"
              >
                <span className="wrap-anywhere text-label-sm font-medium text-foreground">
                  {document.name}
                </span>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-label-caps text-muted-foreground">
                  <span className="shrink-0 uppercase">{document.type}</span>
                  <span className="shrink-0 uppercase">{document.status}</span>
                  <span className="shrink-0 uppercase">{document.updatedAt}</span>
                  {document.size ? (
                    <span className="shrink-0 uppercase">{document.size}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            No documents yet. Your uploaded materials will appear here.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2.5 pt-3">
          <Divider />
          <WorkspaceAction href={documentsHref}>
            View all documents
          </WorkspaceAction>
        </div>
      </Card>
    </div>
  );
}
