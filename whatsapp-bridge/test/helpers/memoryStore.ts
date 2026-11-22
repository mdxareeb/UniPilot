import type {
  DesiredState,
  GroupInfo,
  IngestedRow,
  IngestRow,
  KeyEntry,
  MessageOutcome,
  NewDocument,
  LinkMethod,
  SessionRow,
  SessionStatus,
  SessionStore,
  StatusPatch,
} from "../../src/store/types.ts";

/**
 * An in-memory SessionStore. A FAKE: it proves the bridge's logic, not the
 * database. The real store is exercised by the SQL checks in
 * backend/supabase/qa/ and by the live runbook.
 */
export class MemoryStore implements SessionStore {
  sessions = new Map<
    string,
    {
      status: SessionStatus;
      desiredState: DesiredState;
      linkMethod: LinkMethod;
      lastError: string | null;
      connectedAt: Date | null;
      heartbeats: number;
    }
  >();
  creds = new Map<string, string>();
  keys = new Map<string, string>(); // `${userId}|${type}|${id}` -> value
  qr = new Map<string, { qr: string; ttl: number }>();
  calls: string[] = [];

  addSession(
    userId: string,
    status: SessionStatus,
    desiredState: DesiredState,
    linkMethod: LinkMethod = "qr",
  ): void {
    this.sessions.set(userId, {
      status,
      desiredState,
      linkMethod,
      lastError: null,
      connectedAt: null,
      heartbeats: 0,
    });
  }

  async listSessions(): Promise<SessionRow[]> {
    return [...this.sessions].map(([userId, s]) => ({
      userId,
      status: s.status,
      desiredState: s.desiredState,
      linkMethod: s.linkMethod,
    }));
  }

