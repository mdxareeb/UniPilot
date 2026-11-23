import { supabase } from "@/lib/supabase";

import { bytesToBase64 } from "./fileBytes";
import { uploadDocument } from "./fileIo";

/**
 * The Bearer client for mobile File Tools.
 *
 * All server work that holds a secret or the job queue goes through these
 * routes; the JWT is the only credential and never leaves the header. Errors
 * are sanitized UI copy, including the bounded 413/429/503 cases.
 */
export type FileToolErrorKind =
  | "config"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "too_large"
  | "rate_limited"
  | "unavailable"
  | "provider"
  | "network"
  | "server"
  | "parse";

export class FileToolApiError extends Error {
  readonly kind: FileToolErrorKind;
  readonly status: number | null;

  constructor(kind: FileToolErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "FileToolApiError";
    this.kind = kind;
    this.status = status;
  }
}

export const FILE_TOOL_COPY = {
  NOT_CONNECTED: "This build isn't connected to the UniPilot server.",
  SIGNED_OUT: "Sign in again to continue.",
  FORBIDDEN: "Finish setting up your account first.",
  INVALID: "That file couldn't be accepted. Check its type and size.",
  TOO_LARGE: "That file is larger than the allowed limit.",
  RATE_LIMITED: "You've reached the limit for now. Try again in a minute.",
  UNAVAILABLE: "The server is temporarily unavailable. Try again in a moment.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
  SERVER: "Something went wrong. Please try again.",
  PARSE: "The server returned an unreadable response. Try again.",
  SAVE_CANCELLED: "Save cancelled.",
} as const;

type ReserveResponse = { documentId: string; uploadPath: string };
export type MaterialsMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "image/png"
  | "image/jpeg";
type OcrResponse = {
  configured: boolean;
  status: "indexed" | "saved_not_searchable";
  error?: string;
  pages?: number;
  characters?: number;
  alreadyIndexed?: boolean;
};

export type PdfProbe = {
  hasText: boolean;
  pageCount: number;
  characters: number;
};

export type OcrPreviewResponse = {
  configured: boolean;
  text: string;
  charCount: number;
  error?: string;
};

export type OcrPageFile = {
  uri: string;
  name: string;
  type: "image/jpeg" | "image/png";
};

export type SaveToMaterialsResult = {
  status: "indexed" | "indexing" | "saved_not_searchable" | "error";
  error: string | null;
  /** Present once the reservation exists, so Ask AI can poll its status. */
  documentId: string | null;
};

