import { parseProfileEdit } from "../profileEdit";

describe("parseProfileEdit", () => {
  it("trims and accepts a complete profile", () => {
    const result = parseProfileEdit({
      firstName: "  QA ",
      lastName: "Two",
      timezone: "Asia/Kolkata",
    });
    expect(result).toEqual({
      ok: true,
      value: { firstName: "QA", lastName: "Two", timezone: "Asia/Kolkata" },
    });
  });

  it("requires at least one name", () => {
    const result = parseProfileEdit({ firstName: " ", lastName: "", timezone: "UTC" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("name");
  });

  it("rejects a name that is too long", () => {
    const result = parseProfileEdit({
      firstName: "a".repeat(61),
      lastName: "",
      timezone: "UTC",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("name");
  });

  it("rejects an invalid timezone", () => {
    const result = parseProfileEdit({
      firstName: "QA",
      lastName: "",
      timezone: "Mars/Olympus",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("timezone");
  });

  it("normalises an empty last name to null", () => {
    const result = parseProfileEdit({ firstName: "QA", lastName: "", timezone: "UTC" });
    expect(result).toEqual({
      ok: true,
      value: { firstName: "QA", lastName: null, timezone: "UTC" },
    });
  });
});
