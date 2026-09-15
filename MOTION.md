# Motion

Motion.dev (`motion`) is UniPilot's primary animation library. Everything that
needs JavaScript — scroll reveals, benchmark bars, popups, the mobile drawer,
the modal, route transitions, onboarding steps — is built on it, in
`frontend/components/motion/`, from one shared vocabulary.

What stays CSS-only: behaviours that need no JS at all — `press-feedback`,
`hover-lift`, `action-arrow`, `icon-turn`, `[data-enter]` (a keyframe that runs
before hydration, so nothing above the fold ever depends on a script), and
`[data-collapsible]` (an interruptible `grid-template-rows` height animation).

## The rule

> Motion.dev is UniPilot's primary animation library.
>
> Before creating a new animation:
> 1. Inspect existing shared Motion primitives.
> 2. Reuse existing variants/transitions.
> 3. Choose animation based on the UI's purpose.
> 4. Avoid fade-only animation when a more meaningful Motion interaction is appropriate.
> 5. Preserve reduced-motion behavior.
> 6. Ensure animation never controls content existence.
> 7. Verify the result in Chromium.
> 8. Do not create page-specific animation systems unless there is a
>    demonstrated technical reason.

Every future popup, page, card, editor, tool, modal, list, tab, dropdown,
panel, section reveal and selection state follows this rule and reuses the
global Motion system — `frontend/components/motion/`, vocabulary in
`frontend/components/motion/presets.ts`.

## Tokens

Two tables, kept in sync by hand: CSS cannot read TypeScript and Motion cannot
read CSS variables as durations, so retiming a behaviour means editing both.

- `:root` in `frontend/app/globals.css` — authoritative for the CSS-driven behaviours.
- `frontend/components/motion/presets.ts` — authoritative for everything Motion-driven.
  Its `EASE_*`, `DURATION` and `STAGGER` values mirror the CSS tokens.

### Easing

| Token | Value | Use |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything entering, exiting or responding to input. The default. |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Something moving or morphing on screen (currently unused; kept as the correct curve if that need appears). |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Large sliding surfaces. Reserved for a future drawer/sheet. |

`ease-in` is never used for UI. It delays the first movement — the exact moment
the user is watching — so the same duration *feels* slower.

`@theme inline` also maps `--default-transition-timing-function` and
`--default-transition-duration` to these tokens, so a bare `transition-colors`
utility already carries the project curve without naming one.

### Duration

| Token | Value | Applies to |
| --- | --- | --- |
| `--duration-press` | 140ms | Button/IconButton press |
| `--duration-hover` | 160ms | Hover and focus feedback, card lift |
| `--duration-popover` | 180ms | Chevrons, small popovers, staggered menu links |
| `--duration-panel` | 220ms | Disclosure, popups and route enter **opening** |
| `--duration-panel-exit` | 150ms | The same surfaces **closing** |
| `--duration-entrance` | 400ms | Above-the-fold page entrance |
| `--duration-reveal` | 380ms | Scroll reveal **in** |
| `--duration-reveal-exit` | 260ms | Scroll reveal **out** (repeat variant only) |
| `--duration-morph` | 380ms | A fixed element morphing between two placements of itself as a state change: the assistant launcher's bar→bubble. The navbar's bar↔pill is scroll-linked instead (see "The navbar morph" below) and uses no duration. |
| `--duration-morph-content-out` | 90ms | The assistant launcher's outgoing content during the bar↔bubble morph |
| `--duration-morph-content-in` | 140ms | The launcher's incoming content, arriving after the out leg (see `morphContentIn`) |
| `--duration-bar` | 720ms | Benchmark bar fill |

Interactive UI stays under 300ms. Entrances and reveals are page-level and can
afford to be slower. Exits are deliberately faster than entrances: opening is
the part worth watching.

### Stagger

