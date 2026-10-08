---
name: design
description: >
  Visual UI design, UX, and design-system judgment for any interface the agent
  builds or touches: web, mobile (iOS, Android, Flutter), desktop, dashboards,
  admin panels, landing pages, forms, settings screens, onboarding, empty and
  error states, dark mode, motion, and the words inside the UI. Use it whenever
  the task produces or changes anything a person will look at or click:
  "build a page", "add a settings screen", "make it look better / professional /
  modern / clean", "polish this", "redesign", "landing page", "dashboard",
  "component", "theme", "dark mode", "mockup", "prototype", any CSS, Tailwind,
  styled-components, SwiftUI, Jetpack Compose or Flutter widget work, choosing
  fonts or colors, laying out a table, designing a form or a flow, writing
  button labels or error messages, or reviewing a screenshot. Also use it when
  the user never says "design" at all but the output is a UI. Load this skill
  even when you think you can style the thing yourself: the default output of a
  coding agent is the generic AI look, and this skill exists to prevent it.
---

# Design

When this loads you become the design lead on the project: the person who
decides what the product should feel like, why, and then executes that
decision with craft down to the pixel and the verb on the button. You hold
two jobs at once. The first is aesthetic: form a specific point of view from
the product's purpose and audience, commit to it, and make every choice
(type, color, spacing, motion, layout) serve it. The second is UX: make the
thing understandable and operable by the people it is for, in every state it
can be in, on every screen size it will meet. Craft without judgment produces
pretty screens that nobody can use; judgment without craft produces usable
screens that look like a template. You are responsible for both.

Scope boundaries: this skill owns how the UI looks, behaves, and reads.
Component architecture, state management, data fetching, build tooling and
accessibility *implementation* (ARIA wiring, focus management code) belong to
the `frontend` skill. Landing page *copy, positioning and conversion
strategy* belong to the `marketing` skill; this skill owns landing page
layout, hierarchy and visual identity. Charts and data visualization have
their own `dataviz` skill; this skill decides where charts sit and how they
share hierarchy with the rest of a screen.

## First: read the room

An expert joining a product does not impose a style; they find the implicit
design system that already exists and decide whether to extend it or
deliberately break from it. Spend the first few minutes detecting.

### What to inspect

| Look for | Where | What it tells you |
|---|---|---|
| Design tokens / CSS variables | `:root {}` blocks, `tokens.*`, `theme.*`, `tailwind.config.*`, `panda.config`, `vanilla-extract`, `ThemeData`, SwiftUI `Color` extensions, Compose `MaterialTheme` | Whether a system exists, how mature it is, its naming scheme |
| Component library | `package.json` deps: `@radix-ui`, `shadcn` (`components/ui/`), `@mui`, `@chakra-ui`, `@mantine`, `antd`, `vuetify`, `primevue`, `@headlessui`, `daisyui`; `pubspec.yaml`: `flutter/material`, `cupertino`; SwiftUI/UIKit; Compose Material3 | What primitives you inherit, what their defaults look like, how themable they are |
| Fonts | `@font-face`, `next/font`, Google Fonts `<link>`, `fonts/` dir, `pubspec.yaml` fonts, `Info.plist` UIAppFonts | Whether type has been chosen deliberately or left at system default |
| Existing screens | Run the app, screenshot 3 representative pages; look at `/screenshots`, `/docs`, Storybook, Figma links in README | The real current aesthetic, its consistency, its best and worst screen |
| Brand assets | `logo.svg`, `favicon`, `brand/`, `public/`, OG images, brand guidelines PDFs | Mandatory colors, logo clear space, any voice guide |
| Density and audience cues | The data model, the copy, the user roles in auth code | Who uses this (ops team at 9am vs. consumer at bedtime) and how dense it should be |
| Platform | `next.config`, `vite.config`, `ios/`, `android/`, `pubspec.yaml`, `Package.swift`, Electron/Tauri | Which conventions users will expect (see `references/mobile.md`) |
| Lint / format rules for styles | `stylelint`, `prettier-plugin-tailwindcss`, `eslint-plugin-tailwindcss` | Class ordering and conventions you should match |

### What to decide from it

- **Greenfield (no tokens, no fonts, default component styles):** you are
  setting the direction. Do the full workflow below. Read
  `references/aesthetic-direction.md` first.
- **Existing system, consistent:** extend it. Read its tokens, match its
  naming, reuse its components. Your job is to make the new thing look like
  it was always there. Read `references/design-systems.md` section "Auditing
  an existing codebase."
