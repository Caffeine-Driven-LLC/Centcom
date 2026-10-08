# Layout and spacing

Spacing scales, grid systems, container widths, optical alignment, density
modes, responsive strategy (content-out breakpoints and container queries),
asymmetric and editorial layouts against centered-everything, and whitespace
as the primary hierarchy tool. With real numbers and CSS.

## Contents

1. Space is hierarchy
2. The spacing scale
3. Proximity and grouping: the gestalt rules that matter
4. Container widths and page gutters
5. Grid systems
6. Vertical rhythm and section spacing
7. Density modes
8. Optical alignment
9. Responsive strategy: content-out breakpoints
10. Container queries
11. Asymmetric and editorial layouts
12. Common layout patterns and their traps
13. Layout primitives worth building once
14. Diagnosing layout problems

## 1. Space is hierarchy

The gap between two things tells the reader how related they are. Space is
therefore the cheapest and most powerful grouping and hierarchy device,
ahead of borders, backgrounds and cards. A screen with correct spacing and
no borders reads cleanly; a screen with borders everywhere and uniform
spacing reads as a spreadsheet.

The failure that defines amateur layout is *uniform spacing*: 16px between
everything, so a label is as far from its input as the input is from the
next field, and a heading floats equidistant from the section above and the
content below. The fix is to make space proportional to relationship:

- Inside a component (icon to label): 4-8px
- Between related elements (label to input, title to description): 8-12px
- Between items in a group (fields in a form, cards in a grid): 16-24px
- Between groups (form sections): 32-48px
- Between page sections: 64-128px

Headings belong to what follows them. Space above a heading should be
1.5-2x the space below it. A heading centered between two blocks belongs to
neither.

## 2. The spacing scale

Pick a base and a scale and use nothing else. The base is 4px for dense or
precise UIs and 8px for airy ones; 4px lets you express 8px too, so 4px is
the universal choice and the decision is which steps to expose.

A workable scale (4px base, named by step number as Tailwind does):

| Token | px | rem | Typical use |
|---|---|---|---|
| 0.5 | 2 | 0.125 | Hairline offsets, icon nudges |
| 1 | 4 | 0.25 | Inline gaps, tight icon padding |
| 1.5 | 6 | 0.375 | Compact badge padding |
| 2 | 8 | 0.5 | Label-to-input, chip gaps, dense cell padding |
| 3 | 12 | 0.75 | Button horizontal padding (sm), list item gaps |
| 4 | 16 | 1 | Default gap, card padding (compact), button padding |
| 5 | 20 | 1.25 | Card padding (comfortable) |
| 6 | 24 | 1.5 | Card padding (default), gutter |
| 8 | 32 | 2 | Group spacing, section padding (compact) |
| 10 | 40 | 2.5 | |
| 12 | 48 | 3 | Section padding (default), page top |
| 16 | 64 | 4 | Section spacing (marketing) |
| 20 | 80 | 5 | |
| 24 | 96 | 6 | Hero padding |
| 32 | 128 | 8 | Large section spacing (marketing) |

Skip steps you do not need and never add 14 or 18 to the system. If a value
seems necessary that is not on the scale, the spacing around it is probably
wrong, not the scale.

Semantic spacing tokens on top of the scale help consistency in big
systems: `--space-inset-sm/md/lg` (padding inside components), `--space-stack-
sm/md/lg` (vertical gaps between stacked items), `--space-inline-sm/md/lg`
(horizontal gaps). Small products do not need this layer.

Tailwind: the default scale *is* this; the discipline is to use only the
steps you have chosen and to never use arbitrary values (`p-[13px]`).
Flutter: define `class Space { static const xs = 4.0; sm = 8.0; md = 16.0;
lg = 24.0; xl = 32.0; xxl = 48.0; }` and use it everywhere.
SwiftUI: `.padding(Space.md)` with the same constants; the default
`.padding()` is 16 on iOS which maps to `md`.

## 3. Proximity and grouping: the gestalt rules that matter