| Token | Value | Use |
| --- | --- | --- |
| `--stagger-sm` | 40ms | Scroll reveals, menu links |
| `--stagger-md` | 60ms | Hero and page entrances |
| `--stagger-lg` | 80ms | Available for wider, slower groups |

For CSS behaviours, position in a group comes from `--motion-index`, set inline
by `motionIndex(i)` in `frontend/components/motion/stagger.ts`. For Motion behaviours,
pass `index={i}` to the primitive (`MotionReveal`, `MotionBar`) or let variant
propagation supply the delay (`MotionMenuItem`). Index `0` has no delay.

## The shared Motion layer

All in `frontend/components/motion/`. `MotionProvider` (mounted once in the root
layout) wraps the app in `MotionConfig reducedMotion="user"`.

### `presets.ts` — the vocabulary

Every duration, curve, stagger step and variant definition used by
`motion/react` components, defined once. New shared motion belongs here, not in
a page. Deliberately small: a developer should be able to read the whole file
before writing a new animation, which is the only thing that keeps it reused.

| Group | Exports | Behaviour |
| --- | --- | --- |
| Tokens | `EASE_OUT`, `EASE_DRAWER`, `DURATION`, `STAGGER` | The TypeScript mirror of the CSS tokens above. |
| Reveal | `revealIn`, `REVEAL_HIDDEN`, `revealVariants`, `revealVariantFrom(variant)`, `revealRepeatVariants(index, reduced, variant)` | One element entering on scroll, from one of five directions. |
| Reveal group | `revealGroupVariants(reduced)`, `revealGroupItemVariants(variant, reduced)` | A section entering as a composition: one observer, staggered children. |
| Page entry | `pageEnterVariants` | Opacity + 6px rise for a whole route arriving. |
| Popover | `popoverVariants(direction, reduced)`, `POPOVER_ORIGIN` | Origin-aware fade + 8px translate + `scale(0.97)`. |
| Menu | `menuVariants(reduced)`, `menuItemVariants(reduced)`, `scrimVariants(reduced)` | The drawer: parent drop, children staggered by propagation, scrim fade. |
| Bar | `barVariants` | `clip-path` fill from the left. |
| Step | `stepVariants(direction)` | Directional slide for a step replacing a step. |
| Selection | `softSpring` | The shared-layout spring, reserved for `layoutId` movement (selection rings, indicators). |
| Morph | `morphTransition`, `morphContentOut`, `morphContentIn`, `SCROLL_MORPH_BAND`, `scrollMorphProgress`, `scrollMorphSpring` | Two mechanisms: the assistant launcher's triggered bar→bubble (real width/height/x/radius, plus a content crossfade), and the navbar's scroll-linked bar↔pill (progress across the band, spring-smoothed). |
| Notice | `noticeIn`, `noticeVariants` | Inline feedback arriving: fade + 4px drop, no delay. |
| Rail | `railFillVariants`, `railFillIn`, `railMarkerVariants` | Progress: `scaleX` fill plus a marker that scales as it becomes current. |
| List | `listItemVariants(reduced)`, `listItemIn` | A row joining or leaving a list that changes length. |
| Status dissolve | `dissolveVariants(reduced)` | A label changing value in place (documents `Parsing…` → `Searchable`, 18.13): blur + opacity at `scale(0.98)`, keyed inside `AnimatePresence`. The text is content regardless of the animation; reduced motion runs both legs at zero. |

The five reveal directions are `up` (16px rise), `down` (16px drop), `left`
(24px from the left), `right` (24px from the right) and `scale` (8px rise +
`scale(0.96)`). Direction carries meaning: `left`/`right` for content that
belongs to one side of a row, `scale` for a surface arriving with depth, `down`
for something descending from the element above it, `up` as the default. Picking
one is the smallest available way to stop a page from reading as a single
repeated fade.

### The navbar morph — scroll-linked, not triggered

