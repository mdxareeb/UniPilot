import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pino from "pino";
import { discoverGroups, isGroupJid } from "../src/groups/discovery.ts";
import { makeReadOnlySocket } from "../src/socket/readOnly.ts";
import { FakeSocket } from "./helpers/fakeSocket.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const silent = pino({ level: "silent" });

function socketWith(groups: FakeSocket["groups"]) {
  const fake = new FakeSocket();
  fake.groups = groups;
  return makeReadOnlySocket(fake);
}

describe("group discovery", () => {
  it("recognises only group JIDs", () => {
    assert.equal(isGroupJid("120363@g.us"), true);
    assert.equal(isGroupJid("1555@s.whatsapp.net"), false);
    assert.equal(isGroupJid("status@broadcast"), false);
    assert.equal(isGroupJid("123@newsletter"), false);
    assert.equal(isGroupJid(undefined), false);
  });

  it("records every group as OFF", async () => {
    const store = new MemoryStore();
    const sock = socketWith({
      "1@g.us": { id: "1@g.us", subject: "CS301 Data Structures" },
      "2@g.us": { id: "2@g.us", subject: "Family" },
    });

    assert.equal(await discoverGroups(USER, sock, store, silent), 2);
    assert.deepEqual(
      [...store.groups.values()].map((g) => [g.name, g.active]),
      [
        ["CS301 Data Structures", false],
        ["Family", false],
      ],
    );
    assert.deepEqual([...(await store.listActiveGroups(USER))], []);
  });

  it("never changes a group the owner already switched on", async () => {
    const store = new MemoryStore();
    store.groups.set(`${USER}|1@g.us`, { jid: "1@g.us", name: "old name", active: true });
    const sock = socketWith({ "1@g.us": { id: "1@g.us", subject: "Renamed" } });

    await discoverGroups(USER, sock, store, silent);

    const row = store.groups.get(`${USER}|1@g.us`)!;
    assert.equal(row.name, "Renamed");
    assert.equal(row.active, true);
    assert.deepEqual([...(await store.listActiveGroups(USER))], ["1@g.us"]);
  });

  it("ignores anything that is not a group", async () => {
    const store = new MemoryStore();
    const sock = socketWith({
      "1@g.us": { id: "1@g.us", subject: "Real group" },
      "x@s.whatsapp.net": { id: "x@s.whatsapp.net", subject: "A person" },
    });
    assert.equal(await discoverGroups(USER, sock, store, silent), 1);
    assert.equal(store.groups.size, 1);
  });

  it("survives a failed listing without breaking the link", async () => {
    const store = new MemoryStore();
    const fake = new FakeSocket();
    fake.groupFetchAllParticipating = async () => {
      throw new Error("rate-overlimit");
    };
    const sock = makeReadOnlySocket(fake);
    assert.equal(await discoverGroups(USER, sock, store, silent), 0);
    assert.equal(store.groups.size, 0);
  });

  it("handles a group with no subject", async () => {
    const store = new MemoryStore();
    const sock = socketWith({ "1@g.us": { id: "1@g.us" } });
    await discoverGroups(USER, sock, store, silent);
    assert.equal(store.groups.get(`${USER}|1@g.us`)!.name, "");
  });
});
