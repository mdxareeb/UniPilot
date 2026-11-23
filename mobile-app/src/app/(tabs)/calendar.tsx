import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { SubjectTag } from "@/components/SubjectTag";
import { AppButton } from "@/components/ui/AppButton";
import { Card } from "@/components/ui/Card";
import { FilterChip } from "@/components/ui/FilterChip";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { dayKeyOf } from "@/features/agenda/agenda";
import { fetchEvents, fetchTasks } from "@/features/agenda/queries";
import { useLoad } from "@/features/agenda/useLoad";
import {
  buildCalendarItems,
  dayHeading,
  itemKeysOf,
  itemsForDay,
  shiftWeek,
  weekDays,
  type CalendarItem,
} from "@/features/calendar/calendarView";
import { DetailSheet } from "@/features/details/DetailSheet";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

function toneForItem(item: CalendarItem): StatusTone {
  if (item.kind === "deadline") return "warning";
  if (item.typeLabel === "Exam") return "solid";
  return "outline";
}

function accentForItem(item: CalendarItem, colors: ReturnType<typeof useTheme>["colors"]) {
  if (item.kind === "deadline") return colors.destructive;
  if (item.typeLabel === "Exam") return colors.foreground;
  if (item.typeLabel === "Lab") return colors.mutedForeground;
  return colors.border;
}

