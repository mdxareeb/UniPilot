import { WhatsAppApiError } from "../api";
import { applyToggle, sortGroups, toggleGroup, TOGGLE_COPY } from "../groupToggle";
import { candidateMeta, decideCandidate, REVIEW_COPY } from "../reviewActions";
import type { GroupCandidateItem, MonitoredGroupItem } from "../types";

const group = (id: string, name: string, active: boolean): MonitoredGroupItem => ({
  id,
  name,
  active,
  activatedAt: null,
  lastSyncedAt: null,
});

const candidate = (id: string, over: Partial<GroupCandidateItem> = {}): GroupCandidateItem => ({
  id,
  title: `Item ${id}`,
  kind: "task",
  typeLabel: "Assignment",
  whenLabel: "Fri, Nov 20",
  allDay: true,
  sender: "Asha",
  messageText: "due friday",
  confidencePercent: 70,
  subjectName: "Databases",
  proposedSubjectName: null,
  groupName: "CS",
  ...over,
});

describe("group toggle", () => {
  const groups = [group("a", "Alpha", false), group("b", "Beta", true)];

  it("turns a group on only after the write succeeds, and stamps when", async () => {
    const write = jest.fn(async () => "ok" as const);
    const outcome = await toggleGroup(write, groups, "a", true);
    expect(write).toHaveBeenCalledWith("a", true);
    expect(outcome.error).toBeNull();
    const a = outcome.groups.find((g) => g.id === "a");
    expect(a?.active).toBe(true);
    expect(a?.activatedAt).not.toBeNull();
    expect(outcome.groups.find((g) => g.id === "b")).toEqual(groups[1]);
  });

  it("leaves the list untouched and says so when the write fails", async () => {
    const outcome = await toggleGroup(async () => "error", groups, "a", true);
    expect(outcome.groups).toBe(groups);
    expect(outcome.error).toBe(TOGGLE_COPY.FAILED);
  });

  it("reports a group that no longer exists", async () => {
    const outcome = await toggleGroup(async () => "missing", groups, "a", true);
    expect(outcome.groups).toBe(groups);
    expect(outcome.error).toBe(TOGGLE_COPY.MISSING);
  });

  it("treats a thrown write as a failure", async () => {
    const outcome = await toggleGroup(
      async () => {
        throw new Error("offline");
      },
      groups,
      "a",
      true,
    );
    expect(outcome.groups).toBe(groups);
    expect(outcome.error).toBe(TOGGLE_COPY.FAILED);
  });

  it("keeps the original activation time when switching off", () => {
    const on = [{ ...group("a", "Alpha", true), activatedAt: "2026-11-01T00:00:00Z" }];
    expect(applyToggle(on, "a", false)[0]).toMatchObject({
      active: false,
      activatedAt: "2026-11-01T00:00:00Z",
    });
  });

  it("lists capturing groups first, then A to Z", () => {
    const sorted = sortGroups([group("1", "Zed", false), group("2", "Beta", true), group("3", "Alpha", false)]);
    expect(sorted.map((g) => g.name)).toEqual(["Beta", "Alpha", "Zed"]);
  });
});

describe("review actions", () => {
  const items = [candidate("1"), candidate("2")];

  it("adds: calls confirm and removes the item", async () => {
    const api = { decide: jest.fn(async () => undefined) };
    const outcome = await decideCandidate(api, items, "1", "confirm");
    expect(api.decide).toHaveBeenCalledWith("1", "confirm");
    expect(outcome.review.map((i) => i.id)).toEqual(["2"]);
    expect(outcome.message).toBe(REVIEW_COPY.ADDED);
    expect(outcome.tone).toBe("info");
  });

  it("dismisses: calls reject and says it is final", async () => {
    const api = { decide: jest.fn(async () => undefined) };
    const outcome = await decideCandidate(api, items, "2", "reject");
    expect(api.decide).toHaveBeenCalledWith("2", "reject");
    expect(outcome.review.map((i) => i.id)).toEqual(["1"]);
    expect(outcome.message).toBe(REVIEW_COPY.DISMISSED);
  });

  it("drops an item the server says is already handled (404)", async () => {
    const api = {
      decide: async () => {
        throw new WhatsAppApiError("not_found", "gone");
      },
    };
    const outcome = await decideCandidate(api, items, "1", "confirm");
    expect(outcome.review.map((i) => i.id)).toEqual(["2"]);
    expect(outcome.message).toBe(REVIEW_COPY.GONE);
    expect(outcome.tone).toBe("info");
  });

  it("keeps the item on a network or server failure", async () => {
    for (const kind of ["network", "server"] as const) {
      const api = {
        decide: async () => {
          throw new WhatsAppApiError(kind, "boom");
        },
      };
      const outcome = await decideCandidate(api, items, "1", "confirm");
      expect(outcome.review).toBe(items);
      expect(outcome.tone).toBe("error");
    }
  });

  it("describes a suggestion with its type, date and course", () => {
    expect(candidateMeta(candidate("1"))).toBe("Assignment · Fri, Nov 20 · Databases");
    expect(candidateMeta(candidate("1", { whenLabel: null, subjectName: null }))).toBe(
      "Assignment · No date",
    );
    expect(
      candidateMeta(candidate("1", { subjectName: null, proposedSubjectName: "Compilers" })),
    ).toBe("Assignment · Fri, Nov 20 · New course: Compilers");
  });
});