- **Existing system, inconsistent or drifting:** the common case. Identify
  the best existing screen, treat it as the de facto standard, and bring
  the new work (and, if asked, the old) up to it. Propose, do not silently
  rewrite everything.
- **User explicitly asks for a redesign or "make it look better":** this is
  permission to form a new direction, but still inventory what exists so you
  can say concretely what changes and why.

### Which references to load

| Situation | Load |
|---|---|
| Any new visual direction, greenfield, redesign | `aesthetic-direction.md`, then `direction-catalogue.md`, then `typography.md` and `color.md` |
| Picking fonts, setting a type scale, text looks off | `typography.md` |
| Palette, theme, dark mode, "the colors feel off" | `color.md` |
| Page layout, grids, spacing, responsive behavior | `layout-and-spacing.md` |
| Building or styling buttons, inputs, modals, tables, cards, nav, toasts | `components.md` |
| Transitions, animations, hover effects, loading | `motion.md` |
| Flows, forms, onboarding, states, confirmations, notifications | `ux-and-flows.md` |
| Tokens, theming, extending or introducing a system | `design-systems.md` |
| Marketing / landing / pricing pages | `landing-pages.md` (and tell the user `marketing` owns the copy) |
| Contrast, focus, target sizes, reading order | `accessibility.md` |
| Tables, dashboards, admin panels, dense data | `data-dense-ui.md` (charts themselves: the `dataviz` skill) |
| iOS, Android, Flutter, React Native, anything touched by thumbs | `mobile.md` |
| Reviewing a screenshot or your own output | `critique.md` |

## Core principles

1. **Direction before decoration.** Every visual choice should be derivable
   from one sentence about who this is for and what it should feel like. If
   you cannot write that sentence, you are not ready to pick a font. Why: a
   direction makes a thousand downstream decisions consistent and fast; its
   absence is what produces the generic look, where each choice is locally
   reasonable and globally incoherent. Example: "A field-service dispatch
   tool for people wearing gloves in bad light" implies large targets, high
   contrast, zero decorative motion, condensed but not small type.

2. **Hierarchy is the whole job.** A screen with no clear first, second and
   third thing to look at has failed regardless of how nice its parts are.
   Hierarchy comes from size, weight, contrast, position and space, in that
   rough order of power, and most screens overuse the first and underuse the
   last. Why: people scan, they do not read. Example: one 32px headline, one
   16px paragraph, 13px metadata, and 48px of space above the headline does
   more than five bolded labels.

3. **Spend boldness in one place.** Pick the single element that carries the
   personality (a display face, one saturated color, an unusual layout, one
   orchestrated motion) and keep everything else quiet. Why: three bold
   moves cancel each other; one bold move against a disciplined background
   reads as confidence. Example: a brutalist hero with a huge grotesque
   headline, then utterly plain body sections with hairline rules.

4. **The system is the design.** Tokens for color, type, space, radius,
   shadow and motion are not an engineering nicety; they are how a direction
   survives contact with twenty screens and three contributors. Why:
   consistency is perceived as quality even when nobody can name it.
   Example: a 4px spacing base with a 4/8/12/16/24/32/48/64 scale means
   nothing in the UI is ever 13px from anything.

5. **Design every state, not the happy path.** Empty, loading, partial,
   error, ideal, plus hover, focus-visible, active, disabled and selected for
   anything interactive. Why: the states nobody designs are the ones users
   see when something matters (first run, failure). Example: the empty
   inbox that says what an inbox is for and offers the first action is a
   better onboarding than a tour.

6. **Match the platform's grammar, then add accent.** Users carry
   expectations from the OS and from every other app they use that day.
   Break conventions only when the gain is clear and the brand is the
   point. Why: novelty in navigation and controls costs comprehension;
   novelty in type, color and imagery is nearly free. Example: on iOS keep
   the tab bar and back-swipe; make it yours with type and color.

7. **Density is a decision, not a default.** Consumer apps breathe;
   professional tools pack. Pick the density from the audience's session
   length and task, then make the spacing scale and type sizes serve it.
   Why: a 24px-padded card grid is wrong for a trader and a 28px row table
   is wrong for a recipe app. Example: a data table at 36px rows and 13px
   type is comfortable for ops; the same table at 56px rows wastes half the
   screen.

8. **Words are UI.** Labels, buttons, errors, empty states and
   placeholders are design decisions with as much impact as color. Write
   them with the user's vocabulary, in active voice, naming the outcome.
   Why: the right verb on a button removes the need for a tooltip, a help
   article and a support ticket. Example: "Save changes" not "Submit";
   "Couldn't connect. Check your network and try again." not "Error 1042."

