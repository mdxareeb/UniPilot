import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  GroupInfo,
  IngestedRow,
  IngestRow,
  KeyEntry,
  MessageOutcome,
  NewDocument,
  RawMediaType,
  SessionRow,
  SessionStatus,
  DesiredState,
  SessionStore,
  StatusPatch,
} from "./types.ts";
import { DOCUMENTS_BUCKET } from "./types.ts";

/**
 * A store failure with NO provider text: Supabase/PostgREST error messages can
 * echo statement fragments, so only the operation name and the error code leave
 * this module.
 */
export class StoreError extends Error {
  override readonly name = "StoreError";
  readonly operation: string;
  readonly code: string | undefined;
  constructor(operation: string, code?: string) {
    super(`Session store operation failed: ${operation}${code ? ` (${code})` : ""}`);
    this.operation = operation;
    this.code = code;
  }
}

const STATUSES: readonly SessionStatus[] = [
  "disconnected",
  "qr_ready",
  "code_ready",
  "connected",
];
const DESIRED: readonly DesiredState[] = ["connected", "disconnected"];

interface SupabaseStoreOptions {
  url: string;
  serviceRoleKey: string;
  integrationsKey: string;
  /** Test seam: inject a client instead of building one. */
  client?: SupabaseClient;
}

/** The service-role implementation over the encrypted session-store RPCs. */
export class SupabaseSessionStore implements SessionStore {
  private readonly db: SupabaseClient;
  private readonly key: string;

