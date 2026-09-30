# Native theme

`tokens.ts` is the **native mirror** of the web design tokens; it is not a
second source of truth. The authoritative files remain:

- `frontend/app/globals.css` — colour, radius, elevation, motion tokens
- `DESIGN.md` — the ratified rules (closed font set, radius/elevation scales,
  fill rationing, backdrop stack)

Mapping rule: a value may be copied; a value may not be invented. When the web
tokens change, the port is a deliberate edit here plus the plan.md token table
in `mobile-app/plan.md` §E.

Port notes:

- Tracking is converted from em to points (`em × fontSize`), e.g. display
  −0.04em at 72px → −2.88pt.
- Radii use the mobile step: Frame 24, Card 16 (DESIGN.md's ≤375px step).
- `elevation` uses RN's New-Architecture `boxShadow` strings with the web's
  exact recipes.
- Fonts are the three authorized families only, loaded by weight-specific
  static instances (`fonts.ts`); the web's closed-set rules (Bricolage for
  headings **and action labels**, Geist for body, Geist Mono for metadata)
  are enforced by the type variants in `tokens.ts`, not by convention.
- Glass surfaces are `expo-blur` + the `glass` fill; without blur support the
  translucent fill alone remains legible — the web's honest-degradation rule.