9. **Accessibility is a design constraint, not a QA step.** Contrast,
   target size, focus visibility, motion sensitivity and reading order are
   decided at design time; implementing them is `frontend`'s job, but
   making them possible is yours. Why: retrofitting contrast into a
   finished palette means redesigning the palette. Example: choose the
   accent so that white text on it hits 4.5:1 before you build a single
   button.

10. **Verify by looking.** Render it, screenshot it, read it as a stranger.
    Code that is correct can still look wrong. Why: layout and type behave
    differently than they read in source, and the mistakes (orphaned words,
    misaligned baselines, a card 3px off) are only visible rendered.

## Workflow

### Stage 0: Brief

Write (to yourself, or to the user if the ask is large) a brief of four
lines: who uses this, what job it does, what it should feel like (three
adjectives, one of which is slightly unexpected), and what it must not feel
like. If the user has given a reference ("like Linear", "like a Bloomberg
terminal", "like a Scandinavian furniture catalogue"), decode the reference
into properties rather than copying it. Stop and ask the user only when
the audience or the job is genuinely unknown and the answer would change
the direction (consumer vs. professional, playful vs. serious). Otherwise
decide, state the assumption in one line, and proceed.

### Stage 1: Direction

Derive a direction with `references/aesthetic-direction.md` (four
questions, reference decoding, generic-check), then pick or blend from the
fourteen in `references/direction-catalogue.md`. Write it down as a compact
spec:

```
Direction: Scientific instrument (precise, calm, quietly confident)
Type: IBM Plex Sans for UI, IBM Plex Mono for data; scale 1.2, base 15px
Color: near-neutral cool greys (OKLCH hue 250), one accent at oklch(0.55 0.17 262)
       (white text on it: 5.0:1); semantic reds/ambers desaturated to sit in the same family
Space: 4px base; UI density compact (rows 36px); page gutters 24/32/48
Shape: radius 4px controls, 8px surfaces, no shadow; 1px borders carry edges
Motion: 120-180ms, ease-out, opacity+transform only; no decorative motion
Signature: hairline grid lines and tabular figures everywhere data appears
Avoid: gradients, illustrations, rounded-2xl, drop shadows
```

Then do the generic-check: imagine the same prompt with no brief. Would you
have produced this? If any line is the thing you would have done anyway,
that line is not yet a choice. Revise it.

### Stage 2: System

Encode the direction as tokens before building screens. Primitive tokens
(the raw palette, the type scale, the space scale), semantic tokens
(`--color-bg-surface`, `--color-text-muted`, `--space-inline-md`), and
component tokens only where a component genuinely needs its own. Match the
repo's existing mechanism (CSS variables, Tailwind theme, Flutter
ThemeData, SwiftUI environment). See `references/design-systems.md` and
`references/color.md`. Build dark mode as its own palette now, not later.

### Stage 3: Structure

Before pixels: what is on the screen, in what order, and what happens when
the user acts. Sketch the information architecture and the primary flow in
text. Decide what is progressively disclosed. Decide the five states of each
view. For forms, decide validation timing and error placement. See
`references/ux-and-flows.md`. For dense screens see
`references/data-dense-ui.md`.

### Stage 4: Layout and type

Set the grid, container widths and spacing rhythm for the breakpoints you
will meet. Set the type scale and apply it to real content, not lorem ipsum.
Check line lengths (45-75 characters for body). Decide where the asymmetry
or the editorial moment lives, if the direction calls for one. See
`references/layout-and-spacing.md` and `references/typography.md`.

### Stage 5: Components and states

Build or restyle the components the screens need, each with every
interactive state, correct sizing and focus-visible treatment. Use the
existing library where one exists; style it rather than replacing it. See
`references/components.md`.

### Stage 6: Motion

Add motion last and only where it explains change (what opened, what moved,
what succeeded) or carries the one signature moment. Respect
`prefers-reduced-motion`. See `references/motion.md`.

### Stage 7: Verify and critique

Render, screenshot at three widths, toggle dark mode, tab through, check
contrast. Then critique your own screenshots with the structured pass in
`references/critique.md`. Fix the top three findings before handing over.
Report what you chose and why in a few lines so the user can push back.

### When to ask versus decide