/** Calendar: a week strip over a clean, typed day agenda. */
export default function CalendarScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const events = useLoad(useCallback(() => fetchEvents(Date.now()), []));
  const tasks = useLoad(useCallback(() => fetchTasks(), []));

  const todayKey = dayKeyOf(new Date().toISOString(), timeZone);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarItem | null>(null);

  const activeAnchor = anchorKey ?? todayKey;
  const activeSelected = selectedKey ?? todayKey;

  const items = useMemo(() => {
    if (events.rows === null || tasks.rows === null) return null;
    return buildCalendarItems(events.rows, tasks.rows, timeZone);
  }, [events.rows, tasks.rows, timeZone]);

  const days = useMemo(
    () =>
      weekDays(
        activeAnchor,
        todayKey,
        activeSelected,
        items === null ? new Set<string>() : itemKeysOf(items, timeZone),
      ),
    [activeAnchor, activeSelected, items, timeZone, todayKey],
  );

  const agenda = useMemo(
    () => (items === null ? null : itemsForDay(items, activeSelected, timeZone)),
    [activeSelected, items, timeZone],
  );

  const error = events.error ?? tasks.error;
  const loading = events.loading || tasks.loading;
  const reload = useCallback(async () => {
    await Promise.all([events.reload(), tasks.reload()]);
  }, [events, tasks]);
  const resetToday = () => {
    setAnchorKey(todayKey);
    setSelectedKey(todayKey);
  };
  const moveWeek = (delta: number) => {
    const next = shiftWeek(activeAnchor, activeSelected, delta);
    setAnchorKey(next.anchorKey);
    setSelectedKey(next.selectedKey);
  };

  return (
    <Screen>
      <PageHeading
        eyebrow="Calendar"
        title="Calendar"
        description="See what's coming up."
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

      <MotionEnter index={1} style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
            <Pressable
              onPress={() => moveWeek(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              hitSlop={8}
              style={{ padding: theme.spacing.xs }}
            >
              <ChevronLeft size={20} color={theme.colors.mutedForeground} />
            </Pressable>
            <AppText variant="bodyMd">
              {new Intl.DateTimeFormat("en-US", {
                timeZone,
                month: "long",
                year: "numeric",
              }).format(new Date(`${activeAnchor}T12:00:00Z`))}
            </AppText>
            <Pressable
              onPress={() => moveWeek(1)}
              accessibilityRole="button"
              accessibilityLabel="Next week"
              hitSlop={8}
              style={{ padding: theme.spacing.xs }}
            >
              <ChevronRight size={20} color={theme.colors.mutedForeground} />
            </Pressable>
          </View>
          <FilterChip label="Today" active={activeSelected === todayKey} onPress={resetToday} />
        </View>

        <Card elevation="raised">
          <View style={{ flexDirection: "row", paddingHorizontal: theme.spacing.xs }}>
            {days.map((day) => (
              <Pressable
                key={day.key}
                onPress={() => setSelectedKey(day.key)}
                accessibilityRole="button"
                accessibilityLabel={`${day.weekdayLabel} ${day.dayNumber}`}
                accessibilityState={{ selected: day.isSelected }}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: theme.spacing.xxs,
                  paddingVertical: theme.spacing.sm,
                  margin: theme.spacing.xxs,
                  borderRadius: theme.radii.nested,
                  backgroundColor: day.isSelected ? theme.colors.primary : "transparent",
                  borderWidth: day.isToday && !day.isSelected ? 1 : 0,
                  borderColor: theme.colors.border,
                }}
              >
                <AppText
                  variant="caps"
                  color={
                    day.isSelected
                      ? theme.colors.onPrimary
                      : theme.colors.mutedForeground
                  }
                >
                  {day.weekdayLabel}
                </AppText>
                <AppText
                  variant="bodyMd"
                  color={day.isSelected ? theme.colors.onPrimary : undefined}
                >
                  {day.dayNumber}
                </AppText>
                <View
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: day.hasItems
                      ? day.isSelected
                        ? theme.colors.onPrimary
                        : theme.colors.foreground
                      : "transparent",
                  }}
                />
              </Pressable>
            ))}
          </View>
        </Card>
      </MotionEnter>

      <MotionEnter index={2} style={{ gap: theme.spacing.md }}>
        <AppText variant="caps" color={theme.colors.mutedForeground}>
          {dayHeading(activeSelected)}
        </AppText>

        {agenda === null ? (
          error === null ? (
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Loading…
            </AppText>
          ) : null
        ) : agenda.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={24} color={theme.colors.mutedForeground} />}
            title="Nothing on this day"
            body="Exams, classes and assignment deadlines show up here once they exist."
          />
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            {agenda.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setDetail(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. Open details`}
              >
                <Card elevation="raised">
                  <View style={{ flexDirection: "row", alignItems: "stretch" }}>
                    <View
                      style={{
                        width: 3,
                        backgroundColor: accentForItem(item, theme.colors),
                      }}
                    />
                    <View
                      style={{
                        width: 76,
                        paddingVertical: theme.spacing.lg,
                        paddingLeft: theme.spacing.md,
                        paddingRight: theme.spacing.sm,
                      }}
                    >
                      <AppText variant="mono" color={theme.colors.mutedForeground}>
                        {item.timeLabel}
                      </AppText>
                    </View>
                    <View
                      style={{
                        flex: 1,
                        gap: theme.spacing.xs,
                        paddingVertical: theme.spacing.lg,
                        paddingRight: theme.spacing.lg,
                      }}
                    >
                      <AppText variant="bodyMd">{item.title}</AppText>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: theme.spacing.sm,
                        }}
                      >
                        <StatusPill label={item.typeLabel} tone={toneForItem(item)} />
                        <SubjectTag
                          name={item.subjectName}
                          colorTag={item.subjectColorTag}
                        />
                      </View>
                      {item.location !== null ? (
                        <AppText variant="mono" color={theme.colors.mutedForeground}>
                          {item.location}
                        </AppText>
                      ) : null}
                      {item.fromWhatsApp ? (
                        <StatusPill label="From WhatsApp" tone="outline" />
                      ) : null}
                      {item.fromGoogleCalendar ? (
                        <StatusPill label="Google Calendar" tone="outline" />
                      ) : null}
                    </View>
                    <View style={{ justifyContent: "center", paddingRight: theme.spacing.md }}>
                      <ChevronRight size={16} color={theme.colors.mutedForeground} />
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </MotionEnter>

      {items !== null && items.length > 0 ? (
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
        kindLabel={detail?.typeLabel ?? "Event"}
        kindTone={detail === null ? "outline" : toneForItem(detail)}
        subjectName={detail?.subjectName ?? null}
        subjectColorTag={detail?.subjectColorTag ?? null}
        description={detail?.description ?? null}
        confidence={detail?.confidence ?? null}
        sourceMessageId={detail?.sourceMessageId ?? null}
        meta={
          detail === null
            ? []
            : [
                {
                  label: "When",
                  value: `${dayHeading(dayKeyOf(detail.startIso, timeZone))} · ${
                    detail.allDay ? "All day" : detail.timeLabel
                  }`,
                },
                ...(detail.location !== null
                  ? [{ label: "Where", value: detail.location }]
                  : []),
                {
                  label: "Source",
                  value: detail.fromGoogleCalendar
                    ? "Google Calendar"
                    : detail.fromWhatsApp
                      ? "WhatsApp group"
                      : "Manual",
                },
              ]
        }
      />
    </Screen>
  );
}