  constructor(options: SupabaseStoreOptions) {
    this.db =
      options.client ??
      createClient(options.url, options.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    this.key = options.integrationsKey;
  }

  private async rpc<T>(operation: string, fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new StoreError(operation, error.code);
    return data as T;
  }

  async listSessions(): Promise<SessionRow[]> {
    const { data, error } = await this.db
      .from("whatsapp_sessions")
      .select("user_id, status, desired_state, link_method");
    if (error) throw new StoreError("listSessions", error.code);
    const rows: SessionRow[] = [];
    for (const row of data ?? []) {
      // A vocabulary miss is skipped, never guessed.
      if (
        !STATUSES.includes(row.status as SessionStatus) ||
        !DESIRED.includes(row.desired_state as DesiredState)
      ) {
        continue;
      }
      rows.push({
        userId: row.user_id as string,
        status: row.status as SessionStatus,
        desiredState: row.desired_state as DesiredState,
        // An unknown value falls back to the web flow rather than guessing.
        linkMethod: row.link_method === "pairing_code" ? "pairing_code" : "qr",
      });
    }
    return rows;
  }

  async updateSession(userId: string, patch: StatusPatch): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.desiredState !== undefined) update.desired_state = patch.desiredState;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.connectedAt !== undefined) {
      update.connected_at = patch.connectedAt ? patch.connectedAt.toISOString() : null;
    }
    if (Object.keys(update).length === 0) return;
    const { error } = await this.db
      .from("whatsapp_sessions")
      .update(update)
      .eq("user_id", userId);
    if (error) throw new StoreError("updateSession", error.code);
  }

  async heartbeat(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const { error } = await this.db
      .from("whatsapp_sessions")
      .update({ bridge_heartbeat_at: new Date().toISOString() })
      .in("user_id", userIds);
    if (error) throw new StoreError("heartbeat", error.code);
  }

  async getCreds(userId: string): Promise<string | null> {
    const value = await this.rpc<string | null>("getCreds", "get_whatsapp_creds", {
      p_user_id: userId,
      p_key: this.key,
    });
    return value ?? null;
  }

  async setCreds(userId: string, serialized: string): Promise<void> {
    await this.rpc<null>("setCreds", "set_whatsapp_creds", {
      p_user_id: userId,
      p_creds: serialized,
      p_key: this.key,
    });
  }

  async getKeys(
    userId: string,
    type: string,
    ids: string[],
  ): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const rows = await this.rpc<Array<{ key_id: string; value: string }> | null>(
      "getKeys",
      "get_whatsapp_auth_keys",
      { p_user_id: userId, p_key_type: type, p_ids: ids, p_key: this.key },
    );
    const out: Record<string, string> = {};
    for (const row of rows ?? []) out[row.key_id] = row.value;
    return out;
  }

  async setKeys(userId: string, entries: KeyEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.rpc<null>("setKeys", "set_whatsapp_auth_keys", {
      p_user_id: userId,
      p_entries: entries.map((e) => ({ type: e.type, id: e.id, value: e.value })),
      p_key: this.key,
    });
  }

  async setQr(userId: string, qr: string, ttlSeconds: number): Promise<void> {
    await this.rpc<null>("setQr", "set_whatsapp_session_qr", {
      p_user_id: userId,
      p_qr: qr,
      p_key: this.key,
      p_ttl_seconds: ttlSeconds,
    });
  }

  async clearQr(userId: string): Promise<void> {
    await this.rpc<null>("clearQr", "clear_whatsapp_session_qr", { p_user_id: userId });
  }

  async getPairingPhone(userId: string): Promise<string | null> {
    const phone = await this.rpc<string | null>("getPairingPhone", "get_whatsapp_pairing_phone", {
      p_user_id: userId,
      p_key: this.key,
    });
    return phone ?? null;
  }

  async setPairingCode(userId: string, code: string, ttlSeconds: number): Promise<void> {
    await this.rpc<null>("setPairingCode", "set_whatsapp_pairing_code", {
      p_user_id: userId,
      p_code: code,
      p_key: this.key,
      p_ttl_seconds: ttlSeconds,
    });
  }

  async clearPairing(userId: string): Promise<void> {
    await this.rpc<null>("clearPairing", "clear_whatsapp_pairing", { p_user_id: userId });
  }

  async clearSession(userId: string): Promise<void> {
    await this.rpc<null>("clearSession", "clear_whatsapp_session", { p_user_id: userId });
  }

  async purgeExpiredMessages(): Promise<number> {
    const deleted = await this.rpc<number | null>(
      "purgeExpiredMessages",
      "purge_expired_raw_messages",
      { p_user_id: null, p_retention_days: 30 },
    );
    return typeof deleted === "number" ? deleted : 0;
  }

  async upsertGroups(userId: string, groups: GroupInfo[]): Promise<void> {
    if (groups.length === 0) return;
    // `is_active` is deliberately absent from the payload: PostgREST's
    // merge-duplicates only rewrites the columns it is given, so an existing
    // group keeps the owner's choice and a new one takes the column default
    // (false).
    const rows = groups.map((g) => ({
      user_id: userId,
      group_jid: g.jid,
      group_name: g.name.slice(0, 200),
    }));
    const { error } = await this.db
      .from("monitored_groups")
      .upsert(rows, { onConflict: "user_id,group_jid" });
    if (error) throw new StoreError("upsertGroups", error.code);
  }

  async ingestMessages(userId: string, rows: IngestRow[]): Promise<IngestedRow[]> {
    if (rows.length === 0) return [];
    const data = await this.rpc<
      Array<{
        message_id: string;
        whatsapp_msg_id: string;
        group_jid: string;
        media_type: RawMediaType;
      }> | null
    >("ingestMessages", "ingest_raw_messages", {
      p_user_id: userId,
      p_rows: rows.map((r) => ({
        group_jid: r.groupJid,
        whatsapp_msg_id: r.whatsappMsgId,
        fingerprint: r.fingerprint,
        sender_name: r.senderName,
        sent_at: r.sentAt,
        raw_text: r.rawText,
        media_type: r.mediaType,
        file_sha256: r.fileSha256,
        status: "queued",
      })),
    });
    return (data ?? []).map((row) => ({
      messageId: row.message_id,
      whatsappMsgId: row.whatsapp_msg_id,
      groupJid: row.group_jid,
      mediaType: row.media_type,
    }));
  }

  async findDocumentByHash(userId: string, sha256: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("documents")
      .select("id")
      .eq("user_id", userId)
      .eq("file_sha256", sha256)
      .maybeSingle();
    if (error) throw new StoreError("findDocumentByHash", error.code);
    return (data?.id as string | undefined) ?? null;
  }

  async uploadDocumentObject(
    path: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.db.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) throw new StoreError("uploadDocumentObject");
  }

  async removeDocumentObject(path: string): Promise<void> {
    const { error } = await this.db.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (error) throw new StoreError("removeDocumentObject");
  }

  async insertDocument(userId: string, doc: NewDocument): Promise<"inserted" | "duplicate"> {
    const { error } = await this.db.from("documents").insert({
      id: doc.documentId,
      user_id: userId,
      name: doc.name,
      storage_path: doc.storagePath,
      mime_type: doc.mimeType,
      size_bytes: doc.sizeBytes,
      status: "uploaded",
      source: "whatsapp_group",
      source_message_id: doc.sourceMessageId,
      file_sha256: doc.fileSha256,
    });
    if (error) {
      if (error.code === "23505") return "duplicate";
      throw new StoreError("insertDocument", error.code);
    }
    return "inserted";
  }

  async setMessageStatus(
    userId: string,
    messageId: string,
    status: MessageOutcome,
    error: string | null = null,
  ): Promise<void> {
    const { error: dbError } = await this.db
      .from("raw_messages")
      .update({ status, error })
      .eq("id", messageId)
      .eq("user_id", userId);
    if (dbError) throw new StoreError("setMessageStatus", dbError.code);
  }

  async enqueueExtraction(userId: string, messageId: string): Promise<boolean> {
    const queued = await this.rpc<boolean>(
      "enqueueExtraction",
      "enqueue_raw_message_extraction",
      { p_user_id: userId, p_message_id: messageId },
    );
    return queued === true;
  }

  async listActiveGroups(userId: string): Promise<Set<string>> {
    const { data, error } = await this.db
      .from("monitored_groups")
      .select("group_jid")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (error) throw new StoreError("listActiveGroups", error.code);
    return new Set((data ?? []).map((row) => row.group_jid as string));
  }
}
