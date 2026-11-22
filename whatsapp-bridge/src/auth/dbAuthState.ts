import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import type { KeyEntry, SessionStore } from "../store/types.ts";

/**
 * A Baileys `AuthenticationState` backed by the encrypted session store
 * (`whatsapp_session_secrets` + `whatsapp_auth_keys`) instead of files, so a
 * linked session survives bridge restarts and the user never re-scans.
 *
 * - Values are serialised with Baileys' `BufferJSON` (plain `JSON.stringify`
 *   would corrupt the Buffer fields) and encrypted by the database RPCs.
 * - `keys.set` is one batched RPC per Baileys call; a null value deletes.
 * - `saveCreds` writes are chained so an older snapshot can never overwrite a
 *   newer one when Baileys fires `creds.update` in quick succession.
 */
export async function useDbAuthState(
  userId: string,
  store: SessionStore,
): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  flushCreds: () => Promise<void>;
}> {
  const stored = await store.getCreds(userId);
  const creds: AuthenticationCreds = stored
    ? (JSON.parse(stored, BufferJSON.reviver) as AuthenticationCreds)
    : initAuthCreds();

  let pendingWrite: Promise<void> = Promise.resolve();

  const saveCreds = (): Promise<void> => {
    // Serialise at call time so the write carries the state as of this call.
    const serialized = JSON.stringify(creds, BufferJSON.replacer);
    const write = pendingWrite.then(() => store.setCreds(userId, serialized));
    // A failed write must not poison later writes, but the caller still sees it.
    pendingWrite = write.catch(() => undefined);
    return write;
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const rows = await store.getKeys(userId, type, ids);
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const raw = rows[id];
          if (raw === undefined) continue;
          let value = JSON.parse(raw, BufferJSON.reviver);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.create(value);
          }
          out[id] = value;
        }
        return out;
      },
      set: async (data: SignalDataSet) => {
        const entries: KeyEntry[] = [];
        for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          const bucket = data[category];
          if (!bucket) continue;
          for (const id of Object.keys(bucket)) {
            const value = bucket[id];
            entries.push({
              type: category,
              id,
              value:
                value === null || value === undefined
                  ? null
                  : JSON.stringify(value, BufferJSON.replacer),
            });
          }
        }
        await store.setKeys(userId, entries);
      },
    },
  };

  return { state, saveCreds, flushCreds: () => pendingWrite };
}
