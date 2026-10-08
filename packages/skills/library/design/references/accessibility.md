# Accessibility as a design discipline

Contrast, focus visibility, target sizes, motion, color as a non-sole
carrier, reading order, headings as structure, forms, and the ARIA hints to
hand to the frontend skill. This file is about decisions made at design
time that make accessibility possible; the frontend skill owns the
implementation (ARIA attributes, focus management code, live regions,
testing with screen readers). Design that ignores these constraints cannot
be fixed in implementation without redesign.

## Contents

1. Why this is a design problem
2. Contrast
3. Color is never the only carrier
4. Focus visibility
5. Target size and spacing
6. Motion and flashing
7. Text: size, spacing, zoom and reflow
8. Reading order and layout
9. Headings and landmarks as structure
10. Forms
11. Images, icons and media
12. Interaction patterns with accessibility consequences
13. Dark mode, high contrast and forced colors
14. Handoff notes for the frontend skill
15. Quick audit

## 1. Why this is a design problem

Most accessibility failures are decided in the design: a grey that is too
light, a focus ring removed for looks, a 28px icon button, a hover-only
menu, a form whose only label is a placeholder, a chart where red and
green are the only difference. By the time a developer adds ARIA, these
are baked in. Roughly one in six people has a disability that affects
interface use, and everyone is situationally impaired sometimes (glare,
one hand, a cracked screen, fatigue). Designing for the edge makes the
middle better: higher contrast and bigger targets help everyone.

Standards: WCAG 2.2 Level AA is the legal and practical target in most
jurisdictions (ADA, EN 301 549, EAA from 2025, AODA). AAA is aspirational
for text contrast on reading-heavy products. Cite criteria by number when
handing off so the frontend skill can test against them.

## 2. Contrast

| Element | Minimum | Criterion |
|---|---|---|
| Body text (under 24px regular / 18.66px bold) | 4.5:1 | 1.4.3 |
| Large text (24px+ regular / 18.66px+ bold) | 3:1 | 1.4.3 |
| UI component boundaries and states (input border, checkbox edge, slider track, toggle) | 3:1 against adjacent colors | 1.4.11 |
| Focus indicator | 3:1 against adjacent colors (and see 2.4.13 for size) | 1.4.11, 2.4.13 |
| Meaningful icons and graphics | 3:1 | 1.4.11 |
| Text in disabled controls | exempt | — |
| Placeholder text | 4.5:1 if it conveys information; it should not be the label | — |
| Logo and decorative text | exempt | — |

Design implications:

