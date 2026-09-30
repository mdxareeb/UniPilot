/**
 * The design-token mirror's regression test: these values are copied from
 * `frontend/app/globals.css` / DESIGN.md and nothing may silently drift.
 */
import {
  elevation,
  fontFamily,
  palettes,
  radii,
  spacing,
  typeScale,
} from "@/theme/tokens";
import { DURATION, EASE_DRAWER, EASE_IN_OUT, EASE_OUT, STAGGER } from "@/motion/presets";

describe("design tokens (native mirror)", () => {
  it("keeps the monochrome palette exactly as the web defines it", () => {
    expect(palettes.light.background).toBe("#f4f4f5");
    expect(palettes.light.foreground).toBe("#1a1c1c");
    expect(palettes.light.border).toBe("#e5e5e5");
    expect(palettes.light.primary).toBe("#000000");
    expect(palettes.dark.background).toBe("#131316");
    expect(palettes.dark.foreground).toBe("#f0f1f1");
    expect(palettes.dark.border).toBe("#2e2e33");
    expect(palettes.dark.primary).toBe("#ffffff");
    expect(palettes.light.destructive).toBe("#ba1a1a");
    expect(palettes.dark.destructive).toBe("#e5484d");
  });

  it("keeps the glass fills at the documented alphas", () => {
    expect(palettes.light.glass).toBe("rgba(243, 243, 244, 0.6)");
    expect(palettes.dark.glass).toBe("rgba(27, 27, 31, 0.7)");
    expect(palettes.dark.glassSubtle).toBe("rgba(27, 27, 31, 0.4)");
  });

  it("keeps both palettes key-identical", () => {
    expect(Object.keys(palettes.light).sort()).toEqual(
      Object.keys(palettes.dark).sort(),
    );
  });

  it("keeps the five-step radius scale at the mobile step", () => {
    expect(radii).toEqual({
      frame: 24,
      card: 16,
      nested: 12,
      control: 8,
      pill: 9999,
    });
  });

  it("keeps the four elevation recipes verbatim", () => {
    expect(elevation.raised).toEqual({ boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)" });
    expect(elevation.floating).toEqual({
      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)",
    });
    expect(elevation.overlay).toEqual({
      boxShadow: "0 12px 40px rgba(0, 0, 0, 0.12)",
    });
    expect(elevation.flush).toEqual({});
  });

  it("keeps the 4px spacing unit", () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.lg).toBe(16);
    expect(spacing.colossal).toBe(64);
  });

  it("keeps the closed font set to three families", () => {
    for (const name of Object.values(fontFamily)) {
      expect(
        name.startsWith("BricolageGrotesque_") ||
          name.startsWith("Geist_") ||
          name.startsWith("GeistMono_"),
      ).toBe(true);
    }
    expect(typeScale.headlineLgMobile.fontSize).toBe(32);
    expect(typeScale.bodyMd.fontSize).toBe(16);
    expect(typeScale.caps.letterSpacing).toBe(1.2);
  });

  it("keeps the motion vocabulary byte-identical", () => {
    expect(EASE_OUT).toEqual([0.23, 1, 0.32, 1]);
    expect(EASE_IN_OUT).toEqual([0.77, 0, 0.175, 1]);
    expect(EASE_DRAWER).toEqual([0.32, 0.72, 0, 1]);
    expect(DURATION.press).toBe(140);
    expect(DURATION.panel).toBe(220);
    expect(DURATION.entrance).toBe(400);
    expect(DURATION.bar).toBe(720);
    expect(STAGGER).toEqual({ sm: 40, md: 60, lg: 80 });
  });
});
