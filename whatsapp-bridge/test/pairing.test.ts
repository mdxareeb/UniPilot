import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import { PHONE_REJECTION_COPY, sanitizePhone } from "../src/pairing/phone.ts";
import {
  PAIRING_CODE_TTL_SECONDS,
  SESSION_MESSAGES,
  SessionRunner,
  type RunnerDeps,
} from "../src/session/runner.ts";
import { FakeSocket, flush } from "./helpers/fakeSocket.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const silent = pino({ level: "silent" });

describe("sanitizePhone", () => {
  it("returns digits only, without a plus, for the shapes people type", () => {
    for (const input of [
      "919876543210",
      "+919876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "(91) 98765.43210",
      "00919876543210",
      "  +91 98765 43210  ",
    ]) {
      assert.deepEqual(sanitizePhone(input), { ok: true, digits: "919876543210" }, input);
    }
  });

  it("accepts the shortest and longest E.164 lengths", () => {
    assert.equal(sanitizePhone("12345678").ok, true);
    assert.equal(sanitizePhone("123456789012345").ok, true);
    assert.deepEqual(sanitizePhone("1234567"), { ok: false, reason: "length" });
    assert.deepEqual(sanitizePhone("1234567890123456"), { ok: false, reason: "length" });
  });

  it("rejects a national-format number instead of guessing a country", () => {
    assert.deepEqual(sanitizePhone("09876543210"), { ok: false, reason: "country_code" });
    assert.deepEqual(sanitizePhone("+0987654321"), { ok: false, reason: "country_code" });
  });

  it("rejects letters and other characters rather than stripping them", () => {
    for (const input of ["91 9876 abc 210", "call me", "91987654321x", "91;98765432", "٩١٩٨٧٦٥٤٣٢١٠"]) {
      assert.deepEqual(sanitizePhone(input), { ok: false, reason: "characters" }, input);
    }
  });

  it("rejects empty and non-string input", () => {
    for (const input of ["", "   ", null, undefined, 919876543210, {}, []]) {
      assert.deepEqual(sanitizePhone(input), { ok: false, reason: "empty" });
    }
  });

  it("has plain-language copy for every rejection and never echoes the input", () => {
    for (const reason of ["empty", "characters", "country_code", "length"] as const) {
      assert.ok(PHONE_REJECTION_COPY[reason].length > 10);
    }
  });
});

function setup(options: { linkMethod?: "qr" | "pairing_code"; phone?: string | null; registered?: boolean } = {}) {
  const store = new MemoryStore();
  store.addSession(USER, "disconnected", "connected", options.linkMethod ?? "pairing_code");
  if (options.phone !== null) store.phones.set(USER, options.phone ?? "919876543210");
  if (options.registered) {
    // An already-linked account's credentials: `registered: true`.
    store.creds.set(USER, JSON.stringify({ registered: true }));
  }
  const sockets: FakeSocket[] = [];
  const deps: RunnerDeps = {
    store,
    logger: silent,
    openSocket: () => {
      const sock = new FakeSocket();
      sockets.push(sock);
      return sock;
    },
    sleep: async () => undefined,
    backoffMs: () => 0,
  };
  const runner = new SessionRunner(USER, deps, { linkMethod: options.linkMethod ?? "pairing_code" });
  return { store, sockets, runner };
}

