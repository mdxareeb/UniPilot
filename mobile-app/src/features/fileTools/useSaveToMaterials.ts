import { useCallback, useState } from "react";

import {
  fileToolsApi,
  savePdfToMaterials,
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
      mode: "ocr" | "process";
      pages?: OcrPageFile[];
    }) => {
      if (saving) return;
      setSaving(true);
      setResult(null);
      const saved = await savePdfToMaterials(fileToolsApi, {
        ...input,
        subjectId,
      });
      setSaving(false);
      setResult(saved);
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
  };
}
