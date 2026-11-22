import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { Divider } from "@/components/Divider";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";

import type { EventDayGroup, TaskListItem } from "./agenda";

/** Where an item came from; shown only for WhatsApp group sync. */
export const WHATSAPP_MARK = "From WhatsApp";

export function TaskList({ tasks }: { tasks: TaskListItem[] }) {
  const theme = useTheme();
  return (
    <Surface
      fill="solid"
      elevation="raised"
      radius="card"
      padding={0}
      style={{ overflow: "hidden" }}
    >
      {tasks.map((task, index) => (
        <View key={task.id}>
          {index > 0 ? <Divider /> : null}
          <View
            style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}
            accessible
            accessibilityLabel={[
              task.title,
              task.done ? "done" : task.statusLabel,
              task.dueLabel ? `due ${task.dueLabel}` : "no due date",
              task.subjectName ?? "",
              task.fromWhatsApp ? WHATSAPP_MARK : "",
            ]
              .filter(Boolean)
              .join(", ")}
          >
            <AppText
              variant="bodyMd"
              color={task.done ? theme.colors.mutedForeground : undefined}
              style={task.done ? { textDecorationLine: "line-through" } : undefined}
            >
              {task.title}
            </AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {[
                task.dueLabel ? `Due ${task.dueLabel}` : "No due date",
                task.subjectName,
                task.typeLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </AppText>
            {task.fromWhatsApp ? <Badge>{WHATSAPP_MARK}</Badge> : null}
          </View>
        </View>
      ))}
    </Surface>
  );
}

export function EventAgenda({ days }: { days: EventDayGroup[] }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xl }}>
      {days.map((day) => (
        <View key={day.dayKey} style={{ gap: theme.spacing.sm }}>
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            {day.dayLabel}
          </AppText>
          <Surface
            fill="solid"
            elevation="raised"
            radius="card"
            padding={0}
            style={{ overflow: "hidden" }}
          >
            {day.events.map((event, index) => (
              <View key={event.id}>
                {index > 0 ? <Divider /> : null}
                <View
                  style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}
                  accessible
                  accessibilityLabel={[
                    event.title,
                    event.timeLabel,
                    event.typeLabel ?? "",
                    event.subjectName ?? "",
                    event.fromWhatsApp ? WHATSAPP_MARK : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                >
                  <AppText variant="bodyMd">{event.title}</AppText>
                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {[event.timeLabel, event.typeLabel, event.subjectName, event.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </AppText>
                  {event.fromWhatsApp ? <Badge>{WHATSAPP_MARK}</Badge> : null}
                </View>
              </View>
            ))}
          </Surface>
        </View>
      ))}
    </View>
  );
}
