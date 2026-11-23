import {
  AI_SCOPE_LABELS,
  AI_SCOPE_MODES,
  isAiScopeMode,
  resolveThemeScheme,
} from "../preferences";

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
});