- **Proximity** beats everything. Things close together are read as a
  group. Before adding a border or a background to group items, try
  reducing the gap inside the group and increasing the gap outside it.
- **Alignment** makes groups read as deliberate. A shared left edge is the
  strongest alignment; shared baselines second. Mixed alignments (one card
  centered, one left) read as error.
- **Similarity** groups by appearance. Items that behave the same should
  look the same; the inverse is that items that look the same are expected
  to behave the same, so do not style a link like a button.
- **Common region** (a border or background) is the heaviest grouping tool.
  Use it when proximity alone fails, which is rare, or when the group must
  be visually movable (a card in a kanban).
- **Continuity**: the eye follows lines. A column of left-aligned labels
  creates a line the eye runs down; a ragged column breaks it.

Applied: a settings page does not need a card per section. It needs a
heading, 8px, a description, 24px, the fields with 16px between them, then
48px before the next heading. Add a hairline rule between sections only if
the sections are long.

## 4. Container widths and page gutters

Decide the maximum width of content, not of the page. The page can be any
width; the content column should not grow forever.

| Content type | Max width | Why |
|---|---|---|
| Prose (articles, docs) | 640-720px (65-75ch at 16-18px) | Measure |
| Forms | 480-640px | Fields wider than 480 look empty; long forms read better narrow |
| Marketing sections | 1120-1280px | Enough for 3-4 columns with air |
| App shells (sidebar + content) | content fluid, max 1440-1600px, or unlimited for tables | Dashboards and tables use the width |
| Dialogs | sm 400, md 520, lg 680, xl 880px | Content-dependent |
| Settings pages | 720-880px | Form plus description column |

Page gutters (padding between content and viewport edge) scale with
viewport: 16px below 480px, 24px to 768px, 32px to 1024px, 48-64px above.
Phones need at least 16px; 20px feels better for text-heavy screens. Set it
once as a fluid value: `--gutter: clamp(1rem, 0.5rem + 2.5vw, 4rem)`.

The "container" primitive:

```css
.container {
  width: min(100% - 2 * var(--gutter), var(--container-max, 72rem));
  margin-inline: auto;
}
```

This replaces padding-based containers and never produces horizontal
scroll.

## 5. Grid systems

A grid is a set of columns and gutters content aligns to. Twelve columns is
the web default because 12 divides by 2, 3, 4 and 6. Fewer columns are
fine: 4 on phones, 8 on tablets, 12 on desktop.

Gutters: 16px phones, 24px tablet, 24-32px desktop. Gutters equal to a
spacing step keeps the system coherent.

Modern CSS grid does not need a 12-column framework for most layouts:

```css
/* Responsive card grid without breakpoints */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  gap: var(--space-6);
}

/* Sidebar + content, collapses when sidebar can't fit */
.with-sidebar {
  display: grid;
  grid-template-columns: fit-content(16rem) minmax(0, 1fr);
}
@media (max-width: 48rem) { .with-sidebar { grid-template-columns: 1fr; } }

/* Twelve-column when alignment across rows matters (editorial) */
.editorial {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  column-gap: var(--space-6);
}
.editorial > .text  { grid-column: 2 / span 6; }
.editorial > .aside { grid-column: 9 / span 3; }
```

`minmax(0, 1fr)` matters: `1fr` alone lets long content (tables, code)
blow the column open.

Named grid areas make complex layouts readable:

```css
.app {
  display: grid;
  grid-template:
    "nav    header" auto
    "nav    main"   1fr
    "nav    footer" auto / 15rem minmax(0, 1fr);
  min-height: 100dvh;
}
```

Use `dvh` not `vh` for full-height layouts on mobile so the browser chrome
does not cause overflow.

## 6. Vertical rhythm and section spacing

A page has a rhythm when vertical spaces repeat in a pattern the eye
learns. The two tools:

- A consistent *within-section* stack: heading, 12px, lead, 32px, content.
  Same on every section.
