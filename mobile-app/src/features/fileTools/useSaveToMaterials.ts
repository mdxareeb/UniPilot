import { useCallback, useState } from "react";

import {
  fileToolsApi,
  saveFileToMaterials,
  type MaterialsMimeType,
  type OcrPageFile,
  type SaveToMaterialsResult,
} from "./fileToolsApi";
import { useSubjects } from "./useSubjects";

/** Shared "Save to Course Materials" sheet state for every tool screen. */
export function useSaveToMaterials() {
  const { subjects, loading, error: subjectsError, reload } = useSubjects();
  const [visible, setVisible] = useState(false);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveToMaterialsResult | null>(null);

  const open = useCallback(() => {
    setResult(null);
    setVisible(true);
    void reload();
  }, [reload]);

  const close = useCallback(() => {
    setVisible(false);
    setResult(null);
  }, []);

  const save = useCallback(
    async (input: {
      bytes: Uint8Array;
      name: string;
      mimeType?: MaterialsMimeType;
      mode: "ocr" | "process";
      pages?: OcrPageFile[];
    }) => {
      if (saving) return;
      setSaving(true);
      setResult(null);
      const saved = await saveFileToMaterials(fileToolsApi, {
        ...input,
        mimeType: input.mimeType ?? "application/pdf",
        subjectId,
      });
      setSaving(false);
      setResult(saved);
    },
    [saving, subjectId],
  );

  /** A caller-owned save pipeline (PDF probe, OCR prep) with sheet state. */
  const saveCustom = useCallback(
    async (
      run: (subjectId: string | null) => Promise<SaveToMaterialsResult>,
    ) => {
      if (saving) return;
      setSaving(true);
      setResult(null);
      try {
        setResult(await run(subjectId));
      } catch (error) {
        setResult({
          status: "error",
          error:
            error instanceof Error && error.message !== ""
              ? error.message
              : "The file couldn't be saved. Try again.",
          documentId: null,
        });
      } finally {
        setSaving(false);
      }
    },
    [saving, subjectId],
  );

  return {
    visible,
    subjects,
    subjectsLoading: loading,
    subjectsError,
    subjectId,
    setSubjectId,
    saving,
    result,
    open,
    close,
    save,
    saveCustom,
  };
}
