import { supabase } from "@/lib/supabase";

import { bytesToBase64 } from "./fileBytes";
import { uploadPdf } from "./fileIo";

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
type OcrResponse = {
  configured: boolean;
  status: "indexed" | "saved_not_searchable";
  error?: string;
  pages?: number;
  characters?: number;
  alreadyIndexed?: boolean;
};

export type OcrPageFile = {
  uri: string;
  name: string;
  type: "image/jpeg" | "image/png";
};

export type SaveToMaterialsResult = {
  status: "indexed" | "indexing" | "saved_not_searchable" | "error";
  error: string | null;
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
      mimeType: "application/pdf";
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
 * Upload a generated PDF and hand it to the right indexer. Image PDFs also
 * send their normalized page images to OCR so Ask AI can cite the pages.
 */
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
  let reserved: ReserveResponse;
  try {
    reserved = await api.reserve({
      name: input.name,
      mimeType: "application/pdf",
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
    };
  }

  const uploaded = await uploadPdf(reserved.uploadPath, input.bytes);
  if (uploaded.error !== null) {
    // finalize's missing-object branch discards the reservation row.
    await api.finalize(reserved.documentId, "process").catch(() => undefined);
    return { status: "error", error: uploaded.error };
  }

  try {
    const finalized = await api.finalize(
      reserved.documentId,
      input.mode,
    );
    if (input.mode === "process") {
      return finalized === "indexing"
        ? { status: "indexing", error: null }
        : {
            status: "saved_not_searchable",
            error: "The PDF is saved, but it couldn't be queued for indexing.",
          };
    }
    if (input.pages === undefined || input.pages.length === 0) {
      return {
        status: "saved_not_searchable",
        error: "The PDF is saved, but its pages weren't available for OCR.",
      };
    }
    const ocr = await api.ocr(reserved.documentId, input.pages);
    if (!ocr.configured) {
      return {
        status: "saved_not_searchable",
        error:
          ocr.error ??
          "The PDF is saved, but AI OCR isn't configured on this server.",
      };
    }
    return {
      status: ocr.status === "indexed" ? "indexed" : "saved_not_searchable",
      error: ocr.status === "indexed" ? null : ocr.error ?? null,
    };
  } catch (error) {
    return {
      status: "saved_not_searchable",
      error:
        error instanceof FileToolApiError
          ? error.message
          : "The PDF is saved, but it couldn't be made searchable yet.",
    };
  }
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
