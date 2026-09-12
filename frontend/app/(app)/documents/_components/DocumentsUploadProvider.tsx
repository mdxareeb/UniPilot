"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import {
  abortDocumentAction,
  deleteDocumentAction,
  finalizeDocumentAction,
  renameDocumentAction,
  reserveDocumentAction,
} from "@/lib/data/documentActions";
import {
  DOCUMENT_DELETE_ERROR,
  DOCUMENT_INVALID_INPUT_ERROR,
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
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/config";

type UploadPhase = "idle" | "uploading" | "error";

type DocumentsUploadContextValue = {
  phase: UploadPhase;
  /** Real byte progress (0–100), reported by the XHR upload. */
  progress: number;
  pendingName: string | null;
  error: string | null;
  notice: string | null;
  /** The most recently settled document, or the page's latest at rest. */
  document: DocumentItem | null;
  openPicker: () => void;
  upload: (file: File) => Promise<void>;
  rename: (id: string, name: string) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
};

const DocumentsUploadContext =
  createContext<DocumentsUploadContextValue | null>(null);

export function useDocumentsUpload(): DocumentsUploadContextValue {
  const value = useContext(DocumentsUploadContext);
  if (!value) {
    throw new Error(
      "useDocumentsUpload must be used inside DocumentsUploadProvider.",
    );
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
    xhr.onload = () =>
      resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);

    xhr.send(options.file);
  });
}

/**
 * The one upload pipeline (23.2/23.3/23.7/23.8), shared by the header button
 * and the drop target through this provider.
 *
 * Ordering: client pre-check → reserve (row + path) → direct upload with
 * progress → finalize (server verifies the object, its size and its magic
 * bytes). Any failure after the reservation runs the abort action, so a
 * partial upload discards its row and object. State is per-attempt: the
 * progress bar reports real bytes, an error keeps the last good document
 * visible, and success replaces it with the settled row the server verified.
 */
export function DocumentsUploadProvider({
  initialDocument,
  children,
}: {
  initialDocument: DocumentItem | null;
  children: ReactNode;
}) {
  const { requireAuth } = useSignInPrompt();
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentItem | null>(initialDocument);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const abort = useCallback(async (id: string) => {
    try {
      await abortDocumentAction(id);
    } catch {
      // Cleanup is best-effort; the finalize path already discarded anything
      // it could reach, and the 29.x sweep is the backstop.
    }
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!requireAuth("Sign in to upload documents.")) return;

      setNotice(null);
      setError(null);

      const mimeType = resolveFileMime(file);
      if (
        mimeType === null ||
        file.size <= 0 ||
        file.size > DOCUMENT_MAX_BYTES
      ) {
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

      setDocument(finalized.document);
      setPhase("idle");
      setProgress(100);
      setPendingName(null);
    },
    [abort, requireAuth],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      if (!requireAuth("Sign in to rename documents.")) return null;

      let result: Awaited<ReturnType<typeof renameDocumentAction>>;
      try {
        result = await renameDocumentAction(id, name);
      } catch {
        result = { error: DOCUMENT_RENAME_ERROR, document: null };
      }

      if (result.error !== null || result.document === null) {
        return result.error ?? DOCUMENT_RENAME_ERROR;
      }
      setDocument(result.document);
      return null;
    },
    [requireAuth],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      if (!requireAuth("Sign in to delete documents.")) return null;

      let result: Awaited<ReturnType<typeof deleteDocumentAction>>;
      try {
        result = await deleteDocumentAction(id);
      } catch {
        result = { error: DOCUMENT_DELETE_ERROR };
      }

      if (result.error !== null) return result.error;
      setDocument(null);
      setNotice("Document deleted.");
      return null;
    },
    [requireAuth],
  );

  const value = useMemo<DocumentsUploadContextValue>(
    () => ({
      phase,
      progress,
      pendingName,
      error,
      notice,
      document,
      openPicker,
      upload,
      rename,
      remove,
    }),
    [
      phase,
      progress,
      pendingName,
      error,
      notice,
      document,
      openPicker,
      upload,
      rename,
      remove,
    ],
  );

  return (
    <DocumentsUploadContext.Provider value={value}>
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
    </DocumentsUploadContext.Provider>
  );
}