The navbar's bar↔pill is continuous. `useScroll`'s `scrollY` maps to 0→1
across `SCROLL_MORPH_BAND` (0–64px) through `scrollMorphProgress`, a spring
(`scrollMorphSpring`) smooths that progress, and the header's `y`, the
wrapper's `width` and the nav's `borderRadius` are all `useTransform` outputs
of the one value. There is no threshold, no class swap and no FLIP: the width
interpolates in pixels between the measured viewport width and
`min(viewport − 32, 820)`, so the bar shrinks in direct proportion to scroll
and its content reflows in place.

Two properties of the mechanism are deliberate:

- **Real `width`, not `scaleX`.** The shell is one small fixed element, so one
  re-layout per frame is cheap and Motion batches it into rAF; a real width
  never smears the border, the type or the `backdrop-blur` surface the way a
  FLIP scale does. The navbar and the assistant launcher are the only
  Motion-driven shells allowed to animate real box geometry — the launcher's
  width/height/`x`/radius and the navbar's width and radius — alongside the
  CSS-driven `[data-collapsible]` height.
- **`scrollMorphSpring` sets `skipInitialAnimation: true`.** A refresh or
  back-navigation landing mid-page adopts the first real scroll position
  outright, so the page starts in the settled pill state instead of morphing
  in from the top. A resize recomputes the pixel endpoints from a motion
  value, never through React state, and the observer keeps a single discrete
  boolean (`progress > 0.5`) purely to switch its `rootMargin` — no
  per-frame re-render.

Under `prefers-reduced-motion: reduce` the spring is bypassed and the raw
scroll-linked progress is used: the morph snaps to the scroll position
instead of easing. The transforms are state, not decoration, so they are
still applied.

### The assistant launcher morph — triggered, real geometry

The launcher's bar↔bubble is a state change rather than a scroll position, so
it uses `morphTransition` (380ms ease-out) instead of the scroll band. It
animates the navbar's way: real numeric `width`, `height`, `x` and
`borderRadius` on its one fixed surface, with the pixel targets recomputed by
a viewport-width state on resize — never per frame. A Motion `layout` FLIP was
removed deliberately: scaling two differently-shaped children smeared the
border, the type and the `backdrop-blur`, and laid the bar's label out at the
bubble's size.

Inside the surface, the bar and bubble are two content layers whose opacity is
the only thing animated — `morphContentOut` (90ms) then `morphContentIn`
(140ms, delayed by the out leg), so no text is visible while the shell is
narrow — and the non-current layer is `inert`, leaving the tab order, the
accessibility tree and hit testing while it fades. `overflow-hidden` on the
surface clips the label as the real width shrinks; nothing is scaled.

One sparkle element is shared by both states. It is never unmounted, so it
cannot blink mid-morph: it glides between the bar's trailing edge and the
bubble's centre by animating its own real `x`/`y`/size on `softSpring` — the
shared-movement spring this file reserves for exactly that thread — while its
ink colour swaps on the content-in leg. Under reduced motion every leg is
zeroed: the surface snaps and both layers swap instantly.

### `MotionReveal` — scroll reveal

