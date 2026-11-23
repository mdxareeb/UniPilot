import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import {
  loadAiLastScope,
  loadAiScopeMode,
  saveAiLastScope,
} from "@/lib/preferences";
import { probeApiHealth } from "@/features/workspace/health";
import { askAiApi, isAskAiApiConfigured } from "./chatClient";
import {
  ChatApiError,
  toChatFailure,
  type ChatApiErrorKind,
} from "./chatErrors";
import {
  CHAT_COPY,
  CHAT_MESSAGE_MAX_LENGTH,
  titleFromQuestion,
  type ChatMessage,
  type ChatSessionSummary,
} from "./chatValues";
import { fetchAskAiWorkspace, type AskAiWorkspace } from "./queries";
import {
  ALL_SCOPE,
  resolveInitialScope,
  sameScope,
  scopeFromSession,
  scopeStillValid,
  scopeToSessionInput,
  scopeToStored,
  type AskScope,
  type ScopeDocument,
  type ScopeSubject,
} from "./scope";

export type AskAiNotice = {
  tone: "info" | "error";
  message: string;
  source: "ai" | "connection";
};

export type FailedTurn = {
  content: string;
  message: string;
  kind: ChatApiErrorKind;
  retryable: boolean;
  optimisticId: string;
};

/**
 * The Ask AI screen's state machine. It owns the active thread, scope,
 * optimistic turns and the bounded history read; the screen owns drafts and
 * sheet visibility.
 *
 * Every network failure is already sanitized by `chatErrors`; this hook only
 * decides whether it belongs beside the thread (retryable turn) or in the
 * connection notice (auth/onboarding).
 */
