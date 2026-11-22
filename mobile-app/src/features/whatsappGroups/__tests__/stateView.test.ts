import { effectiveView, pollDelayMs, viewFor } from "../stateView";
import { EMPTY_SNAPSHOT, GROUP_SYNC_STATES, type GroupSyncSnapshot } from "../types";

describe("state → view", () => {
  it("defines every state", () => {
    for (const state of GROUP_SYNC_STATES) {
      const view = viewFor(state);
      expect(view.title).not.toBe("");
      expect(view.body).not.toBe("");
      expect(view.badge).not.toBe("");
    }
  });

  it("shows the phone form only when a link can be started", () => {
    const withForm = GROUP_SYNC_STATES.filter((s) => viewFor(s).showPhoneForm);
    expect(withForm.sort()).toEqual(["disconnected", "error"]);
  });

  it("shows the code only while code_ready, and groups only when connected", () => {
    expect(GROUP_SYNC_STATES.filter((s) => viewFor(s).showCode)).toEqual(["code_ready"]);
    expect(GROUP_SYNC_STATES.filter((s) => viewFor(s).showGroups)).toEqual(["connected"]);
  });

  it("offers a way out of every in-flight or linked state", () => {
    for (const state of ["starting", "bridge_offline", "qr_ready", "code_ready", "connected"] as const) {
      expect(viewFor(state).showDisconnect).toBe(true);
    }
    expect(viewFor("connected").disconnectLabel).toBe("Disconnect");
    expect(viewFor("code_ready").disconnectLabel).toBe("Cancel");
  });

  it("tells the student that turning a group on captures from now on", () => {
    expect(viewFor("connected").body).toMatch(/from that moment forward/i);
  });

  it("hides the whole feature when the server does not run it", () => {
    const view = viewFor("not_enabled");
    expect(view.showPhoneForm || view.showCode || view.showGroups || view.showReview).toBe(false);
  });

  it("says a code has expired instead of showing a dead one", () => {
    const snapshot: GroupSyncSnapshot = { ...EMPTY_SNAPSHOT, state: "code_ready", pairing: null };
    const view = effectiveView(snapshot);
    expect(view.showCode).toBe(false);
    expect(view.title).toMatch(/expired/i);
    expect(view.showDisconnect).toBe(true);
  });

  it("keeps the code card for a live code", () => {
    const snapshot: GroupSyncSnapshot = {
      ...EMPTY_SNAPSHOT,
      state: "code_ready",
      pairing: { code: "ABCD1234", expiresAt: "2026-11-19T12:00:00Z" },
    };
    expect(effectiveView(snapshot).showCode).toBe(true);
  });
});

describe("polling", () => {
  it("is quick while a link is in flight and relaxed otherwise", () => {
    expect(pollDelayMs("starting")).toBe(3_000);
    expect(pollDelayMs("code_ready")).toBe(3_000);
    expect(pollDelayMs("disconnecting")).toBe(3_000);
    expect(pollDelayMs("connected")).toBe(15_000);
    expect(pollDelayMs("disconnected")).toBe(10_000);
  });
});
