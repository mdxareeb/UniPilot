"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { WhatsAppCandidateItem } from "@/lib/data/integrationValues";

/**
 * The dismiss confirmation (P5.1): rejection is terminal, so it goes through
 * the shared `Modal` with destructive copy. `candidate` is the row awaiting
 * confirmation; `null` closes. The dialog's accessible name is the fixed
 * question and the candidate it names travels in the description.
 */
export function RejectCandidateModal({
  candidate,
  busy,
  onOpenChange,
  onConfirm,
}: {
  candidate: WhatsAppCandidateItem | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={candidate !== null}
      onOpenChange={onOpenChange}
      title="Dismiss this event?"
      description={
        candidate ? `${candidate.title} — ${candidate.dateLabel}` : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-muted-foreground">
          Dismissed events don&apos;t come back on re-scan. You can still create
          it manually from the calendar.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Keep event
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            Dismiss event
          </Button>
        </div>
      </div>
    </Modal>
  );
}
