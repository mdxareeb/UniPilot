import { ScrollView } from "react-native";
import { BookOpen, FileText, Layers } from "lucide-react-native";

import { FilterChip } from "@/components/ui/FilterChip";
import { useTheme } from "@/theme/ThemeProvider";
import { scopeChipLabel, type AskScope } from "../scope";

type ScopeKind = AskScope["kind"];

/** The compact top scope bar: All Materials · Subject · Document. */
export function ScopeBar({
  scope,
  onChoose,
  disabled,
}: {
  scope: AskScope;
  onChoose: (kind: ScopeKind) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const activeColor = theme.colors.onPrimary;
  const idleColor = theme.colors.mutedForeground;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: theme.spacing.sm }}
    >
      <FilterChip
        label="All Materials"
        active={scope.kind === "all"}
        onPress={() => onChoose("all")}
        disabled={disabled}
        accessibilityLabel="Ask across all materials"
        leading={
          <Layers
            size={14}
            color={scope.kind === "all" ? activeColor : idleColor}
          />
        }
      />
      <FilterChip
        label={scope.kind === "subject" ? scopeChipLabel(scope) : "Subject"}
        active={scope.kind === "subject"}
        onPress={() => onChoose("subject")}
        disabled={disabled}
        accessibilityLabel="Ask within a subject"
        leading={
          <BookOpen
            size={14}
            color={scope.kind === "subject" ? activeColor : idleColor}
          />
        }
      />
      <FilterChip
        label={scope.kind === "document" ? scopeChipLabel(scope) : "Document"}
        active={scope.kind === "document"}
        onPress={() => onChoose("document")}
        disabled={disabled}
        accessibilityLabel="Ask within one document"
        leading={
          <FileText
            size={14}
            color={scope.kind === "document" ? activeColor : idleColor}
          />
        }
      />
    </ScrollView>
  );
}
