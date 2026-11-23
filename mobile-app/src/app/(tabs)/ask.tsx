import { View } from "react-native";
import { Sparkles } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/ui/Card";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Ask AI's Phase 1 shell. The tab exists in the final 5-tab order, but the
 * grounded chat client arrives with the chat phase. Nothing is faked: the
 * screen says exactly what is live and what is next.
 */
export default function AskScreen() {
  const theme = useTheme();

  return (
    <Screen>
      <PageHeading
        eyebrow="Study"
        title="Ask AI"
        description="Questions answered from your own course materials."
      />

      <MotionEnter index={1}>
        <Notice>
          The study assistant is being connected in the next phase. Your
          indexed materials are already waiting for it.
        </Notice>
      </MotionEnter>

      <MotionEnter index={2}>
        <Card>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <EmptyState
              icon={<Sparkles size={24} color={theme.colors.mutedForeground} />}
              title="Grounded study chat"
              body="Soon you will scope a question to all materials, a subject or one document, then open the exact source behind every answer."
              footnote="Citations, thread history and starter prompts are part of the same surface."
            />
          </View>
        </Card>
      </MotionEnter>

      <MotionEnter index={3} style={{ gap: theme.spacing.sm }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          What it will use
        </AppText>
        <Card>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <AppText variant="bodyMd">Course materials</AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              PDFs and documents already indexed for search.
            </AppText>
            <AppText variant="bodyMd">Subject and document scope</AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Answers stay inside the material you choose.
            </AppText>
            <AppText variant="bodyMd">Source citations</AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Every answer names the document, page and chunk it used.
            </AppText>
          </View>
        </Card>
      </MotionEnter>
    </Screen>
  );
}
