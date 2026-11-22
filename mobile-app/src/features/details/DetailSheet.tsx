import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/AppText";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusPill, type StatusTone } from "@/components/ui/StatusPill";
import { SubjectTag } from "@/components/SubjectTag";
import { useAuth } from "@/auth/AuthProvider";
import { fetchOriginalMessage } from "@/features/agenda/queries";
import {
  ORIGINAL_GONE_COPY,
  toOriginalMessage,
  type OriginalMessage,
} from "@/features/agenda/sourceMessage";
import { useTheme } from "@/theme/ThemeProvider";

export type DetailMetaRow = { label: string; value: string };

type DetailSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  kindLabel: string;
  kindTone?: StatusTone;
  subjectName?: string | null;
  subjectColorTag?: string | null;
  description?: string | null;
  meta: DetailMetaRow[];
  confidence?: number | null;
  sourceMessageId?: string | null;
};

type SourceState =
  | { kind: "loading" }
  | { kind: "ready"; message: OriginalMessage }
  | { kind: "gone" }
  | { kind: "error" };

function OriginalMessageBlock({ messageId }: { messageId: string }) {
  const theme = useTheme();
  const { profile } = useAuth();
  const timeZone = profile?.timezone ?? "UTC";
  const [source, setSource] = useState<SourceState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void fetchOriginalMessage(messageId).then((result) => {
      if (!active) return;
      if (result.error !== null) {
        setSource({ kind: "error" });
      } else if (result.row === null) {
        setSource({ kind: "gone" });
      } else {
        setSource({
          kind: "ready",
          message: toOriginalMessage(result.row, timeZone),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [messageId, timeZone]);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <SectionHeader label="From WhatsApp" />
      {source.kind === "loading" ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Loading the original message…
        </AppText>
      ) : null}
      {source.kind === "gone" ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          {ORIGINAL_GONE_COPY}
        </AppText>
      ) : null}
      {source.kind === "error" ? (
        <AppText variant="mono" color={theme.colors.mutedForeground}>
          Couldn&apos;t load the original message.
        </AppText>
      ) : null}
      {source.kind === "ready" ? (
        <View
          style={{
            gap: theme.spacing.xs,
            padding: theme.spacing.md,
            borderRadius: theme.radii.nested,
            backgroundColor: theme.colors.muted,
          }}
        >
          <AppText variant="caps" color={theme.colors.mutedForeground}>
            {source.message.sender} · {source.message.sentLabel}
          </AppText>
          <AppText variant="bodyMd">{source.message.text}</AppText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The unified task/event detail surface. It shows the resolved fields and,
 * when the row came from WhatsApp, resolves the captured message under owner
 * RLS; after the 30-day purge it says so instead of faking the source.
 */
export function DetailSheet({
  visible,
  onClose,
  title,
  kindLabel,
  kindTone = "outline",
  subjectName = null,
  subjectColorTag = null,
  description = null,
  meta,
  confidence = null,
  sourceMessageId = null,
}: DetailSheetProps) {
  const theme = useTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={kindLabel}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
        <StatusPill label={kindLabel} tone={kindTone} />
        {confidence !== null ? (
          <StatusPill label={`${Math.round(confidence * 100)}% confidence`} />
        ) : null}
        {subjectName !== null ? (
          <SubjectTag name={subjectName} colorTag={subjectColorTag} />
        ) : null}
      </View>

      {description !== null ? (
        <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
          {description}
        </AppText>
      ) : null}

      {meta.length > 0 ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.nested,
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          {meta.map((row) => (
            <View
              key={row.label}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: theme.spacing.md,
              }}
            >
              <AppText variant="mono" color={theme.colors.mutedForeground}>
                {row.label}
              </AppText>
              <AppText variant="mono" style={{ flexShrink: 1, textAlign: "right" }}>
                {row.value}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {visible && sourceMessageId !== null ? (
        <OriginalMessageBlock messageId={sourceMessageId} />
      ) : null}
    </BottomSheet>
  );
}
