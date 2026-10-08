# Motion

Easing curves with real cubic-bezier values, durations by element size and
distance, choreography and stagger, enter versus exit, micro-interactions,
what to animate and what never to, reduced motion, and performance rules
(transform and opacity only, will-change discipline). Platform notes for
CSS, Framer Motion, SwiftUI, Compose and Flutter.

## Contents

1. What motion is for
2. The three questions before animating anything
3. Easing: curves and when each is right
4. Duration: by size, distance and type
5. Enter and exit
6. Choreography and stagger
7. Micro-interactions
8. What never to animate
9. Scroll-driven and page-load motion
10. Reduced motion
11. Performance
12. Tokens and implementation
13. Platform notes
14. Diagnosing bad motion

## 1. What motion is for

Motion has three legitimate jobs in an interface:

1. **Explain change.** Where did this come from, where did it go, what is
   related to what. A panel sliding from the right tells the user it lives
   off to the right; a list item collapsing tells them it was removed,
   not that the list re-rendered.
2. **Give feedback.** The button pressed. The toggle flipped. The form is
   saving. The drop target is live.
3. **Carry personality** in one or two deliberate moments: a page-load
   reveal, a success celebration, a signature hover.

Everything else is decoration, and decoration in motion costs more than
decoration in color because it takes time and attention. The AI-default
look (fade-up on every section as it scrolls, lift on every card hover,
bounce on every button) is motion without a job. Remove it.

A useful test: if the animation were removed, would the user understand
less? If not, the animation is decoration; keep it only if it is the one
signature moment.

## 2. The three questions before animating anything

- **What changed, and does the user need help seeing it?** A modal
  appearing from nowhere is disorienting; a 150ms fade and scale from 0.96
  grounds it. A row of numbers updating in place does not need a tween.
- **How big and how far?** Big things and long distances take longer; small
  things and short distances are nearly instant. A 400ms animation on a
  16px checkbox feels broken; a 120ms animation on a full-screen page
  transition feels like a glitch.
- **Is this entering, exiting or transforming?** Enter slower and
  decelerating (ease-out); exit faster and accelerating (ease-in);
  transforms in place use ease-in-out or a spring.

## 3. Easing: curves and when each is right

Linear motion looks mechanical because nothing in the physical world moves
at constant speed. Every UI animation should ease.

| Name | cubic-bezier | Feel | Use |
|---|---|---|---|
| Ease-out (standard) | `cubic-bezier(0.2, 0, 0, 1)` | Fast start, soft landing | Enters, expansions, most UI |
| Ease-out (gentle) | `cubic-bezier(0.25, 0.1, 0.25, 1)` | CSS `ease`, slightly softer | Color and opacity changes |
| Ease-out (emphasized) | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Material 3 "emphasized decelerate"; very fast then long settle | Large elements entering, sheets, dialogs |
| Ease-in (exit) | `cubic-bezier(0.4, 0, 1, 1)` | Slow start, fast finish | Exits, dismissals, collapses |
| Ease-in (emphasized) | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Material 3 "emphasized accelerate" | Large elements leaving |
| Ease-in-out | `cubic-bezier(0.45, 0, 0.55, 1)` | Symmetric | Moving between two on-screen positions (tab indicator, reorder) |
| Ease-in-out (sharp) | `cubic-bezier(0.4, 0, 0.2, 1)` | Material 2 "standard" | Legacy Material feel |
| Overshoot / back-out | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Goes past and settles | Playful enters, toggles, small confirmations; never on large elements |
| Anticipate / back-in | `cubic-bezier(0.36, 0, 0.66, -0.56)` | Pulls back before leaving | Playful exits; rare |
| Linear | `linear` | Constant | Spinners, marquees, progress fills, opacity cross-fades of equal images |

Springs (physics-based) replace curves and durations with mass, stiffness
and damping. They feel natural because they respond to interruption (a
dragged sheet released mid-way continues from its current velocity). Use
them in Framer Motion, React Spring, SwiftUI (`.spring(response:
dampingFraction:)`), Compose (`spring(dampingRatio, stiffness)`) and
Flutter (`SpringSimulation`). Good defaults: stiffness 300-400, damping
25-35 (critically damped, no bounce) for UI; damping 15-20 for a slight
bounce in playful contexts. `response: 0.35, dampingFraction: 0.8` in
SwiftUI is a solid general-purpose spring.

