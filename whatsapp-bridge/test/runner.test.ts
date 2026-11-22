import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import { SESSION_MESSAGES, SessionRunner, type RunnerDeps } from "../src/session/runner.ts";
import { FakeSocket, flush } from "./helpers/fakeSocket.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const silent = pino({ level: "silent" });

function setup(overrides: Partial<RunnerDeps> = {}) {
  const store = new MemoryStore();
  store.addSession(USER, "disconnected", "connected");
  const sockets: FakeSocket[] = [];
  const slept: number[] = [];
  const deps: RunnerDeps = {
    store,
    logger: silent,
    openSocket: () => {
      const sock = new FakeSocket();
      sockets.push(sock);
      return sock;
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    backoffMs: (attempt) => attempt * 100,
    ...overrides,
  };
  const runner = new SessionRunner(USER, deps);
  return { store, sockets, slept, runner, deps };
}

describe("SessionRunner", () => {
  it("publishes the QR (encrypted by the store) and flips the status to qr_ready", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    await flush();

    assert.deepEqual(store.qr.get(USER), { qr: "2@scan-me", ttl: 60 });
    assert.equal(store.sessions.get(USER)!.status, "qr_ready");
  });

  it("goes connected on open: clears the QR, stamps connected_at, runs the open hook", async () => {
    const opened: string[] = [];
    const { store, sockets, runner } = setup({
      hooks: { onOpen: (userId) => void opened.push(userId) },
    });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();

    const row = store.sessions.get(USER)!;
    assert.equal(row.status, "connected");
    assert.ok(row.connectedAt instanceof Date);
    assert.equal(row.lastError, null);
    assert.equal(store.qr.has(USER), false);
    assert.deepEqual(opened, [USER]);
  });

  it("reopens immediately on restartRequired (the normal step after a scan)", async () => {
    const { sockets, runner, slept } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    sockets[0]!.close(DisconnectReason.restartRequired);
    await flush();

    assert.equal(sockets.length, 2);
    assert.deepEqual(slept, []);
    assert.equal(runner.isFinished, false);
  });

  it("does not treat a post-scan timeout as an unscanned QR", async () => {
    const { store, sockets, runner } = setup({ maxReconnectAttempts: 3 });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    sockets[0]!.close(DisconnectReason.restartRequired);
    await flush();
    sockets[1]!.close(DisconnectReason.timedOut);
    await flush();

    assert.equal(sockets.length, 3, "reconnects with backoff instead of giving up");
    assert.notEqual(store.sessions.get(USER)!.lastError, SESSION_MESSAGES.qrExpired);
  });

  it("gives up with an honest message when the QR was never scanned", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    sockets[0]!.close(DisconnectReason.timedOut);
    await flush();

    const row = store.sessions.get(USER)!;
    assert.equal(row.status, "disconnected");
    assert.equal(row.desiredState, "disconnected");
    assert.equal(row.lastError, SESSION_MESSAGES.qrExpired);
    assert.equal(store.qr.has(USER), false);
    assert.equal(runner.isFinished, true);
    assert.equal(sockets.length, 1);
  });

  it("forgets the session when WhatsApp reports the device as logged out", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    store.creds.set(USER, "{}");
    sockets[0]!.emit("connection.update", { connection: "open" });
    sockets[0]!.close(DisconnectReason.loggedOut);
    await flush();

    assert.equal(store.creds.has(USER), false);
    const row = store.sessions.get(USER)!;
    assert.equal(row.status, "disconnected");
    assert.equal(row.desiredState, "disconnected");
    assert.equal(row.lastError, SESSION_MESSAGES.loggedOut);
    assert.equal(runner.isFinished, true);
  });

  it("stops (keeping the creds) when the link was opened somewhere else", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    store.creds.set(USER, "{}");
    sockets[0]!.emit("connection.update", { connection: "open" });
    sockets[0]!.close(DisconnectReason.connectionReplaced);
    await flush();

    assert.equal(store.sessions.get(USER)!.lastError, SESSION_MESSAGES.replaced);
    assert.equal(store.creds.has(USER), true);
    assert.equal(runner.isFinished, true);
  });

  it("reconnects with exponential backoff after a lost connection, then gives up", async () => {
    const { store, sockets, slept, runner } = setup({ maxReconnectAttempts: 2 });
    await runner.start();
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();

    sockets[0]!.close(DisconnectReason.connectionLost);
    await flush();
    assert.equal(sockets.length, 2);
    assert.deepEqual(slept, [100]);

    sockets[1]!.close(DisconnectReason.connectionLost);
    await flush();
    assert.equal(sockets.length, 3);
    assert.deepEqual(slept, [100, 200]);

    sockets[2]!.close(DisconnectReason.connectionLost);
    await flush();
    assert.equal(runner.isFinished, true);
    assert.equal(store.sessions.get(USER)!.lastError, SESSION_MESSAGES.lost);
  });

  it("resets the backoff once a connection opens again", async () => {
    const { sockets, slept, runner } = setup({ maxReconnectAttempts: 2 });
    await runner.start();
    sockets[0]!.close(DisconnectReason.connectionLost);
    await flush();
    sockets[1]!.emit("connection.update", { connection: "open" });
    await flush();
    sockets[1]!.close(DisconnectReason.connectionLost);
    await flush();

    assert.deepEqual(slept, [100, 100]);
    assert.equal(runner.isFinished, false);
  });

  it("ignores events from a socket it already replaced", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.close(DisconnectReason.restartRequired);
    await flush();
    assert.equal(sockets.length, 2);

    // A late event from the OLD socket must not touch the session.
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();
    assert.notEqual(store.sessions.get(USER)!.status, "connected");
  });

  it("persists credentials when Baileys reports a creds.update", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("creds.update", {});
    await flush();
    assert.ok(store.creds.has(USER));
  });

  it("disconnect (logout:true) unlinks the device and forgets every secret", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();
    store.keys.set(`${USER}|pre-key|1`, "x");

    await runner.stop({ logout: true });

    assert.ok(sockets[0]!.calls.includes("logout"));
    assert.equal(store.creds.has(USER), false);
    assert.equal(store.keys.size, 0);
    const row = store.sessions.get(USER)!;
    assert.equal(row.status, "disconnected");
    assert.equal(row.connectedAt, null);
    assert.equal(runner.isFinished, true);
  });

  it("disconnect still forgets the secrets when the logout call fails", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.logout = async () => {
      throw new Error("not connected");
    };
    store.creds.set(USER, "{}");
    await runner.stop({ logout: true });
    assert.equal(store.creds.has(USER), false);
  });

  it("bridge shutdown (logout:false) keeps the link", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    store.creds.set(USER, "{}");
    await runner.stop({ logout: false });

    assert.ok(!sockets[0]!.calls.includes("logout"));
    assert.ok(sockets[0]!.calls.includes("end"));
    assert.equal(store.creds.has(USER), true);
  });

  it("forwards history and live messages to the ingestion hooks", async () => {
    const seen: string[] = [];
    const { sockets, runner } = setup({
      hooks: {
        onHistory: (_u, messages) => void seen.push(`history:${messages.length}`),
        onUpsert: (_u, messages, type) => void seen.push(`upsert:${messages.length}:${type}`),
      },
    });
    await runner.start();
    sockets[0]!.emit("messaging-history.set", { messages: [{}, {}] });
    sockets[0]!.emit("messages.upsert", { messages: [{}], type: "notify" });
    await flush();
    assert.deepEqual(seen, ["history:2", "upsert:1:notify"]);
  });

  it("never lets the raw socket's write APIs reach the runner", async () => {
    const { sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();
    // The runner only ever touched allowlisted members.
    assert.deepEqual(
      sockets[0]!.calls.filter((c) => !["end", "logout", "groupFetchAllParticipating"].includes(c)),
      [],
    );
  });
});
