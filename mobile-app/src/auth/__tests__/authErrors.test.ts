/**
 * The auth copy mapping: GoTrue's error shapes become the sanitized strings
 * the sign-in screen renders — provider text never passes through.
 */
import { AUTH_COPY, signInErrorMessage } from "@/auth/authErrors";

describe("signInErrorMessage", () => {
  it("maps invalid credentials", () => {
    expect(
      signInErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }),
    ).toBe(AUTH_COPY.INVALID_CREDENTIALS);
  });

  it("maps an unconfirmed email", () => {
    expect(
      signInErrorMessage({ code: "email_not_confirmed", message: "Email not confirmed" }),
    ).toBe(AUTH_COPY.EMAIL_NOT_CONFIRMED);
  });

  it("maps a rate limit", () => {
    expect(signInErrorMessage({ status: 429, message: "too many requests" })).toBe(
      AUTH_COPY.RATE_LIMIT,
    );
  });

  it("maps network failures", () => {
    expect(
      signInErrorMessage({ message: "Network request failed" }),
    ).toBe(AUTH_COPY.NETWORK);
    expect(signInErrorMessage({ message: "Failed to fetch" })).toBe(
      AUTH_COPY.NETWORK,
    );
  });

  it("never leaks provider detail for anything else", () => {
    const result = signInErrorMessage({
      code: "unexpected_failure",
      message: "pg: internal error at 0xDEADBEEF",
    });
    expect(result).toBe(AUTH_COPY.GENERIC);
    expect(result).not.toContain("0xDEADBEEF");
  });
});