CSS `linear()` can approximate springs:

```css
--ease-spring: linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1);
```

Rules:

- Pick two or three curves for the whole product and name them as tokens
  (`--ease-out`, `--ease-in`, `--ease-in-out`, optionally `--ease-spring`).
- Never `ease-in` on an enter (it lurches in) and never `ease-out` on an
  exit (it lingers).
- Overshoot only on small elements and only in directions that want it.
- `ease-in-out` is overused as a default; most UI wants ease-out.

## 4. Duration: by size, distance and type

| What | Duration | Notes |
|---|---|---|
| Color, opacity, border changes (hover, focus) | 100-150ms | Faster feels instant; slower feels laggy |
| Press feedback (scale, translate) | 60-100ms | Must feel like contact |
| Small element enter (tooltip, badge, checkbox check) | 120-180ms | |
| Small element exit | 80-120ms | Exits 20-30% faster than enters |
| Medium element enter (menu, popover, toast) | 150-220ms | |
| Medium element exit | 100-150ms | |
| Large element enter (dialog, drawer, sheet) | 200-300ms | Emphasized ease-out |
| Large element exit | 150-200ms | |
| Expand / collapse (accordion, inline detail) | 200-300ms | Scales with height; cap at 300 |
| Reorder / move on screen | 200-350ms | Longer distances longer |
| Page / route transition | 250-400ms | Shared-element transitions up to 500 |
| Skeleton shimmer | 1200-1600ms loop | Subtle |
| Spinner rotation | 800-1000ms loop | Linear |
| Decorative signature moment (load reveal) | 400-800ms total | Once per session |
| Celebration (confetti, check draw) | 600-1200ms | Rare events only |

Distance adjustment: durations above assume the element moves less than
about 100px. For longer travel add roughly 1ms per 2px, capped at 400ms.
Elements should move 8-24px on enter, not 100px; subtle translation plus
opacity reads as "appearing here," large translation reads as "flying in
from elsewhere" and must correspond to a real spatial model.

Desktop can run slightly faster than mobile (Material recommends ~30%
shorter on large screens because elements travel relatively less).

Nothing in a UI should take longer than 300ms except page transitions and
deliberate signature moments. When in doubt, shorten by 20%.

## 5. Enter and exit

**Enter**: opacity 0 to 1 plus a small transform (translateY 8px to 0, or
scale 0.96 to 1, or both), ease-out. Transform origin matters: menus scale
from the trigger edge (`transform-origin: top left`), dialogs from center,
toasts from their entry edge.

**Exit**: reverse, faster, ease-in, often opacity-only to avoid a lurch.
Exits are the detail most often skipped (elements just vanish) and skipping
them makes the interface feel brittle. CSS: use `@starting-style` and
`transition-behavior: allow-discrete` for `display: none` transitions in
modern browsers, or keep the element mounted until the exit finishes
(Framer Motion `AnimatePresence`, Vue `<Transition>`, Svelte `out:`).

```css
.menu {
  transition: opacity 120ms var(--ease-in), transform 120ms var(--ease-in), display 120ms allow-discrete;
  opacity: 1; transform: scale(1);
}
.menu[hidden] { opacity: 0; transform: scale(0.96); }
@starting-style { .menu { opacity: 0; transform: scale(0.96); } }
```

**Expand/collapse height**: animate `grid-template-rows: 0fr` to `1fr` on a
wrapper (with `overflow: hidden` on the child), or measure and animate
`height` with the Web Animations API, or use `interpolate-size:
allow-keywords` in browsers that support it. Never animate `max-height` to
a large magic number (the easing is wrong for most of the travel).

**Shared element**: when an item expands into a detail view, the image and
title should move from their list position to their detail position. The
View Transitions API (`document.startViewTransition`, `view-transition-
name`) does this with little code and is worth using for list-to-detail
and tab-to-tab transitions. Native: Hero in Flutter, `matchedGeometryEffect`
in SwiftUI, `SharedTransitionLayout` in Compose.

