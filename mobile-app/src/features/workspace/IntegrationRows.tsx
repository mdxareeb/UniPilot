import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { StatusPill } from "@/components/ui/StatusPill";
import { REGISTRY_ICONS } from "@/features/workspace/icons";
import {
  INTEGRATIONS_REGISTRY,
  relativeTime,
  type IntegrationStatusContext,
} from "@/features/workspace/registries";
import { useTheme } from "@/theme/ThemeProvider";

export type PlannedIntegration = {
  name: string;
  description: string;
  note: string;
};

type IntegrationRowsProps = {
  context: IntegrationStatusContext;
  /** One clock for every relative timestamp; 0 means "not read yet". */
  checkedAt: number;
  timeZone: string;
  onPlanned: (item: PlannedIntegration) => void;
};

/**
 * The registry-driven integration list shared by Home and More. Live rows
 * navigate; a planned row opens the honest "reserved" sheet. There is one
 * status resolver, so the two screens cannot disagree.
 */
export function IntegrationRows({
  context,
  checkedAt,
  timeZone,
  onPlanned,
}: IntegrationRowsProps) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <>
      {INTEGRATIONS_REGISTRY.map((integration, index) => {
        const Icon = REGISTRY_ICONS[integration.icon];
        const status = integration.statusResolver(context);
        const lastSynced = integration.lastSyncedAt?.(context) ?? null;
        const live = integration.route !== undefined;
        return (
          <View key={integration.id}>
            {index > 0 ? <Divider /> : null}
            <Pressable
              onPress={() => {
                if (live && integration.route) {
                  router.push(integration.route);
                  return;
                }
                onPlanned({
                  name: integration.name,
                  description: integration.description,
                  note: "This integration is reserved for a later phase.",
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`${integration.name}, ${status.label}`}
              style={{
                minHeight: 56,
                flexDirection: "row",
                alignItems: "center",
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.colors.muted,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon size={18} color={theme.colors.foreground} />
              </View>
              <View style={{ flex: 1, gap: theme.spacing.xxs }}>
                <AppText variant="bodyMd">{integration.name}</AppText>
                <AppText
                  variant="mono"
                  color={theme.colors.mutedForeground}
                  numberOfLines={1}
                >
                  {integration.description}
                </AppText>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: theme.spacing.sm,
                    marginTop: theme.spacing.xxs,
                  }}
                >
                  <StatusPill label={status.label} tone={status.tone} />
                  {checkedAt > 0 && (lastSynced !== null || live) ? (
                    <AppText
                      variant="mono"
                      color={theme.colors.mutedForeground}
                    >
                      {relativeTime(lastSynced, checkedAt, timeZone)}
                    </AppText>
                  ) : null}
                </View>
              </View>
              <ChevronRight size={16} color={theme.colors.mutedForeground} />
            </Pressable>
          </View>
        );
      })}
    </>
  );
}
