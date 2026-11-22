import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  makeReadOnlySocket,
  READ_ONLY_ALLOWLIST,
  ReadOnlyViolationError,
  type RawSocketLike,
} from "../src/socket/readOnly.ts";
import { FakeSocket } from "./helpers/fakeSocket.ts";

/** A raw socket that also HAS every dangerous method, like the real one. */
function dangerousSocket(): RawSocketLike & Record<string, unknown> {
  const fake = new FakeSocket() as unknown as RawSocketLike & Record<string, unknown>;
  for (const name of [
    "sendMessage",
    "sendReceipt",
    "sendReceipts",
    "readMessages",
    "sendPresenceUpdate",
    "presenceSubscribe",
    "relayMessage",
    "updateMediaMessage",
    "chatModify",
    "groupParticipantsUpdate",
    "groupCreate",
    "groupLeave",
    "updateProfileStatus",
    "query",
  ]) {
    (fake as Record<string, unknown>)[name] = () => {
      throw new Error(`REAL ${name} WAS CALLED`);
    };
  }
  return fake;
}

describe("read-only socket", () => {
  it("passes the allowlisted members through", async () => {
    const fake = new FakeSocket();
    fake.groups = { "1@g.us": { id: "1@g.us", subject: "CS301" } };
    const sock = makeReadOnlySocket(fake);

    assert.deepEqual(Object.keys(await sock.groupFetchAllParticipating()), ["1@g.us"]);
    assert.equal(sock.user?.name, "Test");
    sock.end(undefined);
    await sock.logout();
    assert.deepEqual(fake.calls, ["groupFetchAllParticipating", "end", "logout"]);

    let seen = 0;
    sock.ev.on("messages.upsert", () => (seen += 1));
    fake.emit("messages.upsert", {});
    assert.equal(seen, 1);
  });

  it("throws ReadOnlyViolationError for every write/send/presence API", () => {
    const sock = makeReadOnlySocket(dangerousSocket()) as unknown as Record<string, unknown>;
    for (const name of [
      "sendMessage",
      "sendReceipt",
      "sendReceipts",
      "readMessages",
      "sendPresenceUpdate",
      "presenceSubscribe",
      "relayMessage",
      "updateMediaMessage",
      "chatModify",
      "groupParticipantsUpdate",
      "groupCreate",
      "groupLeave",
      "updateProfileStatus",
      "query",
    ]) {
      assert.throws(() => sock[name], ReadOnlyViolationError, name);
    }
  });

  it("refuses mutation of the socket", () => {
    const sock = makeReadOnlySocket(new FakeSocket()) as unknown as Record<string, unknown>;
    assert.throws(() => {
      sock.sendMessage = () => undefined;
    }, ReadOnlyViolationError);
    assert.throws(() => {
      delete sock.ev;
    }, ReadOnlyViolationError);
  });

  it("the allowlist is exactly the members the bridge needs", () => {
    assert.deepEqual([...READ_ONLY_ALLOWLIST].sort(), [
      "end",
      "ev",
      "groupFetchAllParticipating",
      "logout",
      "requestPairingCode",
      "user",
    ]);
  });
});

describe("source scan: nothing in src/ can write to WhatsApp", () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  function listTs(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listTs(full) : full.endsWith(".ts") ? [full] : [];
    });
  }

  const FORBIDDEN =
    /\b(sendMessage|sendReceipts?|readMessages|sendPresenceUpdate|presenceSubscribe|relayMessage|updateMediaMessage|sendMessageAck|chatModify|rejectCall|updateProfile\w*|groupParticipantsUpdate|groupCreate|groupLeave|groupUpdate\w*|newsletter\w*|addChatLabel|star)\b/;

  it("never references a send / receipt / presence / group-write API", () => {
    const offenders: string[] = [];
    for (const file of listTs(srcDir)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        // Comments may NAME these APIs to explain the rule.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (FORBIDDEN.test(code)) {
          offenders.push(`${relative(srcDir, file)}:${index + 1}`);
        }
      });
    }
    assert.deepEqual(offenders, []);
  });

  it("keeps the socket passive (online presence off, no outbound previews)", () => {
    const factory = readFileSync(join(srcDir, "socket", "factory.ts"), "utf8");
    assert.match(factory, /markOnlineOnConnect:\s*false/);
    assert.match(factory, /generateHighQualityLinkPreview:\s*false/);
    assert.doesNotMatch(factory, /markOnlineOnConnect:\s*true/);
  });

  it("uses a standard browser identity and Baileys' bundled web version", () => {
    const factory = readFileSync(join(srcDir, "socket", "factory.ts"), "utf8");
    assert.match(factory, /browser:\s*Browsers\.ubuntu\("Chrome"\)/);
    assert.doesNotMatch(factory, /version\s*:/, "no WA Web version override");
  });

  it("only the factory imports the raw Baileys socket constructor", () => {
    const importers = listTs(srcDir).filter((file) =>
      /import\s+makeWASocket|from\s+"@whiskeysockets\/baileys"[^;]*makeWASocket/.test(
        readFileSync(file, "utf8"),
      ),
    );
    assert.deepEqual(importers.map((f) => relative(srcDir, f).replace(/\\/g, "/")), [
      "socket/factory.ts",
    ]);
  });
});