Fade + 16px rise (the homepage's visual reference), 380ms in with a stagger
delay from `index`, 260ms out without one. Two modes:

- Play-once (default): Motion's own viewport tracking (`whileInView`, `once`).
- `repeat`: reveals coming down, resets once the element has left *completely*
  through the bottom, reveals again next time it is reached. Anything that
  leaves through the top stays revealed. Motion's viewport API has a single
  boundary and no exit direction, so this mode uses a hand-rolled
  two-observer hook (`useRevealRepeat`) with mismatched bounds — reveal at 10%
  of the viewport inside, reset only after full exit. That asymmetry is what
  keeps a two-way reveal from jittering on the boundary.

```tsx
<MotionReveal repeat index={0}>…</MotionReveal>
<MotionReveal as="li" index={1}>…</MotionReveal>
<MotionReveal variant="right" index={1}>…</MotionReveal>
```

`variant` picks one of the five directions; `up` is the default and stays the
homepage's reference. Two halves of an alternating row take `left` and `right`
with the same `index`, so they arrive from opposite sides at the same moment —
the row reads as one thing assembling rather than two elements queueing.

Stagger convention: `index % 2` in two-column grids (a desktop row arrives
together; a mobile card never waits more than 40ms), the absolute index in
three-column grids, and copy-before-visual (`0` then `1`) in alternating
two-column rows regardless of `order-*`.

### `MotionRevealGroup` / `MotionRevealItem` — a section as a composition

One observer per section instead of one per element. The group holds the play
state; each `MotionRevealItem` inherits it through Motion's variant propagation
and starts one stagger step after the item before it, so a heading followed by
three cards plays as heading → card → card → card with nobody naming a delay.
Items may each choose their own `variant` while sharing the one timeline — a
heading rising while the cards under it arrive with depth is the point.

```tsx
<MotionRevealGroup as="ul" className="grid gap-4 md:grid-cols-3">
  <MotionRevealItem as="li" variant="scale">…</MotionRevealItem>
  <MotionRevealItem as="li" variant="scale">…</MotionRevealItem>
</MotionRevealGroup>
```

Use it when the elements are one composition. Keep `MotionReveal` for a single
element, or for the two halves of a row described above.

Propagation is load-bearing and survives plain intermediate DOM and component
boundaries — a `MotionRevealItem` several plain `<div>`s deep still receives the
group's state. Two consequences: the group element itself animates nothing (no
large container is ever transformed, and it carries no opacity of its own, so a
QA sweep filtering on opacity will not see it), and `data-reveal` is only the
`<noscript>` hook — the direction lives in the variant, not in the attribute.

### `MotionListItem` — a list that changes length

For lists that gain and lose members: onboarding subjects today, tasks and
documents later. A new row drops in from 6px above its own position; a removed
row fades out in 150ms. `layout` is what makes a removal read as a removal — the
rows below animate up into the freed space instead of jumping. Place inside
`AnimatePresence` with a stable `key`.

```tsx
<AnimatePresence initial={false}>
  {items.map((item) => (
    <MotionListItem key={item.id}>…</MotionListItem>
  ))}
</AnimatePresence>
```

### `MotionNotice` — inline feedback

Auth errors, validation messages, status lines: fade + 4px drop at 180ms with
**no delay**, because feedback must never make anyone wait for the message. The
`role="alert"` and the text are in the DOM at mount, so the announcement does
not wait for the animation either. Mount-only — a dismissed message unmounts
instantly rather than animating out.

### `MotionSelectionRing` — shared-layout selection

A 2px border rendered inside the selected surface only, travelling between
surfaces on `softSpring` when the selection moves. Every member of one selection
group shares a `layoutId`; separate groups need separate ids. `radiusClass` must
match the surface's own `rounded-*` or the corners drift.

```tsx
<button className="relative rounded-card" aria-pressed={selected}>
  {selected && <MotionSelectionRing layoutId="plan-selection" radiusClass="rounded-card" />}
  …
</button>
```

The workspace rail uses the same idiom at a smaller scale with its own
`layoutId="workspace-nav-active"` — a filled `bg-card` row rather than a border,
so it renders the element itself in `WorkspaceNavList` instead of borrowing this
primitive. The mobile drawer deliberately stays out of that group: it is
unmounted while closed, and a second element claiming the same `layoutId` would
hand the highlight back and forth between the two navigations. `aria-pressed` /
`aria-current` always flips immediately; only the visual travels.

### `MotionBar` — benchmark bars

`clip-path` fills from the left when the track scrolls into view. The bar's
`width` stays the layout value it always was, so the track reserves its final
size and nothing reflows. Fills once, does not loop. The track is observed
rather than the bar: a bar clipped to zero area never reports as intersecting.

### `MotionPopover` — the one popup transition

