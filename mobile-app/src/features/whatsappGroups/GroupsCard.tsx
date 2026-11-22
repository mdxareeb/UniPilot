import { useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Notice } from "@/components/Notice";
import { Surface } from "@/components/Surface";
import { tapFeedback } from "@/lib/haptics";
import { Switch } from "@/components/Switch";
import { useTheme } from "@/theme/ThemeProvider";

import { sortGroups } from "./groupToggle";
import type { ActionResult } from "./useGroupSync";
import type { MonitoredGroupItem } from "./types";

type GroupsCardProps = {
  groups: MonitoredGroupItem[];
  onToggle: (id: string, active: boolean) => Promise<ActionResult>;
};

/**
 * The student's WhatsApp groups with an on/off switch each. A switch is
 * disabled while its own write is in flight, and the list only changes after the
 * database accepted the change.
 */
export function GroupsCard({ groups, onToggle }: GroupsCardProps) {
  const theme = useTheme();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (id: string, active: boolean) => {
    setPending(id);
    setError(null);
    const outcome = await onToggle(id, active);
    setPending(null);
    if (outcome.error !== null) setError(outcome.error);
  };

  if (groups.length === 0) {
    return (
      <Notice>
        No groups yet. They appear here shortly after WhatsApp finishes linking.
      </Notice>
    );
  }

  const sorted = sortGroups(groups);
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Surface
        fill="solid"
        elevation="raised"
        radius="card"
        padding={0}
        style={{ overflow: "hidden" }}
      >
        {sorted.map((group, index) => (
          <View key={group.id}>
            {index > 0 ? <Divider /> : null}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.lg,
              }}
            >
              <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                <AppText variant="bodyMd" numberOfLines={2}>
                  {group.name}
                </AppText>
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  {group.active ? "Capturing" : "Off"}
                </AppText>
              </View>
              <Switch
                value={group.active}
                disabled={pending === group.id}
                onValueChange={(next) => {
                  tapFeedback();
                  void change(group.id, next);
                }}
                accessibilityLabel={`Capture messages from ${group.name}`}
              />
            </View>
          </View>
        ))}
      </Surface>
      <AppText variant="mono" color={theme.colors.mutedForeground}>
        Turning a group on captures messages from that moment forward. Earlier
        messages are never read.
      </AppText>
      {error !== null ? <Notice tone="error">{error}</Notice> : null}
    </View>
  );
}
