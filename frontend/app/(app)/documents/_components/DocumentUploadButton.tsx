"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDocuments } from "./DocumentsWorkspace";

/**
 * The header's "Upload document" trigger (18.4): pressing it opens the
 * workspace's file picker. The trigger is only a trigger — the picker, the
 * reserve→upload→finalize pipeline, the progress state and the error copy all
 * live in `DocumentsWorkspace`, shared with the hub's drop target so the two
 * entry points can never drift apart.
 */
export function DocumentUploadButton() {
  const { openPicker } = useDocuments();

  return (
    <Button size="sm" onClick={openPicker}>
      <Upload aria-hidden="true" className="size-4" />
      Upload document
    </Button>
  );
}