Every floating surface that appears and disappears — menus, notifications,
search, assistant, dialogs, and any future tool panel — renders its panel
through this component and sets only its `direction` and, when its anchor
calls for it, its `origin`. Do not create a second popup animation.

Fade + 8px directional translate + `scale(0.97)`, opening at 220ms and closing
at 150ms. `AnimatePresence` unmounts the panel once its exit finishes, so a
closed panel is out of the DOM, the tab order and the accessibility tree with
no `visibility` machinery.

Direction and origin match the UI location — a panel grows out of the control
that opened it, never out of its own centre:

| Surface | Direction | Origin |
| --- | --- | --- |
| ProfileMenu | `up` | `bottom` |
| NotificationCenter | `down` | `top right` |
| GlobalSearch | `center` | `center` |
| AssistantLauncher | `up` | `bottom right` (default) |
| Modal dialog | `center` | `center` |

`scale(0.97)`, never `scale(0)`: nothing in the real world appears from
nothing.

Modal keeps its native `<dialog>` two-clock sequencing: a transition cannot
start from `display: none`, so the dialog enters the top layer first and the
open state flips one frame later; on close the order inverts, and
`dialog.close()` waits for the exit duration (skipped under reduced motion).

### `MotionMenu` / `MotionMenuItem` — the mobile drawer

The parent owns the fade + 8px drop; items stagger in at 40ms through variant
propagation and leave together — a staggered exit makes closing feel slower
than opening. `AnimatePresence` unmounts the drawer after its exit.

### `RouteTransition` — workspace page enter

Wraps the page inside `<main>` in `frontend/app/(app)/layout.tsx`. On every pathname
change the inner `motion.div` remounts via `key` and plays the shared
page-enter variant (opacity 0 + 6px rise, 220ms). Enter only — no exit
animation, which would require keeping the old tree mounted and re-introduce
layout jumps. The shell (sidebar, mobile bar, dotted canvas, Assistant) sits
outside it and never receives a transform.

`RouteTransition` is the page *arriving*; the composition *inside* the page is
the entrance ladder below. They are deliberately separate: one belongs to the
route, the other to the content, and a tool page added later gets the first for
free.

### The workspace entrance ladder

Every authenticated page composes itself with `[data-enter]` slots rather than
scroll observers — the workspace is above the fold by definition, and §18's rule
is that page entry beats viewport reveal for content that is already on screen.

`PageHeader` owns **slot 0** of every page it appears on. That is the whole
convention: a page sets `motionIndex(1)` on its first section, `2` on the next,
and never has to remember to animate its own title. It also means a tool page
built on `PageHeader` later inherits a correct ladder by construction.

```tsx
<PageHeader eyebrow="Tasks" title="Tasks" … />           {/* slot 0, implicit */}
<div data-enter="scale" style={motionIndex(1)}>…</div>
<div data-enter="left"  style={motionIndex(2)}>…</div>
```

Slots differ in kind, not just in delay: the dashboard's greeting rises, its
primary workspace card arrives with depth (`data-enter="scale"`), and the
quick-access pair enters from opposite sides (`left` / `right`). Six slots at
60ms settle inside 480ms.

`PageHeader` renders no `data-enter` while `isLoading`. `(app)/loading.tsx`
renders the same component as skeletons, and animating a fallback in means the
reader waits 400ms to be told to wait — then watches the header rise a second
time when the real one replaces it.

### Onboarding steps

`OnboardingShell` remounts its content region per step with
`stepVariants(direction)`: a fade plus a 16px slide from the direction of
travel — forward from the right, back from the left. The frame stays put; only
the contents move. Forms themselves never animate during entry, validation or
submission.

`OnboardingProgress` is the rail: `railFillVariants` grows the completed track
with `scaleX` from `origin-left`, and `railMarkerVariants` scales each step
marker as it becomes current. Both are `initial={false}`, so a direct load or a
refresh mid-flow renders the rail at its real position with no animation —
progress is state, not an entrance, and replaying it on every mount would tell
the reader they had just advanced when they had not. Subject rows use
`MotionListItem` inside `AnimatePresence`.

