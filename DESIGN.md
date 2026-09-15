---
name: Monolith Precision
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#4c4546'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e3e2e2'
  on-secondary-container: '#646464'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1c1c'
  on-tertiary-container: '#838484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#e3e2e2'
  secondary-fixed-dim: '#c7c6c6'
  on-secondary-fixed: '#1b1c1c'
  on-secondary-fixed-variant: '#464747'
  tertiary-fixed: '#e3e2e2'
  tertiary-fixed-dim: '#c7c6c6'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#464747'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
typography:
  display:
    fontFamily: Geist
    fontSize: 72px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  label-caps:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: 0.1em
  label-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0em
rounded:
  frame: 2rem
  card: 1.25rem
  nested: 0.75rem
  control: 0.5rem
  pill: 9999px
spacing:
  unit: 4px
  container-max: 1200px
  gutter: 24px
  margin-mobile: 20px
  section-padding: 120px
  grid-size: 32px
---

## Brand & Style

The design system is rooted in **Modern Minimalism** with a strong **Editorial** influence. It targets a sophisticated technical audience that values clarity, speed, and structural integrity over decorative fluff. The aesthetic is "White Canvas"—using a stark, high-contrast palette and expansive whitespace to frame content as the primary focus.

The personality is confident, precise, and utilitarian. By stripping away color, the system relies on heavy-weight typography and geometric precision to establish hierarchy. A soft ambient field with a repeating geometric motif provides a technical "blueprint" feel, suggesting that the platform is a tool for building and creation. The overall emotional response should be one of calm, focused productivity.

## Colors

