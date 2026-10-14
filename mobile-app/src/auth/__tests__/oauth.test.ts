/**
 * The OAuth callback URL parser: the piece that decides between a code to
 * exchange, a provider refusal, and junk — the three cases the deep-link tests
 * exercise on the device.
 */
import { parseAuthCallbackUrl } from "@/auth/oauth";

describe("parseAuthCallbackUrl", () => {
  it("extracts a PKCE code", () => {
    expect(
      parseAuthCallbackUrl("unipilot://auth-callback?code=abc123&state=xyz"),
    ).toEqual({ code: "abc123", error: null });
  });

  it("extracts a provider refusal (description first)", () => {
    expect(
      parseAuthCallbackUrl(
        "unipilot://auth-callback?error=access_denied&error_description=User%20denied",
      ),
    ).toEqual({ code: null, error: "User denied" });
  });

  it("falls back to the short error when no description exists", () => {
    expect(
      parseAuthCallbackUrl("unipilot://auth-callback?error=access_denied"),
    ).toEqual({ code: null, error: "access_denied" });
  });

  it("treats an empty or whitespace code as absent", () => {
    expect(parseAuthCallbackUrl("unipilot://auth-callback?code=")).toEqual({
      code: null,
      error: null,
    });
    expect(parseAuthCallbackUrl("unipilot://auth-callback?code=%20")).toEqual({
      code: null,
      error: null,
    });
  });

  it("returns nothing for an unparseable URL", () => {
    expect(parseAuthCallbackUrl("not a url")).toEqual({ code: null, error: null });
  });
});