## The CSS behaviours

### `press-feedback` (utility)

On `Button` and `IconButton`. Transitions transform + colour, and applies
`scale(0.97)` on `:active`. Pressable things must visibly answer the press.

### `hover-lift` (utility)

`translateY(-2px)` plus the element's own border/background change. Gated behind
`@media (hover: hover) and (pointer: fine)` — on touch, `:hover` sticks after a
tap and the card would stay lifted.

Applied only to cards that already had a hover state, plus the three pricing
plan cards. Adding a hover state to a card that never had one would be a design
change, not an animation.

### `action-arrow` (utility)

Inline "read more" links: the label changes colour, the trailing arrow nudges
forward 3px. Same pointer gate as `hover-lift`.

### `icon-turn` (utility)

Disclosure chevrons and pluses. Transitions `rotate` and `transform`, in that
order and both deliberately: Tailwind v4's `rotate-*` utilities compile to the
standalone `rotate` property, not to `transform`, so transitioning `transform`
alone leaves the chevron snapping. Under reduced motion the duration drops to
`0ms`: the rotation *is* the state, so it lands immediately rather than being
removed.

### `[data-enter]` — page entrance

Above-the-fold content only. A keyframe (`motion-enter`: `opacity 0` +
`translateY(8px)` → final) rather than a transition, because an entrance is
never interrupted and must not wait for hydration — nothing above the fold
should need JavaScript to become visible.

Order is always eyebrow → heading → description → CTA → visual. Nothing blocks
interaction while it plays.

Four variants, so a page entrance is a composition rather than one repeated
rise: bare (8px rise, the default), `"scale"` (6px rise + `scale(0.97)`, for a
surface arriving with depth), `"left"` and `"right"` (10px from that side, for
two things that belong to opposite halves of a row). The entrance travels a
shorter distance than a scroll reveal on purpose — it plays while the reader is
still arriving, so it should be over before it is studied.

```tsx
<span data-enter style={motionIndex(0)}>Features</span>
<h1   data-enter style={motionIndex(1)}>…</h1>
<p    data-enter style={motionIndex(2)}>…</p>
<div  data-enter="scale" style={motionIndex(3)}>…</div>
```

Do not put `data-enter` on an element that carries its own opacity class — the
keyframe ends at `opacity: 1` and would overwrite it. Wrap it instead.

Nor on an element that also carries `hover-lift` or `press-feedback`. The
keyframe runs with `animation-fill-mode: both`, so when it finishes it pins
`transform: none` and the hover or press transform never applies. Put the
entrance on a wrapper and the interaction on the child.

### `[data-collapsible]` — disclosure panels

`frontend/components/motion/Collapsible.tsx`. Animates `grid-template-rows: 0fr → 1fr`,
the one layout property this system touches: a disclosure has to reserve its own
height or the content below it jumps, and `clip-path` cannot do that. The
technique is interruptible — clicking mid-transition reverses from where it is.

`visibility` is deliberately in the transition list. It keeps the panel visible
for the whole collapse and only applies `hidden` at the end, which also removes
the closed panel from the tab order and the accessibility tree, so no
`aria-hidden` is needed.

The direct child is a bare clipper. **Padding, border and background belong on
your content, not on the panel** — anything on the clipper's own box survives
the collapse as a visible sliver.

```tsx
<Collapsible open={open} id={panelId}>
  <div className="px-6 pb-5">…</div>
</Collapsible>
```

`variant="scale"` adds `scale(0.97)` for panels that read as a surface arriving
(the auth email panel). Text-only panels stay unscaled — scaling body text
mid-transition looks soft. Never `scale(0)`: nothing in the real world appears
from nothing.

### `marquee-*` — the infinite tool rows

