import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { FileText } from "lucide-react-native";

import { useAuth } from "@/auth/AuthProvider";
import { AppText } from "@/components/AppText";
import { Badge } from "@/components/Badge";
import { AppButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { Screen } from "@/components/Screen";
import { SubjectTag } from "@/components/SubjectTag";
import { Surface } from "@/components/Surface";
import { useLoad } from "@/features/agenda/useLoad";
import {
  filterMaterials,
  subjectFilters,
  toMaterialItem,
  type MaterialItem,
} from "@/features/materials/materials";
import { fetchMaterials, openMaterialFile } from "@/features/materials/queries";
import { MotionEnter } from "@/motion/MotionEnter";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Course materials: the files captured from active WhatsApp groups, with the
 * AI summary and topic tags the worker wrote, a course filter, and one tap to
 * open a file through a short-lived signed URL. Read-only; opening is the only
 * action, and every state is the row's real one.
 */
export default function MaterialsScreen() {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const { rows, error, loading, reload } = useLoad(
    useCallback(() => fetchMaterials(), []),
  );
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const items = useMemo(
    () => (rows === null ? null : rows.map((row) => toMaterialItem(row, timeZone))),
    [rows, timeZone],
  );
  const filters = useMemo(
    () => (items === null ? [] : subjectFilters(items)),
    [items],
  );
  /* A reload can remove the selected course; fall back to All rather than
     leaving a filter that hides everything. */
  const activeId =
    subjectId !== null && filters.some((filter) => filter.id === subjectId)
      ? subjectId
      : null;
  const visible = useMemo(
    () => (items === null ? null : filterMaterials(items, activeId)),
    [activeId, items],
  );

  const onOpen = useCallback(async (item: MaterialItem) => {
    if (openingId !== null) return;
    setOpeningId(item.id);
    setOpenError(null);
    const result = await openMaterialFile(item);
    setOpeningId(null);
    if (result.error !== null) setOpenError(result.error);
  }, [openingId]);

  return (
    <Screen>
      <PageHeading
        eyebrow="More"
        title="Course materials"
        description="Files your groups shared, summarised and sorted."
      />

      {error !== null ? (
        <MotionEnter index={1}>
          <Notice tone="error">{error}</Notice>
          <AppButton
            label="Try again"
            variant="secondary"
            onPress={() => void reload()}
            style={{ alignSelf: "stretch", marginTop: theme.spacing.sm }}
          />
        </MotionEnter>
      ) : null}

      {items === null ? (
        error === null ? (
          <AppText variant="mono" color={theme.colors.mutedForeground}>
            Loading…
          </AppText>
        ) : null
      ) : items.length === 0 ? (
        <MotionEnter index={1}>
          <EmptyState
            icon={<FileText size={24} color={theme.colors.mutedForeground} />}
            title="No materials yet"
            body="Files shared in your linked WhatsApp groups show up here once a group is switched on."
          />
        </MotionEnter>
      ) : (
        <>
          {filters.length > 0 ? (
            <MotionEnter index={1}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: theme.spacing.sm }}
              >
                <AppButton
                  label={`All · ${items.length}`}
                  size="sm"
                  variant={activeId === null ? "primary" : "secondary"}
                  onPress={() => setSubjectId(null)}
                  accessibilityLabel="Show all course materials"
                />
                {filters.map((filter) => (
                  <AppButton
                    key={filter.id}
                    label={`${filter.name} · ${filter.count}`}
                    size="sm"
                    variant={activeId === filter.id ? "primary" : "secondary"}
                    onPress={() => setSubjectId(filter.id)}
                    accessibilityLabel={`Show files for ${filter.name}`}
                  />
                ))}
              </ScrollView>
            </MotionEnter>
          ) : null}

          {openError !== null ? (
            <Notice tone="error">{openError}</Notice>
          ) : null}

          {visible !== null && visible.length === 0 ? (
            <MotionEnter index={2}>
              <Notice>No files in this course yet.</Notice>
            </MotionEnter>
          ) : null}

          <MotionEnter index={2}>
            <View style={{ gap: theme.spacing.md }}>
              {(visible ?? []).map((item) => (
                <Surface
                  key={item.id}
                  fill="solid"
                  elevation="raised"
                  radius="card"
                  padding={theme.spacing.lg}
                  style={{ gap: theme.spacing.sm }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: theme.spacing.sm,
                    }}
                  >
                    <AppText variant="bodyMd" style={{ flex: 1 }}>
                      {item.name}
                    </AppText>
                    <AppText variant="mono" color={theme.colors.mutedForeground}>
                      {item.typeLabel}
                    </AppText>
                  </View>

                  <AppText variant="mono" color={theme.colors.mutedForeground}>
                    {[
                      item.sizeLabel,
                      `Added ${item.addedLabel}`,
                      item.statusValue === "indexed" ? null : item.statusLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </AppText>

                  <SubjectTag
                    name={item.subjectName}
                    colorTag={item.subjectColorTag}
                  />

                  {item.fromWhatsApp ? <Badge>From WhatsApp</Badge> : null}

                  {item.summary !== null ? (
                    <AppText variant="bodyMd">{item.summary}</AppText>
                  ) : null}

                  {item.tags.length > 0 ? (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: theme.spacing.xs,
                      }}
                    >
                      {item.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </View>
                  ) : null}

                  {item.canOpen ? (
                    <AppButton
                      label={openingId === item.id ? "Opening…" : "Open file"}
                      size="sm"
                      variant="secondary"
                      disabled={openingId !== null}
                      onPress={() => void onOpen(item)}
                      accessibilityLabel={`Open ${item.name}`}
                      style={{ alignSelf: "flex-start" }}
                    />
                  ) : (
                    <AppText variant="mono" color={theme.colors.mutedForeground}>
                      File unavailable
                    </AppText>
                  )}
                </Surface>
              ))}
            </View>
          </MotionEnter>

          <AppButton
            label={loading ? "Refreshing…" : "Refresh"}
            variant="ghost"
            disabled={loading}
            onPress={() => void reload()}
            style={{ alignSelf: "center" }}
          />
        </>
      )}
    </Screen>
  );
}
