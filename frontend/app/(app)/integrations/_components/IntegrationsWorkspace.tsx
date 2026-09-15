"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import {
  abortExportRunAction,
  confirmCandidateAction,
  createExportRunAction,
  disconnectWhatsAppAction,
  finalizeExportRunAction,
  getWhatsAppStatusAction,
  rejectCandidateAction,
  startLiveConnectAction,
  startLiveScanAction,
} from "@/lib/data/integrationActions";
import {
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_INVALID_FILE_ERROR,
  WHATSAPP_UPLOAD_ERROR,
} from "@/lib/data/integrationErrors";
import {
  isWhatsAppRunActive,
  parseWhatsAppExport,
  WHATSAPP_CANDIDATE_STATUS_LABELS,
  WHATSAPP_CONNECTION_STATUS_LABELS,
  WHATSAPP_EXPORT_BUCKET,
  WHATSAPP_REVIEW_MODE_LABELS,
  WHATSAPP_RUN_STATUS_LABELS,
  type WhatsAppCandidateItem,
  type WhatsAppConnectionItem,
  type WhatsAppDateOrder,
  type WhatsAppReviewMode,
  type WhatsAppRunItem,
} from "@/lib/data/integrationValues";
import type {
  GoogleConnectionStatus,
  WhatsAppOverview,
} from "@/lib/data/integrations";
import { formatTaskDueDate } from "@/lib/data/taskDates";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/config";

/** The one reason every gated action on this card routes to the prompt. */
export const WHATSAPP_AUTH_REASON = "Sign in to connect WhatsApp.";

/** The 46.x status poll: only while a run or a connection is in flight. */
const STATUS_POLL_MS = 3_000;

/** The upload pipeline's honest states; `data-upload-phase` carries this. */
export type WhatsAppUploadPhase = "idle" | "uploading" | "error";

type IntegrationsContextValue = {
  /** The live runs/candidates/connection, seeded from the server render. */
  runs: WhatsAppRunItem[];
  candidates: WhatsAppCandidateItem[];
  connection: WhatsAppConnectionItem | null;
  liveEnabled: boolean;
  /** The polled login QR, held only while a connection is pending. */
  qr: string | null;
  /** True while a live connect/scan/disconnect action is in flight. */
  liveBusy: boolean;
  googleStatus: GoogleConnectionStatus | null;
  /** The sanitized success line and the sanitized failure line. */
  notice: string | null;
  error: string | null;
  /** The direct-upload pipeline's phase, real byte progress and file name. */
  phase: WhatsAppUploadPhase;
  progress: number;
  pendingName: string | null;
  /** The review mode the next upload sends; starts at the saved default. */
  reviewMode: WhatsAppReviewMode;
  setReviewMode: (mode: WhatsAppReviewMode) => void;
  /** The date order the next upload sends; starts at the saved default. */
  dateOrder: WhatsAppDateOrder;
  setDateOrder: (order: WhatsAppDateOrder) => void;
  /** Whether relative dates are detected; starts at the saved default. */
  detectRelativeDates: boolean;
  setDetectRelativeDates: (value: boolean) => void;
  /** Reserve → direct upload → finalize; errors land in `error`. */
  upload: (file: File) => void;
  /** Link the self-host browser (no-op while pending/connected). */
  connectLive: () => void;
  /** Reserve a live run for the chat name; true when it was enqueued. */
  scanLive: (chatName: string) => Promise<boolean>;
  /** Disconnect, purge the profile and delete the owner's raw archive. */
  disconnectLive: () => Promise<boolean>;
  /** Resolve true when the candidate settled; false leaves it pending. */
  confirm: (candidate: WhatsAppCandidateItem) => Promise<boolean>;
  reject: (candidate: WhatsAppCandidateItem) => Promise<boolean>;
};

const IntegrationsContext = createContext<IntegrationsContextValue | null>(null);

export function useIntegrations(): IntegrationsContextValue {
  const value = useContext(IntegrationsContext);
  if (!value) {
    throw new Error("useIntegrations must be used inside IntegrationsWorkspace.");
  }
  return value;
}

/**
 * The direct browser→Storage upload (P5.2), the `DocumentsWorkspace` helper
 * with the WhatsApp bucket and MIME: supabase-js `upload()` has no progress
 * events, so the pipeline speaks the Storage REST endpoint over XHR and
 * reports real `upload.onprogress` values. The session access token is read
 * from the browser client and used only in this request — never logged, never
 * stored.
 */
