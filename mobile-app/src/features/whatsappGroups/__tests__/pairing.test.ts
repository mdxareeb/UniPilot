import {
  copyPairingCode,
  displayCode,
  formatCountdown,
  normalizeCode,
  secondsLeft,
} from "../pairing";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const LIVE = { code: "ABCD1234", expiresAt: "2026-11-19T12:01:42Z" };
const EXPIRED = { code: "ABCD1234", expiresAt: "2026-11-19T11:59:59Z" };

describe("countdown", () => {
  it("counts whole seconds up, never below zero", () => {
    expect(secondsLeft(LIVE.expiresAt, NOW)).toBe(102);
    expect(secondsLeft(LIVE.expiresAt, NOW + 101_500)).toBe(1);
    expect(secondsLeft(EXPIRED.expiresAt, NOW)).toBe(0);
    expect(secondsLeft("not a date", NOW)).toBe(0);
  });

  it("formats m:ss", () => {
    expect(formatCountdown(102)).toBe("1:42");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(120)).toBe("2:00");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("code formatting", () => {
  it("shows ABCD-1234 but copies the raw 8 characters", () => {
    expect(displayCode("ABCD1234")).toBe("ABCD-1234");
    expect(normalizeCode("abcd-1234")).toBe("ABCD1234");
    expect(normalizeCode(" ab cd 12 34 ")).toBe("ABCD1234");
  });

  it("leaves an unexpected length ungrouped", () => {
    expect(displayCode("ABC")).toBe("ABC");
  });
});

describe("Copy Code", () => {
  it("copies the raw code while it is live", async () => {
    const setString = jest.fn(async () => true);
    expect(await copyPairingCode(LIVE, setString, NOW)).toBe("copied");
    expect(setString).toHaveBeenCalledTimes(1);
    expect(setString).toHaveBeenCalledWith("ABCD1234");
  });

  it("does not copy an expired code", async () => {
    const setString = jest.fn(async () => true);
    expect(await copyPairingCode(EXPIRED, setString, NOW)).toBe("expired");
    expect(setString).not.toHaveBeenCalled();
  });

  it("reports a clipboard refusal or error instead of claiming it copied", async () => {
    expect(await copyPairingCode(LIVE, async () => false, NOW)).toBe("failed");
    expect(
      await copyPairingCode(
        LIVE,
        async () => {
          throw new Error("denied");
        },
        NOW,
      ),
    ).toBe("failed");
  });
});