- A *between-section* spacing that is clearly larger and also consistent,
  with deliberate exceptions for a hero or a pause before a conversion
  section.

Marketing pages: section padding 64px on mobile, 96-128px on desktop, with
the hero getting more. Make it fluid: `padding-block: clamp(4rem, 2rem +
8vw, 8rem)`.

App pages: page padding 24-32px, section gaps 32-48px, no more. An app with
marketing-page spacing feels empty.

Avoid identical padding on every section with no variation (the `py-20`
problem). Rhythm needs a beat *and* a rest: alternate section heights,
let one section be a tight band and the next breathe, or let a full-bleed
image break the pattern once.

Baseline grid: if the body line-height is 24px, make all vertical spacing
multiples of 8 (24 = 3 x 8) so text in adjacent columns lands on shared
baselines. Hard to maintain perfectly; the approximation is worth it.

## 7. Density modes

Density is the ratio of content to space. Three named modes cover most
products:

| Mode | Row height | Body size | Cell padding | Card padding | Who |
|---|---|---|---|---|---|
| Compact | 32px | 13px | 6-8px | 12-16px | Power users, ops, trading, dev tools, large tables |
| Comfortable (default) | 40px | 14-15px | 8-12px | 16-24px | Most B2B apps |
| Spacious | 48-56px | 16px | 12-16px | 24-32px | Consumer, mobile, onboarding, first-run |

Pick one for the product, and consider a user toggle only if the audience
spans both (a CRM with admins and occasional users). Implement density as a
token swap, not as separate components:

```css
:root { --density: 1; }
[data-density="compact"] { --density: 0.8; }
[data-density="spacious"] { --density: 1.25; }
.row { min-height: calc(2.5rem * var(--density)); padding-block: calc(0.5rem * var(--density)); }
```

Mobile is always at least Comfortable because touch targets need 44px; a
compact row of 32px needs the touch area extended with padding or
`::before` hit areas.

## 8. Optical alignment

Mathematical centering is often visually off. Correct by eye:

- **Icons next to text**: the icon's optical center is usually above its
  bounding-box center; nudge icons down 1px, or use `align-items: center`
  with the icon sized to the cap height (not the line height).
- **Play triangles, arrows, chevrons**: shift 1-2px toward the point so
  they appear centered in a circle or button.
- **Text in buttons**: fonts have uneven ascender/descender space; a
  button with equal top and bottom padding often looks bottom-heavy. Use
  `line-height: 1` and check; add 1px to the top padding if needed.
- **Rounded shapes vs squares**: a circle the same size as a square looks
  smaller; make circles 5-10% larger to match visual weight.
- **Hanging punctuation and bullets**: let quotes, bullets and list markers
  hang into the margin so the text edge stays flush.
- **Cards with images**: the image's visual mass can make the card look
  top-heavy; add 2-4px extra bottom padding or let the text block have a
  touch more space.
- **Large display type**: side bearings make a left-aligned headline look
  indented by 2-5px compared to body text below. Pull it left with a
  negative margin equal to the bearing (`margin-left: -0.04em`), or accept
  it.

Check alignment on the rendered screenshot, not in the code.

## 9. Responsive strategy: content-out breakpoints

Breakpoints should be where *the content* breaks, not where devices are.
Start at the narrowest width, let the layout be a single column, and widen
until something looks wrong (line too long, too much empty space, a row of
cards that could fit two). Add a breakpoint there.

In practice most layouts settle on three or four: around 480px (phones to
large phones), 768px (one column to two, or sidebar appears), 1024-1100px
(full layout), and sometimes 1440px (max width reached, gutters grow).
Use `rem`-based media queries (`48rem`, `64rem`) so they respect user font
size.

Principles:

- **Mobile-first CSS**: base styles are the narrow layout; media queries
  add complexity. The reverse makes the narrow layout a pile of overrides.
- **Reflow, do not shrink.** Three cards become a column, not three tiny
  cards. Tables become stacked cards or get horizontal scroll with a sticky
  first column; they do not shrink to 9px text.