`marquee-viewport` + `marquee-track` in `frontend/app/globals.css`. A constant-speed
horizontal loop built purely in CSS: the track is wider than its viewport,
translates by exactly one copy of its set (`-50%` of a track holding the set
twice), and starts over — which is what makes the wrap seamless and gapless
with no JS clock. The row pauses on hover (gated behind a fine pointer, the
same gate as `hover-lift`) and on focus-within, so a link under keyboard focus
never scrolls away from its user. Edge fades on both sides come from the
viewport's `mask-image`. Under reduced motion there is no animation at all:
the duplicated set — which carries `inert` — drops out and the row renders as
its own static, horizontally scrollable list. The homepage's "What's inside"
section is the current user; any future row reuses the same two utilities.

## Document and layout contracts

Two things outside `frontend/components/motion/` exist only to make the motion above
safe. Both are easy to delete by accident.

### `overflow-x-clip` on `Section` and `PageSection`

The directional reveals start their content 24px off-axis while the page gutter
is 20px, so for the ~380ms of an entrance the element's edge sits a few pixels
outside the viewport — enough to add a horizontal scrollbar at 320px. Both
section primitives carry the clip, which is what makes `left`/`right` safe to
use in any band without checking the arithmetic each time.

`clip`, not `hidden`, and the distinction matters: `clip` creates no scroll
container, so it cannot capture the page's scrolling, break a `scroll-mt`
anchor, or hand a sticky descendant a new scrollport.

### `data-scroll-behavior="smooth"` on `<html>`

`globals.css` sets `scroll-behavior: smooth` on `html` (behind
`prefers-reduced-motion: no-preference`) so in-page anchor jumps glide. Next.js
has to scroll to the top on every route change, and with smooth scrolling on it
*animates* that jump — the reader watches the old page scroll away while
`RouteTransition` is already playing the new one in. The attribute tells Next.js
the smooth behaviour is deliberate so it can suspend it for the duration of a
navigation and restore it afterwards: anchors keep gliding, navigations land
instantly. Without it Next.js also logs a warning on every soft navigation.

## Safety rules

These are the rules the dashboard bug taught, and they bind every animation,
Motion or CSS:

1. **Animation never controls content existence.** Content is always
   structurally rendered; animation only ever controls `opacity` and
   `transform` (or `clip-path` for bars). Nothing may sit permanently at
   `opacity: 0` or `visibility: hidden` because an observer or animation
   failed to initialize.
2. **Hydration-safe by construction.** Hidden states are Motion's `initial`,
   rendered identically on server and client — no client-side DOM mutation
   before hydration (the failure mode of the old `data-revealed` attribute).
3. **No-JavaScript fallback.** `MotionReveal`, `MotionRevealItem` and
   `MotionBar` still emit `data-reveal` / `data-reveal-bar`, and
   `RouteTransition` emits `data-route-transition`; `<noscript>` styles in the
   layouts un-hide every target when scripts never run. A new hidden start state
   that no `<noscript>` rule covers — an arbitrary `scaleX(0)`, say — is a new
   way for content to stay invisible. Reuse a primitive or add the rule.
4. **The dashboard prefers page entry over viewport reveals.**
   `RouteTransition` and the `[data-enter]` ladder cover the workspace's first
   paint; viewport reveals are for marketing pages with a reliable scroll
   lifecycle.
5. **Performance is part of safety.** No React state updates per frame, no
   scroll listeners where a viewport API works, no animation on a page-level
   container, and one observer per composition — that last one is what
   `MotionRevealGroup` is for.

## Reduced motion

CSS honours `prefers-reduced-motion: reduce` by inversion: every rule that
hides, translates, scales or clips lives *inside*
`@media (prefers-reduced-motion: no-preference)`. Under `reduce` there is no
hidden state to recover from, so nothing depends on JavaScript or an observer
having run.

