import * as SecureStore from "expo-secure-store";

/**
 * The chunked secure-storage adapter for Supabase sessions (M2).
 *
 * Sessions live ONLY in platform secure storage (Android Keystore-backed
 * EncryptedSharedPreferences) — never AsyncStorage, never a plain file. A
 * Supabase session JSON can exceed a single SecureStore entry on some
 * platforms, so values over `CHUNK_SIZE` are split into numbered chunks with
 * a small head record; reads reassemble, and an incomplete chunk set reads
 * as "no session" rather than as a corrupt half-session.
 */

const CHUNK_SIZE = 1800;
const CHUNK_PREFIX = "__unipilot_chunks__:";
const MAX_CHUNKS = 16;

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function deleteChunks(key: string): Promise<void> {
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, index));
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    if (!head.startsWith(CHUNK_PREFIX)) return head;

    const count = Number.parseInt(head.slice(CHUNK_PREFIX.length), 10);
    if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
      return null;
    }

    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, index));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  },

  async setItem(key: string, value: string): Promise<void> {
    await deleteChunks(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks: string[] = [];
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
      chunks.push(value.slice(offset, offset + CHUNK_SIZE));
    }
    if (chunks.length > MAX_CHUNKS) {
      // Never silently truncate a session: an unreadable session is worse
      // than an honest failure at the storage boundary.
      throw new Error("The session is too large for secure storage.");
    }

    for (let index = 0; index < chunks.length; index += 1) {
      await SecureStore.setItemAsync(chunkKey(key, index), chunks[index]);
    }
    await SecureStore.setItemAsync(key, `${CHUNK_PREFIX}${chunks.length}`);
  },

  async removeItem(key: string): Promise<void> {
    await deleteChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};