export function createFileToolsApi(deps: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  const base = deps.baseUrl.trim().replace(/\/+$/, "");
  const doFetch = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 120_000;

  async function call(
    path: string,
    init: {
      method: "GET" | "POST";
      body?: BodyInit | Record<string, unknown>;
      /** FormData must never be JSON-stringified by the auto-detection. */
      json?: boolean;
    } = { method: "GET" },
  ): Promise<Response> {
    if (base === "") {
      throw new FileToolApiError("config", FILE_TOOL_COPY.NOT_CONNECTED);
    }
    const token = await deps.getToken();
    if (token === null || token === "") {
      throw new FileToolApiError("unauthorized", FILE_TOOL_COPY.SIGNED_OUT);
    }

    const isJson =
      init.json ??
      (init.body !== undefined &&
        !(init.body instanceof FormData) &&
        typeof init.body === "object" &&
        !(init.body instanceof ArrayBuffer) &&
        !(init.body instanceof Blob));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Cache-Control": "no-store",
    };
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      if (isJson) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.body);
      } else {
        body = init.body as BodyInit;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        method: init.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      throw new FileToolApiError("network", FILE_TOOL_COPY.NETWORK);
    } finally {
      clearTimeout(timer);
    }
  }

  async function jsonOrNull(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function errorFrom(status: number, body: unknown): FileToolApiError {
    const serverError =
      typeof (body as { error?: unknown })?.error === "string"
        ? (body as { error: string }).error
        : null;
    if (status === 401) {
      return new FileToolApiError("unauthorized", FILE_TOOL_COPY.SIGNED_OUT, status);
    }
    if (status === 403) {
      return new FileToolApiError("forbidden", FILE_TOOL_COPY.FORBIDDEN, status);
    }
    if (status === 404) {
      return new FileToolApiError(
        "not_found",
        serverError ?? "That file is no longer available.",
        status,
      );
    }
    if (status === 413) {
      return new FileToolApiError(
        "too_large",
        serverError ?? FILE_TOOL_COPY.TOO_LARGE,
        status,
      );
    }
    if (status === 429) {
      return new FileToolApiError(
        "rate_limited",
        serverError ?? FILE_TOOL_COPY.RATE_LIMITED,
        status,
      );
    }
    if (status === 503) {
      return new FileToolApiError(
        "unavailable",
        serverError ?? FILE_TOOL_COPY.UNAVAILABLE,
        status,
      );
    }
    if (status === 400) {
      return new FileToolApiError(
        "invalid",
        serverError ?? FILE_TOOL_COPY.INVALID,
        status,
      );
    }
    if (status === 415) {
      return new FileToolApiError(
        "invalid",
        serverError ?? FILE_TOOL_COPY.INVALID,
        status,
      );
    }
    if (status === 502) {
      return new FileToolApiError(
        "provider",
        serverError ?? FILE_TOOL_COPY.UNAVAILABLE,
        status,
      );
    }
    return new FileToolApiError("server", serverError ?? FILE_TOOL_COPY.SERVER, status);
  }

  async function requireJson(response: Response): Promise<unknown> {
    const body = await jsonOrNull(response);
    if (!response.ok) throw errorFrom(response.status, body);
    if (body === null) throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
    return body;
  }

  return {
    async reserve(input: {
      name: string;
      mimeType: MaterialsMimeType;
      sizeBytes: number;
      subjectId: string | null;
    }): Promise<ReserveResponse> {
      const response = await call("/api/mobile/documents/reserve", {
        method: "POST",
        body: input,
      });
      const body = (await requireJson(response)) as Partial<ReserveResponse>;
      if (
        typeof body.documentId !== "string" ||
        typeof body.uploadPath !== "string"
      ) {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return { documentId: body.documentId, uploadPath: body.uploadPath };
    },

    async finalize(
      documentId: string,
      mode: "process" | "ocr",
    ): Promise<"indexing" | "ocr_required"> {
      const response = await call(
        `/api/mobile/documents/${documentId}/finalize`,
        { method: "POST", body: { mode } },
      );
      const body = (await requireJson(response)) as { status?: unknown };
      if (body.status !== "indexing" && body.status !== "ocr_required") {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return body.status;
    },

    async ocr(documentId: string, pages: OcrPageFile[]): Promise<OcrResponse> {
      const form = new FormData();
      form.append("documentId", documentId);
      for (const page of pages) {
        appendFile(form, "pages", page);
      }
      const response = await call("/api/mobile/tools/ocr", {
        method: "POST",
        body: form,
        json: false,
      });
      const body = (await requireJson(response)) as Partial<OcrResponse>;
      if (typeof body.configured !== "boolean") {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return body as OcrResponse;
    },

    /**
     * OCR one image for a preview. The server enforces the same page/token
     * ledger as indexing but never writes a `documents` row.
     */
    async ocrPreview(image: OcrPageFile): Promise<OcrPreviewResponse> {
      const form = new FormData();
      appendFile(form, "image", image);
      const response = await call("/api/mobile/tools/ocr", {
        method: "POST",
        body: form,
        json: false,
      });
      const body = (await requireJson(response)) as Partial<OcrPreviewResponse>;
      if (typeof body.configured !== "boolean") {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return {
        configured: body.configured,
        text: typeof body.text === "string" ? body.text : "",
        charCount: typeof body.charCount === "number" ? body.charCount : 0,
        ...(typeof body.error === "string" ? { error: body.error } : {}),
      };
    },

    /**
     * OCR a PDF already stored by reserve/finalize. The route reads the object
     * with the owner JWT; the client never re-uploads the same bytes.
     */
    async ocrStoredPdf(documentId: string): Promise<OcrResponse> {
      const response = await call("/api/mobile/tools/ocr", {
        method: "POST",
        body: { documentId },
      });
      const body = (await requireJson(response)) as Partial<OcrResponse>;
      if (typeof body.configured !== "boolean") {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return body as OcrResponse;
    },

    /** Check whether a PDF has a real text layer (no provider call). */
    async probePdf(file: {
      uri: string;
      name: string;
      mimeType: string | null;
    }): Promise<PdfProbe> {
      const form = new FormData();
      appendFile(form, "file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/pdf",
      });
      const response = await call("/api/mobile/tools/pdf-probe", {
        method: "POST",
        body: form,
        json: false,
      });
      const body = (await requireJson(response)) as Partial<PdfProbe>;
      if (
        typeof body.hasText !== "boolean" ||
        typeof body.pageCount !== "number" ||
        typeof body.characters !== "number"
      ) {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return {
        hasText: body.hasText,
        pageCount: body.pageCount,
        characters: body.characters,
      };
    },

    /** Convert one file; the response body is already the target bytes. */
    async convert(file: {
      uri: string;
      name: string;
      mimeType: string | null;
      targetFormat?: "pdf" | "txt" | "md" | "docx";
    }): Promise<{
      bytes: Uint8Array;
      base64: string;
      name: string;
      mimeType: string;
    }> {
      const form = new FormData();
      appendFile(form, "file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      });
      if (file.targetFormat !== undefined) {
        form.append("targetFormat", file.targetFormat);
      }
      const response = await call("/api/mobile/tools/convert", {
        method: "POST",
        body: form,
        json: false,
      });
      if (!response.ok) {
        throw errorFrom(response.status, await jsonOrNull(response));
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0) {
        throw new FileToolApiError("parse", FILE_TOOL_COPY.PARSE);
      }
      return {
        bytes,
        base64: bytesToBase64(bytes),
        name:
          response.headers.get("X-Unipilot-Filename") ??
          file.name.replace(/\.[^.]+$/, "") + ".pdf",
        mimeType:
          response.headers.get("Content-Type") ?? "application/octet-stream",
      };
    },
  };
}

/**
 * Upload one supported Course Materials type and hand it to the right
 * indexer. PDFs use the worker unless OCR was requested; images must send
 * their page image to the ledgered OCR route because the worker has no image
 * extractor yet.
 */
export async function saveFileToMaterials(
  api: ReturnType<typeof createFileToolsApi>,
  input: {
    bytes: Uint8Array;
    name: string;
    mimeType: MaterialsMimeType;
    subjectId: string | null;
    mode: "ocr" | "process";
    pages?: OcrPageFile[];
  },
): Promise<SaveToMaterialsResult> {
  let reserved: ReserveResponse;
  try {
    reserved = await api.reserve({
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      subjectId: input.subjectId,
    });
  } catch (error) {
    return {
      status: "error",
      error:
        error instanceof FileToolApiError
          ? error.message
          : FILE_TOOL_COPY.SERVER,
      documentId: null,
    };
  }

  const uploaded = await uploadDocument(
    reserved.uploadPath,
    input.bytes,
    input.mimeType,
  );
  if (uploaded.error !== null) {
    // finalize's missing-object branch discards the reservation row.
    await api.finalize(reserved.documentId, "process").catch(() => undefined);
    return {
      status: "error",
      error: uploaded.error,
      documentId: null,
    };
  }

  try {
    const finalized = await api.finalize(reserved.documentId, input.mode);
    if (input.mode === "process") {
      return finalized === "indexing"
        ? { status: "indexing", error: null, documentId: reserved.documentId }
        : {
            status: "saved_not_searchable",
            error: "The file is saved, but it couldn't be queued for indexing.",
            documentId: reserved.documentId,
          };
    }

    let ocr: OcrResponse;
    if (input.pages !== undefined && input.pages.length > 0) {
      ocr = await api.ocr(reserved.documentId, input.pages);
    } else if (input.mimeType === "application/pdf") {
      ocr = await api.ocrStoredPdf(reserved.documentId);
    } else {
      return {
        status: "saved_not_searchable",
        error: "The file is saved, but no page image was available for OCR.",
        documentId: reserved.documentId,
      };
    }
    if (!ocr.configured) {
      return {
        status: "saved_not_searchable",
        error:
          ocr.error ??
          "The file is saved, but AI OCR isn't configured on this server.",
        documentId: reserved.documentId,
      };
    }
    return {
      status: ocr.status === "indexed" ? "indexed" : "saved_not_searchable",
      error: ocr.status === "indexed" ? null : ocr.error ?? null,
      documentId: reserved.documentId,
    };
  } catch (error) {
    return {
      status: "saved_not_searchable",
      error:
        error instanceof FileToolApiError
          ? error.message
          : "The file is saved, but it couldn't be made searchable yet.",
      documentId: reserved.documentId,
    };
  }
}

/** The PDF-only wrapper retained by Image-to-PDF and PDF Utilities. */
export async function savePdfToMaterials(
  api: ReturnType<typeof createFileToolsApi>,
  input: {
    bytes: Uint8Array;
    name: string;
    subjectId: string | null;
    mode: "ocr" | "process";
    pages?: OcrPageFile[];
  },
): Promise<SaveToMaterialsResult> {
  return saveFileToMaterials(api, {
    ...input,
    mimeType: "application/pdf",
  });
}

/**
 * Probe the PDF's text layer, then pick `process` for readable files or the
 * stored-PDF OCR path for scans. A probe failure falls back to `process`.
 */
export async function savePdfWithAutoMode(
  api: ReturnType<typeof createFileToolsApi>,
  input: {
    uri: string;
    bytes: Uint8Array;
    name: string;
    mimeType: string | null;
    subjectId: string | null;
  },
): Promise<{ result: SaveToMaterialsResult; mode: "process" | "ocr" }> {
  let mode: "process" | "ocr" = "process";
  try {
    const probe = await api.probePdf(input);
    if (!probe.hasText) mode = "ocr";
  } catch {
    // A probe is an optimization, not a prerequisite: the worker stays the
    // safe default when the text layer can't be checked.
  }
  const result = await savePdfToMaterials(api, {
    bytes: input.bytes,
    name: input.name,
    subjectId: input.subjectId,
    mode,
  });
  return { result, mode };
}

function appendFile(
  form: FormData,
  field: string,
  file: { uri: string; name: string; type: string },
): void {
  (form as unknown as { append(name: string, value: unknown): void }).append(
    field,
    { uri: file.uri, name: file.name, type: file.type },
  );
}

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();

export const fileToolsApi = createFileToolsApi({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    if (supabase === null) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

/**
 * Briefly wait for the worker to settle a freshly saved document. The studio
 * uses this before handing the document scope to Ask AI; a timeout is shown
 * honestly instead of pretending the file is citable.
 */
export async function waitForDocumentIndexed(
  documentId: string,
  timeoutMs = 12_000,
): Promise<"indexed" | "failed" | "timeout"> {
  if (supabase === null) return "timeout";
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await supabase
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();
    if (error) return "timeout";
    if (data?.status === "indexed") return "indexed";
    if (data?.status === "failed") return "failed";
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  return "timeout";
}
