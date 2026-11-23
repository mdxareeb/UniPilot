import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { FileText, History, Sparkles } from "lucide-react-native";
import Animated from "react-native-reanimated";

import { AppText } from "@/components/AppText";
import { Backdrop } from "@/components/Backdrop";
import { EmptyState } from "@/components/EmptyState";
import { Notice } from "@/components/Notice";
import { PageHeading } from "@/components/PageHeading";
import { AppButton } from "@/components/ui/AppButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useTheme } from "@/theme/ThemeProvider";
import { useReduceMotion } from "@/motion/useReduceMotion";
import { usePressScale } from "@/motion/pressFeedback";
import { TypingDots } from "@/motion/TypingDots";
import { ChatComposer } from "@/features/askAi/components/ChatComposer";
import { HistorySheet } from "@/features/askAi/components/HistorySheet";
import { MessageBubble } from "@/features/askAi/components/MessageBubble";
import { ScopeBar } from "@/features/askAi/components/ScopeBar";
import { ScopePickerSheet, type ScopePickerKind } from "@/features/askAi/components/ScopePickerSheet";
import { SourceSheet } from "@/features/askAi/components/SourceSheet";
import { StarterPrompts } from "@/features/askAi/components/StarterPrompts";
import type { CitationGroup } from "@/features/askAi/citations";
import { CHAT_COPY } from "@/features/askAi/chatValues";
import { ALL_SCOPE } from "@/features/askAi/scope";
import { useAskAi } from "@/features/askAi/useAskAi";
import { normalizeRouteParam } from "@/features/fileTools/fileInspector";

/**
 * Ask AI — a grounded study chat over the student's indexed materials.
 *
 * The screen is deliberately editorial: the user's turns are compact inverted
 * bubbles, answers are plain text in the body type with compact source pills,
 * and every unavailable state says exactly which dependency is missing. The
 * composer is pinned; the thread scrolls; history and scope live in sheets.
 */