## 6. Choreography and stagger

When several things enter together, stagger them so the eye reads an
order: 20-40ms between items, cap total stagger at ~300ms (so a list of
20 does not take a second; stagger the first 6-8 and let the rest appear
together). Stagger follows reading order (top-left to bottom-right) or
hierarchy (container, then header, then content).

Dialog choreography: overlay fades (150ms), panel scales and fades
(200ms, starts 0-30ms after overlay), content inside is already in place
(do not stagger form fields in a dialog; it delays the task).

Page load (the one signature moment, if the direction has one): background
and layout instantly, headline first (0ms), supporting text (+60ms),
primary visual (+120ms), secondary elements (+180ms). Total under 600ms.
Run once per session, not on every navigation.

Sequential dependencies: when B is caused by A (toggle a switch, section
appears), B starts as A finishes or at A's midpoint, not simultaneously.

Avoid: everything moving at once in different directions; stagger on
hover states; stagger on content that re-renders frequently (lists that
filter) beyond a single frame of difference.

## 7. Micro-interactions

Small, fast responses that make controls feel physical:

- **Button press**: `scale(0.97)` or `translateY(1px)`, 80ms, returning
  on release with ease-out 120ms. Playful: hard shadow collapses.
- **Checkbox**: box fills over 100ms; check path draws with
  `stroke-dashoffset` over 150ms, slightly delayed. Bounce acceptable in
  soft/playful directions.
- **Switch**: thumb slides 120-150ms ease-out; track color crossfades in
  the same time; a tiny stretch of the thumb mid-travel (scaleX 1.1) is a
  nice touch in playful directions.
- **Tab indicator**: slides and resizes between tabs 150-200ms ease-in-out.
- **Input focus**: border and ring 120ms.
- **Hover on list rows / menu items**: 60-100ms background; near-instant.
- **Like / favorite**: icon scales to 1.3 and back (200ms spring), fills;
  a particle burst only if the direction is playful.
- **Copy to clipboard**: icon swaps to a check for 1.5s with a 150ms
  crossfade; the label can say "Copied".
- **Drag**: lifted item scales 1.02-1.05 and gains elevation 3 shadow;
  siblings move aside with 150ms ease-in-out; drop snaps with a spring.
- **Pull to refresh / overscroll**: follows the finger (no easing while
  dragging), springs back on release.
- **Number changes**: counters roll digits (each digit a vertical strip
  translating) or crossfade; never tween a big dashboard number from 0
  every time it loads (that is decoration).
- **Inline validation success**: a check appears with a 150ms fade; no
  bounce in serious products.

Interaction-driven motion should start within one frame (16ms) of the
input. Any delay between press and response reads as lag.

## 8. What never to animate

- **Layout properties** (`width`, `height`, `top`, `left`, `margin`,
  `padding`, `font-size`) except via the height techniques above. They
  trigger layout every frame and jank on anything but the simplest page.
  Animate `transform` and `opacity`; fake size changes with `scale` where
  acceptable, or clip-path.
- **Body text** (no fading paragraphs in as the user scrolls; they are
  trying to read).
- **Things the user is interacting with**, beyond the immediate feedback.
  An input that animates its label while the user types is a distraction.
- **Infinite loops on visible UI** except spinners, progress and skeleton
  shimmer. A pulsing CTA is an anxiety generator.
- **Backgrounds behind text** (moving gradients, particles, video) at
  anything above very low intensity. Contrast becomes unpredictable and
  reading suffers.
- **Hover states on touch devices**. `@media (hover: hover)` gates hover
  animations.
- **Large images or whole sections on scroll** on marketing pages, unless
  it is the one orchestrated moment. Fade-up on every section is the
  single most recognizable AI motion tell.
- **The cursor** (custom cursors, trailing effects) outside of expressive
  art-directed sites.
- **Everything on the page at once** on load. Pick the hero.
- **Toast position** when a new toast arrives (no re-stacking shuffle);
  new toasts enter, old ones fade.

## 9. Scroll-driven and page-load motion