- **Hide less than you think.** Hidden content on mobile usually means the
  page's hierarchy was wrong on desktop.
- **Navigation changes shape**: sidebar to bottom tab bar or drawer;
  horizontal nav to a menu. Decide where the primary actions go on mobile
  (bottom, within thumb reach).
- **Touch targets grow**: 44px minimum, 48 preferred, 8px gap between them.
- **Typography adjusts**: display sizes shrink (fluid clamp), body stays.
- **Images**: `aspect-ratio` plus `object-fit: cover` and `srcset`. Hero
  images may need a different crop on portrait screens (`<picture>` with
  media queries for art direction).
- **Test at 320px.** It still exists (small phones, split screens, zoomed
  browsers at 400%).

Fluid everything where possible so breakpoints do less work: `clamp()` for
type and space, `auto-fill` grids for cards, `flex-wrap` for toolbars,
`min()` for container widths.

## 10. Container queries

Media queries ask about the viewport; container queries ask about the
component's own box. A card in a sidebar and the same card in the main
column should lay out differently, and only container queries can tell them
apart.

```css
.card-list { container-type: inline-size; container-name: cards; }
.card { display: grid; gap: var(--space-3); }
@container cards (min-width: 32rem) {
  .card { grid-template-columns: 10rem 1fr; }   /* image left, text right */
}
@container cards (min-width: 48rem) {
  .card { grid-template-columns: 14rem 1fr auto; } /* add actions column */
}
```

Container query units (`cqi`, `cqw`) let type and spacing scale with the
container: `font-size: clamp(1rem, 0.8rem + 1cqi, 1.5rem)`.

Use container queries for: cards, widgets, dashboard panels, any component
that appears in different-width slots. Keep media queries for: page-level
layout, navigation shape, gutters.

Tailwind v3.4+ has `@container` and `@md:` variants; v4 has them built in.

## 11. Asymmetric and editorial layouts

Centering everything is the default because it needs no decision. It also
reads as a template, because the eye has nowhere to enter and nothing to
follow. Asymmetry gives the page a reading direction.

Techniques, in increasing boldness:

- **Left-align the hero.** Headline, paragraph and buttons flush left in a
  column of 7/12, with the right 5/12 holding an image, a demo or nothing.
  This alone removes most of the template feeling.
- **Offset columns.** Text in columns 2-7, image in 8-12, with the next
  section mirroring (text 6-11, image 1-5). The alternation creates rhythm.
- **Unequal splits.** 5/7, 4/8, 3/9 instead of 6/6. Give the more important
  element more width, not equal width.
- **Overlap.** An image that crosses the boundary between two sections, or
  a card that overlaps a colored band by 48px. Done with negative margins
  or grid placement with `grid-row: 1 / 3`.
- **Bleed to one edge.** Images or color bands that touch the right edge of
  the viewport while text stays in the container. `margin-right:
  calc(50% - 50vw)` or a full-width grid with the content column in the
  middle:

```css
.bleed-grid {
  display: grid;
  grid-template-columns: [full-start] minmax(var(--gutter), 1fr) [content-start] min(100% - 2*var(--gutter), 72rem) [content-end] minmax(var(--gutter), 1fr) [full-end];
}
.bleed-grid > * { grid-column: content; }
.bleed-grid > .bleed-right { grid-column: content-start / full-end; }
.bleed-grid > .full { grid-column: full; }
```

- **Vertical text or rotated labels** on a column edge (Swiss, Editorial).
- **Stagger.** Cards in a grid where odd columns are offset by 48px
  vertically (`:nth-child(even) { margin-top: 3rem; }`), giving a
  masonry-like life without masonry.
- **One huge element.** A number, a word or an image given 60% of the
  viewport while everything else stays small.

Keep asymmetry *systematic*: the same offset rule throughout, the same
column assignments alternating. Random asymmetry reads as broken. And keep
the body text column disciplined no matter how expressive the layout
around it is.