- Pick the muted text color last, by computing it: on white, #767676 (OKLCH
  L about 0.56) is the lightest pure grey that reaches 4.5:1. Most "subtle"
  greys designers like (#999, #AAA, Tailwind gray-400 and gray-500) fail.
- Pick the accent so white text on it passes 4.5:1 (L ≤ 0.58) *or* commit
  to dark text on the accent. Yellow, orange, light green and cyan accents
  need dark text.
- Input borders at `border-default` (very light) fail 3:1; use
  `border-strong` for control boundaries or add a background tint.
- Text over images needs a scrim (gradient or solid panel at 60%+) or a
  known-dark region; check against the lightest pixel region under the
  text.
- Text on gradients: check at both ends.
- Dark mode: light text on dark is perceived as higher contrast than the
  ratio suggests; thin weights still fail. Avoid 300 weights on dark.
- Thin fonts and light weights reduce effective contrast; APCA accounts
  for this and WCAG does not. If a design uses weights under 400 at small
  sizes, raise the ratio target to 7:1.
- `prefers-contrast: more` is set by users who need stronger separation;
  respond by darkening muted text and strengthening borders.

Use `scripts/contrast.py` on every text/background pair and on the accent
pair before building.

## 3. Color is never the only carrier

About 8% of men have some color vision deficiency; most commonly red-green.
Information carried by color alone is lost to them, and to everyone on a
poorly calibrated screen or in sunlight.

- **Status**: icon + text + color ("● Failed" in red with an x icon), not a
  colored dot alone.
- **Links in prose**: underline (or a weight/other visible difference), not
  color alone (1.4.1). Links in navigation lists are exempt by context.
- **Form errors**: icon + message + border color, not a red border alone.
- **Required fields**: asterisk + legend, or "(required)" text; not a red
  label.
- **Charts**: direct labels, patterns or shape differences, ordered
  legends; never rely on red vs green for up/down (use arrows or signs too).
  The dataviz skill owns the palette; insist on this constraint.
- **Selected state**: a check icon or a weight change plus the color
  (tabs, cards-as-radios, list selection).
- **Toggle switches**: the on/off position is the carrier, color is
  secondary; optional icons in the thumb.
- **Diff views and calendars**: symbols or labels in addition to color
  fills.

Simulate: Chrome DevTools > Rendering > Emulate vision deficiencies
(protanopia, deuteranopia, tritanopia, achromatopsia). If the screen still
makes sense in achromatopsia, color is not the sole carrier.

## 4. Focus visibility

Keyboard users (and switch, voice and screen-reader users) need to see
where focus is at every moment. `outline: none` without a replacement is
the single most common accessibility regression in styled UIs.

Design requirements (2.4.7, 2.4.11, 2.4.13):

- Every focusable element has a visible focus indicator.
- The indicator has 3:1 contrast against the adjacent colors and is at
  least as large as a 2px perimeter around the element.
- Focused elements are not hidden behind sticky headers, footers or
  toasts (2.4.11 Focus Not Obscured); `scroll-padding-top` equal to the
  header height fixes the common case.

Design the focus style once and apply it everywhere:

```css
:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
```

- Use `:focus-visible` so the ring appears for keyboard but not for mouse
  clicks on buttons (the browser decides heuristically).
- Make the ring color work on every surface: a single accent ring fails on
  an accent button. Use a double ring (white inner, accent outer via
  `box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent)`) or a dedicated
  high-contrast focus color (a dark blue or near-black on light; a light
  yellow or white on dark).
- `outline` renders in Windows High Contrast mode; `box-shadow` does not.
  Use `outline` as the base and `box-shadow` as enhancement.
- Inputs: a border color change alone is weak; combine with a ring.
- Rounded elements: `outline` follows `border-radius` in modern browsers;
  on old ones it is square, which is acceptable.
- Cards and rows that are links: ring on the whole card (`:focus-within`
  for cards whose link is inside) with an inset ring if the card touches
  neighbors.
- Skip links: a visually hidden "Skip to content" link that appears on
  focus at the top left, styled as a prominent button.

Focus *order* is a design decision too: it follows DOM order, so the
visual order must match the DOM order (see section 8).

## 5. Target size and spacing

- WCAG 2.2 AA (2.5.8): 24x24 CSS px minimum, or 24px spacing between
  smaller targets. AAA (2.5.5) and platform guidance: 44x44 (iOS), 48x48dp
  (Android), 44px (web best practice).
- Design controls at 40px visual height and extend the hit area to 44px
  where they are smaller (padding, or a pseudo-element with `inset: -4px`).
- Icon-only buttons: 40x40 minimum visual, 44 hit.
- Inline links in text are exempt from size but adjacent links need
  distinguishable boundaries.
- Spacing between adjacent targets: 8px minimum so a miss does not hit the
  neighbor; critical for toolbars, row actions and pagination.
- Checkboxes and radios: the label is part of the target; the whole row in
  a settings list is the target.
- Dense tables: row actions in a menu rather than four tiny icons; or
  increase row height when actions are visible.
- Sliders and drag handles: 44px grab area even when the visual handle is
  16-20px.
- Close buttons on dialogs and toasts: 32px visual minimum, 44 hit;
  positioned with 8px+ from the edge.

## 6. Motion and flashing

- Respect `prefers-reduced-motion` (2.3.3 AAA, but treat as required): see
  motion.md for what to remove and what to keep.
- Nothing flashes more than 3 times per second (2.3.1); avoid strobing
  effects entirely.
- Auto-playing motion longer than 5 seconds (carousels, video, marquees)
  has a pause/stop control (2.2.2) and pauses on hover and focus.
- Parallax and scroll-jacking are vestibular triggers; keep parallax
  intensity low and off under reduced motion; never hijack scroll.
- Animated content behind text makes reading harder for people with
  attention and reading disabilities; keep backgrounds still.
- Timeouts: warn before session expiry and allow extension (2.2.1); do not
  auto-advance content on a timer without control.

## 7. Text: size, spacing, zoom and reflow

- Body text 16px minimum on the web (14px tolerable for dense desktop
  tools with excellent fonts; 12px only for legal and tertiary metadata).
- Text must be resizable to 200% without loss (1.4.4): use `rem`/`em`, not
  `px`, for font sizes and media queries; test with browser zoom at 200%.
- Reflow at 320px CSS width without horizontal scroll (1.4.10): test at
  400% zoom on a 1280 window, which equals 320px.
- Text spacing (1.4.12): the layout must survive line-height 1.5,
  paragraph spacing 2em, letter-spacing 0.12em, word-spacing 0.16em. Fixed-
  height containers with text inside break this; let containers grow.
- Line length 45-75ch; justified text off; `hyphens: auto` with `lang`.
- Avoid images of text (1.4.5); use real text with web fonts.
- Dyslexia-friendly choices: left-aligned, generous leading, clear
  distinction between similar glyphs (Il1, 0O), no italics for long
  passages, sentence case.
- Users may override fonts (Dyslexie, OpenDyslexic) and colors via
  browser settings; do not fight that with `!important`.

## 8. Reading order and layout

Screen readers and keyboard navigation follow DOM order. Visual order must
match (1.3.2, 2.4.3).

- Do not reorder with CSS (`order`, `flex-direction: row-reverse`,
  grid placement) in ways that change meaning. Reversing image/text columns
  on alternating rows is fine if the text is always first in DOM and the
  image is decorative; it is not fine if the visual order is the reading
  order.
- Absolutely positioned elements that appear elsewhere than their DOM
  location confuse; keep sidebars, toolbars and sticky actions in logical
  DOM positions.
- Multi-column forms: DOM order should be row by row, matching how the eye
  reads; a two-column grid filled column-first reads wrong.
- Modals: the dialog's DOM position does not matter as long as focus moves
  into it and returns on close (frontend implements).
- Hidden content (`display: none`, `visibility: hidden`, `hidden`) is
  hidden from everyone; visually hidden but available to screen readers
  uses the `.sr-only`/`.visually-hidden` pattern. Decide which each hidden
  thing is.
- Tab order: interactive elements in a sensible path, left-to-right,
  top-to-bottom per region; a design that puts the primary action before
  the fields in the DOM to make it "first" breaks the flow.

## 9. Headings and landmarks as structure

Headings are the table of contents for screen reader users (who navigate by
them) and the hierarchy for everyone.

- One `h1` per page, naming the page. Sections use `h2`; subsections `h3`;
  do not skip levels going down (h2 to h4).
- Heading level is structure, not style. A heading that should look small
  gets a class, not a lower level. Define type presets so any level can
  take any visual size.
- Every visually distinct section needs a heading, even if visually hidden
  ("Filters", "Results", "Recently viewed").
- Cards: the card title is a heading at the appropriate level; the grid's
  heading is one level above.
- Landmarks (`header`, `nav`, `main`, `aside`, `footer`, `section` with a
  label, `form` with a label, `search`) let users jump between regions.
  Design the page as regions and name them; the frontend adds the
  elements.
- Page titles (`<title>`) change per route and start with the specific
  ("Invoices · Acme") so tab lists and history are usable.

## 10. Forms

Most of ux-and-flows.md's form guidance is accessibility guidance. The
design-time requirements:

- Every input has a visible, persistent label (3.3.2). Placeholders are
  not labels. Icon-only inputs (search) need a visible label or a
  tooltip-less accessible name; the design should include a visible
  label or at least an `aria-label` note in the handoff.
- Labels are adjacent to their fields (above or left), so magnifier users
  see both.
- Required/optional is indicated in text or symbol with a legend.
- Errors are identified in text (3.3.1), adjacent to the field, and
  describe the fix (3.3.3). Color alone is insufficient. A summary at the
  top links to each error for long forms.
- Grouped controls (radio groups, checkbox sets, date parts) have a group
  label (the design should show the group heading; frontend uses
  `fieldset/legend` or `role=group`).
- Help text is visible before the error, not revealed only after.
- Autocomplete is enabled for personal data fields (1.3.5): the design
  should name which fields are name, email, address, etc.
- Redundant entry (3.3.7): do not ask for the same information twice in a
  flow; offer to reuse (shipping = billing).
- Accessible authentication (3.3.8): no cognitive-function tests (puzzle
  CAPTCHAs, memorized patterns) without an alternative; allow paste in
  password fields; support password managers (no `autocomplete="off"` on
  login).
- Input purpose and keyboard: the right `type`/`inputmode` so mobile
  keyboards match.
- Time limits on forms (session expiry) warn and extend.

## 11. Images, icons and media

- Informative images need alt text describing the information, not the
  picture ("Revenue grew from $2M to $5M between 2023 and 2026", not "a
  chart"). Decorative images get empty alt. The design should mark which
  is which.
- Icon-only buttons need an accessible name (visible tooltip plus
  `aria-label`); the design should list the name for each.
- Icons that accompany text are decorative (`aria-hidden`).
- Complex images (charts, diagrams) need a text alternative nearby (a data
  table, a summary sentence) or a link to one.
- Video: captions (1.2.2) and, for meaningful visuals, audio description
  or a transcript. Design the player with visible caption toggle.
- Audio does not autoplay; if it must, a visible mute within reach (1.4.2).
- SVG icons: consistent sizing in `em` or tokens so they scale with text
  zoom.
- Emoji as icons fail: inconsistent rendering, poor contrast, read aloud
  as their names ("rocket"). Use an icon set.

## 12. Interaction patterns with accessibility consequences

| Pattern | Risk | Design mitigation |
|---|---|---|
| Hover-revealed actions | Invisible to keyboard and touch | Also show on focus-within; always visible on touch; or put in a menu button |
| Hover-only tooltips carrying essential info | Lost to touch and keyboard | Put the info in visible text; tooltips for supplementary only; show on focus |
| Infinite scroll | Footer unreachable; focus lost on load | "Load more" button option; keep footer reachable; announce new items |
| Drag and drop | Impossible for many | Keyboard alternative (move up/down buttons, cut/paste) and a visible one (2.5.7) |
| Custom select | Often broken | Prefer native where possible; if custom, follow the listbox pattern (frontend) and design keyboard-highlight state |
| Carousels | Auto-advance, hidden content | Pause control; visible dots as buttons; prefer a grid |
| Gestures (swipe, pinch) | Not everyone can | Buttons for the same actions (2.5.1) |
| Modal on page load | Traps and disorients | Avoid; if required (consent), make it the first focused element with a clear action |
| Toast-only confirmations | Missed by screen readers if not announced; disappear | Also update the page state; frontend uses live region; errors persist |
| Disabled submit until valid | No feedback on why | Enabled submit with validation messages |
| Timed content | Fails users who read slowly | User-controlled pacing |
| Click targets that are also drag handles | Ambiguous | Separate handle |
| Content that appears on hover/focus (menus, popovers) | Can be dismissed only by moving the mouse | Dismissible with Escape; hoverable; persistent (1.4.13) |
| Color pickers, sliders | Hard to use precisely | Numeric input alongside |
| Keyboard shortcuts (single key) | Conflict with assistive tech | Require modifier, or allow turning off/remapping (2.1.4) |

## 13. Dark mode, high contrast and forced colors

- Dark mode is not an accessibility feature by itself, but offering both
  modes helps users with light sensitivity (dark) and with low vision or
  astigmatism (light, which many find easier to read). Respect the system
  preference and allow override.
- `prefers-contrast: more`: increase text contrast to 7:1, borders to
  `border-strong`, and remove translucent surfaces.
- `forced-colors: active` (Windows High Contrast): the OS replaces colors
  with its palette. Backgrounds vanish, so anything communicated by
  background alone (selected rows, filled buttons, toggle state) needs a
  border or icon; focus must use `outline`; use CSS system colors
  (`CanvasText`, `LinkText`, `ButtonText`, `Highlight`) for custom
  elements where needed; `forced-color-adjust: none` only for color
  swatches that must keep their color.
- Test with "Emulate CSS media feature forced-colors" in DevTools and with
  a real Windows High Contrast theme when possible.

## 14. Handoff notes for the frontend skill

When handing designs (or your own components) to implementation, state:

- The focus style and where double rings are needed.
- Accessible names for every icon-only control and every unlabeled input.
- Which images are informative (with the alt text) and which decorative.
- Heading levels per section, and the landmark regions.
- Live region needs: what must be announced (toast text, validation
  summary, loading complete, search result count).
- Keyboard behavior for custom components: Escape closes, arrow keys move
  within menus/tabs/listboxes, Enter/Space activate, Home/End in lists;
  roving tabindex for composite widgets.
- Focus management: where focus goes when a dialog opens, when it closes,
  after a delete, after "Load more".
- Reduced-motion variants for each animation.
- Which hover-revealed elements must also be focus-revealed or
  touch-visible.
- Autocomplete tokens for form fields.
- Target sizes where the visual is under 44px and the hit area must be
  extended.
- Form error association (`aria-describedby`), required state, invalid
  state, group labels.
- Any `aria-*` the design implies (`aria-current="page"` on active nav,
  `aria-expanded` on disclosure triggers, `aria-selected` on tabs,
  `aria-pressed` on toggle buttons, `aria-sort` on sortable headers).

The frontend skill owns the correct attribute usage and screen-reader
testing; the design owns having made these decisions.

## 15. Quick audit

Run on every screen before handoff:

1. Tab through: every interactive element reachable, visible focus, logical
   order, nothing non-interactive focused, no traps.
2. Contrast: body text 4.5:1, large text 3:1, borders and focus 3:1
   (script or DevTools).
3. Achromatopsia emulation: everything still understandable.
4. Zoom to 200%: readable, no overlap; 400% (320px): no horizontal scroll.
5. Reduced motion emulation: no movement except essential; nothing broken.
6. Targets: 44px on touch, 24px minimum with spacing on desktop.
7. Labels: every input has one visible; every icon button has a name.
8. Headings: one h1, no skipped levels, every section headed.
9. Images: alt decided; icons hidden; charts have text alternatives.
10. Errors: text + icon + color; adjacent; actionable.
11. Hover-only: nothing essential.
12. Forced colors emulation: states and focus still visible.
