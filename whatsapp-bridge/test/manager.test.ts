import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pino from "pino";
import { SessionManager } from "../src/session/manager.ts";
import { FakeSocket, flush } from "./helpers/fakeSocket.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const silent = pino({ level: "silent" });

function setup(clock = { now: 1_000_000 }) {
  const store = new MemoryStore();
  const sockets: FakeSocket[] = [];
  const manager = new SessionManager({
    store,
    logger: silent,
    pollIntervalMs: 3000,
    heartbeatIntervalMs: 10_000,
    now: () => clock.now,
    runner: {
      logger: silent,
      openSocket: () => {
        const sock = new FakeSocket();
        sockets.push(sock);
        return sock;
      },
      sleep: async () => undefined,
    },
  });
  return { store, sockets, manager, clock };
}

describe("SessionManager", () => {
  it("starts a runner for a session whose desired state is connected", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    assert.equal(sockets.length, 1);
    assert.deepEqual(manager.managedUserIds, [A]);
  });

  it("does not start a second runner on the next pass", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    await manager.tick();
    assert.equal(sockets.length, 1);
  });

  it("leaves disconnected sessions alone", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "disconnected");
    await manager.tick();
    assert.equal(sockets.length, 0);
    assert.deepEqual(manager.managedUserIds, []);
  });

  it("stops and logs out a runner when the user disconnects", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();
    store.creds.set(A, "{}");

    store.sessions.get(A)!.desiredState = "disconnected";
    await manager.tick();

    assert.ok(sockets[0]!.calls.includes("logout"));
    assert.equal(store.creds.has(A), false);
    assert.equal(store.sessions.get(A)!.status, "disconnected");
    assert.deepEqual(manager.managedUserIds, []);
  });

  it("settles a row left 'connected' by a process that died", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "connected", "disconnected");
    store.qr.set(A, { qr: "stale", ttl: 60 });
    await manager.tick();

    assert.equal(sockets.length, 0);
    assert.equal(store.sessions.get(A)!.status, "disconnected");
    assert.equal(store.qr.has(A), false);
  });

  it("reconnects a previously linked session on startup without a new QR", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "connected", "connected");
    store.creds.set(A, "{}");
    await manager.tick();
    assert.equal(sockets.length, 1);
  });

  it("manages each user independently", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    store.addSession(B, "disconnected", "connected");
    await manager.tick();
    assert.equal(sockets.length, 2);
    assert.deepEqual(manager.managedUserIds.sort(), [A, B]);
  });

  it("drops a runner that gave up on its own", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    sockets[0]!.close(408); // QR never scanned
    await flush();

    await manager.tick();
    assert.deepEqual(manager.managedUserIds, []);
    // The runner set desired_state back to disconnected, so it is not restarted.
    assert.equal(sockets.length, 1);
  });

  it("heartbeats the managed sessions on the heartbeat interval", async () => {
    const { store, manager, clock } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    assert.equal(store.sessions.get(A)!.heartbeats, 1);

    clock.now += 3000;
    await manager.tick();
    assert.equal(store.sessions.get(A)!.heartbeats, 1, "not yet due");

    clock.now += 8000;
    await manager.tick();
    assert.equal(store.sessions.get(A)!.heartbeats, 2);
  });

  it("heartbeats a newly started session immediately, not on the next interval", async () => {
    const { store, manager, clock } = setup();
    await manager.tick(); // nothing managed yet: no heartbeat, no wasted interval
    store.addSession(A, "disconnected", "connected");
    clock.now += 3000;
    await manager.tick();
    assert.equal(store.sessions.get(A)!.heartbeats, 1);
  });

  it("marks a session as failed to start instead of crashing the loop", async () => {
    const { store, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    store.getCreds = async () => {
      throw new Error("db down");
    };
    await manager.tick();
    assert.match(store.sessions.get(A)!.lastError ?? "", /could not start/i);
    assert.deepEqual(manager.managedUserIds, []);
  });

  it("keeps links when the bridge shuts down", async () => {
    const { store, sockets, manager } = setup();
    store.addSession(A, "disconnected", "connected");
    await manager.tick();
    store.creds.set(A, "{}");
    await manager.stop();

    assert.ok(!sockets[0]!.calls.includes("logout"));
    assert.equal(store.creds.has(A), true);
  });
});
