import {
  AI_SCOPE_LABELS,
  AI_SCOPE_MODES,
  isAiScopeMode,
  loadAiLastScope,
  loadAiScopeMode,
  resolveThemeScheme,
  saveAiLastScope,
} from "../preferences";

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

const secureStore = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};

describe("resolveThemeScheme", () => {
  it("follows the system only in system mode", () => {
    expect(resolveThemeScheme("system", "light")).toBe("light");
    expect(resolveThemeScheme("system", "dark")).toBe("dark");
    expect(resolveThemeScheme("system", null)).toBe("dark");
  });

  it("lets an explicit mode override the system", () => {
    expect(resolveThemeScheme("light", "dark")).toBe("light");
    expect(resolveThemeScheme("dark", "light")).toBe("dark");
  });
});

describe("Ask AI scope preference", () => {
  it("accepts only the two documented modes", () => {
    expect(AI_SCOPE_MODES).toEqual(["all", "last"]);
    expect(isAiScopeMode("all")).toBe(true);
    expect(isAiScopeMode("last")).toBe(true);
    expect(isAiScopeMode("subject")).toBe(false);
    expect(isAiScopeMode(null)).toBe(false);
  });

  it("labels every mode", () => {
    for (const mode of AI_SCOPE_MODES) {
      expect(AI_SCOPE_LABELS[mode].length).toBeGreaterThan(0);
    }
  });

  describe("SecureStore fallbacks", () => {
    beforeEach(() => {
      secureStore.__store.clear();
    });

    it("defaults the opening mode to All Materials", async () => {
      await expect(loadAiScopeMode()).resolves.toBe("all");
      secureStore.__store.set("unipilot.ai-scope-mode", "junk");
      await expect(loadAiScopeMode()).resolves.toBe("all");
      secureStore.__store.set("unipilot.ai-scope-mode", "last");
      await expect(loadAiScopeMode()).resolves.toBe("last");
    });

    it("round-trips the last concrete scope and clears it for All Materials", async () => {
      await saveAiLastScope({ kind: "subject", id: "s1" });
      await expect(loadAiLastScope()).resolves.toEqual({
        kind: "subject",
        id: "s1",
      });

      await saveAiLastScope({ kind: "document", id: "d1" });
      await expect(loadAiLastScope()).resolves.toEqual({
        kind: "document",
        id: "d1",
      });

      await saveAiLastScope(null);
      await expect(loadAiLastScope()).resolves.toBeNull();
      expect(secureStore.__store.has("unipilot.ai-last-scope")).toBe(false);
    });

    it("reads corrupt or incomplete stored scopes as no scope", async () => {
      secureStore.__store.set("unipilot.ai-last-scope", "{not json");
      await expect(loadAiLastScope()).resolves.toBeNull();

      secureStore.__store.set(
        "unipilot.ai-last-scope",
        JSON.stringify({ kind: "subject", id: "   " }),
      );
      await expect(loadAiLastScope()).resolves.toBeNull();

      secureStore.__store.set(
        "unipilot.ai-last-scope",
        JSON.stringify({ kind: "other", id: "x" }),
      );
      await expect(loadAiLastScope()).resolves.toBeNull();
    });
  });
});