  async updateSession(userId: string, patch: StatusPatch): Promise<void> {
    this.calls.push(`updateSession:${JSON.stringify({ ...patch, connectedAt: undefined })}`);
    const row = this.sessions.get(userId);
    if (!row) return;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.desiredState !== undefined) row.desiredState = patch.desiredState;
    if (patch.lastError !== undefined) row.lastError = patch.lastError;
    if (patch.connectedAt !== undefined) row.connectedAt = patch.connectedAt;
  }

  async heartbeat(userIds: string[]): Promise<void> {
    this.calls.push(`heartbeat:${userIds.join(",")}`);
    for (const id of userIds) {
      const row = this.sessions.get(id);
      if (row) row.heartbeats += 1;
    }
  }

  async getCreds(userId: string): Promise<string | null> {
    return this.creds.get(userId) ?? null;
  }

  async setCreds(userId: string, serialized: string): Promise<void> {
    this.calls.push("setCreds");
    this.creds.set(userId, serialized);
  }

  async getKeys(userId: string, type: string, ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of ids) {
      const value = this.keys.get(`${userId}|${type}|${id}`);
      if (value !== undefined) out[id] = value;
    }
    return out;
  }

  async setKeys(userId: string, entries: KeyEntry[]): Promise<void> {
    this.calls.push(`setKeys:${entries.length}`);
    for (const e of entries) {
      const k = `${userId}|${e.type}|${e.id}`;
      if (e.value === null) this.keys.delete(k);
      else this.keys.set(k, e.value);
    }
  }

  async setQr(userId: string, qr: string, ttlSeconds: number): Promise<void> {
    this.calls.push("setQr");
    this.qr.set(userId, { qr, ttl: ttlSeconds });
  }

  async clearQr(userId: string): Promise<void> {
    this.calls.push("clearQr");
    this.qr.delete(userId);
  }

  /** userId -> number (as the real store would hold it, decrypted). */
  phones = new Map<string, string>();
  pairingCodes = new Map<string, { code: string; ttl: number }>();

  async getPairingPhone(userId: string): Promise<string | null> {
    return this.phones.get(userId) ?? null;
  }

  async setPairingCode(userId: string, code: string, ttlSeconds: number): Promise<void> {
    this.calls.push("setPairingCode");
    this.pairingCodes.set(userId, { code, ttl: ttlSeconds });
  }

  async clearPairing(userId: string): Promise<void> {
    this.calls.push("clearPairing");
    this.phones.delete(userId);
    this.pairingCodes.delete(userId);
  }

  async clearSession(userId: string): Promise<void> {
    this.calls.push("clearSession");
    this.creds.delete(userId);
    this.qr.delete(userId);
    this.phones.delete(userId);
    this.pairingCodes.delete(userId);
    for (const k of [...this.keys.keys()]) {
      if (k.startsWith(`${userId}|`)) this.keys.delete(k);
    }
  }

  purgeCalls = 0;
  async purgeExpiredMessages(): Promise<number> {
    this.purgeCalls += 1;
    return 0;
  }

  /** `${userId}|${jid}` -> group row, mirroring the table's unique key. */
  groups = new Map<string, { jid: string; name: string; active: boolean }>();

  async upsertGroups(userId: string, groups: GroupInfo[]): Promise<void> {
    this.calls.push(`upsertGroups:${groups.length}`);
    for (const g of groups) {
      const key = `${userId}|${g.jid}`;
      const existing = this.groups.get(key);
      // Mirrors the real upsert: the name is refreshed, `active` is never
      // written (a new group starts off).
      this.groups.set(key, { jid: g.jid, name: g.name, active: existing?.active ?? false });
    }
  }

  async listActiveGroups(userId: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const [key, row] of this.groups) {
      if (key.startsWith(`${userId}|`) && row.active) out.add(row.jid);
    }
    return out;
  }

  // ---- documents / storage / message outcome fakes -------------------------
  documents: Array<NewDocument & { userId: string }> = [];
  objects = new Map<string, Uint8Array>();
  outcomes = new Map<string, { status: MessageOutcome; error: string | null }>();
  extractionQueue: string[] = [];
  failUpload = false;

  async findDocumentByHash(userId: string, sha256: string): Promise<string | null> {
    return (
      this.documents.find((d) => d.userId === userId && d.fileSha256 === sha256)?.documentId ??
      null
    );
  }

  async uploadDocumentObject(path: string, bytes: Uint8Array): Promise<void> {
    if (this.failUpload) throw new Error("storage down");
    this.objects.set(path, bytes);
  }

  async removeDocumentObject(path: string): Promise<void> {
    this.objects.delete(path);
  }

  async insertDocument(userId: string, doc: NewDocument): Promise<"inserted" | "duplicate"> {
    if (this.documents.some((d) => d.userId === userId && d.fileSha256 === doc.fileSha256)) {
      return "duplicate";
    }
    this.documents.push({ ...doc, userId });
    return "inserted";
  }

  async setMessageStatus(
    _userId: string,
    messageId: string,
    status: MessageOutcome,
    error: string | null = null,
  ): Promise<void> {
    this.outcomes.set(messageId, { status, error });
  }

  async enqueueExtraction(_userId: string, messageId: string): Promise<boolean> {
    if (this.extractionQueue.includes(messageId)) return false;
    this.extractionQueue.push(messageId);
    return true;
  }

  /** Stored rows, mirroring raw_messages' two unique constraints. */
  rawMessages: Array<IngestRow & { userId: string; messageId: string }> = [];
  ingestCalls = 0;
  failIngest = false;

  async ingestMessages(userId: string, rows: IngestRow[]): Promise<IngestedRow[]> {
    this.ingestCalls += 1;
    if (this.failIngest) throw new Error("db down");
    const inserted: IngestedRow[] = [];
    for (const row of rows) {
      const group = this.groups.get(`${userId}|${row.groupJid}`);
      if (!group?.active) continue; // the database enforces the active-group rule too
      const duplicate = this.rawMessages.some(
        (m) =>
          m.userId === userId &&
          (m.fingerprint === row.fingerprint ||
            (m.groupJid === row.groupJid && m.whatsappMsgId === row.whatsappMsgId)),
      );
      if (duplicate) continue;
      const messageId = `msg-${this.rawMessages.length + 1}`;
      this.rawMessages.push({ ...row, userId, messageId });
      inserted.push({
        messageId,
        whatsappMsgId: row.whatsappMsgId,
        groupJid: row.groupJid,
        mediaType: row.mediaType,
      });
    }
    return inserted;
  }
}
