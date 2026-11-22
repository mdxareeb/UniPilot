import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Check, ChevronRight, SquareCheck } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { SubjectTag } from "@/components/SubjectTag";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { sortTasks, type TaskListItem } from "@/features/agenda/agenda";
import { fetchTasks } from "@/features/agenda/queries";
import { useLoad } from "@/features/agenda/useLoad";
import { DetailSheet } from "@/features/details/DetailSheet";
import { setTaskDone } from "@/features/tasks/actions";
import {
  filterTasks,
  pendingLabel,
  subjectOptions,
  TASK_FILTERS,
  type TaskStatusFilter,
} from "@/features/tasks/tasksView";
import { useReviewQueue } from "@/features/tasks/useReviewQueue";
import { ReviewCard } from "@/features/whatsappGroups/ReviewCard";
import { confirmFeedback } from "@/lib/haptics";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/** Tasks: a scannable academic to-do list with review triage and provenance. */
export default function TasksScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const { rows, error, loading, reload } = useLoad(
    useCallback(() => fetchTasks(), []),
  );
  const review = useReviewQueue();
  const [status, setStatus] = useState<TaskStatusFilter>("upcoming");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskListItem | null>(null);
  const [doneOverrides, setDoneOverrides] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const tasks = useMemo(() => {
    if (rows === null) return null;
    const withOverrides = rows.map((row) =>
      doneOverrides[row.id] === undefined
        ? row
        : { ...row, status: doneOverrides[row.id] ? "done" : "todo" },
    );
    return sortTasks(withOverrides, timeZone);
  }, [doneOverrides, rows, timeZone]);

  const subjects = useMemo(
    () => (tasks === null ? [] : subjectOptions(tasks)),
    [tasks],
  );
  const visible = useMemo(
    () => (tasks === null ? null : filterTasks(tasks, status, subjectId)),
    [status, subjectId, tasks],
  );

  const toggle = useCallback(async (item: TaskListItem) => {
    const next = !item.done;
    setActionError(null);
    setDoneOverrides((previous) => ({ ...previous, [item.id]: next }));
    const result = await setTaskDone(item.id, next);
    if (result.error !== null) {
      setDoneOverrides((previous) => {
        const copy = { ...previous };
        delete copy[item.id];
        return copy;
      });
      setActionError(result.error);
      return;
    }
    confirmFeedback();
  }, []);

  const emptyCopy: Record<Exclude<TaskStatusFilter, "review">, string> = {
    upcoming: "Nothing to do yet. Deadlines from WhatsApp show up here.",
    today: "Nothing is due today.",
    completed: "Nothing completed yet.",
  };

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
          <AppButton
            label="Try again"
            variant="secondary"
            fullWidth
            onPress={() => void reload()}
            style={{ marginTop: theme.spacing.sm }}
          />
        </MotionEnter>
      ) : null}

      {review.count > 0 && status !== "review" ? (
        <MotionEnter index={1}>
          <Pressable
            onPress={() => setStatus("review")}
            accessibilityRole="button"
            accessibilityLabel={pendingLabel(review.count) ?? "Review suggestions"}
          >
            <Card>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing.md,
                  padding: theme.spacing.lg,
                }}
              >
                <StatusPill
                  label={`${review.count} pending`}
                  tone="warning"
                  dot
                />
                <AppText variant="bodyMd" style={{ flex: 1 }}>
                  {pendingLabel(review.count)}
                </AppText>
                <ChevronRight size={18} color={theme.colors.mutedForeground} />
              </View>
            </Card>
          </Pressable>
        </MotionEnter>
      ) : null}

      <MotionEnter index={2} style={{ gap: theme.spacing.sm }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: theme.spacing.sm }}
        >
          {TASK_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              label={
                filter.id === "review" && review.count > 0
                  ? `${filter.label} · ${review.count}`
                  : filter.label
              }
              active={status === filter.id}
              onPress={() => setStatus(filter.id)}
            />
          ))}
        </ScrollView>

        {status !== "review" && subjects.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            <FilterChip
              label="All subjects"
              active={subjectId === null}
              onPress={() => setSubjectId(null)}
            />
            {subjects.map((subject) => (
              <FilterChip
                key={subject.id}
                label={`${subject.name} · ${subject.count}`}
                active={subjectId === subject.id}
                onPress={() => setSubjectId(subject.id)}
                accessibilityLabel={`Filter by ${subject.name}`}
                leading={
                  subject.colorTag !== null ? (
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor:
                          subjectId === subject.id
                            ? theme.colors.onPrimary
                            : theme.colors.mutedForeground,
                      }}
                    />
                  ) : null
                }
              />
            ))}
          </ScrollView>
        ) : null}
      </MotionEnter>

      {actionError !== null ? <Notice tone="error">{actionError}</Notice> : null}

      {status === "review" ? (
        <MotionEnter index={3}>
          {review.error !== null ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Notice tone="error">{review.error}</Notice>
              <AppButton
                label="Try again"
                variant="secondary"
                fullWidth
                onPress={() => void review.refresh()}
              />
            </View>
          ) : (
            <ReviewCard
              items={review.items ?? []}
              onDecide={async (id, decision) => {
                const outcome = await review.decide(id, decision);
                if (decision === "confirm") await reload();
                return outcome;
              }}
            />
          )}
        </MotionEnter>
      ) : tasks === null ? (
        error === null ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Loading…
          </AppText>
        ) : null
      ) : visible !== null && visible.length === 0 ? (
        <MotionEnter index={3}>
          <EmptyState
            icon={<SquareCheck size={24} color={theme.colors.mutedForeground} />}
            title="Nothing here"
            body={
              subjectId !== null
                ? "No tasks in this course."
                : emptyCopy[status as Exclude<TaskStatusFilter, "review">]
            }
          />
        </MotionEnter>
      ) : (
        <MotionEnter index={3}>
          <View style={{ gap: theme.spacing.md }}>
            {(visible ?? []).map((item) => {
              const tone: StatusTone =
                item.dueState === "overdue"
                  ? "danger"
                  : item.dueState === "today" || item.dueState === "soon"
                    ? "warning"
                    : "outline";
              return (
                <Card key={item.id} elevation="raised">
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: theme.spacing.md,
                      padding: theme.spacing.lg,
                    }}
                  >
                    <Pressable
                      onPress={() => void toggle(item)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.done }}
                      accessibilityLabel={`Mark ${item.title} ${
                        item.done ? "not done" : "done"
                      }`}
                      hitSlop={8}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        borderWidth: 1.5,
                        borderColor: item.done
                          ? theme.colors.primary
                          : theme.colors.border,
                        backgroundColor: item.done
                          ? theme.colors.primary
                          : "transparent",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                      }}
                    >
                      {item.done ? (
                        <Check size={16} color={theme.colors.onPrimary} />
                      ) : null}
                    </Pressable>

                    <Pressable
                      onPress={() => setDetail(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}. Open details`}
                      style={{ flex: 1, gap: theme.spacing.xs }}
                    >
                      <AppText
                        variant="bodyMd"
                        color={item.done ? theme.colors.mutedForeground : undefined}
                        style={
                          item.done
                            ? { textDecorationLine: "line-through" }
                            : undefined
                        }
                      >
                        {item.title}
                      </AppText>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: theme.spacing.sm,
                          alignItems: "center",
                        }}
                      >
                        <SubjectTag
                          name={item.subjectName}
                          colorTag={item.subjectColorTag}
                        />
                        {item.typeLabel !== null ? (
                          <Badge>{item.typeLabel}</Badge>
                        ) : null}
                        {item.fromWhatsApp ? (
                          <Badge>WhatsApp</Badge>
                        ) : null}
                      </View>
                      {item.description !== null ? (
                        <AppText
                          variant="mono"
                          color={theme.colors.mutedForeground}
                          numberOfLines={2}
                        >
                          {item.description}
                        </AppText>
                      ) : null}
                    </Pressable>

                    <View style={{ alignItems: "flex-end", gap: theme.spacing.xs }}>
                      {item.dueBadge !== null && !item.done ? (
                        <StatusPill label={item.dueBadge} tone={tone} />
                      ) : null}
                      <AppText variant="mono" color={theme.colors.mutedForeground}>
                        {item.done
                          ? "Done"
                          : item.dueIso === null
                            ? "No date"
                            : item.dueState === "today" ||
                                item.dueState === "soon" ||
                                item.dueState === "overdue"
                              ? item.dueTimestampLabel?.split(" · ")[1] ?? "Due"
                              : item.dueLabel ?? "Due"}
                      </AppText>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </MotionEnter>
      )}

      {tasks !== null && tasks.length > 0 && status !== "review" ? (
        <AppButton
          label={loading ? "Refreshing…" : "Refresh"}
          variant="ghost"
          onPress={() => void reload()}
          loading={loading}
          style={{ alignSelf: "center" }}
        />
      ) : null}

      <DetailSheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.title ?? ""}
        kindLabel={detail?.typeLabel ?? "Task"}
        kindTone={detail?.done ? "solid" : "outline"}
        subjectName={detail?.subjectName ?? null}
        subjectColorTag={detail?.subjectColorTag ?? null}
        description={detail?.description ?? null}
        confidence={detail?.confidence ?? null}
        sourceMessageId={detail?.sourceMessageId ?? null}
        meta={
          detail === null
            ? []
            : [
                { label: "Due", value: detail.dueTimestampLabel ?? "No due date" },
                { label: "Status", value: detail.statusLabel },
                {
                  label: "Source",
                  value: detail.fromWhatsApp ? "WhatsApp group" : "Manual",
                },
              ]
        }
      />
    </Screen>
  );
}
