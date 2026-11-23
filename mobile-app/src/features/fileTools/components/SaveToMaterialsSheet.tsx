import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { ListRow } from "@/components/ListRow";
import { Notice } from "@/components/Notice";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { useTheme } from "@/theme/ThemeProvider";
import type { SaveToMaterialsResult } from "../fileToolsApi";
import type { SubjectOption } from "../useSubjects";

/** The optional course picker and the honest indexing outcome. */
export function SaveToMaterialsSheet({
  visible,
  onClose,
  subjects,
  loading,
  subjectsError,
  selectedSubjectId,
  onSelectSubject,
  saving,
  result,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  subjects: readonly SubjectOption[];
  loading: boolean;
  subjectsError: string | null;
  selectedSubjectId: string | null;
  onSelectSubject: (id: string | null) => void;
  saving: boolean;
  result: SaveToMaterialsResult | null;
  onSave: () => void;
}) {
  const theme = useTheme();
  const completed =
    result !== null &&
    (result.status === "indexed" ||
      result.status === "indexing" ||
      result.status === "saved_not_searchable");

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Save to Course Materials"
      subtitle="Optional course, stored in your indexed library"
    >
      {completed && result !== null ? (
        <View style={{ gap: theme.spacing.md }}>
          <Notice tone={result.status === "saved_not_searchable" ? "error" : "info"}>
            {result.status === "indexed"
              ? "Saved and indexed. Ask AI can cite this file now."
              : result.status === "indexing"
                ? "Saved. The worker is indexing it; Ask AI will pick it up shortly."
                : result.error ?? "Saved, but it isn't searchable yet."}
          </Notice>
          <AppButton
            label="Done"
            variant="primary"
            onPress={onClose}
            fullWidth
          />
        </View>
      ) : (
        <>
          {result?.status === "error" ? (
            <Notice tone="error">
              {result.error ?? "The file couldn't be saved. Try again."}
            </Notice>
          ) : null}
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            The file is stored privately in your Course Materials. A course is
            optional; you can sort it later.
          </AppText>

          {subjectsError !== null ? (
            <Notice tone="error">{subjectsError}</Notice>
          ) : null}

          <Card elevation="flush">
            <ListRow
              title="No subject"
              subtitle="Leave it unfiled"
              value={selectedSubjectId === null ? "Selected" : undefined}
              showChevron={selectedSubjectId !== null}
              disabled={saving}
              onPress={() => onSelectSubject(null)}
            />
            {subjects.map((subject) => (
              <View key={subject.id}>
                <Divider />
                <ListRow
                  title={subject.name}
                  value={
                    selectedSubjectId === subject.id ? "Selected" : undefined
                  }
                  showChevron={selectedSubjectId !== subject.id}
                  disabled={saving}
                  onPress={() => onSelectSubject(subject.id)}
                />
              </View>
            ))}
          </Card>

          {loading ? (
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Loading courses…
            </AppText>
          ) : null}

          {result !== null && result.status === "error" ? (
            <Notice tone="error">{result.error ?? "The PDF wasn't saved."}</Notice>
          ) : null}

          <AppButton
            label={saving ? "Saving…" : "Save PDF"}
            variant="primary"
            loading={saving}
            disabled={saving}
            onPress={onSave}
            fullWidth
          />
        </>
      )}
    </BottomSheet>
  );
}