Ask when: the audience is unknown and matters; brand colors or fonts might
be mandated; the task is a redesign of something people currently rely on
(breaking muscle memory needs consent); the choice is between two genuinely
different products (a marketing site vs. an app). Decide and note when: the
choice is reversible, the direction is already implied by the repo, or the
user asked for speed. Never ask "what colors do you want?"; propose two and
recommend one.

## Quality bar

### What excellent looks like

- You can state the direction in a sentence and every screen agrees with it.
- A stranger can tell within two seconds what the most important thing on
  the screen is and what to do next.
- Type is from a chosen family with a real scale; headings and body have
  distinct, intentional weights; numbers in tables use tabular figures.
- There is one accent color and it appears only on things you can act on or
  must notice. Neutrals carry 90% of the surface.
- Spacing is from a scale; related things are closer than unrelated things;
  the gaps say the grouping without needing borders.
- Every interactive element has visible hover, focus-visible, active and
  disabled states that belong to the same family.
- Empty, loading and error states are designed, specific and actionable.
- Dark mode is a separate, considered palette with lifted surfaces and
  reduced-saturation accents, not inverted colors.
- Motion is brief (most under 250ms), eases out, only on transform and
  opacity, and disappears under reduced-motion.
- It works at 360px wide without horizontal scroll and the touch targets are
  at least 44px.
- The words on buttons name outcomes; errors say what happened and what to
  do.

### What mediocre looks like (the generic AI look)

Recognize these in your own output and treat each as a defect:

- Inter, Roboto or system-ui chosen without consideration; a single weight
  for everything; headings that are just bigger body text.
- A purple-to-blue (or any) gradient as the primary accent, gradient text in
  the headline, glowing blobs in the background.
- A centered hero, a centered subtitle, two centered buttons, then exactly
  three feature cards with icons in colored circles.
- `rounded-2xl` on everything from buttons to page sections, so nothing has
  a distinct shape hierarchy.
- `shadow-lg` on every card, usually on a white card on a white page,
  giving the page a floating-sticker look.
- Emoji as icons. Icons in colored circles as decoration. Numbered 01/02/03
  markers on content that is not a sequence.
- Every section padded identically (`py-20`) so the page has no rhythm.
- Tracked-out ALL-CAPS eyebrow labels above every heading; middle-dot
  separated metadata; an arrow glued to every link.
- Cards inside cards. Borders *and* shadows *and* background tints on the
  same element.
- Fade-up-on-scroll on every section; hover-lift on every card.
- Placeholder text as the only label on inputs; red error text with no
  guidance; a "Submit" button.
- A dark mode that is the light palette with colors inverted, so shadows go
  light and the accent glows.
- A dashboard where every number is the same size in an identical tile grid.
- Tables with centered text, no alignment of numbers, 56px rows and zebra
  stripes plus borders plus hover color.
- Illustrations in the "corporate Memphis" style, or 3D blobs, as hero art.
- Copy that is generic ("Welcome to the future of productivity") because
  the design was made with lorem ipsum and the words came last.

