"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import {
  abortDocumentAction,
  deleteDocumentAction,
  finalizeDocumentAction,
  previewDocumentAction,
  renameDocumentAction,
  reserveDocumentAction,
  retryDocumentAction,
} from "@/lib/data/documentActions";
import {
  DOCUMENT_DELETE_ERROR,
  DOCUMENT_INVALID_INPUT_ERROR,
  DOCUMENT_PREVIEW_ERROR,
  DOCUMENT_RENAME_ERROR,
  DOCUMENT_SAVE_ERROR,
  DOCUMENT_UPLOAD_ERROR,
} from "@/lib/data/documentErrors";
import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  DOCUMENT_BUCKET,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  isDocumentMimeType,
  type DocumentItem,
  type DocumentMimeType,
} from "@/lib/data/documentValues";
import type { DocumentPreview } from "@/lib/data/documents";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/config";

type UploadPhase = "idle" | "uploading" | "error";

export type PreviewResult = {
  error: string | null;
  preview: DocumentPreview | null;
};

type DocumentsContextValue = {
  /** The hub's live list: server-loaded, then mutated optimistically. */
  documents: DocumentItem[];
  phase: UploadPhase;
  /** Real byte progress (0–100), reported by the XHR upload. */
  progress: number;
  pendingName: string | null;
  /** Sanitized upload/quota/processing copy for the hub-level notice. */
  error: string | null;
  notice: string | null;
  openPicker: () => void;
  upload: (file: File) => Promise<void>;
  /** All resolve to the sanitized error, or null on success. */
  rename: (id: string, name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  retry: (id: string) => Promise<string | null>;
  preview: (id: string) => Promise<PreviewResult>;
};

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function useDocuments(): DocumentsContextValue {
  const value = useContext(DocumentsContext);
  if (!value) {
    throw new Error("useDocuments must be used inside DocumentsWorkspace.");
  }
  return value;
}

/**
 * The browser's file MIME: the browser-provided type wins when it is one we
 * accept, otherwise the extension resolves it (some platforms report "").
 * The server's finalize step re-checks magic bytes, so this is only what the
 * user hears first — never the authority.
 */
function resolveFileMime(file: File): DocumentMimeType | null {
  if (isDocumentMimeType(file.type)) return file.type;

  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = dot > 0 ? lower.slice(dot + 1) : "";
  for (const [mime, meta] of Object.entries(DOCUMENT_MIME_TYPES)) {
    if ((meta.extensions as readonly string[]).includes(extension)) {
      return mime as DocumentMimeType;
    }
  }
  return null;
}

/**
 * The direct browser→Storage upload (23.2/23.7): supabase-js `upload()` has
 * no progress events, so the pipeline speaks the Storage REST endpoint over
 * XHR and reports real `upload.onprogress` values. The session access token
 * is read from the browser client and used only in this request — never
 * logged, never stored.
 */
function putObjectWithProgress(options: {
  url: string;
  anonKey: string;
  accessToken: string;
  path: string;
  mimeType: DocumentMimeType;
  file: File;
  onProgress: (percent: number) => void;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${options.url}/storage/v1/object/${DOCUMENT_BUCKET}/${options.path}`,
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

/** The 18.x hub's refresh policy while processing is in flight. */
const INDEXING_POLL_MS = 4_000;

/**
 * The documents workspace (18.x hub; 23.x/24.x pipeline): the client boundary
 * that owns the list the server page loaded and every mutation the hub
 * performs.
 *
 * The page stays the server owner of access and data (`getWorkspaceAccess` →
 * `listDocuments`) and passes the initial list here. Rename/delete/retry are
 * optimistic with rollback and the settled row reconciled back in; uploads
 * ride the 23.x reserve → direct upload → finalize pipeline and insert the
 * settled card.
 *
 * Async processing (18.8–18.10): while any document is `indexing`, the
 * workspace asks the server for a fresh render every four seconds
 * (`router.refresh()`; the interval clears the moment none remains), and the
 * refreshed `initialDocuments` replace the local list. This is deliberately
 * polling a server-owned read rather than inventing a client socket: the
 * worker owns the status, `revalidatePath` already refreshes after actions,
 * and a bounded interval is the smallest honest mechanism until a realtime
 * channel is justified.
 */
export function DocumentsWorkspace({
  initialDocuments,
  guest,
  children,
}: {
  initialDocuments: DocumentItem[];
  guest: boolean;
  children: ReactNode;
}) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();
  const [documents, setDocuments] =
    useState<DocumentItem[]>(initialDocuments);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* The refreshed server render is authoritative at rest. React's documented
     "adjust state when a prop changes" pattern (derived during render, not in
     an effect): a new `initialDocuments` identity swaps the local list unless
     an upload is mid-flight, where the optimistic card is the newer truth. */
  const [serverSnapshot, setServerSnapshot] =
    useState<DocumentItem[]>(initialDocuments);
  if (initialDocuments !== serverSnapshot) {
    setServerSnapshot(initialDocuments);
    if (phase !== "uploading") setDocuments(initialDocuments);
  }

  const anyIndexing = documents.some(
    (document) => document.statusValue === "indexing",
  );

  useEffect(() => {
    if (guest || !anyIndexing) return;
    const timer = window.setInterval(() => router.refresh(), INDEXING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [guest, anyIndexing, router]);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const abort = useCallback(async (id: string) => {
    try {
      await abortDocumentAction(id);
    } catch {
      // Cleanup is best-effort; finalize already discarded what it could.
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!requireAuth("Sign in to upload documents.")) return;

      setNotice(null);
      setError(null);

      const mimeType = resolveFileMime(file);
      if (mimeType === null || file.size <= 0 || file.size > DOCUMENT_MAX_BYTES) {
        setPendingName(null);
        setPhase("error");
        setError(DOCUMENT_INVALID_INPUT_ERROR);
        return;
      }

      setPhase("uploading");
      setProgress(0);
      setPendingName(file.name);

      let reserved: Awaited<ReturnType<typeof reserveDocumentAction>>;
      try {
        reserved = await reserveDocumentAction({
          name: file.name,
          mimeType,
          sizeBytes: file.size,
        });
      } catch {
        reserved = { error: DOCUMENT_SAVE_ERROR, upload: null };
      }

      if (reserved.error !== null || reserved.upload === null) {
        setPhase("error");
        setError(reserved.error ?? DOCUMENT_SAVE_ERROR);
        setPendingName(null);
        return;
      }

      const { id, path } = reserved.upload;
      const { url, anonKey } = getSupabaseEnv();
      const { data: session } = await createClient().auth.getSession();
      const accessToken = session.session?.access_token ?? "";
      if (accessToken === "") {
        await abort(id);
        setPhase("error");
        setError(DOCUMENT_UPLOAD_ERROR);
        setPendingName(null);
        return;
      }

      const uploaded = await putObjectWithProgress({
        url,
        anonKey,
        accessToken,
        path,
        mimeType,
        file,
        onProgress: setProgress,
      });
      if (!uploaded) {
        await abort(id);
        setPhase("error");
        setError(DOCUMENT_UPLOAD_ERROR);
        setPendingName(null);
        return;
      }

      let finalized: Awaited<ReturnType<typeof finalizeDocumentAction>>;
      try {
        finalized = await finalizeDocumentAction(id);
      } catch {
        finalized = { error: DOCUMENT_SAVE_ERROR, document: null };
      }

      if (finalized.error !== null || finalized.document === null) {
        await abort(id);
        setPhase("error");
        setError(finalized.error ?? DOCUMENT_SAVE_ERROR);
        setPendingName(null);
        return;
      }

      setDocuments((previous) => [
        finalized.document!,
        ...previous.filter((document) => document.id !== finalized.document!.id),
      ]);
      setPhase("idle");
      setProgress(100);
      setPendingName(null);
    },
    [abort, requireAuth],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      if (!requireAuth("Sign in to rename documents.")) return null;

      const previous = documents;
      // Optimistic: the name changes under the pointer; the settled row
      // reconciles a moment later, or the snapshot comes back on failure.
      setDocuments((list) =>
        list.map((document) =>
          document.id === id ? { ...document, name } : document,
        ),
      );

      let result: Awaited<ReturnType<typeof renameDocumentAction>>;
      try {
        result = await renameDocumentAction(id, name);
      } catch {
        result = { error: DOCUMENT_RENAME_ERROR, document: null };
      }

      if (result.error !== null || result.document === null) {
        setDocuments(previous);
        return result.error ?? DOCUMENT_RENAME_ERROR;
      }

      setDocuments((list) =>
        list.map((document) =>
          document.id === id ? result.document! : document,
        ),
      );
      return null;
    },
    [documents, requireAuth],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      if (!requireAuth("Sign in to delete documents.")) return null;

      const index = documents.findIndex((document) => document.id === id);
      if (index === -1) return DOCUMENT_DELETE_ERROR;
      const previous = documents[index];

      setDocuments((list) => list.filter((document) => document.id !== id));

      let result: Awaited<ReturnType<typeof deleteDocumentAction>>;
      try {
        result = await deleteDocumentAction(id);
      } catch {
        result = { error: DOCUMENT_DELETE_ERROR };
      }

      if (result.error !== null) {
        setDocuments((list) => {
          const next = [...list];
          next.splice(Math.min(index, next.length), 0, previous);
          return next;
        });
        return result.error;
      }

      setNotice("Document deleted.");
      return null;
    },
    [documents, requireAuth],
  );

  const retry = useCallback(
    async (id: string): Promise<string | null> => {
      if (!requireAuth("Sign in to retry documents.")) return null;

      const previous = documents;
      setDocuments((list) =>
        list.map((document) =>
          document.id === id
            ? { ...document, statusValue: "indexing", statusLabel: "Parsing…", errorMessage: undefined }
            : document,
        ),
      );

      let result: Awaited<ReturnType<typeof retryDocumentAction>>;
      try {
        result = await retryDocumentAction(id);
      } catch {
        result = { error: DOCUMENT_SAVE_ERROR, document: null };
      }

      if (result.error !== null || result.document === null) {
        setDocuments(previous);
        return result.error ?? DOCUMENT_SAVE_ERROR;
      }

      setDocuments((list) =>
        list.map((document) =>
          document.id === id ? result.document! : document,
        ),
      );
      return null;
    },
    [documents, requireAuth],
  );

  const preview = useCallback(
    async (id: string): Promise<PreviewResult> => {
      if (!requireAuth("Sign in to preview documents.")) {
        return { error: null, preview: null };
      }
      try {
        return await previewDocumentAction(id);
      } catch {
        return { error: DOCUMENT_PREVIEW_ERROR, preview: null };
      }
    },
    [requireAuth],
  );

  const value = useMemo<DocumentsContextValue>(
    () => ({
      documents,
      phase,
      progress,
      pendingName,
      error,
      notice,
      openPicker,
      upload,
      rename,
      remove,
      retry,
      preview,
    }),
    [
      documents,
      phase,
      progress,
      pendingName,
      error,
      notice,
      openPicker,
      upload,
      rename,
      remove,
      retry,
      preview,
    ],
  );

  return (
    <DocumentsContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT_ATTRIBUTE}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </DocumentsContext.Provider>
  );
}