This is a strictly monochrome palette. 
- **Primary Black (#000000):** Used for primary actions, headlines, and high-impact text.
- **Pure White (#FFFFFF):** The base canvas and surface for all containers.
- **Grayscales:** Used for secondary text, metadata, and background elements. 
- **Borders (#E5E5E5):** A consistent, light neutral used for structural definition without adding visual weight.

Avoid the use of any brand colors or gradients. Functional states (success, error) should be handled through iconography or weight changes rather than hue shifts where possible, or kept to the most desaturated versions of functional colors if absolutely necessary for accessibility.

**Narrow amendment to the gradient ban (Task 3.13):** one exception exists and it is exactly one — a single neutral, monochrome, low-contrast ambient field used exclusively as the fixed page backdrop beneath the motif layer (see "The Backdrop System" below). This permission is scoped to that layer and that layer only. Chromatic gradients, decorative gradients, gradient fills on cards, gradient text, gradient borders and gradient buttons all remain banned. A gradient on any element other than the fixed backdrop stack is a defect. This amendment may not be read as general permission for gradients anywhere else in the interface.

## Typography

The system utilizes **Geist** to achieve a "developer-chic" editorial look. Typography is the primary driver of visual interest. 

Headlines use tight letter-spacing and heavy weights to create "blocks" of text that command attention. Display type should be used sparingly for hero sections to maximize the "White Canvas" effect. Body text is kept clean with generous line height to ensure readability against the dotted grid background. All labels and secondary information should maintain high contrast even when using smaller font sizes.

### The closed font set (ratified — not open to revision)

Exactly **three** families are permitted, each in one role:

- **Geist** — body UI: paragraphs, dense text, form text, form fields, navigation links.
- **Geist Mono** — metadata and technical labels: eyebrows, timestamps, file names, code.
- **Bricolage Grotesque** — the heading family: major headings (h1 and section-major h2/h3, per TASK.md §0.3) **and action labels** — buttons, button links and the button-styled controls (the shared `Button`/`ButtonLink` primitives, status filters and segmented controls, prompt and quick-action chips).

**Task 3.14 amendment — action labels join the heading family.** Bricolage now sets every action label as well as the major headings. The rationale is the one that gives the system its editorial voice: typography leads the hierarchy, and the few words the interface asks a reader to press should speak in the same voice as the headings that frame them, not in the body voice used for prose and fields. The amendment adds no family and changes no weight or size — `label-sm` stays 500 and `label-caps` stays 600; only the family moves. The boundary is enforced by the committed guard `frontend/tests/qa/fonts.spec.ts`, which asserts every text-bearing button renders Bricolage unless its text is explicitly content (`data-fontprobe-role="content"`): form fields (Input/Select/textarea), navigation links, menu items that read as navigation, metadata/eyebrow labels, and content-like interactive text (a task title, a calendar event block, the profile identity chip) stay on Geist or Geist Mono. Bricolage remains the authorized heading family and the three-family set above remains closed.

Required coverage: Geist and Geist Mono as variable faces with `latin` and `latin-ext` ranges (the rendered copy includes `— · ’ “ ”` and similar, which live in those ranges); Bricolage Grotesque as the variable font at weights 200–800 with its optical-size axis auto-resolved.

Prohibited entry vectors for a fourth family — no additional `next/font` loader beyond the two in `frontend/app/layout.tsx`, no font-CDN `<link>`, no `@import` of a remote font, no fourth Tailwind/`@theme`/`@utility` font key (including `font-bitcount`), no literal `font-family` naming a family in a component or wrapper class outside the single `@font-face` mechanism, no inline `fontFamily` style, and no use of Tailwind's built-in `font-serif`. The system fallback stack is permitted only as the tail of a declared stack that begins with an authorized family; a fallback that actually renders is a defect, not a degradation.

This closed set is enforced by the committed regression spec `frontend/tests/qa/fonts.spec.ts` (Task 3.12, extended by Task 3.14 with the button/action-label role), which fails if any surface renders a family outside the three above or an action button that does not render Bricolage.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop, centered on a 1200px max-width container to maintain the editorial feel. 

- **Dotted Grid:** A background pattern of 1px dots spaced every 32px (grid-size). UI elements should ideally snap to this grid to maintain mathematical harmony.
- **Whitespace:** Use extreme vertical padding (120px+) between major sections to emphasize the minimalist nature of the design system.
- **Fluidity:** On mobile, margins reduce to 20px, and section padding scales down to 64px. Content should reflow into a single column, maintaining the center-aligned "hero" typography style.

## Elevation & Depth

Depth is achieved through **Tonal Layers** and **Subtle Shadows**, avoiding heavy blurs or complex gradients.

- **The Canvas:** The base layer is pure white with the dotted grid.
- **Floating Navigation:** The primary navigation uses a pill-shape with a very subtle, diffused shadow (0px 4px 20px rgba(0,0,0,0.05)) to separate it from the content it floats over.
- **Cards:** Cards use #E5E5E5 borders rather than shadows for a "flat-depth" look.
- **Interactive States:** Lifted states are shown via a slight darken of the border color or a scale-up (1.02x) rather than traditional shadow increases.

## Shapes

The design system uses a **Rounded** (0.5rem / 8px) base language, with specific exceptions for high-visibility components.

- **Standard Elements:** Input fields, small cards, and utility buttons use the base 8px radius.
- **Large Cards:** Marketing cards and content containers use a `rounded-xl` (24px) radius to feel more approachable.
- **Pills:** All primary CTA buttons and the floating navigation bar must be fully pill-shaped (rounded-full) to provide a soft contrast to the rigid grid background.

## Components

- **Buttons:** 
  - *Primary:* Black fill, white text, pill-shaped. No borders. 
  - *Secondary:* White fill, black text, #E5E5E5 border, pill-shaped.
- **Input Fields:** White background, 1px #E5E5E5 border, 8px radius. On focus, the border turns black.
- **Cards:** White background, 1px #E5E5E5 border, 24px radius. Content inside should have 32px or 40px of internal padding.
- **Navigation:** A floating pill-shaped bar. It contains the logo, text links in `label-sm` style, and a primary CTA. 
- **Icons:** Use ultra-thin (1px or 1.5px stroke) line icons. Icons should always be monochrome (Black or Gray-500).
- **Chips:** Small, #F5F5F5 background with `label-sm` text, 4px radius. Used for tags and categories.
- **Dotted Background:** The background is not a solid color but a repeating pattern of `#D4D4D4` dots on `#FFFFFF`.

---

# Task 3.13 — Visual Foundation Amendment

Everything below amends and supersedes the corresponding rules above where they conflict. Where a rule above is not named here, it stands unchanged. The three-font set (closed), the monochrome constraint, the Motion system (MOTION.md) and the accessibility posture are untouched by this amendment.

## What this section supersedes

- §Shapes "Large Cards … `rounded-xl` (24px)" → the five-step radius scale below.
- §Shapes "Standard Elements … 8px radius" → the Control step below.
- §Elevation & Depth (all four bullets) → the four-level elevation scale below.
- §Components "Cards: … 24px radius" → the Card step below.
- §Layout "Dotted Grid: 1px dots every 32px" as the total backdrop definition → the three-layer backdrop stack below (the dot grid survives as the default motif candidate, pending the founder's motif choice).
- The three `--surface-glass*` alphas as the only surface-fills concept → the three-fill system below (glass survives as one of the three fills, same mechanism).

## The Backdrop System (ambient field + motif)

Every surface in the app and in marketing sits on one composed backdrop: a fixed, non-scrolling stack of exactly three layers, with a single mounting point (the existing `bg-dotted-grid` utility on the three layout roots — the utility is the token; it gains the field layer and its motif becomes swappable).

1. **Base** — a flat neutral at the light end of the gray scale (`#f4f4f5`, the light step the new scale defines). The floor.
2. **Ambient field** — one large, very low-contrast, neutral monochrome luminance variation across the viewport, suggesting soft directional light. Gray only, no discernible edges or bands, and it must not read as a decorative gradient. The whole-viewport luminance range must be felt rather than seen: a radial/linear mix in the range of ±1.5% lightness around the base. This is the sole beneficiary of the narrow gradient amendment above.
3. **Motif** — a low-contrast repeating geometric texture over the field. The incumbent dot grid (`#D4D4D4`, 1px, 32px pitch) is the default candidate; a fine grid/crosshatch and a third sparse mark are alternatives, presentable via one token. Motif colour, scale and spacing are tokens, never magic numbers.

Rules: the stack stays fixed (no repaint on scroll); the motif must be swappable by changing one token or one component prop; and the stack must degrade honestly — without `backdrop-filter` support, surfaces remain legible on the flat base.

**CTA band (theme-stable charcoal).** The closing CTA bands are one opaque charcoal surface in both themes — `--surface-cta` (#1d1d21) with `--surface-cta-foreground` for text and the button pill — and deliberately do **not** track `--primary` (which is black in light and white in dark), so the band no longer inverts with the theme. The band hides the fixed canvas beneath it, so its motif cannot come from `bg-dotted-grid::after`; the grid utility is never re-mounted on it — that would stack a second fixed field and motif over the first. Instead the band paints the motif as its own background through the `bg-dotted-cta` utility: the same recipes, `--motif-scale` and `--motif-spacing`, with `--motif-color-cta` for the mark colour. That mark is one low-alpha light value in both themes (the fill does not change, so the mark cannot) and stays strictly neutral, so the band still reads as one flat surface rather than as decoration. The motif is background only: static, non-interactive, and it adds no DOM, no fixed canvas and no z-index.

## The Radius Scale (radius encodes hierarchy)

Five named steps, one per surface level. A nested surface never carries a radius equal to or larger than its parent's, and adjacent steps differ enough to read as intentional.

| Step | Value | Applies to |
| --- | --- | --- |
| Frame | 32px (2rem) | The outermost container or panel holding a whole region: a shell panel, a major frame |
| Card | 20px (1.25rem) | A standard content card on the backdrop (the default card radius) |
| Nested | 12px (0.75rem) | A surface inside a card: inset panels, metric strips, list wells |
| Control | 8px (0.5rem) | Buttons' inner geometry, inputs, small interactive elements |
| Pill | fully rounded | CTAs, chips, badges, the primary active nav state |

At 320–375px the Frame and Card steps reduce (Frame 24px, Card 16px) as a responsive token step, not a per-component override. Any radius outside the scale is a defect; map it to the nearest step that respects the nesting rule.

## The Elevation Scale

Four named levels, one shadow recipe each. Shadows are neutral and low-opacity; a heavy or tinted shadow is a defect. One elevation level per surface — never two shadow utilities on one element. Elevation correlates with radius: Floating surfaces take the Frame radius, Raised surfaces take the Card radius.

| Level | Shadow | Applies to |
| --- | --- | --- |
| Flush | none | Dividers, inline content, nested wells inside a parent |
| Raised | `0 4px 16px rgba(0,0,0,0.06)` | A card resting on the backdrop |
| Floating | `0 8px 32px rgba(0,0,0,0.08)` | A panel that reads as detached: the sidebar, a major frame |
| Overlay | `0 12px 40px rgba(0,0,0,0.12)` | Popovers, menus, dialogs — the only level permitted a noticeably stronger shadow |

Hover and press states may step elevation by one level, only on genuinely interactive surfaces. A static card does not lift on hover.

## The Surface Fill System (three fills)

A surface uses exactly one fill. Monochrome hierarchy comes from fill, not from color, borders, or labels. There is no "glass card with a solid header" — if a design needs that, it is two surfaces at two levels.

| Fill | Recipe | Default elevation | Text |
| --- | --- | --- | --- |
| Glass | `--surface-glass` (Muted @ 60%) + `backdrop-blur-md` (12px) + 1px `--border` | Floating | Shell-level and navigation surfaces where the backdrop should stay sensed: the rail, the mobile bar, popovers, the navbar |
| Solid | opaque `--card` (#ffffff) + 1px `--border` | Raised | Standard content cards — the default card fill where legibility and calm matter |
| Inverted | opaque near-black `--inverse-surface` (#1a1c1c) + 1px border at the inverted-border token | Raised | The emphasis device — see the rationing rule below |

Glass is for shell-level surfaces and, per the amendment below, for content cards and dialogs too; Solid remains the default for controls, not for content. Nested surfaces never use shadow for separation (see below); nested inside Inverted they step lighter; nested inside Glass they take a subtle fill step.

**Amendment — content cards and modals use the GlobalSearch recipe (controls stay solid).** A content card or dialog copies the search popover's surface exactly: `--surface-glass` + `backdrop-blur-md` (12px) + 1px `--border` + the surface's existing shadow token, so the page faintly shows through a blur while text stays crisp. Base cards use `bg-glass`; a card nested inside a glass panel takes `bg-glass-subtle` (the parent is already frosted); a dialog uses the same `bg-glass` fill as the popover, with the scrim keeping the page behind it subdued enough to read against. Controls keep their solid styling everywhere: inputs, buttons, selects, checkboxes, list rows, chips and badges stay on `--card`, exactly as they do inside the popover. The shared glass tokens (`--surface-glass`, `-strong`, `-subtle`), `--blur-glass` and the reference popover itself are unchanged.

**The scrim (modal/popup backdrop).** Overlays dim the page with `--scrim`: one dark translucent veil in both themes — `rgba(0, 0, 0, 0.4)` light, `rgba(0, 0, 0, 0.55)` dark — plus `backdrop-blur-md`, so the page behind reads blurred and subtly darkened rather than washed grey. It is deliberately not derived from `--foreground`: in dark mode that token is near-white and a foreground scrim would lighten the page instead of dimming it. Components read the token only through `bg-scrim` (mapped in `@theme inline`); the scrim fades with its panel (`scrimVariants`) and keeps click-to-close.

**The surface motif.** Dialog panels paint the page's dot motif locally so the texture still reads on them once `backdrop-blur-md` has blurred the fixed canvas into a wash: the `bg-dotted-surface` utility reuses `bg-dotted-grid`'s recipes and geometry exactly (`--motif-scale`, `--motif-spacing`, and the same `data-motif` dots|grid|diagonal switch) with `--motif-color-surface` as the mark colour — tuned per theme for the glass fill (`#d4d4d4` light, `#414147` dark) so it stays as subtle and low-contrast as the page dots. It is background-only: static, non-interactive, never over text, no layout effect. It applies to **dialog panels only** — the shared `Modal` primitive's panel — and never to page cards, the rail, board columns, task cards, calendar blocks or any other content surface, which stay plain glass. Nested wells (list rows, icon tiles) let the parent's motif read through their translucent fill instead of painting a second copy, so one pitch stays on screen; if interference ever appears, tune the colour token — never the geometry.

## The Inverted Card (rationed)

Inverted fill marks the single most important surface in a view, or a deliberate closing group. **At most one dominant inverted surface per view**, plus at most one inverted group elsewhere. A third is a hierarchy collapse and the emphasis means nothing. Inverted is never decorative, never alternating, never used to make a grid look varied.

Text on Inverted meets contrast requirements at every size (see Accessibility below). Nested surfaces inside Inverted step **lighter** (fill step + one radius step down + padding — in that order). Focus rings, borders and dividers all carry an inverted-context variant: a ring tuned for a white card is invisible on near-black and that is an accessibility failure. Inverted is a fill variant on the shared `Card` primitive — never a forked component.

## Nested Surfaces (depth by fill, not by shadow)

A surface nested inside another surface gains separation by a fill step, a radius step down (per the scale), and padding — in that order. It does not gain a shadow. Shadows are for surfaces that float above the backdrop, not for surfaces inside a parent. Two levels of nesting maximum; a third is an information-architecture defect and should be reported, not supported.

## The Bento Grid (composition rule)

The `BentoGrid` primitive: a column count per breakpoint, a base row height, and span tokens so a child declares its width and height in grid units. Composition rule: a view should have **one dominant cell, a small number of medium cells, and several small cells** — the largest card is the most important one. A view where every cell is the same size is a defect; it is the single most recognisable generic-dashboard tell.

## The Two-Level Active State

Navigation renders four states, simultaneously informative:

- **Primary active** — the current top-level section: a fully-rounded pill with Inverted fill, light text and light icon.
- **Secondary active** — the current item within that section: a raised pill with Solid fill and a soft shadow, dark text.
- **Inactive** — no fill, no border, muted text and icon.
- **Hover** — a barely-there fill step. Not a border, not a shadow, not a color.

Nested items: one level of indentation, a thin connector line with a branch marker per child, and the same four states one level down. Inverted-context variants exist for every state (a hover fill tuned for a light rail is invisible on an inverted panel). These apply to the shared navigation primitive only; no surface is required to build a nested tree it does not have.

## The Display Type Treatment (no new font)

The marketing hero impact comes from treatment, never a fourth family:

- **Weight** — Bricolage Grotesque at its heaviest loaded weight (800; confirm the loader serves it — a missing weight is a loader finding, not a token change).
- **Tracking** — negative, tightening as size increases: −0.03em at display; −0.045em at display-xl.
- **Line height** — near or below 1.0 at the largest sizes, so multi-line headlines read as a single mass.
- **Offset shadow** — a hard, unblurred, solid offset in the near-black, specified in an em-scaled unit so it holds across breakpoints. On an inverted background the shadow inverts to the near-white. **Permitted on marketing hero headings only.** Banned on application surfaces, subordinate headings, and any text below the display steps.
- **Case** — sentence case as already specified. Headlines are never set in all caps to imitate the reference.

## The Two Type Scales (scale contrast)

Marketing surfaces: body text is small, light, generously leaded, with a **minimum 8:1 display-to-body size ratio** (e.g. 72px display against 18px body — the current ratio, kept) and a **constrained measure under 80 characters per line**. Application surfaces: a flatter, denser, uniform scale for scanning — the app scale does not adopt the marketing ratio. Measured CPL at 1280 exceeds 80 on `/features` copy blocks (up to ~130) — the measure constraint applies to future surface work and the specimen; the copy itself is not changed by the foundation task.

## The Icon Rule

One family (Lucide), one stroke width (the family's default 2px at 24px viewBox — never overridden), a small named size scale (currently size-3.5 / size-4 / size-6 plus aria-consistent outliers), and an icon's color is inherited from its text context rather than set locally (decorative icons may carry `text-muted-foreground` to sit below their label). No inline SVGs with baked-in stroke values; no second family.

**Narrow amendment to the icon rule (Google sign-in mark).** One exception exists and it is exactly one: the official multi-colour Google "G" mark inlined on the Google sign-in control (`frontend/app/(auth)/_components/AuthOptions.tsx`). Google's branding guidelines require the official multi-colour mark on the sign-in control; it is a brand authentication asset, not UI iconography. No external asset, CDN or dependency is used; the SVG carries `aria-hidden` so the visible "Continue with Google" label keeps the control's accessible name; it is sized to the button's icon slot (size-4) and vertically centred by the button's existing flex layout in both themes. This permission is scoped to that one control: no other inline-fill SVG, no second icon family, and no other surface may copy it.

**Narrow amendment to the icon rule (integration brand marks).** A second exception exists for the official WhatsApp and Gmail marks on `/integrations` (`frontend/app/(app)/integrations/_components/BrandMarks.tsx`). WhatsApp's and Gmail's branding guidelines require their official marks on an integrations surface; like the Google mark they are brand authentication assets, not UI iconography. The constraints are the same and equally narrow: inline SVG only (no external asset, CDN or dependency); official geometry and colours unmodified (no recolouring, re-stroking or added gradient); `aria-hidden` so the adjacent heading keeps the card's accessible name; sized on one axis so the mark's aspect ratio cannot distort in either theme; and scoped to that one page — no other inline-fill SVG, no second icon family, and no other surface may copy the file.

## The Metric Pattern

A primitive: a very large numeral with a small quiet label beneath it, grouped in a row and separated from what follows by a thin rule. Numeral step: the largest app-scale step (headline-md 24px default). Label step: label-sm. Vertical relationship: 4px gap. Grouping: a row with internal dividers, the row separated from what follows by a Divider. **Numeral font role is an open founder decision** (body face for warmth vs mono face for tabular stability) — the primitive ships with the body face as default and the decision is presented at the gate.

## The Ghost Surface

A variant of `Card`: no fill, a dashed border at the token border color, the same radius as the sibling surfaces it sits among, centered icon-plus-label content, and hover/focus states (a barely-there fill step on hover; the standard focus ring on focus). It is the "add a new item" affordance — a slot waiting to be filled, sized identically to the real cards beside it. It is distinct from `EmptyState` (a centred message where nothing exists at all); both remain, and no existing `EmptyState` is converted.

## What the references do not authorize

No illustrations. No thematic imagery (composition, not content). No fourth font. No color. No all-caps headline treatment. No layout changes to existing views — the BentoGrid primitive is defined and exercised on the specimen, and adopted on no real surface until per-surface tasks run after founder review.