Where centering is right: single short headlines, a sign-in form, a
success or empty state, a pricing table's header, a logo wall. Centered
blocks of body text over two lines are never right.

## 12. Common layout patterns and their traps

**App shell (sidebar + header + content).** Sidebar 240-280px (collapsible
to 64px icon rail), header 56-64px, content padding 24-32px. Trap: a header
*and* a sidebar *and* a page title bar *and* tabs stack 200px of chrome
above the content. Collapse levels; put the page title in the header or
remove the header.

**Three feature cards.** The most recognizable template pattern. If the
content really is three parallel things, vary the presentation: a 2+1
split, a list with large numerals, alternating image-text rows, a single
wide card with three columns inside. If the content is not parallel, do
not force it into cards.

**Hero with centered text and two buttons.** See landing-pages.md. At
minimum, left-align and give it a real visual on the right.

**Dashboard tile grid.** Equal tiles for unequal information. Make the
most important metric 2x the size, group related tiles, and give charts
room. See data-dense-ui.md.

**Settings page.** Trap: cards per setting. Use a two-column layout
(description left, controls right) or a single column with section headings
and hairline rules.

**Form in a card in a card.** One container, max-width 480-640px, no card
unless the page background demands it.

**Footer with five columns of links.** Fine for big sites; for small
products a single row with four links and a copyright is more honest.

**Sticky things.** Sticky header (good), sticky sidebar (good), sticky CTA
bar (sometimes), sticky cookie banner plus sticky header plus sticky chat
bubble (the content area is now 60% of the screen). Count sticky pixels;
keep under 120px total on desktop and under 15% of viewport on mobile.

## 13. Layout primitives worth building once

Composable layout components keep spacing on the scale and out of page
code. Whatever the framework, these six cover most needs:

- **Stack**: vertical flow with a gap token. `display: flex; flex-direction:
  column; gap: var(--space-4)`.
- **Inline / Cluster**: horizontal wrap with gap, alignment options.
- **Container**: as in section 4.
- **Grid**: auto-fill responsive grid with a min column width.
- **Sidebar**: the two-column collapse pattern.
- **Center**: a max-width centered column for prose with `text-align`
  left.

Plus a **Spacer** only for rare cases (prefer gap). In React these are
`<Stack gap={4}>`; in Flutter `Column` with `spacing:` (3.27+) or a `Gap`
widget; in SwiftUI `VStack(spacing: Space.md)`.

The point is that page code never writes `margin-bottom: 17px`; it picks a
primitive and a token.

## 14. Diagnosing layout problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Page looks like a template | Everything centered, equal columns, uniform section padding | Left-align hero; unequal splits; vary section rhythm |
| Hard to tell what goes together | Uniform spacing | Tighten within groups, loosen between |
| Feels cramped despite padding | Padding equal to gap; no breathing at section level | Section gaps 2-3x internal gaps |
| Feels empty / unfinished | Marketing spacing in an app; max-width too narrow for the content | App spacing scale; let tables use width |
| Horizontal scroll on mobile | Fixed widths, `100vw` with padding, long unbroken strings, images without max-width | `min()` containers; `overflow-wrap`; `max-width: 100%` on media |
| Elements misaligned by a few px | Mixed padding and margin; optical vs mathematical | Audit with an overlay grid; use gap; nudge by eye |
| Card grid has orphan card | Fixed column count | `auto-fill` grid, or design the last row (2+1 feature) |
| Header eats the screen | Stacked chrome | Merge header and title bar; collapse on scroll |
| Text column too wide | No max-width on text | `max-width: 65ch` |
| Too many borders | Common region used where proximity would do | Remove borders; fix spacing; keep one rule where needed |
| Layout jumps on load | Images without dimensions; fonts without fallbacks | `aspect-ratio`, `width/height` attributes, size-adjusted fallback fonts |
| Looks fine at 1440, wrong at 1024 | Breakpoints from devices not content | Find where it breaks; add a breakpoint there; prefer fluid |
