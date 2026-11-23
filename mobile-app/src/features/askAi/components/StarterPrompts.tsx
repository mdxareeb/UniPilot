import { View } from "react-native";
import { Sparkles } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { AppButton } from "@/components/ui/AppButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useTheme } from "@/theme/ThemeProvider";
import { starterPromptsFor } from "../starterPrompts";
import type { AskScope } from "../scope";

/** New-thread starters; tapping one sends it as the first question. */
export function StarterPrompts({
  scope,
  disabled,
  onSend,
}: {
  scope: AskScope;
  disabled: boolean;
  onSend: (prompt: string) => void;
}) {
  const theme = useTheme();
  const prompts = starterPromptsFor(scope);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader
        label="Start with"
        trailing={
          <Sparkles size={14} color={theme.colors.mutedForeground} />
        }
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        {prompts.map((prompt) => (
          <AppButton
            key={prompt.id}
            label={prompt.label}
            size="sm"
            variant="secondary"
            disabled={disabled}
            onPress={() => onSend(prompt.prompt)}
            accessibilityLabel={`Ask: ${prompt.prompt}`}
          />
        ))}
      </View>
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        Grounded in the materials inside this scope.
      </AppText>
    </View>
  );
}
