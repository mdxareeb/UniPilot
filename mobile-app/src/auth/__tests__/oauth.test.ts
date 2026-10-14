/**
 * The OAuth callback URL parser: the piece that decides between a code to
 * exchange, a provider refusal, and junk — plus the PKCE flow id (`sb_flow_id`)
 * that React Native must pass back explicitly, since there is no
 * `window.location` for the library to read it from.
 */
import { parseAuthCallbackUrl } from "@/auth/oauth";

describe("parseAuthCallbackUrl", () => {
  it("extracts a PKCE code", () => {
    expect(
      parseAuthCallbackUrl("unipilot://auth-callback?code=abc123&state=xyz"),
    ).toEqual({ code: "abc123", error: null, flowId: null });
  });

  it("extracts the PKCE flow id when present", () => {
    expect(
      parseAuthCallbackUrl(
        "unipilot://auth-callback?code=abc123&sb_flow_id=flow-42",
      ),
    ).toEqual({ code: "abc123", error: null, flowId: "flow-42" });
  });

  it("extracts a provider refusal (description first)", () => {
    expect(
      parseAuthCallbackUrl(
        "unipilot://auth-callback?error=access_denied&error_description=User%20denied",
      ),
    ).toEqual({ code: null, error: "User denied", flowId: null });
  });

  it("falls back to the short error when no description exists", () => {
    expect(
      parseAuthCallbackUrl("unipilot://auth-callback?error=access_denied"),
    ).toEqual({ code: null, error: "access_denied", flowId: null });
  });

  it("treats an empty or whitespace code as absent", () => {
    expect(parseAuthCallbackUrl("unipilot://auth-callback?code=")).toEqual({
      code: null,
      error: null,
      flowId: null,
    });
    expect(parseAuthCallbackUrl("unipilot://auth-callback?code=%20")).toEqual({
      code: null,
      error: null,
      flowId: null,
    });
  });

  it("returns nothing for an unparseable URL", () => {
    expect(parseAuthCallbackUrl("not a url")).toEqual({
      code: null,
      error: null,
      flowId: null,
    });
  });
});