export function useAskAi() {
  const [scope, setScope] = useState<AskScope>(ALL_SCOPE);
  const [subjects, setSubjects] = useState<ScopeSubject[]>([]);
  const [documents, setDocuments] = useState<ScopeDocument[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [session, setSession] = useState<ChatSessionSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<FailedTurn | null>(null);

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [notice, setNotice] = useState<AskAiNotice | null>(null);

  const [historySessions, setHistorySessions] = useState<
    ChatSessionSummary[] | null
  >(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const mounted = useRef(true);
  const initialized = useRef(false);
  const initializing = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true);
    if (!isAskAiApiConfigured) {
      setAiConfigured(false);
      setNotice({
        tone: "error",
        message: CHAT_COPY.NOT_CONNECTED,
        source: "connection",
      });
      setCheckingStatus(false);
      return;
    }

    const health = await probeApiHealth();
    if (!mounted.current) return;
    if (health.status === "online") {
      setAiConfigured(health.aiConfigured);
      setNotice(
        health.aiConfigured
          ? null
          : {
              tone: "info",
              message: CHAT_COPY.AI_NOT_CONFIGURED,
              source: "ai",
            },
      );
    } else {
      setAiConfigured(health.status === "unconfigured" ? false : null);
      setNotice({
        tone: "error",
        message:
          health.status === "offline"
            ? CHAT_COPY.STATUS_UNKNOWN
            : CHAT_COPY.NOT_CONNECTED,
        source: "connection",
      });
    }
    setCheckingStatus(false);
  }, []);

  const applyWorkspace = useCallback((workspace: AskAiWorkspace) => {
    setWorkspaceLoading(false);
    if (workspace.error !== null) {
      setWorkspaceError(workspace.error);
      setSubjects([]);
      setDocuments([]);
      return;
    }
    setWorkspaceError(null);
    setSubjects(workspace.subjects);
    setDocuments(workspace.documents);
  }, []);

  const initialize = useCallback(async () => {
    if (initializing.current) return;
    initializing.current = true;
    setWorkspaceLoading(true);

    let workspace: AskAiWorkspace;
    try {
      workspace = await fetchAskAiWorkspace();
    } catch {
      workspace = {
        subjects: [],
        documents: [],
        error: CHAT_COPY.WORKSPACE_ERROR,
      };
    }
    if (!mounted.current) return;
    applyWorkspace(workspace);

    const mode = await loadAiScopeMode();
    if (!mounted.current) return;
    if (workspace.error === null) {
      const stored = mode === "last" ? await loadAiLastScope() : null;
      if (!mounted.current) return;
      setScope(
        resolveInitialScope(
          mode,
          stored,
          workspace.subjects,
          workspace.documents,
        ),
      );
    }

    initialized.current = workspace.error === null;
    initializing.current = false;
  }, [applyWorkspace]);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceLoading(true);
    let workspace: AskAiWorkspace;
    try {
      workspace = await fetchAskAiWorkspace();
    } catch {
      workspace = {
        subjects: [],
        documents: [],
        error: CHAT_COPY.WORKSPACE_ERROR,
      };
    }
    if (!mounted.current) return;
    applyWorkspace(workspace);
    if (workspace.error === null) {
      setScope((current) =>
        scopeStillValid(current, workspace.subjects, workspace.documents)
          ? current
          : ALL_SCOPE,
      );
    }
  }, [applyWorkspace]);

  useFocusEffect(
    useCallback(() => {
      if (!initialized.current) {
        void initialize();
      } else {
        void refreshWorkspace();
      }
      void refreshStatus();
    }, [initialize, refreshStatus, refreshWorkspace]),
  );

  const chooseScope = useCallback(
    (next: AskScope) => {
      if (sameScope(scope, next)) return;
      setScope(next);
      setSession(null);
      setMessages([]);
      setFailed(null);
      setThreadLoading(false);
      void saveAiLastScope(scopeToStored(next));
    },
    [scope],
  );

  const newChat = useCallback(() => {
    setSession(null);
    setMessages([]);
    setFailed(null);
    setThreadLoading(false);
  }, []);

  const send = useCallback(
    async (raw: string, replaceId?: string): Promise<boolean> => {
      const content = raw.trim();
      if (
        content === "" ||
        content.length > CHAT_MESSAGE_MAX_LENGTH ||
        sendingRef.current
      ) {
        return false;
      }

      sendingRef.current = true;
      setSending(true);
      setFailed(null);
      setNotice((current) =>
        current?.source === "connection" ? current : null,
      );

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content,
        status: "complete",
        sources: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => {
        const withoutReplaced =
          replaceId === undefined
            ? current
            : current.filter((message) => message.id !== replaceId);
        return [...withoutReplaced, optimistic];
      });

      try {
        let active = session;
        if (active === null) {
          active = await askAiApi.createSession(scopeToSessionInput(scope));
          if (!mounted.current) return false;
          setSession(active);
        }

        const turn = await askAiApi.sendTurn({
          sessionId: active.id,
          content,
        });
        if (!mounted.current) return false;

        setMessages((current) => [
          ...current.filter((message) => message.id !== optimistic.id),
          turn.userMessage,
          turn.assistantMessage,
        ]);
        setSession((current) => {
          const base = current ?? active;
          return {
            ...base,
            title:
              base.title === "New chat"
                ? titleFromQuestion(content)
                : base.title,
            updatedAt: new Date().toISOString(),
          };
        });
        setAiConfigured(turn.configured);
        setNotice(
          turn.configured
            ? null
            : {
                tone: "info",
                message: CHAT_COPY.AI_NOT_CONFIGURED,
                source: "ai",
              },
        );
        setHistorySessions((current) => {
          if (current === null) return current;
          const existing = current.find((item) => item.id === active!.id);
          const updated: ChatSessionSummary = {
            ...(existing ?? active!),
            title:
              existing !== undefined && existing.title !== "New chat"
                ? existing.title
                : titleFromQuestion(content),
            updatedAt: turn.assistantMessage.createdAt,
          };
          return [
            updated,
            ...current.filter((item) => item.id !== active!.id),
          ];
        });
        return true;
      } catch (error) {
        if (!mounted.current) return false;
        const failure = toChatFailure(error);
        setFailed({
          content,
          message: failure.message,
          kind: failure.kind,
          retryable: failure.retryable,
          optimisticId: optimistic.id,
        });
        if (
          failure.kind === "unauthorized" ||
          failure.kind === "forbidden" ||
          failure.kind === "config"
        ) {
          setNotice({
            tone: "error",
            message: failure.message,
            source: "connection",
          });
        }
        return false;
      } finally {
        sendingRef.current = false;
        if (mounted.current) setSending(false);
      }
    },
    [scope, session],
  );

  const retry = useCallback(async (): Promise<void> => {
    if (failed === null || sending) return;
    const target = failed;
    setFailed(null);
    await send(target.content, target.optimisticId);
  }, [failed, send, sending]);

  const dismissFailure = useCallback(() => {
    if (failed === null) return;
    const id = failed.optimisticId;
    setMessages((current) => current.filter((message) => message.id !== id));
    setFailed(null);
  }, [failed]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const sessions = await askAiApi.listSessions();
      if (!mounted.current) return;
      setHistorySessions(sessions);
    } catch (error) {
      if (!mounted.current) return;
      setHistoryError(toChatFailure(error).message);
    } finally {
      if (mounted.current) setHistoryLoading(false);
    }
  }, []);

  const openSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setThreadLoading(true);
      setHistoryError(null);
      try {
        const detail = await askAiApi.getSession(sessionId);
        if (!mounted.current) return false;
        setSession(detail);
        setMessages(detail.messages);
        setScope(scopeFromSession(detail, subjects, documents));
        setFailed(null);
        return true;
      } catch (error) {
        if (!mounted.current) return false;
        setHistoryError(
          error instanceof ChatApiError
            ? error.message
            : CHAT_COPY.THREAD_ERROR,
        );
        return false;
      } finally {
        if (mounted.current) setThreadLoading(false);
      }
    },
    [documents, subjects],
  );

  const deleteSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setHistoryError(null);
      try {
        await askAiApi.deleteSession(sessionId);
        if (!mounted.current) return false;
        setHistorySessions((current) =>
          current === null
            ? current
            : current.filter((item) => item.id !== sessionId),
        );
        if (session?.id === sessionId) newChat();
        return true;
      } catch (error) {
        if (!mounted.current) return false;
        setHistoryError(
          error instanceof ChatApiError
            ? error.message
            : CHAT_COPY.DELETE_ERROR,
        );
        return false;
      }
    },
    [newChat, session],
  );

  return {
    scope,
    subjects,
    documents,
    indexedCount: documents.length,
    workspaceLoading,
    workspaceError,
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
  };
}
