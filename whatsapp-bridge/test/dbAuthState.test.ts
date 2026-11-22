import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useDbAuthState } from "../src/auth/dbAuthState.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("DB-backed auth state", () => {
  it("starts with fresh credentials and persists them for the next start", async () => {
    const store = new MemoryStore();
    const first = await useDbAuthState(USER, store);
    assert.equal(first.state.creds.registered, false);
    assert.ok(first.state.creds.noiseKey.private instanceof Uint8Array);

    await first.saveCreds();
    assert.ok(store.creds.has(USER));

    // "Restart": a new state built from the same store has the same identity,
    // with the Buffer fields revived (not left as {type:"Buffer",data:[...]}).
    const second = await useDbAuthState(USER, store);
    assert.deepEqual(
      Buffer.from(second.state.creds.noiseKey.private),
      Buffer.from(first.state.creds.noiseKey.private),
    );
    assert.equal(second.state.creds.registrationId, first.state.creds.registrationId);
  });

  it("round-trips signal keys with binary values", async () => {
    const store = new MemoryStore();
    const { state } = await useDbAuthState(USER, store);

    const preKey = {
      private: new Uint8Array([1, 2, 3, 250]),
      public: new Uint8Array([9, 8, 7]),
    };
    await state.keys.set({ "pre-key": { "7": preKey }, session: { "abc.0": new Uint8Array([5, 6]) } });

    const got = await state.keys.get("pre-key", ["7", "missing"]);
    assert.deepEqual(Object.keys(got), ["7"]);
    assert.deepEqual(Array.from(got["7"]!.private), [1, 2, 3, 250]);
    assert.deepEqual(Array.from(got["7"]!.public), [9, 8, 7]);

    const session = await state.keys.get("session", ["abc.0"]);
    assert.deepEqual(Array.from(session["abc.0"]!), [5, 6]);
  });

  it("deletes a key when its value is null", async () => {
    const store = new MemoryStore();
    const { state } = await useDbAuthState(USER, store);
    await state.keys.set({ "pre-key": { "1": { private: new Uint8Array([1]), public: new Uint8Array([2]) } } });
    await state.keys.set({ "pre-key": { "1": null } });
    assert.deepEqual(await state.keys.get("pre-key", ["1"]), {});
  });

  it("revives app-state-sync keys into the protobuf type", async () => {
    const store = new MemoryStore();
    const { state } = await useDbAuthState(USER, store);
    await state.keys.set({
      "app-state-sync-key": { K1: { keyData: new Uint8Array([4, 4]), timestamp: 5 } },
    });
    const got = await state.keys.get("app-state-sync-key", ["K1"]);
    assert.deepEqual(Array.from(got["K1"]!.keyData!), [4, 4]);
  });

  it("keeps users isolated", async () => {
    const store = new MemoryStore();
    const a = await useDbAuthState(USER, store);
    const b = await useDbAuthState(OTHER, store);
    await a.state.keys.set({ "pre-key": { "1": { private: new Uint8Array([1]), public: new Uint8Array([1]) } } });
    assert.deepEqual(await b.state.keys.get("pre-key", ["1"]), {});
  });

  it("sends one batched call per keys.set", async () => {
    const store = new MemoryStore();
    const { state } = await useDbAuthState(USER, store);
    await state.keys.set({
      "pre-key": {
        "1": { private: new Uint8Array([1]), public: new Uint8Array([1]) },
        "2": { private: new Uint8Array([2]), public: new Uint8Array([2]) },
      },
    });
    assert.deepEqual(store.calls.filter((c) => c.startsWith("setKeys")), ["setKeys:2"]);
  });

  it("writes credentials in call order, even when an earlier write is slower", async () => {
    const store = new MemoryStore();
    const written: string[] = [];
    const realSet = store.setCreds.bind(store);
    let first = true;
    store.setCreds = async (userId, serialized) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 20)); // slow first write
      }
      written.push(serialized);
      await realSet(userId, serialized);
    };

    const { state, saveCreds } = await useDbAuthState(USER, store);
    (state.creds as { advSecretKey: string }).advSecretKey = "one";
    const a = saveCreds();
    (state.creds as { advSecretKey: string }).advSecretKey = "two";
    const b = saveCreds();
    await Promise.all([a, b]);

    assert.equal(written.length, 2);
    assert.match(written[0]!, /"one"/);
    assert.match(written[1]!, /"two"/);
    assert.match(store.creds.get(USER)!, /"two"/);
  });

  it("surfaces a failed credentials write but keeps later writes working", async () => {
    const store = new MemoryStore();
    const realSet = store.setCreds.bind(store);
    let fail = true;
    store.setCreds = async (userId, serialized) => {
      if (fail) {
        fail = false;
        throw new Error("boom");
      }
      await realSet(userId, serialized);
    };
    const { saveCreds } = await useDbAuthState(USER, store);
    await assert.rejects(saveCreds(), /boom/);
    await saveCreds();
    assert.ok(store.creds.has(USER));
  });
});
