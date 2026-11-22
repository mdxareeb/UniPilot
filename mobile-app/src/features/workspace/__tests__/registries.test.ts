import {
  INTEGRATIONS_REGISTRY,
  relativeTime,
  TOOLS_REGISTRY,
  type IntegrationStatusContext,
} from "../registries";

const context = (
  over: Partial<NonNullable<IntegrationStatusContext["whatsapp"]>>,
): IntegrationStatusContext => ({
  whatsapp: {
    configured: true,
    state: "connected",
    pending: 0,
    lastSyncedAt: null,
    ...over,
  },
});

describe("tools registry", () => {
  it("has unique ids and only live tools carry a route", () => {
    const ids = TOOLS_REGISTRY.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of TOOLS_REGISTRY) {
      if (tool.status === "live") expect(tool.route).toBeTruthy();
      else expect(tool.route).toBeUndefined();
    }
    expect(TOOLS_REGISTRY.find((tool) => tool.id === "materials")?.route).toBe(
      "/materials",
    );
    expect(TOOLS_REGISTRY.find((tool) => tool.id === "focus")?.status).toBe(
      "planned",
    );
  });
});

describe("integrations registry", () => {
  const whatsapp = INTEGRATIONS_REGISTRY.find(
    (integration) => integration.id === "whatsapp",
  )!;

  it("has unique ids and valid categories", () => {
    const ids = INTEGRATIONS_REGISTRY.map((integration) => integration.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(["messaging", "hardware", "calendar", "lms"]);
    for (const integration of INTEGRATIONS_REGISTRY) {
      expect(categories.has(integration.category)).toBe(true);
    }
  });

  it("resolves the honest WhatsApp states", () => {
    expect(whatsapp.statusResolver({ whatsapp: null })).toEqual({
      label: "Not connected",
      tone: "outline",
    });
    expect(whatsapp.statusResolver(context({ pending: 2 }))).toEqual({
      label: "2 Pending",
      tone: "warning",
    });
    expect(whatsapp.statusResolver(context({}))).toEqual({
      label: "Connected",
      tone: "solid",
    });
    expect(whatsapp.statusResolver(context({ state: "bridge_offline" }))).toEqual({
      label: "Service off",
      tone: "outline",
    });
    expect(whatsapp.statusResolver(context({ state: "error" }))).toEqual({
      label: "Needs attention",
      tone: "danger",
    });
    expect(
      whatsapp.statusResolver(context({ state: "code_ready" })),
    ).toEqual({ label: "Linking", tone: "warning" });
    expect(whatsapp.statusResolver(context({ state: "disconnected" }))).toEqual({
      label: "Disconnected",
      tone: "outline",
    });
  });

  it("marks the future integrations as planned", () => {
    for (const id of ["desk-companion", "google-calendar", "microsoft", "moodle"]) {
      const integration = INTEGRATIONS_REGISTRY.find((entry) => entry.id === id)!;
      expect(integration.statusResolver({ whatsapp: null })).toEqual({
        label: "Planned",
        tone: "planned",
      });
    }
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-22T10:00:00Z");
  const at = (secondsAgo: number) =>
    new Date(now - secondsAgo * 1000).toISOString();

  it("reports honest relative timestamps", () => {
    expect(relativeTime(null, now)).toBe("Not synced yet");
    expect(relativeTime("nonsense", now)).toBe("Not synced yet");
    expect(relativeTime(at(20), now)).toBe("Just now");
    expect(relativeTime(at(12 * 60), now)).toBe("12m ago");
    expect(relativeTime(at(3 * 3600), now)).toBe("3h ago");
    expect(relativeTime(at(26 * 3600), now)).toBe("Yesterday");
    expect(relativeTime(at(5 * 24 * 3600), now)).toBe("5d ago");
    expect(relativeTime(at(10 * 24 * 3600), now)).toBe("Nov 12");
  });
});