export default function AskScreen() {
  const theme = useTheme();
  const router = useRouter();
  const reduced = useReduceMotion();
  const {
    scope,
    subjects,
    documents,
    indexedCount,
    workspaceLoading,
    workspaceError,
    scopeReady,
    refreshWorkspace,
    session,
    messages,
    threadLoading,
    sending,
    failed,
    send,
    retry,
    dismissFailure,
    newChat,
    chooseScope,
    aiConfigured,
    checkingStatus,
    notice,
    refreshStatus,
    historySessions,
    historyLoading,
    historyError,
    refreshHistory,
    openSession,
    deleteSession,
  } = useAskAi();

  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scopePicker, setScopePicker] = useState<ScopePickerKind | null>(null);
  const [source, setSource] = useState<CitationGroup | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const params = useLocalSearchParams<{
    documentId?: string;
    name?: string;
    indexing?: string;
  }>();
  const preloadApplied = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const historyPress = usePressScale(!sending);

  /** Apply a studio handoff once, after the indexed workspace is known. */
  useEffect(() => {
    if (preloadApplied.current || workspaceLoading || !scopeReady) return;
    const documentId = normalizeRouteParam(params.documentId);
    if (documentId === null) {
      preloadApplied.current = true;
      return;
    }
    preloadApplied.current = true;
    const label = normalizeRouteParam(params.name) ?? "This file";
    const indexing = normalizeRouteParam(params.indexing) === "1";
    void Promise.resolve().then(() => {
      if (indexing) {
        setHandoffNotice(
          `${label} is still indexing. It will appear in the document scope as soon as the worker finishes.`,
        );
        return;
      }
      const document = documents.find((entry) => entry.id === documentId);
      if (document === undefined) {
        setHandoffNotice(
          `${label} isn't indexed yet. It will be selectable once indexing finishes.`,
        );
        return;
      }
      chooseScope({ kind: "document", id: document.id, name: document.name });
      setHandoffNotice(null);
    });
  }, [
    chooseScope,
    documents,
    params.documentId,
    params.indexing,
    params.name,
    scopeReady,
    workspaceLoading,
  ]);

  const aiBlocked = aiConfigured === false;
  const noMaterials =
    !workspaceLoading && workspaceError === null && indexedCount === 0;
  const composerDisabled =
    sending ||
    workspaceLoading ||
    workspaceError !== null ||
    noMaterials ||
    aiBlocked ||
    checkingStatus;

  const placeholder = aiBlocked
    ? "AI is not configured on the server"
    : noMaterials
      ? "Upload a course file to start"
      : workspaceError !== null
        ? "Materials unavailable"
        : checkingStatus
          ? "Checking the assistant…"
          : CHAT_COPY.COMPOSER_PLACEHOLDER;

  const scopeSentence =
    scope.kind === "all"
      ? "Ask across all your materials"
      : scope.kind === "subject"
        ? `Ask within ${scope.name}`
        : `Ask about ${scope.name}`;

  /* New turns settle at the bottom; reading older messages is still free
     scrolling because only a content change re-runs this. */
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: !reduced });
    }, 40);
    return () => clearTimeout(timer);
  }, [failed, messages.length, reduced, sending]);

  const submit = useCallback(
    (content?: string) => {
      const text = (content ?? draft).trim();
      if (text === "") return;
      setDraft("");
      Keyboard.dismiss();
      void send(text, failed?.optimisticId);
    },
    [draft, failed?.optimisticId, send],
  );

  const openHistory = useCallback(() => {
    if (sending) return;
    setHistoryOpen(true);
    void refreshHistory();
  }, [refreshHistory, sending]);

  const startNewChat = useCallback(() => {
    setDraft("");
    newChat();
  }, [newChat]);

  const chooseScopeKind = useCallback(
    (kind: "all" | "subject" | "document") => {
      if (sending) return;
      setHandoffNotice(null);
      if (kind === "all") {
        chooseScope(ALL_SCOPE);
        return;
      }
      setScopePicker(kind);
    },
    [chooseScope, sending],
  );

  const showThread = messages.length > 0 || sending || failed !== null;

  return (
    <View style={{ flex: 1 }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={{
              width: "100%",
              maxWidth: theme.layout.maxContentWidth,
              alignSelf: "center",
              paddingHorizontal: theme.layout.screenMargin,
              paddingTop: theme.spacing.md,
              gap: theme.spacing.md,
            }}
          >
            <PageHeading
              eyebrow="Study"
              title="Ask AI"
              description="Grounded answers from your own course materials."
              trailing={
                <Animated.View style={historyPress.animatedStyle}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open chat history"
                    accessibilityState={{ disabled: sending }}
                    disabled={sending}
                    onPress={openHistory}
                    onPressIn={historyPress.onPressIn}
                    onPressOut={historyPress.onPressOut}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: theme.radii.pill,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.card,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: sending ? 0.5 : 1,
                    }}
                  >
                    <History size={18} color={theme.colors.foreground} />
                  </Pressable>
                </Animated.View>
              }
            />
            <ScopeBar
              scope={scope}
              onChoose={chooseScopeKind}
              disabled={sending || workspaceLoading}
            />
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (sending) {
                scrollRef.current?.scrollToEnd({ animated: !reduced });
              }
            }}
            contentContainerStyle={{
              width: "100%",
              maxWidth: theme.layout.maxContentWidth,
              alignSelf: "center",
              paddingHorizontal: theme.layout.screenMargin,
              paddingTop: theme.spacing.lg,
              paddingBottom: theme.spacing.xxl,
              gap: theme.spacing.xl,
            }}
          >
            {handoffNotice !== null ? (
              <Notice>{handoffNotice}</Notice>
            ) : null}

            {notice !== null ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Notice tone={notice.tone}>{notice.message}</Notice>
                <AppButton
                  label={checkingStatus ? "Checking…" : "Check again"}
                  size="sm"
                  variant="secondary"
                  loading={checkingStatus}
                  disabled={checkingStatus}
                  onPress={() => void refreshStatus()}
                  style={{ alignSelf: "flex-start" }}
                />
              </View>
            ) : null}

            {workspaceError !== null ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Notice tone="error">{workspaceError}</Notice>
                <AppButton
                  label="Try again"
                  size="sm"
                  variant="secondary"
                  onPress={() => void refreshWorkspace()}
                  style={{ alignSelf: "flex-start" }}
                />
              </View>
            ) : null}

            {workspaceLoading && messages.length === 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                }}
              >
                <ActivityIndicator
                  size="small"
                  color={theme.colors.mutedForeground}
                />
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  Loading your courses and materials…
                </AppText>
              </View>
            ) : null}

            {!workspaceLoading && noMaterials ? (
              <View style={{ gap: theme.spacing.md }}>
                <EmptyState
                  icon={
                    <FileText
                      size={24}
                      color={theme.colors.mutedForeground}
                    />
                  }
                  title="No indexed materials yet"
                  body={CHAT_COPY.NO_MATERIALS}
                  footnote="A file becomes searchable after it finishes indexing."
                />
                <AppButton
                  label={CHAT_COPY.MATERIALS_LINK}
                  variant="primary"
                  onPress={() => router.push("/materials")}
                  fullWidth
                />
              </View>
            ) : null}

            {!workspaceLoading && !noMaterials && !showThread && aiBlocked ? (
              <EmptyState
                icon={
                  <Sparkles
                    size={24}
                    color={theme.colors.mutedForeground}
                  />
                }
                title="Chat is disabled"
                body={
                  notice?.source === "connection"
                    ? "This build can't reach the UniPilot server, so Ask AI can't load or answer anything."
                    : "Your materials and previous chats are safe. Ask AI unlocks when the server's Gemini key is configured."
                }
                footnote={
                  notice?.source === "connection"
                    ? "Sign in again or check the app's API address."
                    : "This is a server setting, not something the app can change."
                }
              />
            ) : null}

            {!workspaceLoading && !noMaterials && !showThread && !aiBlocked ? (
              <View style={{ gap: theme.spacing.lg }}>
                <View style={{ gap: theme.spacing.xs }}>
                  <SectionHeader label="New chat" />
                  <AppText variant="headlineMd">{scopeSentence}</AppText>
                  <AppText
                    variant="bodyMd"
                    color={theme.colors.mutedForeground}
                  >
                    Every answer is grounded in the material inside this scope
                    and cites the page or chunk it used.
                  </AppText>
                </View>
                <StarterPrompts
                  scope={scope}
                  disabled={composerDisabled}
                  onSend={submit}
                />
              </View>
            ) : null}

            {threadLoading ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                }}
              >
                <ActivityIndicator
                  size="small"
                  color={theme.colors.mutedForeground}
                />
                <AppText variant="mono" color={theme.colors.mutedForeground}>
                  Loading conversation…
                </AppText>
              </View>
            ) : showThread ? (
              <View style={{ gap: theme.spacing.xl }}>
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onCitation={setSource}
                  />
                ))}

                {sending ? (
                  <View style={{ gap: theme.spacing.sm }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: theme.spacing.xs + 2,
                      }}
                    >
                      <Sparkles
                        size={13}
                        color={theme.colors.mutedForeground}
                      />
                      <AppText
                        variant="caps"
                        color={theme.colors.mutedForeground}
                      >
                        Ask AI
                      </AppText>
                    </View>
                    <View
                      accessibilityLiveRegion="polite"
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: theme.spacing.sm,
                      }}
                    >
                      <TypingDots />
                      <AppText
                        variant="mono"
                        color={theme.colors.mutedForeground}
                      >
                        {CHAT_COPY.THINKING}
                      </AppText>
                    </View>
                  </View>
                ) : null}

                {failed !== null ? (
                  <View style={{ gap: theme.spacing.sm }}>
                    <Notice tone="error">{failed.message}</Notice>
                    <View
                      style={{
                        flexDirection: "row",
                        gap: theme.spacing.sm,
                        flexWrap: "wrap",
                      }}
                    >
                      {failed.retryable ? (
                        <AppButton
                          label="Try again"
                          size="sm"
                          variant="primary"
                          onPress={() => void retry()}
                        />
                      ) : null}
                      <AppButton
                        label="Dismiss"
                        size="sm"
                        variant="ghost"
                        onPress={dismissFailure}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.glass,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: theme.layout.maxContentWidth,
                alignSelf: "center",
                paddingHorizontal: theme.layout.screenMargin,
                paddingTop: theme.spacing.sm,
                paddingBottom: theme.spacing.sm,
              }}
            >
              <ChatComposer
                value={draft}
                onChangeText={setDraft}
                onSend={() => submit()}
                disabled={composerDisabled}
                placeholder={placeholder}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ScopePickerSheet
        visible={scopePicker !== null}
        kind={scopePicker ?? "subject"}
        onClose={() => setScopePicker(null)}
        subjects={subjects}
        documents={documents}
        activeId={
          scopePicker !== null && scope.kind === scopePicker ? scope.id : null
        }
        onSelect={chooseScope}
      />

      <HistorySheet
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={historySessions}
        loading={historyLoading}
        error={historyError}
        currentSessionId={session?.id ?? null}
        subjects={subjects}
        documents={documents}
        onNew={startNewChat}
        onSelect={openSession}
        onDelete={deleteSession}
        onRetry={() => void refreshHistory()}
      />

      <SourceSheet group={source} onClose={() => setSource(null)} />
    </View>
  );
}