Scroll-driven animations (`animation-timeline: scroll()` / `view()`, or a
library) are appropriate for: a progress indicator, a header that compacts,
a sticky element that transforms as the page progresses, a single hero
parallax at low intensity (image moves at 0.8-0.9x scroll speed, not 0.5x).
They are not appropriate for revealing each section's content.

If a reveal-on-scroll is part of the direction (Kinetic, some Editorial):
one kind of reveal, 300-400ms, 12-16px translate, triggered when the
element is 15-20% into the viewport, once (no re-animating on scroll up),
and body copy excluded. CSS:

```css
@supports (animation-timeline: view()) {
  .reveal {
    animation: reveal linear both;
    animation-timeline: view();
    animation-range: entry 10% entry 40%;
  }
  @keyframes reveal { from { opacity: 0; transform: translateY(12px); } }
}
```

Page-load: see choreography above. On repeat visits (session storage
flag) skip the reveal entirely; returning users want the content.

Route transitions in apps: 150-250ms crossfade or a 16-24px slide in the
direction of navigation (forward slides left, back slides right). Keep the
chrome (nav, header) static; only the content pane transitions. The View
Transitions API makes this nearly free in SPAs and MPAs.

## 10. Reduced motion

`prefers-reduced-motion: reduce` is set by people with vestibular
disorders, motion sickness, attention conditions, or simply a preference.
Honoring it is not optional. What it means in practice:

- **Remove** translation, scale, parallax, auto-playing video, infinite
  loops (except a spinner which may become a static indicator or a slow
  pulse), scroll-driven effects, and page-load choreography.
- **Keep** opacity crossfades (shortened to about 100ms), color changes,
  and instant state changes. Fades are generally safe; movement is not.
- **Keep meaning**: if an animation explained where a panel came from,
  make sure the panel is still visibly distinct when it appears instantly
  (border, shadow).

Global approach:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This blunt version works for most products. Better: define motion tokens
and set them to zero under the media query, while leaving opacity
transitions at 100ms:

```css
:root { --motion-duration-sm: 120ms; --motion-duration-md: 200ms; --motion-distance: 8px; }
@media (prefers-reduced-motion: reduce) {
  :root { --motion-duration-sm: 0ms; --motion-duration-md: 0ms; --motion-distance: 0px; --motion-fade: 100ms; }
}
```

Native: `UIAccessibility.isReduceMotionEnabled` (iOS), `Settings.Global.
ANIMATOR_DURATION_SCALE` or `LocalAccessibilityManager` (Android),
`MediaQuery.disableAnimationsOf(context)` (Flutter). Framer Motion:
`useReducedMotion()`; `MotionConfig reducedMotion="user"`.

Also respect `prefers-reduced-transparency` where glass is used, and
provide a pause control for any auto-playing motion longer than 5 seconds.

## 11. Performance

Smooth motion is 60fps (16.7ms per frame) or 120fps on capable displays.
Dropped frames are more noticeable than no animation.

- **Animate only `transform` and `opacity`** (and `filter` sparingly, and
  `clip-path` for reveals). These run on the compositor without layout or
  paint. `background-color` and `color` transitions are cheap enough for
  small elements (hover states) but not for large surfaces.
- **`will-change`** promotes an element to its own layer. Apply it just
  before an animation and remove it after (or apply only to elements that
  animate constantly, like a draggable). Blanket `will-change: transform`
  on many elements eats memory and can blur text. Never leave it on in a
  stylesheet for static elements.
- **`backdrop-filter`** is expensive; limit to one or two surfaces and
  avoid animating elements behind it.
- **Box-shadow transitions** repaint; for hover elevation, crossfade two
  pseudo-elements with different shadows using opacity instead.
- **Layout thrash**: reading `offsetHeight` then writing styles in a loop
  forces synchronous layout. Batch reads then writes, or use
  `requestAnimationFrame`. FLIP (First, Last, Invert, Play) is the
  technique for animating layout changes with transforms.
- **Large images in motion**: downscale to display size; a 4000px image
  being parallaxed will stutter.
- **Measure**: Chrome DevTools Performance panel, "Rendering > Frame
  Rendering Stats", and the Layers panel. A long purple (layout) bar during
  animation means a layout property is animating.
