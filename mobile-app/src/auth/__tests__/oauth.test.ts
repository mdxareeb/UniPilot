/**
 * The OAuth callback URL parser: the piece that decides between a code to
 * exchange, a provider refusal, and junk — plus the PKCE flow id (`sb_flow_id`)
 * that React Native must pass back explicitly, since there is no
 * `window.location` for the library to read it from. The exchange tests cover
 * the single-flight guard added after one callback minted two sessions.
 */
import { supabase } from "@/lib/supabase";
import { authCallbackParams, exchangeAuthCode, parseAuthCallbackUrl } from "@/auth/oauth";

jest.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession: jest.fn() } },
}));

const exchangeMock = (supabase as NonNullable<typeof supabase>).auth
  .exchangeCodeForSession as unknown as jest.Mock;

describe("exchangeAuthCode single-flight", () => {
  beforeEach(() => {
    exchangeMock.mockReset();
  });

  it("shares one exchange between concurrent submissions of the same code", async () => {
    exchangeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ error: null }), 10);
        }),
    );

    const [first, second] = await Promise.all([
      exchangeAuthCode("code-shared", "flow-1"),
      exchangeAuthCode("code-shared", "flow-1"),
    ]);

    expect(exchangeMock).toHaveBeenCalledTimes(1);
    expect(exchangeMock).toHaveBeenCalledWith("code-shared", {
      flowId: "flow-1",
    });
    expect(first).toEqual({ status: "signed_in" });
    expect(second).toEqual({ status: "signed_in" });
  });

  it("reuses the settled result when the same code arrives later", async () => {
    exchangeMock.mockResolvedValue({ error: null });

    await exchangeAuthCode("code-late");
    await exchangeAuthCode("code-late");

    expect(exchangeMock).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh exchange for a different code", async () => {
    exchangeMock.mockResolvedValue({ error: null });

    await exchangeAuthCode("code-one");
    await exchangeAuthCode("code-two");

    expect(exchangeMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, so a re-delivery can retry", async () => {
    exchangeMock
      .mockResolvedValueOnce({ error: { message: "network" } })
      .mockResolvedValueOnce({ error: null });

    const failed = await exchangeAuthCode("code-retry");
    const retried = await exchangeAuthCode("code-retry");

    expect(failed.status).toBe("error");
    expect(retried).toEqual({ status: "signed_in" });
    expect(exchangeMock).toHaveBeenCalledTimes(2);
  });
});

describe("authCallbackParams", () => {
  it("extracts the route params from the app landing", () => {
    expect(
      authCallbackParams("unipilot://auth-callback?code=abc123&sb_flow_id=f1"),
    ).toEqual({ code: "abc123", sb_flow_id: "f1" });
  });

  it("decodes a provider refusal for the callback screen", () => {
    expect(
      authCallbackParams(
        "unipilot://auth-callback?error=access_denied&error_description=User%20denied",
      ),
    ).toEqual({ error: "access_denied", error_description: "User denied" });
  });

  it("ignores URLs that are not the app's OAuth landing", () => {
    expect(authCallbackParams("https://example.com/?code=abc")).toBeNull();
    expect(authCallbackParams("unipilot://other?code=abc")).toBeNull();
    expect(authCallbackParams("unipilot://auth-callback")).toBeNull();
  });

  it("returns null for missing or unparseable URLs", () => {
    expect(authCallbackParams(null)).toBeNull();
    expect(authCallbackParams(undefined)).toBeNull();
    expect(authCallbackParams("not a url")).toBeNull();
  });
});

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
