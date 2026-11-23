import { useState } from "react";
import { Pressable, View } from "react-native";
import { History, Trash2 } from "lucide-react-native";

import { AppText } from "@/components/AppText";
import { Divider } from "@/components/Divider";
import { Notice } from "@/components/Notice";
import { AppButton } from "@/components/ui/AppButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/StatusPill";
import { useTheme } from "@/theme/ThemeProvider";
import { CHAT_COPY, type ChatSessionSummary } from "../chatValues";
import {
  relativeTimestamp,
  scopeKindLabel,
  sessionScopeLabel,
  type ScopeDocument,
  type ScopeSubject,
} from "../scope";

/**
 * The thread history sheet. Selecting a row opens it; delete is a two-step
 * action inside the sheet, so a mistap never destroys a conversation.
 */
export function HistorySheet({
  visible,
  onClose,
  sessions,
  loading,
  error,
  currentSessionId,
  subjects,
  documents,
  onNew,
  onSelect,
  onDelete,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  sessions: ChatSessionSummary[] | null;
  loading: boolean;
  error: string | null;
  currentSessionId: string | null;
  subjects: readonly ScopeSubject[];
  documents: readonly ScopeDocument[];
  onNew: () => void;
  onSelect: (sessionId: string) => Promise<boolean>;
  onDelete: (sessionId: string) => Promise<boolean>;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const [pendingDelete, setPendingDelete] =
    useState<ChatSessionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const close = () => {
    setPendingDelete(null);
    setDeleting(false);
    setOpeningId(null);
    onClose();
  };

  const choose = async (sessionId: string) => {
    if (openingId !== null || deleting) return;
    setOpeningId(sessionId);
    const opened = await onSelect(sessionId);
    setOpeningId(null);
    if (opened) close();
  };

  const confirmDelete = async () => {
    if (pendingDelete === null || deleting) return;
    setDeleting(true);
    const removed = await onDelete(pendingDelete.id);
    setDeleting(false);
    if (removed) setPendingDelete(null);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={pendingDelete === null ? CHAT_COPY.HISTORY_TITLE : CHAT_COPY.DELETE_CONFIRM_TITLE}
      subtitle={
        pendingDelete === null
          ? CHAT_COPY.HISTORY_SUBTITLE
          : "This cannot be undone"
      }
    >
      {pendingDelete !== null ? (
        <View style={{ gap: theme.spacing.lg }}>
          <View
            style={{
              gap: theme.spacing.xs,
              padding: theme.spacing.md,
              borderRadius: theme.radii.nested,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.muted,
            }}
          >
            <AppText variant="bodyMd">{pendingDelete.title}</AppText>
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              {sessionScopeLabel(pendingDelete, subjects, documents)}
            </AppText>
          </View>
          <AppText variant="bodyMd" color={theme.colors.mutedForeground}>
            {CHAT_COPY.DELETE_CONFIRM_BODY}
          </AppText>
          {error !== null ? <Notice tone="error">{error}</Notice> : null}
          <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton
                label={CHAT_COPY.CANCEL}
                variant="secondary"
                disabled={deleting}
                onPress={() => setPendingDelete(null)}
                fullWidth
              />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton
                label={CHAT_COPY.DELETE_CHAT}
                variant="destructive"
                loading={deleting}
                disabled={deleting}
                onPress={() => void confirmDelete()}
                fullWidth
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <AppButton
            label={CHAT_COPY.NEW_CHAT}
            variant="primary"
            onPress={() => {
              onNew();
              close();
            }}
            fullWidth
          />

          {error !== null ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Notice tone="error">{error}</Notice>
              <AppButton
                label="Try again"
                variant="secondary"
                onPress={onRetry}
                fullWidth
              />
            </View>
          ) : null}

          {loading && sessions === null ? (
            <AppText variant="mono" color={theme.colors.mutedForeground}>
              Loading history…
            </AppText>
          ) : sessions === null ? null : sessions.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.xl,
              }}
            >
              <History size={22} color={theme.colors.mutedForeground} />
              <AppText
                variant="bodyMd"
                color={theme.colors.mutedForeground}
                style={{ textAlign: "center" }}
              >
                No previous chats yet. Your first question starts one.
              </AppText>
            </View>
          ) : (
            <Card elevation="flush">
              {sessions.map((session, index) => (
                <View key={session.id}>
                  {index > 0 ? <Divider /> : null}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: theme.spacing.sm,
                      paddingLeft: theme.spacing.lg,
                      paddingRight: theme.spacing.sm,
                      paddingVertical: theme.spacing.md,
                      opacity: openingId === session.id ? 0.55 : 1,
                    }}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open chat ${session.title}`}
                      disabled={openingId !== null}
                      onPress={() => void choose(session.id)}
                      style={{ flex: 1, gap: theme.spacing.xs }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: theme.spacing.sm,
                        }}
                      >
                        <AppText
                          variant="bodyMd"
                          style={{ flex: 1 }}
                          numberOfLines={2}
                        >
                          {session.title}
                        </AppText>
                        {currentSessionId === session.id ? (
                          <StatusPill label="Current" tone="solid" />
                        ) : null}
                      </View>
                      <AppText
                        variant="mono"
                        color={theme.colors.mutedForeground}
                        numberOfLines={1}
                      >
                        {sessionScopeLabel(session, subjects, documents)}
                      </AppText>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: theme.spacing.sm,
                        }}
                      >
                        <StatusPill
                          label={scopeKindLabel(session)}
                          tone={
                            session.scopeSubjectId === null &&
                            session.scopeDocumentId === null
                              ? "neutral"
                              : "outline"
                          }
                        />
                        <AppText
                          variant="mono"
                          color={theme.colors.mutedForeground}
                        >
                          {relativeTimestamp(session.updatedAt)}
                        </AppText>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete chat ${session.title}`}
                      onPress={() => setPendingDelete(session)}
                      hitSlop={8}
                      style={{
                        width: 40,
                        height: 40,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: theme.radii.control,
                      }}
                    >
                      <Trash2
                        size={17}
                        color={theme.colors.mutedForeground}
                      />
                    </Pressable>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </BottomSheet>
  );
}
