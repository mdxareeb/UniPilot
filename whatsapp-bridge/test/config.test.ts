import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError, loadConfig } from "../src/config.ts";

const base = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
  UNIPILOT_INTEGRATIONS_KEY: "integrations-secret-value",
};

describe("loadConfig", () => {
  it("reads the required values and applies defaults", () => {
    const config = loadConfig(base);
    assert.equal(config.supabaseUrl, base.SUPABASE_URL);
    assert.equal(config.pollIntervalMs, 3000);
    assert.equal(config.heartbeatIntervalMs, 10000);
    assert.equal(config.logLevel, "info");
  });

  it("falls back to NEXT_PUBLIC_SUPABASE_URL", () => {
    const { SUPABASE_URL: _omit, ...rest } = base;
    const config = loadConfig({ ...rest, NEXT_PUBLIC_SUPABASE_URL: "http://example.test" });
    assert.equal(config.supabaseUrl, "http://example.test");
  });

  it("names every missing variable and never prints a value", () => {
    assert.throws(
      () => loadConfig({ SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /SUPABASE_URL/);
        assert.match(error.message, /UNIPILOT_INTEGRATIONS_KEY/);
        assert.doesNotMatch(error.message, /service-role-secret-value/);
        return true;
      },
    );
  });

  it("rejects a non-integer or too-small interval", () => {
    assert.throws(() => loadConfig({ ...base, WHATSAPP_BRIDGE_POLL_MS: "abc" }), ConfigError);
    assert.throws(() => loadConfig({ ...base, WHATSAPP_BRIDGE_POLL_MS: "100" }), ConfigError);
    assert.equal(loadConfig({ ...base, WHATSAPP_BRIDGE_POLL_MS: "1500" }).pollIntervalMs, 1500);
  });
});
