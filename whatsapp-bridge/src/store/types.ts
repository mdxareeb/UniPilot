/**
 * The bridge's only view of the database.
 *
 * Everything the bridge persists goes through this interface so the session
 * logic can be tested with an in-memory fake, and so the real implementation
 * (`supabaseStore.ts`) is the single place that touches the encrypted RPCs.
 * Values passed to the secret methods are opaque strings: the bridge
 * serialises Baileys objects with BufferJSON before they reach the store.
 */

export type SessionStatus = "disconnected" | "qr_ready" | "code_ready" | "connected";
export type DesiredState = "connected" | "disconnected";
/** `qr` is the web flow; `pairing_code` is the mobile flow ("Link with phone number"). */
export type LinkMethod = "qr" | "pairing_code";

export interface SessionRow {
  userId: string;
  status: SessionStatus;
  desiredState: DesiredState;
  linkMethod: LinkMethod;
}

export interface StatusPatch {
  status?: SessionStatus;
  desiredState?: DesiredState;
  /** Sanitized, human-safe copy. `null` clears it. Never a stack or a token. */
  lastError?: string | null;
  connectedAt?: Date | null;
}

export interface KeyEntry {
  type: string;
  id: string;
  /** `null` deletes the key. */
  value: string | null;
}

export interface SessionStore {
  /** Every session row (the table is small: one row per linked user). */
  listSessions(): Promise<SessionRow[]>;
  updateSession(userId: string, patch: StatusPatch): Promise<void>;
  /** Bumps `bridge_heartbeat_at` for the sessions this bridge is managing. */
  heartbeat(userIds: string[]): Promise<void>;

  getCreds(userId: string): Promise<string | null>;
  setCreds(userId: string, serialized: string): Promise<void>;
  getKeys(
    userId: string,
    type: string,
    ids: string[],
  ): Promise<Record<string, string>>;
  setKeys(userId: string, entries: KeyEntry[]): Promise<void>;

  setQr(userId: string, qr: string, ttlSeconds: number): Promise<void>;
  clearQr(userId: string): Promise<void>;

  /** The user's number (digits-only E.164) for a pairing-code link, or null. */
  getPairingPhone(userId: string): Promise<string | null>;
  /** Publish the 8-character code WhatsApp issued; it expires after `ttlSeconds`. */
  setPairingCode(userId: string, code: string, ttlSeconds: number): Promise<void>;
  /** Forget the number and the code (link succeeded, or the attempt ended). */
  clearPairing(userId: string): Promise<void>;
  /** Logout: forget credentials, QR and every signal key. */
  clearSession(userId: string): Promise<void>;

  /**
   * Delete captured message text older than the retention window (30 days),
   * for every user. Extracted tasks, events, files and queued suggestions keep
   * their rows (their `source_message_id` is ON DELETE SET NULL). Returns the
   * number of messages removed.
   */
  purgeExpiredMessages(): Promise<number>;

  /**
   * Insert newly discovered groups and refresh the names of known ones.
   * MUST NOT touch `is_active`: the owner alone decides which groups are read,
   * and a new group always starts off.
   */
  upsertGroups(userId: string, groups: GroupInfo[]): Promise<void>;
  /** The jids of the groups the owner has switched on. */
  listActiveGroups(userId: string): Promise<Set<string>>;

  /**
   * Atomic, idempotent insert into `raw_messages` (the `ingest_raw_messages`
   * RPC). Returns ONLY the rows that were actually inserted: a duplicate, or a
   * row from a group that is not active, comes back as nothing. The database
   * enforces the active-group rule itself, in addition to the bridge's filter.
   */
  ingestMessages(userId: string, rows: IngestRow[]): Promise<IngestedRow[]>;

  /** The id of this user's document with that content hash, if any. */
  findDocumentByHash(userId: string, sha256: string): Promise<string | null>;
  uploadDocumentObject(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  removeDocumentObject(path: string): Promise<void>;
  /**
   * Inserts the `documents` row for a captured file. `"duplicate"` means the
   * per-user unique hash already existed (a race with another capture); the
   * caller removes the object it just uploaded.
   */
  insertDocument(userId: string, doc: NewDocument): Promise<"inserted" | "duplicate">;
  /** Settle a message the pipeline will not (or could not) process further. */
  setMessageStatus(
    userId: string,
    messageId: string,
    status: MessageOutcome,
    error?: string | null,
  ): Promise<void>;
  /** Queue the extraction job for a message whose file is safely stored. */
  enqueueExtraction(userId: string, messageId: string): Promise<boolean>;
}

export interface NewDocument {
  documentId: string;
  name: string;
  /** Object key in the `documents` bucket: `{user_id}/{document_id}/{name}`. */
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  fileSha256: string;
  sourceMessageId: string;
}

export type MessageOutcome = "processed" | "ignored_noise" | "failed";

/** The bucket group-sync files live in (the existing private bucket). */
export const DOCUMENTS_BUCKET = "documents";

export type RawMediaType = "none" | "pdf" | "pptx" | "docx" | "image";

export interface IngestRow {
  groupJid: string;
  whatsappMsgId: string;
  fingerprint: string;
  senderName: string;
  /** ISO-8601. */
  sentAt: string;
  rawText: string;
  mediaType: RawMediaType;
  fileSha256: string | null;
}

export interface IngestedRow {
  messageId: string;
  whatsappMsgId: string;
  groupJid: string;
  mediaType: RawMediaType;
}

export interface GroupInfo {
  /** The group's JID (`...@g.us`). */
  jid: string;
  name: string;
}