Motion honours it twice: `MotionProvider`'s `reducedMotion="user"` disables
transform and layout animation at the library level, and every shared primitive
additionally zeroes its durations through `useReducedMotion()`, so an open, a
close and a reveal all land instantly — no opacity fade either. `MotionReveal`
renders a plain element with no hidden state at all.

- Entrances and reveals: content renders in its final position.
- Bars: drawn at full width.
- Disclosures, the drawer, the popovers and Modal: still open and close,
  instantly. Functionality is never hidden. Modal skips its close delay as
  well, so the dialog leaves immediately.
- Colour and opacity feedback on hover, focus and press is kept.

## What deliberately does not animate

- **The dotted background.** It is static. `bg-dotted-grid` sits on layout
  roots; every animation here applies `transform`, `opacity` or `clip-path` to
  descendants only. Never animate it or any ancestor of it.
- **The workspace shell** — sidebar, mobile bar, Assistant launcher,
  notification/profile/search triggers — during route transitions.
- Body copy on reading pages (`/devs-note`) — revealing paragraphs interrupts a
  read.
- Text input, typing, keyboard navigation, and anything repeated many times a
  day.
- `/auth/confirm`, which exists for a moment before redirecting.

## Future tool pages

The creation and study tools — presentation generator, document maker, PDF and
spreadsheet editors, converters, background remover, photo/video editors, QR
generator, flashcards, quiz generator, handwritten notes, data tables, mind maps
— do **not** get animation systems of their own. Each surface they need already
has a primitive, and the mapping is fixed:

| Tool surface | Reuse |
| --- | --- |
| Tool workspace opens | `RouteTransition` (automatic inside `(app)`) |
| Page composition inside it | `PageHeader` slot 0 + `[data-enter]` slots |
| Generation running | An indeterminate state on the surface being generated — purposeful, not decorative. Reuse `railFillVariants` for determinate progress. |
| Generated result arriving | `MotionRevealGroup` + `MotionRevealItem variant="scale"` |
| Result cards, slide/page thumbnails | `MotionRevealItem`, or `MotionListItem` when the set changes |
| Items added, removed or reordered | `MotionListItem` inside `AnimatePresence` |
| Editor panels, inspectors, sidebars | `MotionPopover` with the `direction`/`origin` of its trigger |
| Toolbars, dialogs, context menus | `MotionPopover` |
| Selected tool, layer, slide or cell | `MotionSelectionRing` with its own `layoutId` |
| Expanding options, advanced settings | `Collapsible` |
| Inline errors and status | `MotionNotice` |
| Buttons, icon actions, cards | `press-feedback`, `icon-turn`, `action-arrow`, `hover-lift` |

If a genuinely new behaviour is needed, it goes in `presets.ts` and this file —
as a primitive every tool can use, not as one tool's private animation.

## Adding motion

1. Should this animate at all? How often will a user see it? Hundreds of times a
   day → no animation.
2. What is the purpose — feedback, spatial continuity, explanation, or avoiding
   a jarring change? "It looks nice" is not one.
3. Reuse a primitive or a variant above. If none fits, add to `presets.ts` or a
   token here rather than a duration in a component.
4. A basic fade is not sufficient where a meaningful dimensional interaction
   fits: combine opacity with subtle translation, origin-aware scale, staggered
   children or coordinated parent/child motion as the UI's purpose dictates.
   Different UI patterns get different motion — do not apply one fade/translate
   to everything.
5. Animate `transform`, `opacity` or `clip-path`. Never `width`, `height`,
   `margin`, `padding`, `top` or `left`. Never `transition: all`. Use Motion
   `layout` only where it measurably improves UX (selected states, expanding
   controls, reordered lists) — never on large page containers. Two layout
   properties are deliberate, documented exceptions: `[data-collapsible]`'s
   `grid-template-rows` and the navbar shell's scroll-linked `width`.
6. Verify the result in Chromium, including `prefers-reduced-motion: reduce`.
