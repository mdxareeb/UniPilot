import { SquareCheck } from "lucide-react-native";

import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Tasks — the M1 honest state. Task data and creation arrive in a later
 * milestone; nothing is listed or counted here.
 */
export default function TasksScreen() {
  const theme = useTheme();

  return (
    <Screen>
      <PageHeading
        eyebrow="Tasks"
        title="Tasks"
        description="What needs doing, next."
      />
      <MotionEnter index={1}>
        <EmptyState
          icon={<SquareCheck size={24} color={theme.colors.mutedForeground} />}
          title="Nothing to do yet"
          body="Task creation and sync arrive in a later milestone."
          footnote="Not built yet"
        />
      </MotionEnter>
      <MotionEnter index={2}>
        <Notice>This surface is an honest empty state — no tasks are faked.</Notice>
      </MotionEnter>
    </Screen>
  );
}
