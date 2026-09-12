"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDocumentsUpload } from "./DocumentsUploadProvider";

/**
 * The header's "Upload document" trigger (23.2): pressing it opens the
 * provider's file picker. The trigger is only a trigger — the picker, the
 * reserve→upload→finalize pipeline, the progress state and the error copy all
 * live in `DocumentsUploadProvider`, shared with the drop target so the two
 * entry points can never drift apart.
 */
export function DocumentUploadButton() {
  const { openPicker } = useDocumentsUpload();

  return (
    <Button size="sm" onClick={openPicker}>
      <Upload aria-hidden="true" className="size-4" />
      Upload document
    </Button>
  );
}
