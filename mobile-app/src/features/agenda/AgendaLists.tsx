import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { Divider } from "@/components/Divider";
import { SubjectTag } from "@/components/SubjectTag";
import { Surface } from "@/components/Surface";
import { useTheme } from "@/theme/ThemeProvider";

import type { EventDayGroup, TaskListItem } from "./agenda";
import { WHATSAPP_MARK } from "./agenda";
import { SourceMessageBadge } from "./SourceMessageBadge";

function SourceMark({
  fromWhatsApp,
  sourceMessageId,
}: {
  fromWhatsApp: boolean;
  sourceMessageId: string | null;
}) {
  if (!fromWhatsApp) return null;
  if (sourceMessageId === null) return <Badge>{WHATSAPP_MARK}</Badge>;
  return <SourceMessageBadge messageId={sourceMessageId} />;
}

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
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
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
                task.typeLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </AppText>
            <SubjectTag name={task.subjectName} colorTag={task.subjectColorTag} />
            <SourceMark
              fromWhatsApp={task.fromWhatsApp}
              sourceMessageId={task.sourceMessageId}
            />
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
                <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
                  <AppText variant="bodyMd">{event.title}</AppText>
                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {[event.timeLabel, event.typeLabel, event.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </AppText>
                  <SubjectTag
                    name={event.subjectName}
                    colorTag={event.subjectColorTag}
                  />
                  <SourceMark
                    fromWhatsApp={event.fromWhatsApp}
                    sourceMessageId={event.sourceMessageId}
                  />
                </View>
              </View>
            ))}
          </Surface>
        </View>
      ))}
    </View>
  );
}