describe("SessionRunner: pairing-code link (mobile)", () => {
  it("requests a code for the stored, sanitised number and publishes it, never the QR", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@would-be-a-qr" });
    await flush();

    assert.deepEqual(sockets[0]!.pairingRequests, ["919876543210"]);
    assert.deepEqual(store.pairingCodes.get(USER), { code: "ABCD1234", ttl: PAIRING_CODE_TTL_SECONDS });
    assert.equal(store.sessions.get(USER)!.status, "code_ready");
    assert.equal(store.qr.has(USER), false, "no QR is published in pairing mode");
    assert.equal(store.sessions.get(USER)!.lastError, null);
  });

  it("asks WhatsApp for ONE code per socket even though the QR keeps rotating", async () => {
    const { sockets, runner } = setup();
    await runner.start();
    for (let i = 0; i < 4; i += 1) sockets[0]!.emit("connection.update", { qr: `2@qr-${i}` });
    await flush();
    assert.equal(sockets[0]!.pairingRequests.length, 1);
  });

  it("re-validates the number before sending it to WhatsApp", async () => {
    const { store, sockets, runner } = setup({ phone: "0987654321" });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();

    assert.equal(sockets[0]!.pairingRequests.length, 0, "a malformed number never reaches WhatsApp");
    const row = store.sessions.get(USER)!;
    assert.equal(row.lastError, SESSION_MESSAGES.noNumber);
    assert.equal(row.desiredState, "disconnected");
    assert.equal(runner.isFinished, true);
  });

  it("stops with an honest message when no number is stored", async () => {
    const { store, sockets, runner } = setup({ phone: null });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();
    assert.equal(store.sessions.get(USER)!.lastError, SESSION_MESSAGES.noNumber);
  });

  it("stops and forgets the number when WhatsApp refuses the request", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.pairingError = new Error("rate-overlimit +919876543210");
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();

    const row = store.sessions.get(USER)!;
    assert.equal(row.lastError, SESSION_MESSAGES.pairingFailed);
    assert.doesNotMatch(row.lastError ?? "", /9876543210|rate-overlimit/);
    assert.equal(store.phones.has(USER), false, "the number is deleted when the attempt ends");
    assert.equal(store.pairingCodes.has(USER), false);
    assert.equal(runner.isFinished, true);
  });

  it("deletes the number and the code the moment the link succeeds", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();
    assert.ok(store.phones.has(USER) && store.pairingCodes.has(USER));

    sockets[0]!.close(DisconnectReason.restartRequired); // WhatsApp's step after the code is entered
    await flush();
    sockets[1]!.emit("connection.update", { connection: "open" });
    await flush();

    assert.equal(store.sessions.get(USER)!.status, "connected");
    assert.equal(store.phones.has(USER), false);
    assert.equal(store.pairingCodes.has(USER), false);
  });

  it("does not treat the reconnect after entering the code as an expired code", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();
    sockets[0]!.close(DisconnectReason.restartRequired);
    await flush();
    sockets[1]!.close(DisconnectReason.timedOut);
    await flush();
    assert.equal(sockets.length, 3, "retried with backoff");
    assert.notEqual(store.sessions.get(USER)!.lastError, SESSION_MESSAGES.codeExpired);
  });

  it("gives up with an honest message when the code is never entered", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();
    sockets[0]!.close(DisconnectReason.timedOut);
    await flush();

    const row = store.sessions.get(USER)!;
    assert.equal(row.lastError, SESSION_MESSAGES.codeExpired);
    assert.equal(row.status, "disconnected");
    assert.equal(store.phones.has(USER), false);
    assert.equal(store.pairingCodes.has(USER), false);
    assert.equal(runner.isFinished, true);
  });

  it("the web (QR) method is unchanged and never asks for a pairing code", async () => {
    const { store, sockets, runner } = setup({ linkMethod: "qr" });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@scan-me" });
    await flush();
    assert.equal(sockets[0]!.pairingRequests.length, 0);
    assert.equal(store.sessions.get(USER)!.status, "qr_ready");
    assert.ok(store.qr.has(USER));
  });

  it("an already-linked account just reconnects: no code is requested", async () => {
    const { store, sockets, runner } = setup({ registered: true });
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" }); // would not normally arrive
    sockets[0]!.emit("connection.update", { connection: "open" });
    await flush();
    assert.equal(sockets[0]!.pairingRequests.length, 0);
    assert.equal(store.sessions.get(USER)!.status, "connected");
  });

  it("disconnect (logout) removes the number along with every other secret", async () => {
    const { store, sockets, runner } = setup();
    await runner.start();
    sockets[0]!.emit("connection.update", { qr: "2@x" });
    await flush();
    await runner.stop({ logout: true });
    assert.equal(store.phones.has(USER), false);
    assert.equal(store.pairingCodes.has(USER), false);
  });
});
