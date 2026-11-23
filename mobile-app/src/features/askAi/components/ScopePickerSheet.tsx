import { View } from "react-native";
import { BookOpen, FileText } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { ListRow } from "@/components/ListRow";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { useTheme } from "@/theme/ThemeProvider";
import type { AskScope, ScopeDocument, ScopeSubject } from "../scope";

export type ScopePickerKind = "subject" | "document";

/** The subject/document picker. Choosing a row starts a fresh scoped chat. */
export function ScopePickerSheet({
  visible,
  kind,
  onClose,
  subjects,
  documents,
  activeId,
  onSelect,
}: {
  visible: boolean;
  kind: ScopePickerKind;
  onClose: () => void;
  subjects: readonly ScopeSubject[];
  documents: readonly ScopeDocument[];
  activeId: string | null;
  onSelect: (scope: AskScope) => void;
}) {
  const theme = useTheme();
  const isSubject = kind === "subject";
  const options = isSubject ? subjects : documents;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={isSubject ? "Ask within a subject" : "Ask within one document"}
      subtitle={
        isSubject
          ? "Answers stay inside that course's materials"
          : "Only indexed documents can ground an answer"
      }
    >
      {options.length === 0 ? (
        <View
          style={{
            alignItems: "center",
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.xl,
          }}
        >
          {isSubject ? (
            <BookOpen size={24} color={theme.colors.mutedForeground} />
          ) : (
            <FileText size={24} color={theme.colors.mutedForeground} />
          )}
          <AppText
            variant="bodyMd"
            color={theme.colors.mutedForeground}
            style={{ textAlign: "center" }}
          >
            {isSubject
              ? "No subjects yet. Add your courses during setup or in More."
              : "No indexed documents yet. Upload or sync a course file first."}
          </AppText>
        </View>
      ) : (
        <Card elevation="flush">
          {options.map((option, index) => (
            <View key={option.id}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={option.name}
                value={activeId === option.id ? "Selected" : undefined}
                showChevron={activeId !== option.id}
                onPress={() => {
                  onSelect(
                    isSubject
                      ? { kind: "subject", id: option.id, name: option.name }
                      : { kind: "document", id: option.id, name: option.name },
                  );
                  onClose();
                }}
              />
            </View>
          ))}
        </Card>
      )}
    </BottomSheet>
  );
}
