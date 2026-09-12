/**
 * tests/qa/tool-registry.spec.ts — Task 30.1's committed surface guard.
 *
 * Proves the registry (components/tools/toolCatalog.ts) is the source the
 * audited surfaces actually read: /features cards, the homepage marquee and the
 * authenticated dashboard hub each render names, actions, status words and
 * family labels that resolve from the same entries. It imports the registry
 * directly, so the assertions compare the live data rather than a third copy of
 * it — and the module's own load-time invariant runs as a side effect of that
 * import, which is what the deliberate-break proof exercises.
 *
 * Scope notes (0.7 — focused):
 * - Guest surfaces open a fresh context; the dashboard test uses the 20.10
 *   fixture's storage state supplied by the `chromium-authenticated` project.
 * - `pdf-editor` has no card on /features: the converter section carries its
 *   capabilities (merge/split/extract/compress) as utility groups, while the
 *   tool is carded on the homepage marquee and the dashboard hub. The expected
 *   catalogue set below encodes that, so it cannot silently change.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  HAS_LIVE_TOOL,
  OFFERABLE_TOOLS,
  TOOL_GROUPS,
  TOOLS,
  toolActionLabel,
  toolStatusLabel,
  toolsInGroup,
  type Tool,
} from "../../components/tools/toolCatalog";

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Tools with their own expanded /features section instead of a catalogue card. */
const DEDICATED_SECTION_TOOLS: readonly Tool[] = [
  "presentation",
  "file-converters",
].map((id) => TOOLS.find((tool) => tool.id === id) as Tool);

/**
 * The catalogue cards /features renders, mirroring the page's own grouping:
 * create (minus the presentation section), edit (minus the converters
 * section) and study. `pdf-editor` is the convert family's other entry and is
 * represented by the converters section's utility groups, not a card.
 */
const FEATURES_CARDED: readonly Tool[] = [
  ...toolsInGroup("create", ["presentation"]),
  ...toolsInGroup("edit", ["file-converters"]),
  ...toolsInGroup("study"),
];

function cardFrom(
  name: string,
  action: string | null,
  statusWord: string | null,
): { tool: Tool; action: string | null; statusWord: string | null } {
  const tool = BY_NAME.get(name);
  expect(tool, `rendered card "${name}" is not a registry tool name`).toBeTruthy();
  return { tool: tool as Tool, action, statusWord };
}

async function expectNoFakeOpen(page: Page) {
  if (!HAS_LIVE_TOOL) {
    await expect(
      page.getByRole("link", { name: "Open", exact: true }),
    ).toHaveCount(0);
  }
}

test.describe("tool registry: /features catalogue", () => {
  test("every catalogue card renders the registry's name, action and status", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/features");
    await page.waitForLoadState("networkidle");

    // Cards are `li` rows that carry both a tool heading and an action link;
    // that excludes the converter section's utility groups, which are also h4s.
    // The marketing shell has no `<main>` landmark, so the scan is document-wide.
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll("li")]
        .map((li) => {
          const heading = li.querySelector("h4");
          const action = li.querySelector("a");
          if (!heading || !action) return null;
          const actionText = action.textContent.trim();
          if (actionText !== "How it will work" && actionText !== "Open") {
            return null;
          }
          const statusWord =
            [...li.querySelectorAll("span")]
              .map((span) => span.textContent.trim())
              .find((text) => text === "Planned" || text === "Research") ?? null;
          return {
            name: heading.textContent.trim(),
            action: actionText,
            statusWord,
          };
        })
        .filter(Boolean) as {
        name: string;
        action: string;
        statusWord: string | null;
      }[],
    );

    expect(rendered.length, "no catalogue cards found").toBeGreaterThan(0);

    const expectedNames = new Set(FEATURES_CARDED.map((tool) => tool.name));
    for (const card of rendered) {
      expect(
        expectedNames.has(card.name),
        `unexpected card on /features: ${card.name}`,
      ).toBe(true);
    }

    for (const tool of FEATURES_CARDED) {
      const cards = rendered.filter((card) => card.name === tool.name);
      expect(cards, `${tool.id}: expected exactly one card`).toHaveLength(1);
      const { action, statusWord } = cardFrom(
        cards[0].name,
        cards[0].action,
        cards[0].statusWord,
      );
      expect(action, `${tool.id}: action label`).toBe(toolActionLabel(tool));
      if (tool.status === "planned") {
        expect(statusWord, `${tool.id}: status word`).toBe(
          toolStatusLabel(tool),
        );
      }
    }

    for (const tool of DEDICATED_SECTION_TOOLS) {
      await expect(
        page.getByText(tool.name, { exact: true }).first(),
      ).toBeVisible();
    }

    for (const tool of TOOLS.filter((entry) => entry.status === "disabled")) {
      await expect(
        page.getByRole("heading", { level: 4, name: tool.name, exact: true }),
      ).toHaveCount(0);
    }

    await expectNoFakeOpen(page);
    await ctx.close();
  });
});