function putObjectWithProgress(options: {
  url: string;
  anonKey: string;
  accessToken: string;
  path: string;
  mimeType: "text/plain";
  file: File;
  onProgress: (percent: number) => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${options.url}/storage/v1/object/${WHATSAPP_EXPORT_BUCKET}/${options.path}`,
    );
    xhr.setRequestHeader("Authorization", `Bearer ${options.accessToken}`);
    xhr.setRequestHeader("apikey", options.anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("Content-Type", options.mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);

    xhr.send(options.file);
  });
}

/**
 * The integrations client boundary (P5.1), the `DocumentsWorkspace` shape: the
 * server page owns the read (`getWorkspaceAccess` → `getWhatsAppOverview` /
 * `getGoogleStatus`) and hands the serializable overview to this provider,
 * which owns the live runs/candidates/connection, the confirm/dismiss pair and
 * the sanitized notice/error lines. `WhatsAppCard` is the presentation over
 * the context.
 *
 * Polling: while any run is `queued`/`running` or the connection is `pending`,
 * `getWhatsAppStatusAction` is asked every three seconds — the same bounded
 * interval `DocumentsWorkspace` uses for indexing, because the worker owns the
 * status and a network read is the smallest honest mechanism. The same tick
 * carries the owner-only QR data-URL while the connection is pending; it is
 * held in state only for that window and dropped the moment the connection
 * settles or the refreshed render stops showing pending. The interval clears
 * the moment nothing is in flight. Actions call `router.refresh()` so the
 * refreshed server render becomes authoritative at rest; the derived-state
 * swap below applies that render (P5.2 extends the guard when an optimistic
 * upload is mid-flight). P6.1's connect/scan/disconnect callbacks follow the
 * same shape and run `requireAuth` first, so a guest click opens the prompt
 * and never reaches a Server Action.
 *
 * Guests never poll: `getWhatsAppOverview` is never called for them and every
 * action runs `requireAuth` first.
 */
export function IntegrationsWorkspace({
  initial,
  guest,
  liveEnabled,
  googleStatus,
  children,
}: {
  initial: WhatsAppOverview | null;
  guest: boolean;
  liveEnabled: boolean;
  googleStatus: GoogleConnectionStatus | null;
  children: ReactNode;
}) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();
  const [runs, setRuns] = useState<WhatsAppRunItem[]>(initial?.runs ?? []);
  const [candidates, setCandidates] = useState<WhatsAppCandidateItem[]>(
    initial?.candidates ?? [],
  );
  const [connection, setConnection] =
    useState<WhatsAppConnectionItem | null>(initial?.connection ?? null);
  const [qr, setQr] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<WhatsAppUploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState<string | null>(null);
  /* The mode choice is the user's own state once touched; it starts from the
     server's saved default (46.21) and a refreshed render never stomps a
     selection the user just made. The detection settings (46.26) follow the
     same rule. */
  const [reviewMode, setReviewMode] = useState<WhatsAppReviewMode>(
    initial?.connection?.reviewMode ?? "manual",
  );
  const [dateOrder, setDateOrder] = useState<WhatsAppDateOrder>(
    initial?.connection?.dateOrder ?? "DMY",
  );
  const [detectRelativeDates, setDetectRelativeDates] = useState<boolean>(
    initial?.connection?.detectRelativeDates ?? false,
  );

  /* The refreshed server render is authoritative at rest (React's documented
     "adjust state when a prop changes" pattern — the same swap
     `DocumentsWorkspace` performs for its document list). An upload in flight
     is the one exception: the pipeline's own state is the newer truth until it
     settles. The polled QR is dropped the moment the render no longer shows a
     pending connection — it must never outlive the pending window. */
  const [serverSnapshot, setServerSnapshot] = useState(initial);
  if (initial !== serverSnapshot) {
    setServerSnapshot(initial);
    if (phase !== "uploading") {
      setRuns(initial?.runs ?? []);
      setCandidates(initial?.candidates ?? []);
      setConnection(initial?.connection ?? null);
      if (initial?.connection?.statusValue !== "pending") setQr(null);
    }
  }

  const hasActiveRun = runs.some(isWhatsAppRunActive);
  const pendingConnection = connection?.statusValue === "pending";

  useEffect(() => {
    if (guest || (!hasActiveRun && !pendingConnection)) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await getWhatsAppStatusAction();
          if (cancelled || result.error !== null) return;
          setRuns(result.runs);
          setCandidates(result.candidates);
          setConnection(result.connection);
          setQr(result.qr);
        } catch {
          // A background poll is best-effort: the next tick retries.
        }
      })();
    }, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [guest, hasActiveRun, pendingConnection]);

  const abort = useCallback(async (runId: string) => {
    try {
      await abortExportRunAction(runId);
    } catch {
      // Cleanup is best-effort; finalize already discarded what it could.
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return;

      setNotice(null);
      setError(null);

      const draft = parseWhatsAppExport({
        name: file.name,
        sizeBytes: file.size,
        reviewMode,
        dateOrder,
        detectRelativeDates,
      });
      if (draft === null) {
        setPhase("error");
        setError(WHATSAPP_INVALID_FILE_ERROR);
        return;
      }

      setPhase("uploading");
      setProgress(0);
      setPendingName(file.name);

      let reserved: Awaited<ReturnType<typeof createExportRunAction>>;
      try {
        reserved = await createExportRunAction(draft);
      } catch {
        reserved = { error: WHATSAPP_GENERIC_ERROR, upload: null };
      }

      if (reserved.error !== null || reserved.upload === null) {
        setPhase("error");
        setError(reserved.error ?? WHATSAPP_GENERIC_ERROR);
        setPendingName(null);
        return;
      }

      const { runId, path } = reserved.upload;
      const { url, anonKey } = getSupabaseEnv();
      const { data: session } = await createClient().auth.getSession();
      const accessToken = session.session?.access_token ?? "";
      if (accessToken === "") {
        await abort(runId);
        setPhase("error");
        setError(WHATSAPP_UPLOAD_ERROR);
        setPendingName(null);
        return;
      }

      const uploaded = await putObjectWithProgress({
        url,
        anonKey,
        accessToken,
        path,
        mimeType: "text/plain",
        file,
        onProgress: setProgress,
      });
      if (!uploaded) {
        await abort(runId);
        setPhase("error");
        setError(WHATSAPP_UPLOAD_ERROR);
        setPendingName(null);
        return;
      }

      let finalized: Awaited<ReturnType<typeof finalizeExportRunAction>>;
      try {
        finalized = await finalizeExportRunAction(runId);
      } catch {
        finalized = { error: WHATSAPP_GENERIC_ERROR };
      }

      if (finalized.error !== null) {
        await abort(runId);
        setPhase("error");
        setError(finalized.error);
        setPendingName(null);
        return;
      }

      /* The reserved run is real in the DB, so its optimistic row is the
         settled shape: the 3 s poll (and the refreshed render) reconcile it. */
      const optimistic: WhatsAppRunItem = {
        id: runId,
        mode: "export",
        reviewMode,
        reviewModeLabel: WHATSAPP_REVIEW_MODE_LABELS[reviewMode],
        statusValue: "queued",
        statusLabel: WHATSAPP_RUN_STATUS_LABELS.queued,
        messageCount: 0,
        candidateCount: 0,
        capped: false,
        dateLabel: formatTaskDueDate(
          new Date().toISOString(),
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      };
      setRuns((previous) => [
        optimistic,
        ...previous.filter((run) => run.id !== runId),
      ]);
      setPhase("idle");
      setProgress(100);
      setPendingName(null);
      router.refresh();
    },
    [abort, requireAuth, reviewMode, dateOrder, detectRelativeDates, router],
  );

  /**
   * P6.1 — link. `requireAuth` first (a guest click opens the prompt and
   * fetches nothing), then the action; a success swaps the connection to the
   * pending shape immediately so the status poll starts on its first tick
   * instead of waiting for the refreshed render, and any previously held QR is
   * discarded.
   */
  const connectLive = useCallback(async () => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setNotice(null);
    setError(null);
    setLiveBusy(true);
    try {
      const result = await startLiveConnectAction();
      if (result.error !== null) {
        setError(result.error);
        router.refresh();
        return;
      }
      setQr(null);
      setConnection((previous) => ({
        id: previous?.id ?? "pending",
        statusValue: "pending",
        statusLabel: WHATSAPP_CONNECTION_STATUS_LABELS.pending,
        reviewMode: previous?.reviewMode ?? "manual",
        reviewModeLabel:
          WHATSAPP_REVIEW_MODE_LABELS[previous?.reviewMode ?? "manual"],
        dateOrder: previous?.dateOrder ?? "DMY",
        detectRelativeDates: previous?.detectRelativeDates ?? false,
      }));
      router.refresh();
    } catch {
      setError(WHATSAPP_GENERIC_ERROR);
      router.refresh();
    } finally {
      setLiveBusy(false);
    }
  }, [requireAuth, router]);

  /**
   * P6.1 — scan one chat. `requireAuth` first; the name boundary lives in the
   * action (trimmed, 1..100) so the browser's copy is never the authority.
   */
  const scanLive = useCallback(
    async (chatName: string): Promise<boolean> => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return false;
      setNotice(null);
      setError(null);
      setLiveBusy(true);
      try {
        const result = await startLiveScanAction(chatName);
        if (result.error !== null) {
          setError(result.error);
          router.refresh();
          return false;
        }
        setNotice("Scan started. It may take a few minutes.");
        router.refresh();
        return true;
      } catch {
        setError(WHATSAPP_GENERIC_ERROR);
        router.refresh();
        return false;
      } finally {
        setLiveBusy(false);
      }
    },
    [requireAuth, router],
  );

  /**
   * P6.1 — disconnect. `requireAuth` first, then the action; a success swaps
   * the connection to the disconnected shape and drops the polled QR.
   */
  const disconnectLive = useCallback(async (): Promise<boolean> => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return false;
    setNotice(null);
    setError(null);
    setLiveBusy(true);
    try {
      const result = await disconnectWhatsAppAction();
      if (result.error !== null) {
        setError(result.error);
        router.refresh();
        return false;
      }
      setQr(null);
      setConnection((previous) => ({
        id: previous?.id ?? "pending",
        statusValue: "disconnected",
        statusLabel: WHATSAPP_CONNECTION_STATUS_LABELS.disconnected,
        reviewMode: previous?.reviewMode ?? "manual",
        reviewModeLabel:
          WHATSAPP_REVIEW_MODE_LABELS[previous?.reviewMode ?? "manual"],
        dateOrder: previous?.dateOrder ?? "DMY",
        detectRelativeDates: previous?.detectRelativeDates ?? false,
      }));
      setNotice("WhatsApp disconnected.");
      router.refresh();
      return true;
    } catch {
      setError(WHATSAPP_GENERIC_ERROR);
      router.refresh();
      return false;
    } finally {
      setLiveBusy(false);
    }
  }, [requireAuth, router]);

  const confirm = useCallback(
    async (candidate: WhatsAppCandidateItem): Promise<boolean> => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return false;
      setNotice(null);
      setError(null);
      try {
        const result = await confirmCandidateAction(candidate.id);
        if (result.error !== null) {
          setError(result.error);
          router.refresh();
          return false;
        }
        setCandidates((list) =>
          list.map((item) =>
            item.id === candidate.id
              ? {
                  ...item,
                  statusValue: "confirmed",
                  statusLabel: WHATSAPP_CANDIDATE_STATUS_LABELS.confirmed,
                  /* The enqueue is not the push: `pushed` stays false until
                     the refreshed render reads a real `pushed_at`, and the
                     in-flight state travels as `pushing`. */
                  pushed: false,
                  pushing: result.pushed,
                }
              : item,
          ),
        );
        setNotice(
          result.pushed
            ? "Added — syncing to Google Calendar"
            : "Added to your calendar.",
        );
        router.refresh();
        return true;
      } catch {
        setError(WHATSAPP_GENERIC_ERROR);
        router.refresh();
        return false;
      }
    },
    [requireAuth, router],
  );

  const reject = useCallback(
    async (candidate: WhatsAppCandidateItem): Promise<boolean> => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return false;
      setNotice(null);
      setError(null);
      try {
        const result = await rejectCandidateAction(candidate.id);
        if (result.error !== null) {
          setError(result.error);
          router.refresh();
          return false;
        }
        setCandidates((list) =>
          list.map((item) =>
            item.id === candidate.id
              ? {
                  ...item,
                  statusValue: "rejected",
                  statusLabel: WHATSAPP_CANDIDATE_STATUS_LABELS.rejected,
                }
              : item,
          ),
        );
        setNotice("Dismissed. It won't come back on re-scan.");
        router.refresh();
        return true;
      } catch {
        setError(WHATSAPP_GENERIC_ERROR);
        router.refresh();
        return false;
      }
    },
    [requireAuth, router],
  );

  const value = useMemo<IntegrationsContextValue>(
    () => ({
      runs,
      candidates,
      connection,
      liveEnabled,
      qr,
      liveBusy,
      googleStatus,
      notice,
      error,
      phase,
      progress,
      pendingName,
      reviewMode,
      setReviewMode,
      dateOrder,
      setDateOrder,
      detectRelativeDates,
      setDetectRelativeDates,
      upload,
      connectLive,
      scanLive,
      disconnectLive,
      confirm,
      reject,
    }),
    [
      runs,
      candidates,
      connection,
      liveEnabled,
      qr,
      liveBusy,
      googleStatus,
      notice,
      error,
      phase,
      progress,
      pendingName,
      reviewMode,
      dateOrder,
      detectRelativeDates,
      upload,
      connectLive,
      scanLive,
      disconnectLive,
      confirm,
      reject,
    ],
  );

  return (
    <IntegrationsContext.Provider value={value}>
      {children}
    </IntegrationsContext.Provider>
  );
}
