import {
  HOME_ROUTES,
  HOME_TOOL_GROUPS,
  type HomeToolsGroup,
} from "../homeGroups";
import {
  connectedIntegrationCount,
  groupPill,
  indexedFilesLabel,
  integrationGroupPill,
  liveTools,
  statValue,
  toolGroupPill,
} from "../homeValues";
import type { IntegrationStatusContext } from "@/features/workspace/registries";

const context: IntegrationStatusContext = {
  whatsapp: {
    configured: true,
    state: "connected",
    pending: 0,
    lastSyncedAt: null,
  },
  google: {
    configured: true,
    status: "connected",
    lastSyncedAt: null,
  },
};

describe("HOME_TOOL_GROUPS", () => {
  it("has unique group and item ids and only live items carry a route", () => {
    const groupIds = HOME_TOOL_GROUPS.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);

    const items = HOME_TOOL_GROUPS.flatMap((group) =>
      group.kind === "tools" ? group.items : [],
    );
    const itemIds = items.map((item) => item.id);
    expect(new Set(itemIds).size).toBe(itemIds.length);

    for (const item of items) {
      if (item.status === "planned") {
        expect(item.route).toBeUndefined();
      } else {
        expect(HOME_ROUTES).toContain(item.route);
      }
    }
  });

  it("keeps the four file tools and two study tools in their groups", () => {
    const fileTools = HOME_TOOL_GROUPS.find(
      (group) => group.id === "file-tools",
    ) as HomeToolsGroup;
    const studyTools = HOME_TOOL_GROUPS.find(
      (group) => group.id === "study-tools",
    ) as HomeToolsGroup;
    expect(liveTools(fileTools).map((item) => item.id)).toEqual([
      "image-to-pdf",
      "convert",
      "pdf-utils",
      "materials",
    ]);
    expect(liveTools(studyTools).map((item) => item.id)).toEqual(["ask-ai"]);
    expect(fileTools.items).toHaveLength(4);
    expect(studyTools.items).toHaveLength(2);
  });
});

describe("home group pills", () => {
  it("counts live tools and connected integrations without pretending", () => {
    const fileTools = HOME_TOOL_GROUPS.find(
      (group) => group.id === "file-tools",
    ) as HomeToolsGroup;
    expect(toolGroupPill(fileTools)).toBe("4 live");
    expect(connectedIntegrationCount(context)).toBe(2);
    expect(integrationGroupPill(context)).toBe("2 connected");
    expect(groupPill(fileTools, context)).toBe("4 live");
  });

  it("says Set up when nothing is connected", () => {
    expect(integrationGroupPill({ whatsapp: null, google: null })).toBe("Set up");
  });
});

describe("home labels", () => {
  it("pluralises indexed files and never invents a count", () => {
    expect(indexedFilesLabel(null)).toBeNull();
    expect(indexedFilesLabel(0)).toBe("No files");
    expect(indexedFilesLabel(1)).toBe("1 file");
    expect(indexedFilesLabel(3)).toBe("3 files");
    expect(statValue(null)).toBe("—");
    expect(statValue(0)).toBe("0");
  });
});