test.describe("tool registry: homepage marquee", () => {
  test("the marquee lists every offered registry tool with the registry's status word", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const cards = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".marquee-track li:not(.marquee-ghost) a",
        ),
      ].map((anchor) => {
        const spans = [...anchor.querySelectorAll("span span")];
        return {
          name: spans[0]?.textContent?.trim() ?? "",
          statusWord: spans[1]?.textContent?.trim() || null,
        };
      }),
    );

    // Tier-3 `disabled` entries are excluded by the registry itself (TASK.md
    // Part X: never advertised as launch functionality), so the marquee is the
    // offered set, not the whole catalogue.
    expect(cards.map((card) => card.name)).toEqual(
      OFFERABLE_TOOLS.map((tool) => tool.name),
    );

    for (const card of cards) {
      const { tool, statusWord } = cardFrom(card.name, null, card.statusWord);
      const expected = tool.status === "live" ? null : toolStatusLabel(tool);
      expect(statusWord, `${tool.id}: status word`).toBe(expected);
    }

    for (const tool of TOOLS.filter((entry) => entry.status === "disabled")) {
      expect(
        cards.map((card) => card.name),
        `${tool.id}: Tier-3 tool must not be carded on the homepage`,
      ).not.toContain(tool.name);
    }

    await expectNoFakeOpen(page);
    await ctx.close();
  });
});

test.describe("tool registry: destinations resolve", () => {
  test("/features renders every registry destination anchor and jump-nav target", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/features");
    await page.waitForLoadState("networkidle");

    const ids = new Set(
      await page.evaluate(() =>
        [...document.querySelectorAll("[id]")].map((el) => el.id),
      ),
    );

    const anchors = new Set<string>();
    for (const href of [
      ...TOOL_GROUPS.map((group) => group.href),
      ...TOOLS.map((tool) => tool.href),
    ]) {
      if (href.includes("#")) anchors.add(href.slice(href.indexOf("#") + 1));
    }
    expect(anchors.size).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(
        ids.has(anchor),
        `registry destination #${anchor} has no target on /features`,
      ).toBe(true);
    }

    const pills = await page.evaluate(() =>
      [
        ...document.querySelectorAll('nav[aria-label="Jump to a part"] a'),
      ].map((anchor) => anchor.getAttribute("href")),
    );
    expect(pills.length, "jump-nav pills found").toBeGreaterThan(0);
    for (const href of pills) {
      expect(href?.startsWith("#"), `jump pill ${href} is not an anchor`).toBe(
        true,
      );
      expect(
        ids.has((href as string).slice(1)),
        `jump pill ${href} has no target`,
      ).toBe(true);
    }

    await ctx.close();
  });

  test("homepage action links resolve to /features anchors or the real route", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((anchor) => anchor.getAttribute("href") ?? "")
        .filter((href) => href === "/features" || href.startsWith("/features#")),
    );
    expect(hrefs.length, "homepage /features links found").toBeGreaterThan(0);
    const anchorHrefs = [...new Set(hrefs.filter((href) => href.includes("#")))];

    await page.goto("/features");
    await page.waitForLoadState("networkidle");
    const ids = new Set(
      await page.evaluate(() =>
        [...document.querySelectorAll("[id]")].map((el) => el.id),
      ),
    );

    for (const href of anchorHrefs) {
      const anchor = href.slice(href.indexOf("#") + 1);
      expect(
        ids.has(anchor),
        `homepage link ${href} has no target on /features`,
      ).toBe(true);
    }

    await ctx.close();
  });
});

