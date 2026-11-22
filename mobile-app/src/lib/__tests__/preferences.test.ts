import { resolveThemeScheme } from "../preferences";

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