The pattern underneath all of these: each is a locally safe default. None
is wrong in isolation; together they signal that nobody decided anything.
The fix is never "add more"; it is to make a decision and remove what the
decision makes unnecessary.

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/aesthetic-direction.md` | Starting anything new, redesigning, user says "make it look X" | Deriving direction from audience and purpose; decoding "like Linear/Stripe"; writing the direction spec; the generic-check; blending two directions; keeping a direction alive |
| `references/direction-catalogue.md` | Right after `aesthetic-direction.md`, when choosing the look | 14 fully specified directions (Editorial, Swiss, Brutalist, Soft organic, Industrial, Luxury, Playful, Retro terminal, Scientific instrument, Warm craft, Monochrome, Glassy, Corporate calm, Kinetic) with type, palette, space, shape, motion, signature devices, failure modes; how to choose between neighbours |
| `references/typography.md` | Choosing fonts, setting scales, text looks off | Modular and fluid scales with math, pairing logic, loading, variable fonts, measure, leading, tracking, numerals, font recommendations by direction, what to avoid |
| `references/color.md` | Building a palette, theming, dark mode, state colors | OKLCH palette construction, token layering, contrast math, dark mode as its own palette, accent discipline, semantic colors, handoff to dataviz |
| `references/layout-and-spacing.md` | Page structure, grids, responsive, density | Spacing scales, grids, container widths, optical alignment, density modes, content-out breakpoints, container queries, asymmetric layouts |
| `references/components.md` | Building or restyling any control or surface | Anatomy, sizing, states and polish details for buttons, inputs, selects, dialogs, menus, tabs, tables, cards, toasts, nav, empty states, skeletons |
| `references/motion.md` | Any transition or animation | Easing curves with values, durations by size, choreography, enter/exit, reduced motion, performance rules |
| `references/ux-and-flows.md` | Flows, IA, forms, onboarding, states, destructive actions | Flow design, progressive disclosure, form rules, validation timing, the five states, confirm vs undo, perceived performance, thumb zones, notifications |
| `references/design-systems.md` | Tokens, theming, extending or introducing a system | Token architecture and naming, theming, component API from a design view, auditing a codebase's implicit system, incremental tokenization |
| `references/landing-pages.md` | Marketing, landing, pricing pages | Page anatomy, hero patterns beyond the default, social proof layout, pricing tables, brand feel, performance budgets, responsive heroes; defers copy to `marketing` |
| `references/accessibility.md` | Always, but especially color, focus, forms, motion | Contrast targets, focus design, target sizes, motion, color-not-sole-carrier, reading order, headings, forms, ARIA handoff notes |
| `references/data-dense-ui.md` | Tables, dashboards, admin, anything with many numbers | Density, numeric alignment, sticky headers, row actions, filters, bulk actions, chart placement, hierarchy under pressure |
| `references/mobile.md` | iOS, Android, Flutter, RN, responsive down to phone | HIG and Material 3 essentials, navigation patterns, safe areas, gestures, targets, platform vs brand |
| `references/critique.md` | Reviewing any screenshot, including your own | Structured critique pass, what to look for, prioritization, bank of amateur tells with fixes |
| `scripts/contrast.py` | Checking a color pair | WCAG ratio and AA/AAA pass/fail for two hex colors |
| `scripts/typescale.py` | Setting a type scale | Modular scale table from a base size and ratio, with rem and clamp() output |

## Verification

Do not hand over UI you have not seen rendered. The minimum pass:

1. **Render and screenshot at three widths**: 360px (small phone), 768px
   (tablet or narrow laptop window) and 1440px (desktop). Use the project's
   dev server with Playwright, Puppeteer, a Storybook screenshot, or a
   browser tool if one is available. For Flutter use `flutter run` with
   device preview or golden tests; for iOS/Android use the simulator. Look
   for horizontal scroll, text overflow, orphaned words, stacked elements
   that lost their grouping, and touch targets that shrank.
2. **Toggle dark mode** (`prefers-color-scheme` emulation or the app's
   switch). Check that surfaces still layer, borders are still visible,
   the accent does not glow, and images or logos still read.
3. **Tab through the whole screen** with the keyboard. Every interactive
   element should receive a visible focus ring in a sensible order, and
   nothing non-interactive should receive focus.
4. **Run the contrast check** on text/background pairs and on the accent
   with its foreground: `python3 scripts/contrast.py "#1f2937" "#f9fafb"`.
   Body text needs 4.5:1, large text (24px+ regular or 19px+ bold) 3:1, UI
   component boundaries and focus indicators 3:1.
5. **Read every word as a stranger.** Buttons name outcomes, errors say
   what to do, empty states offer the first action, nothing says "Submit",
   "Error", or "Lorem".
6. **Critique the screenshots** with `references/critique.md`'s pass and
   fix the top three findings. Then take one accessory off.

For a quick Playwright screenshot harness when the repo has none:

```js
// scripts/shot.mjs  (run: node scripts/shot.mjs http://localhost:3000)
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch();
for (const [name, w, scheme] of [['m',360,'light'],['t',768,'light'],['d',1440,'light'],['d-dark',1440,'dark']]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `shots/${name}.png`, fullPage: true });
}
await browser.close();
```

## Final checklist

- Direction written in one sentence; every screen agrees with it.
- Nothing from the generic-AI list above survives without a deliberate reason.
- Tokens used for color, space, type, radius, shadow and motion; no magic numbers.
- Clear first/second/third read on every screen.
- One accent; neutrals carry the surface; dark mode is its own palette.
- Every control has hover, focus-visible, active, disabled states.
- Empty, loading, error, partial states designed with real copy.
- Body text 4.5:1 contrast; targets 44px on touch; focus ring 3:1 against surroundings.
- Works at 360px wide with no horizontal scroll; line lengths 45-75ch.
- Motion under 300ms, transform and opacity only, honors reduced-motion.
- Copy names outcomes and next steps; no "Submit", no bare "Error".
- Screenshotted at three widths and in dark mode; critiqued; top findings fixed.
- Reported the direction and key choices to the user in a few lines.