test.describe("tool registry: /tools workspace catalogue", () => {
  test("lists every offerable tool by family with registry actions, statuses and destinations", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/tools");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { level: 1, name: "Tools" }),
    ).toBeVisible();

    // Each family is one `section` with the registry's own label as its h2 and
    // its cards under it. Scanning per section proves grouping, not just
    // presence: a tool moved to the wrong family fails here.
    const families = await page.evaluate(() =>
      [
        ...document.querySelectorAll("main section"),
      ]
        .map((section) => ({
          label: section.querySelector("h2")?.textContent?.trim() ?? null,
          cards: [...section.querySelectorAll("li")].map((li) => {
            const heading = li.querySelector("h3");
            const action = li.querySelector("a");
            return {
              name: heading?.textContent?.trim() ?? null,
              action: action?.textContent?.trim() ?? null,
              href: action?.getAttribute("href") ?? null,
              statusWord:
                [...li.querySelectorAll("span")]
                  .map((span) => span.textContent.trim())
                  .find((text) => text === "Planned" || text === "Research") ??
                null,
            };
          }),
        }))
        .filter((family) => family.label !== null),
    );

    expect(
      families.map((family) => family.label),
      "every registry family renders, in registry order",
    ).toEqual(TOOL_GROUPS.map((group) => group.label));

    for (const group of TOOL_GROUPS) {
      const family = families.find((entry) => entry.label === group.label);
      const expected = toolsInGroup(group.id);
      expect(
        family?.cards.map((card) => card.name),
        `${group.id}: every offerable tool, in registry order`,
      ).toEqual(expected.map((tool) => tool.name));

      for (const tool of expected) {
        const card = family?.cards.find((entry) => entry.name === tool.name);
        expect(card, `${tool.id}: card present`).toBeTruthy();
        expect(card?.action, `${tool.id}: action label`).toBe(
          toolActionLabel(tool),
        );
        expect(card?.href, `${tool.id}: registry destination`).toBe(tool.href);
        if (tool.status === "planned") {
          expect(card?.statusWord, `${tool.id}: status word`).toBe(
            toolStatusLabel(tool),
          );
        }
      }
    }

    // Tier-3 entries stay in the catalogue but are never carded as peers.
    for (const tool of TOOLS.filter((entry) => entry.status === "disabled")) {
      await expect(
        page.getByRole("heading", { level: 3, name: tool.name, exact: true }),
      ).toHaveCount(0);
    }

    await expectNoFakeOpen(page);
    await ctx.close();
  });
});

test.describe("tool registry: authenticated dashboard hub", () => {
  test("hub families and cards read from the registry", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const hub = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          level: 2,
          name: "Create with UniPilot",
        }),
      })
      .first();

    for (const group of TOOL_GROUPS) {
      await expect(
        hub.getByRole("heading", { level: 3, name: group.label, exact: true }),
      ).toBeVisible();
    }

    const cards = await hub.evaluate((section) =>
      [...section.querySelectorAll("li")]
        .map((li) => {
          const heading = li.querySelector("h4");
          const action = li.querySelector("a");
          if (!heading || !action) return null;
          const statusWord =
            [...li.querySelectorAll("span")]
              .map((span) => span.textContent.trim())
              .find((text) => text === "Planned" || text === "Research") ?? null;
          return {
            name: heading.textContent.trim(),
            action: action.textContent.trim(),
            statusWord,
          };
        })
        .filter(Boolean) as {
        name: string;
        action: string;
        statusWord: string | null;
      }[],
    );

    expect(cards.length, "no hub cards found").toBeGreaterThan(0);

    for (const card of cards) {
      const { tool, action } = cardFrom(
        card.name,
        card.action,
        card.statusWord,
      );
      expect(action, `${tool.id}: action label`).toBe(toolActionLabel(tool));
      if (tool.status === "planned") {
        expect(card.statusWord, `${tool.id}: status word`).toBe(
          toolStatusLabel(tool),
        );
      }
      expect(tool.tier, `${tool.id}: tier 3 must not be carded`).not.toBe(3);
    }

    await expectNoFakeOpen(page);
  });
});
