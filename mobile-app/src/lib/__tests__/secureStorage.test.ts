/**
 * The chunked secure-store adapter's regression test: small values round-trip
 * whole, large values split and reassemble byte-for-byte, an incomplete chunk
 * set reads as "no session", and removal clears every chunk.
 */
import { secureStorage } from "@/lib/secureStorage";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

const mocked = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};

describe("secureStorage", () => {
  beforeEach(() => {
    mocked.__store.clear();
  });

  it("round-trips a small value as a single entry", async () => {
    await secureStorage.setItem("session", "small");
    expect(mocked.__store.get("session")).toBe("small");
    expect(await secureStorage.getItem("session")).toBe("small");
  });

  it("splits and reassembles a large value", async () => {
    const large = "x".repeat(5000);
    await secureStorage.setItem("session", large);
    expect(mocked.__store.get("session")).toBe("__unipilot_chunks__:3");
    expect(await secureStorage.getItem("session")).toBe(large);
  });

  it("replacing a large value with a small one leaves no stale chunks", async () => {
    await secureStorage.setItem("session", "y".repeat(5000));
    await secureStorage.setItem("session", "tiny");
    expect(await secureStorage.getItem("session")).toBe("tiny");
    expect(mocked.__store.get("session.0")).toBeUndefined();
  });

  it("returns null for an incomplete chunk set (never a half session)", async () => {
    await secureStorage.setItem("session", "z".repeat(5000));
    mocked.__store.delete("session.1");
    expect(await secureStorage.getItem("session")).toBeNull();
  });

  it("removes the head and every chunk", async () => {
    await secureStorage.setItem("session", "w".repeat(5000));
    await secureStorage.removeItem("session");
    expect(mocked.__store.size).toBe(0);
  });
});