- **Mobile budgets**: assume half the CPU of a laptop. Test on a mid-range
  Android device or throttle 4x.

## 12. Tokens and implementation

```css
:root {
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-out-emphasized: cubic-bezier(0.05, 0.7, 0.1, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  --duration-instant: 80ms;
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 450ms;

  --motion-distance-sm: 4px;
  --motion-distance-md: 8px;
  --motion-distance-lg: 16px;
}

/* Example: menu */
.menu { transition: opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out); }
/* Example: dialog */
.dialog[data-state="open"]  { animation: dialog-in var(--duration-base) var(--ease-out-emphasized); }
.dialog[data-state="closed"] { animation: dialog-out var(--duration-fast) var(--ease-in); }
@keyframes dialog-in  { from { opacity: 0; transform: translateY(var(--motion-distance-md)) scale(0.97); } }
@keyframes dialog-out { to   { opacity: 0; transform: scale(0.98); } }
```

Tailwind: extend `transitionTimingFunction`, `transitionDuration` and
`keyframes`/`animation` in the theme with the same names; use
`motion-safe:` and `motion-reduce:` variants (`motion-safe:transition
motion-safe:duration-200`).

Framer Motion defaults worth setting once via `MotionConfig`:
`transition={{ type: 'spring', stiffness: 380, damping: 32 }}` for layout
and `{ duration: 0.15, ease: [0.2, 0, 0, 1] }` for opacity.

## 13. Platform notes

- **iOS / SwiftUI**: the platform is spring-based. `.animation(.spring(
  response: 0.35, dampingFraction: 0.85), value:)`. Sheets, navigation
  pushes and the keyboard all have system motion; match it rather than
  overriding. Interactive dismissal (drag down a sheet) is expected.
  `withAnimation` for state-driven changes; `.transition(.move(edge:)
  .combined(with: .opacity))` for insert/remove.
- **Android / Compose**: Material 3 motion uses the emphasized curves
  above and durations short1-4 (50-200ms), medium1-4 (250-400ms),
  long1-4 (450-600ms). `animateContentSize()`, `AnimatedVisibility`,
  `AnimatedContent` with `SharedTransitionLayout`. Container transform
  (card expanding into a detail page) is the signature M3 pattern.
- **Flutter**: `AnimatedContainer`, `AnimatedSwitcher`, `Hero`,
  implicit animations with `Curves.easeOutCubic` (close to standard
  ease-out), `Curves.easeOutBack` for overshoot. Durations in
  `Duration(milliseconds:)`; keep the same token values. Respect
  `MediaQuery.disableAnimations`.
- **React Native**: Reanimated for 60fps on the UI thread; `withSpring`
  and `withTiming` with the same curves; `LayoutAnimation` for simple
  cases.
- **Web page transitions**: View Transitions API; fall back to no
  transition where unsupported, never to a JS crossfade that delays
  navigation.

## 14. Diagnosing bad motion

| Symptom | Cause | Fix |
|---|---|---|
| Feels sluggish | Durations over 300ms on UI; ease-in-out on everything | Cut 30%; ease-out for enters |
| Feels cheap / bouncy | Overshoot on large elements or in serious product | Critically damped; reserve bounce for small playful moments |
| Feels like a template | Fade-up on every scrolled section; lift on every card | Remove; keep one signature moment |
| Jank / stutter | Animating layout properties; shadows; too many layers | Transform and opacity only; crossfade shadows; audit will-change |
| Elements pop in/out | No exit animation; no enter for popovers | Add 100-150ms exits; 150ms enters with small transform |
| Disorienting | Elements fly from directions that mean nothing | Small 8-16px translate from the spatial origin; scale from trigger |
| Busy | Multiple things moving at once with different timings | Choreograph; one thing at a time or a tight stagger |
| Hover flicker | Transition on `all`; hover area changes size on hover | Transition specific properties; keep hit area stable |
| Motion-sick users complain | Parallax, large movements, auto-play | Honor reduced-motion; cut distances |
| Spinner flashes on fast loads | No appearance delay | Delay 200-300ms before showing loading state |
| Text looks blurry during/after | `will-change` or 3D transforms left on text layers | Remove after animation; avoid fractional transforms on text |
