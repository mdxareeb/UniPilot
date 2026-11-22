import { useCallback, useMemo } from "react";
import { SquareCheck } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { sortTasks } from "@/features/agenda/agenda";
import { TaskList } from "@/features/agenda/AgendaLists";
import { fetchTasks } from "@/features/agenda/queries";
import { useLoad } from "@/features/agenda/useLoad";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Tasks: a read-only list of the student's own tasks (open first, soonest due
 * first) with the course and a "From WhatsApp" marker where a task was picked
 * up from a group. Creating, editing and completing tasks arrive later.
 */
export default function TasksScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const { rows, error, loading, reload } = useLoad(
    useCallback(() => fetchTasks(), []),
  );
  const tasks = useMemo(
    () => (rows === null ? null : sortTasks(rows, timeZone)),
    [rows, timeZone],
  );

  return (
    <Screen>
      <PageHeading
        eyebrow="Tasks"
        title="Tasks"
        description="What needs doing, next."
      />
      {error !== null ? (
        <MotionEnter index={1}>
          <Notice tone="error">{error}</Notice>
          <Button
            label="Try again"
            variant="outline"
            onPress={() => void reload()}
            style={{ alignSelf: "stretch", marginTop: theme.spacing.sm }}
          />
        </MotionEnter>
      ) : null}
      {tasks === null ? (
        error === null ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Loading…
          </AppText>
        ) : null
      ) : tasks.length === 0 ? (
        <MotionEnter index={1}>
          <EmptyState
            icon={<SquareCheck size={24} color={theme.colors.mutedForeground} />}
            title="Nothing to do yet"
            body="Deadlines picked up from your WhatsApp groups show up here once you link them in More."
          />
        </MotionEnter>
      ) : (
        <MotionEnter index={1}>
          <TaskList tasks={tasks} />
        </MotionEnter>
      )}
      {tasks !== null && tasks.length > 0 ? (
        <Button
          label={loading ? "Refreshing…" : "Refresh"}
          variant="ghost"
          disabled={loading}
          onPress={() => void reload()}
          style={{ alignSelf: "center" }}
        />
      ) : null}
    </Screen>
  );
}
