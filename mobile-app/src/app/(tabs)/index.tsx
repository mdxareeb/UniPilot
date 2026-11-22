import { useCallback, useMemo } from "react";
import { CalendarDays } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { groupEventsByDay } from "@/features/agenda/agenda";
import { EventAgenda } from "@/features/agenda/AgendaLists";
import { fetchEvents } from "@/features/agenda/queries";
import { useLoad } from "@/features/agenda/useLoad";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Calendar: a read-only agenda of the student's own events, grouped by day in
 * their profile timezone. Events that came from a WhatsApp group carry a "From
 * WhatsApp" marker. Creating and editing events, and the month grid, arrive
 * with the full calendar; nothing here is invented.
 */
export default function CalendarScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const load = useCallback(() => fetchEvents(Date.now()), []);
  const { rows, error, loading, reload } = useLoad(load);
  const days = useMemo(
    () => (rows === null ? null : groupEventsByDay(rows, timeZone)),
    [rows, timeZone],
  );

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
          <Button
            label="Try again"
            variant="outline"
            onPress={() => void reload()}
            style={{ alignSelf: "stretch", marginTop: theme.spacing.sm }}
          />
        </MotionEnter>
      ) : null}
      {days === null ? (
        error === null ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Loading…
          </AppText>
        ) : null
      ) : days.length === 0 ? (
        <MotionEnter index={1}>
          <EmptyState
            icon={<CalendarDays size={24} color={theme.colors.mutedForeground} />}
            title="Nothing on your calendar yet"
            body="Exams, classes and events from your WhatsApp groups show up here once you link them in More."
          />
        </MotionEnter>
      ) : (
        <MotionEnter index={1}>
          <EventAgenda days={days} />
        </MotionEnter>
      )}
      {days !== null && days.length > 0 ? (
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
