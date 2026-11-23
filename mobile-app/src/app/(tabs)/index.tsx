import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ArrowRight, ChevronRight, Sparkles } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { AccordionSection } from "@/components/ui/AccordionSection";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  HOME_TOOL_GROUPS,
  type HomeRoute,
  type HomeToolGroup,
  type HomeToolItem,
} from "@/features/home/homeGroups";
import { groupPill, indexedFilesLabel } from "@/features/home/homeValues";
import { useIntegrationStatuses } from "@/features/workspace/useIntegrationStatuses";
import { useWorkspaceCounts } from "@/features/workspace/useWorkspaceCounts";
import { REGISTRY_ICONS } from "@/features/workspace/icons";
import { IntegrationRows } from "@/features/workspace/IntegrationRows";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

type PlannedItem = { name: string; description: string; note: string };

/**
 * Home: the workspace's tool hub. The hero opens the study assistant; the
 * three registry-driven accordions keep file tools, integrations and future
 * study tools in one predictable place. Live rows navigate, planned rows say
 * so instead of pretending.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const counts = useWorkspaceCounts();
  const { whatsapp, google, checkedAt } = useIntegrationStatuses();
  const [planned, setPlanned] = useState<PlannedItem | null>(null);

  const context = { whatsapp, google };
  const timeZone = profile?.timezone ?? "UTC";
  const indexedLabel = indexedFilesLabel(counts.indexedDocs);

  const openRoute = (route: HomeRoute) => {
    if (route === "/ask") {
      router.navigate("/ask");
      return;
    }
    router.push(route);
  };

  const openTool = (item: HomeToolItem) => {
    if (item.route !== undefined) {
      openRoute(item.route);
      return;
    }
    setPlanned({
      name: item.name,
      description: item.description,
      note: item.note,
    });
  };

  const renderGroup = (group: HomeToolGroup, index: number) => {
    const GroupIcon = REGISTRY_ICONS[group.icon];
    const pill = groupPill(group, context);

    return (
      <MotionEnter key={group.id} index={index + 2}>
        <AccordionSection
          title={group.title}
          subtitle={group.subtitle}
          icon={<GroupIcon size={18} color={theme.colors.foreground} />}
          trailing={<StatusPill label={pill} tone="outline" />}
          defaultOpen={group.defaultOpen}
          accessibilityLabel={`${group.title}, ${pill}`}
        >
          {group.kind === "integrations" ? (
            <IntegrationRows
              context={context}
              checkedAt={checkedAt}
              timeZone={timeZone}
              onPlanned={setPlanned}
            />
          ) : (
            group.items.map((item, rowIndex) => {
                const Icon = REGISTRY_ICONS[item.icon];
                const badge =
                  item.badge === "indexed" ? indexedLabel : null;
                return (
                  <View key={item.id}>
                    {rowIndex > 0 ? <Divider /> : null}
                    <Pressable
                      onPress={() => openTool(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}${
                        item.status === "planned" ? ", planned" : ""
                      }`}
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
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: theme.spacing.sm,
                          }}
                        >
                          <AppText variant="bodyMd">{item.name}</AppText>
                          {item.status === "planned" ? (
                            <StatusPill label="Planned" tone="planned" />
                          ) : badge !== null ? (
                            <StatusPill label={badge} tone="outline" />
                          ) : null}
                        </View>
                        <AppText
                          variant="mono"
                          color={theme.colors.mutedForeground}
                          numberOfLines={2}
                        >
                          {item.description}
                        </AppText>
                      </View>
                      <ChevronRight size={16} color={theme.colors.mutedForeground} />
                    </Pressable>
                  </View>
                );
              })
          )}
        </AccordionSection>
      </MotionEnter>
    );
  };

  return (
    <Screen>
      <PageHeading
        eyebrow="Workspace"
        title="Home"
        description="Your tools, integrations and study assistant."
      />

      <MotionEnter index={1}>
        <Pressable
          onPress={() => router.navigate("/ask")}
          accessibilityRole="button"
          accessibilityLabel="Ask your course materials"
        >
          <Card>
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: theme.colors.inverted,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sparkles size={20} color={theme.colors.onInverted} />
                </View>
                <ArrowRight size={18} color={theme.colors.mutedForeground} />
              </View>
              <AppText variant="caps" color={theme.colors.mutedForeground}>
                Study assistant
              </AppText>
              <AppText variant="headlineMd">Ask your course materials</AppText>
              <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
                Grounded answers with citations from the files you have already
                indexed.
              </AppText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                }}
              >
                <StatusPill
                  label={indexedLabel ?? "Checking files"}
                  tone="outline"
                />
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  Tap to open Ask AI
                </AppText>
              </View>
            </View>
          </Card>
        </Pressable>
      </MotionEnter>

      {HOME_TOOL_GROUPS.map((group, index) => renderGroup(group, index))}

      <BottomSheet
        visible={planned !== null}
        onClose={() => setPlanned(null)}
        title={planned?.name ?? ""}
        subtitle="Planned"
      >
        <StatusPill label="Planned" tone="planned" />
        <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
          {planned?.description ?? ""}
        </AppText>
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {planned?.note ?? ""}
        </AppText>
        <AppButton
          label="Got it"
          variant="secondary"
          fullWidth
          onPress={() => setPlanned(null)}
        />
      </BottomSheet>
    </Screen>
  );
}
