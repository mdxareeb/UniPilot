import { CalendarDays } from "lucide-react-native";

import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Calendar — the M1 honest state. The surface renders its real structure and
 * says exactly what exists: nothing synced yet. No rows, counts or events
 * are invented; the unified calendar lands in M3.
 */
export default function CalendarScreen() {
  const theme = useTheme();

  return (
    <Screen>
      <PageHeading
        eyebrow="Calendar"
        title="Calendar"
        description="See what's coming up."
      />
      <MotionEnter index={1}>
        <EmptyState
          icon={
            <CalendarDays size={24} color={theme.colors.mutedForeground} />
          }
          title="Nothing on your calendar yet"
          body="Events from WhatsApp, Google Calendar, Outlook and Teams will appear here once the integrations and sync ship."
          footnote="Sources are not connected yet"
        />
      </MotionEnter>
      <MotionEnter index={2}>
        <Notice>
          This build is the M1 app shell — the unified calendar arrives in M3.
        </Notice>
      </MotionEnter>
    </Screen>
  );
}
