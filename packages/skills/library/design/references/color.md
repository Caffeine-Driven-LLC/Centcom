# Color

How to build a palette from one or two anchors, think in OKLCH, layer tokens
from primitive to semantic to component, do the contrast math, build dark
mode as its own palette rather than an inversion, keep accent discipline,
design state colors, and hand data colors to the dataviz skill. Ends with the
mistakes that make palettes look amateur.

## Contents

1. Color's jobs in a UI
2. Thinking in OKLCH
3. Building a neutral ramp
4. Building the accent and its ramp
5. Semantic (state) colors
6. Token layering: primitive, semantic, component
7. Contrast math and targets
8. Dark mode as its own palette
9. Accent discipline
10. Surfaces, elevation and borders
11. Tinted neutrals and temperature
12. Handoff to dataviz
13. Platform notes
14. Worked example: a full palette
15. Common mistakes

## 1. Color's jobs in a UI

Color does five things, in priority order:

1. **Separates surfaces** (page from card from overlay) so structure reads
   without borders.
2. **Signals interactivity** (this is a button, a link, a selected row).
3. **Carries state** (success, warning, danger, info, disabled).
4. **Guides attention** (the one thing to look at).
5. **Expresses brand** (the feeling).

Most amateur palettes start at 5 and never get to 1-3, which is why they
look pretty in a swatch and fall apart on a screen with forty elements.
Build neutrals first (they do jobs 1 and most of 2), then one accent (jobs 2
and 4), then semantics (job 3), then check that the brand feeling (job 5)
emerges from the whole. If the brand is a specific mandated color, it
becomes the accent and the neutrals are tinted toward it.

Proportion rule: neutrals cover about 90% of pixels, accent under 5%,
semantics appear only when their state occurs. A screen that is 30% brand
color is a poster, not a UI.

## 2. Thinking in OKLCH

OKLCH expresses color as Lightness (0-1), Chroma (0 to about 0.4), Hue
(0-360). Its advantage over HSL: equal steps in L look equally different to
the eye, and changing hue at fixed L and C keeps colors looking equally
bright. In HSL, yellow at 50% lightness is blinding and blue at 50% is
dark; in OKLCH, 0.7 lightness is 0.7 lightness in every hue.

Practical consequences:

- Build ramps by stepping L at fixed H and (roughly) fixed C. The result is
  perceptually even, which is what makes a palette look professional.
- Build a set of accent hues (for categories, tags, avatars) at the same L
  and C. They will look like a family. This is how to get "candy" palettes
  that do not look like a clown.
- Shift hue slightly along a ramp (lighter tints go slightly toward yellow,
  darker shades slightly toward blue) to mimic how pigments behave; this
  reads as richer than a straight ramp. 5-15 degrees across the ramp.
- Chroma is not available everywhere: at very high and very low L, the
  gamut collapses, so a C of 0.2 at L 0.95 is impossible and the browser
  clips it. Keep tints at C 0.02-0.06 and shades at C 0.05-0.1.

Browser support for `oklch()` is universal in current browsers. Where a
build targets old browsers, author in OKLCH and compile to hex with
PostCSS (`postcss-preset-env` or `@csstools/postcss-oklab-function`). The
token values below give both.

Rough hue map: red 25, orange 55, yellow 95, lime 125, green 150, teal 180,
cyan 210, azure 240-250, blue 260-265, indigo 275, violet 300, magenta
330, pink 350. Note that OKLCH hue 250 is a cyan-leaning blue; the
"classic" UI blue sits near 262.

A stdlib converter for checking values is a few lines: OKLCH to OKLab
(`a = C cos h`, `b = C sin h`), OKLab to linear sRGB via the published
matrices, then gamma-encode. Use it to produce the hex fallbacks quoted in
tokens rather than guessing; the hexes in this file were produced that way.

## 3. Building a neutral ramp

Neutrals are the palette. Decide three things:

**Temperature.** Pure grey (C 0) reads as cold and mechanical and is right
for Industrial and Monochrome directions. Most products want a tint:
C 0.005-0.015 at a hue. Cool (hue 240-270) for technical and corporate;
warm (hue 60-90) for craft, editorial, hospitality; green-grey (hue 160)
for finance and health occasionally. The tint should be nearly invisible
in a swatch and clearly felt on a full screen.

**Range.** Light mode needs: page background, surface, raised surface, two
or three border strengths, four text strengths. Twelve steps is a
comfortable ramp; nine is enough for small products.

**Endpoints.** Avoid pure white page backgrounds except in Monochrome and
Swiss directions; L 0.98-0.99 is softer. Avoid pure black text; L 0.15-0.25
is "ink". Luxury and Monochrome directions may use true black as a material.

A twelve-step cool neutral ramp (hue 250, C 0.01 shifting to 0.02 at the dark
end):

| Step | OKLCH | Hex | Light-mode role |
|---|---|---|---|
| 50 | 0.99 0.003 250 | #FAFCFE | Page background (alt) |
| 100 | 0.975 0.005 250 | #F4F7FA | Page background |
| 200 | 0.95 0.008 250 | #EBEFF4 | Subtle fill, hover on surface |
| 300 | 0.91 0.01 250 | #DCE2E8 | Border default |
| 400 | 0.84 0.012 250 | #C5CBD2 | Border strong, disabled text bg |
| 500 | 0.72 0.015 250 | #9EA6AE | Placeholder, disabled text |
| 600 | 0.6 0.018 250 | #78818B | Icon muted, large muted text |
| 700 | 0.5 0.02 250 | #5B646F | Text secondary / muted body text |
| 800 | 0.38 0.02 250 | #3B434D | Text primary (soft) |
| 900 | 0.28 0.02 250 | #212A33 | Text primary |
| 950 | 0.2 0.02 250 | #0F171F | Headings, near-black |
| 1000 | 0.14 0.015 250 | #050A0F | True-dark base (rarely used directly) |

Contrast check (white #FFF background, via `scripts/contrast.py`): 700 is
6.0:1 (body text passes AA), 600 is 3.95:1 (large text and icons only; it
just misses 4.5:1 so it is not a body-text muted color), 500 is 2.6:1
(decorative or placeholder, never for information). This is why "muted"
body text should map to 700, not 600, on a white surface.

## 4. Building the accent and its ramp

Pick the accent hue from the direction or the brand. Then set its *main*
value so that white text on it passes 4.5:1: in OKLCH that means L around
0.5-0.58 for most hues (blue L 0.55 C 0.17 hue 262 = #366BD3, 5.0:1; green
L 0.52 C 0.14 hue 150 = #0A7E3A, 5.7:1; red L 0.55 C 0.19 hue 25 = #C92F33,
6.0:1; violet L 0.5 C 0.2 hue 300 = #773AC1). Yellow and orange cannot
carry white text at any usable L; use dark text on them.

The accent ramp needs fewer steps than the neutral ramp. Typical set:

| Token | OKLCH | Use |
|---|---|---|
| accent-50 | L 0.97 C 0.02 | Subtle background for selected rows, info banners |
| accent-100 | L 0.93 C 0.05 | Hover on subtle backgrounds, badges |
| accent-300 | L 0.8 C 0.1 | Borders of focused inputs (light), chart tints |
| accent-500 (main) | L 0.55 C 0.17 | Primary buttons, links, active indicators |
| accent-600 | L 0.48 C 0.17 | Primary hover |
| accent-700 | L 0.42 C 0.16 | Primary active, link visited (optional) |
| accent-900 | L 0.28 C 0.08 | Text on accent-50 backgrounds |

Hover is one step darker in light mode (and one step *lighter* in dark
mode). Active is two steps. Do not reach for opacity to make hover states;
it produces muddy results on colored backgrounds.

Two accents: allowed when they have clearly separate jobs (one for
interactive, one for brand expression in illustrations and marketing) or
when the direction is Playful or Kinetic. Keep them at the same L and C so
they feel like a pair, and pick hues 120-180 degrees apart for contrast or
30-60 apart for harmony.

## 5. Semantic (state) colors

Success, warning, danger, info. Rules:

- Keep conventional hues (green, amber, red, blue) because they carry
  learned meaning. A product that uses purple for errors is fighting
  decades of habit.
- Match their L and C to the accent so they belong to the family. Scientific
  and Corporate directions desaturate them (C 0.12-0.15); Playful raises
  them (C 0.18-0.2).
- If the accent is blue, info and accent collide. Either make info a
  neutral treatment (grey background, icon only) or shift info toward cyan
  (hue 210) and accent toward indigo (hue 265).
- If the accent is red (common in brands), danger must still be red. Make
  danger slightly more orange (hue 30) and more saturated than the brand
  red, or reserve the brand red for marketing and use a neutral accent in
  the app.
- Each semantic needs four values: `fg` (text/icon on light surface, L
  0.45-0.5 for 4.5:1), `bg` (L 0.95-0.97 C 0.03-0.05), `border` (L 0.8
  C 0.08), and `solid` (L 0.55 for filled badges and destructive buttons).
- Yellow/amber warning text on white never passes contrast. Use a dark
  amber text (L 0.45 C 0.12 hue 70 ≈ #8A5B00) on the pale amber background,
  with an icon.
- Never let semantic colors appear decoratively. Red is for danger and
  destructive actions only; if a brand wants red everywhere, pick a
  different accent for the app.

## 6. Token layering: primitive, semantic, component

Three tiers, each referencing the one below. This is what makes theming and
dark mode possible without touching components.

**Primitive**: the raw ramps. Named by hue and step. Never used directly in
components.

```css
:root {
  --gray-100: oklch(0.975 0.005 250);
  --gray-300: oklch(0.91 0.01 250);
  --gray-700: oklch(0.5 0.02 250);
  --gray-900: oklch(0.28 0.02 250);
  --blue-500: oklch(0.55 0.17 250);
  --blue-600: oklch(0.48 0.17 250);
  --red-500:  oklch(0.55 0.19 25);
  /* ... */
}
```

**Semantic**: named by role. This is what components use. Light mode:

```css
:root {
  --color-bg-page: var(--gray-100);
  --color-bg-surface: #fff;
  --color-bg-raised: #fff;
  --color-bg-subtle: var(--gray-200);
  --color-bg-inverse: var(--gray-950);

  --color-text-primary: var(--gray-900);
  --color-text-secondary: var(--gray-700);
  --color-text-muted: var(--gray-600);
  --color-text-disabled: var(--gray-500);
  --color-text-inverse: #fff;
  --color-text-link: var(--blue-600);

  --color-border-default: var(--gray-300);
  --color-border-strong: var(--gray-400);
  --color-border-subtle: var(--gray-200);

  --color-accent: var(--blue-500);
  --color-accent-hover: var(--blue-600);
  --color-accent-active: var(--blue-700);
  --color-accent-subtle: var(--blue-50);
  --color-accent-fg: #fff;

  --color-danger: var(--red-500);
  --color-danger-fg: var(--red-700);
  --color-danger-bg: var(--red-50);
  --color-danger-border: var(--red-300);
  /* success, warning, info likewise */

  --color-focus-ring: var(--blue-500);
}
```

**Component**: only when a component needs a value that is not simply a
semantic token, or needs to be themed independently (a sidebar that is
always dark, a marketing hero).

```css
.sidebar {
  --sidebar-bg: var(--color-bg-inverse);
  --sidebar-text: var(--color-text-inverse);
}
```

Naming: `--color-{property}-{role}-{state?}`. Property is `bg`, `text`,
`border`, `icon`, `ring`. Role is `page/surface/raised/subtle/inverse` for
backgrounds, `primary/secondary/muted/disabled/inverse/link` for text,
`default/strong/subtle` for borders, plus `accent` and the semantics.
State suffix is `-hover`, `-active`, `-selected`. Match whatever the repo
already uses before inventing this.

Tailwind: put primitives in `theme.extend.colors` and semantics as CSS
variables consumed through `colors: { bg: { page: 'var(--color-bg-page)' } }`,
or in Tailwind v4 define them in `@theme`. shadcn/ui ships exactly this
pattern (`--background`, `--foreground`, `--muted`, `--primary`); extend
its variables rather than parallel ones.

## 7. Contrast math and targets

WCAG contrast ratio = (L1 + 0.05) / (L2 + 0.05), where L is relative
luminance of the lighter and darker color. `scripts/contrast.py` computes
it. Targets:

| Content | Minimum (AA) | Enhanced (AAA) |
|---|---|---|
| Body text (under 24px regular / 19px bold) | 4.5:1 | 7:1 |
| Large text (24px+ regular, 19px+ bold) | 3:1 | 4.5:1 |
| UI component boundaries (input borders, toggle tracks) | 3:1 | — |
| Focus indicators against adjacent colors | 3:1 | — |
| Icons that carry meaning | 3:1 | — |
| Placeholder text | 4.5:1 if it is the only label (it should not be) | — |
| Disabled controls | exempt, but keep around 3:1 so they are findable | — |
| Decorative elements | exempt | — |

Rules of thumb in OKLCH (approximate, verify with the script):

- Text on white needs L ≤ 0.56 for 4.5:1 (#767676 is the lightest pure grey that passes; less for high-chroma hues). L 0.6 lands at about 3.95:1, which is why many "muted" greys fail.
- Text on near-black (L 0.15) needs L ≥ 0.7.
- White text on a colored button needs the button at L ≤ 0.58.
- Dark text (L 0.2) on a colored button needs the button at L ≥ 0.7.
- Two greys 0.3 apart in L usually clear 3:1; 0.45 apart clear 4.5:1.

APCA (the newer algorithm in WCAG 3 drafts) models perception better,
especially for dark mode and thin fonts; it gives Lc values where 60+ is
body text and 75+ is preferred. If the repo or user cares, check both;
when they disagree, trust APCA for dark mode and thin weights, and WCAG
for compliance.

Check contrast against the *actual* background the text sits on,
including translucent surfaces (check against the busiest backdrop),
gradients (check the lightest and darkest point), and images (add an
overlay or a solid panel; never rely on the photo being dark).

## 8. Dark mode as its own palette

Inverting the light palette produces: blinding white text, glowing
saturated accents, light shadows, and borders that disappear. Dark mode is
a separate palette with the same semantic names.

Principles:

- **Background is not black.** L 0.14-0.2 (#0D0F14 to #1A1D24) with the
  neutral tint. True black (#000) only for OLED-first media apps and
  Retro terminal.
- **Surfaces get lighter as they rise**, the opposite of light mode where
  shadows do the work. Page L 0.15, surface L 0.19, raised L 0.23, overlay
  L 0.27. Elevation = lightness. Shadows are nearly useless on dark; use
  them only on overlays and tint them to black at higher alpha.
- **Borders brighten slightly**: a 1px border at L 0.28-0.32 (or white at
  8-12% alpha) defines edges that lightness alone cannot.
- **Text is off-white**: primary L 0.93 (#E8EAEE), secondary L 0.75,
  muted L 0.62. Pure white text on dark vibrates. Reduce weight by 20-50
  if using a variable font.
- **Accents desaturate and lighten**: light-mode accent L 0.55 C 0.17
  becomes L 0.7 C 0.14 in dark mode, so it does not glow and dark text
  (L 0.15) on it passes 4.5:1. Hover gets *lighter* (L 0.76), not darker.
- **Semantic colors follow the same shift**: desaturate 20%, lighten to L
  0.7-0.75 for text-on-dark, and make their `bg` variants very dark tints
  (L 0.22 C 0.04) rather than pastels.
- **Images and illustrations** may need a slight dim (`filter:
  brightness(0.9)`) or a dark variant. Logos need a dark-mode asset.
- **Code blocks and inputs**: in dark mode an input is slightly *lighter*
  than its surface (or has a visible border), the reverse of light mode.

Implementation shape:

```css
:root { color-scheme: light; /* light tokens */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; /* dark tokens */ }
}
:root[data-theme="dark"] { color-scheme: dark; /* dark tokens */ }
```

`color-scheme: dark` makes scrollbars, form controls and the UA defaults
match. Store the user's explicit choice; default to the system. Test with
real content, especially tables and charts, and keep a toggle in dev.

A dark neutral ramp for the same hue 250 (not an inversion of the light
one; lighter steps are closer together because the eye distinguishes
dark tones less well):

| Role | OKLCH | Hex |
|---|---|---|
| bg-page | 0.18 0.012 250 | #0E1217 |
| bg-surface | 0.22 0.012 250 | #161B20 |
| bg-raised | 0.26 0.012 250 | #20252A |
| bg-overlay | 0.30 0.012 250 | #292E34 |
| border-subtle | 0.29 0.012 250 | #272C31 |
| border-default | 0.34 0.012 250 | #33393E |
| border-strong | 0.43 0.012 250 | #4B5056 |
| text-muted | 0.62 0.015 250 | #80878F |
| text-secondary | 0.75 0.012 250 | #A8AFB5 |
| text-primary | 0.93 0.005 250 | #E5E8EB |
| accent | 0.7 0.14 250 | #53A3F2 |
| accent-hover | 0.76 0.13 250 | #6DB6FF |

Checked: text-primary on bg-page 14.3:1, text-secondary 7.9:1, text-muted
4.8:1 (passes body text on dark, which is why muted can sit at L 0.62 here
but not in light mode). Dark text (L 0.18) on the accent is 6.7:1.

## 9. Accent discipline

The accent means "you can act here" or "look here." Every extra use
weakens it. Audit where the accent appears on a screen; it should be:

- Primary action (one per view, or one per clearly separated region)
- Links in running text
- Selected/active state indicators (tab underline, selected nav item)
- Focus ring (or a dedicated focus color)
- Progress and completion
- Possibly: brand mark

It should *not* be:

- Every icon
- Heading text (unless the direction is Swiss/Kinetic and that is the
  signature)
- Section backgrounds (use neutral tints)
- Both the primary and the secondary button (secondary is neutral)
- Chart data (data gets its own palette; see dataviz)
- Info banners *and* buttons *and* badges on the same screen

When the brand mandates a color that fails contrast as a button (a bright
yellow, a light teal), use it as the brand expression (illustrations, hero
background, marketing) and derive a darker working accent from its hue for
interactive elements. Say so in the direction spec.

## 10. Surfaces, elevation and borders

Three ways to separate a surface from its background: tone (lighter or
darker fill), border, shadow. Pick a primary method per direction and use
the others sparingly.

| Direction | Primary separation | Secondary | Never |
|---|---|---|---|
| Industrial, Scientific, Monochrome | 1px border | Tone | Shadow on cards |
| Corporate calm | Tone + 1px border | Soft shadow on raised | Heavy shadows |
| Soft organic | Tone | Soft tinted shadow | Hard borders |
| Editorial, Luxury | Space alone | Hairline rule | Shadow, tone |
| Glassy | Translucent fill + 1px alpha border | Large soft shadow | Opaque borders |
| Playful | Border 2px + hard offset shadow | Tone | Soft shadows |

Shadow recipes that do not look like Tailwind's default:

```css
/* Soft, layered, light mode; tinted with the neutral hue */
--shadow-sm: 0 1px 2px oklch(0.2 0.02 250 / 0.06), 0 1px 1px oklch(0.2 0.02 250 / 0.04);
--shadow-md: 0 2px 4px oklch(0.2 0.02 250 / 0.06), 0 8px 16px -4px oklch(0.2 0.02 250 / 0.08);
--shadow-lg: 0 4px 8px oklch(0.2 0.02 250 / 0.06), 0 24px 48px -12px oklch(0.2 0.02 250 / 0.14);
/* Dark mode: deeper, less spread; rely on surface lightness for most elevation */
--shadow-md-dark: 0 2px 4px rgb(0 0 0 / 0.4), 0 8px 16px -4px rgb(0 0 0 / 0.5);
/* Hard offset (Playful/Brutalist) */
--shadow-hard: 4px 4px 0 var(--color-text-primary);
/* Inner edge highlight for glass */
--shadow-glass: inset 0 1px 0 rgb(255 255 255 / 0.25), 0 8px 32px rgb(0 0 0 / 0.12);
```

Elevation levels: 0 (page), 1 (card, inline surface), 2 (sticky header,
dropdown), 3 (popover, tooltip), 4 (dialog, drawer). Each level gets one
treatment; do not invent a shadow per component.

Borders: use `currentColor` or the ink color at alpha (`oklch(0.2 0.02 250 /
0.12)`) when borders need to sit on varying backgrounds; use the solid
neutral step when the background is known. 1px always; 2px only for Playful
and Brutalist or for focus/selected states. `0.5px` hairlines render
inconsistently; achieve hairlines with 1px at lower alpha.

## 11. Tinted neutrals and temperature

The temperature of neutrals changes the whole feeling at almost no cost:

- Hue 250-270 (cool blue-grey): technical, calm, corporate. Default for
  Scientific, Industrial, Corporate.
- Hue 60-90 (warm): hospitable, crafted, editorial. Paper tones.
- Hue 160-180 (green-grey): fresh, financial, medical. Rare; distinctive.
- Hue 320-340 (mauve-grey): fashion, beauty. Rare.
- C 0 (true grey): stark, mechanical. Monochrome, Swiss, Brutalist.

Keep the tint consistent across the ramp (same hue every step) and across
light and dark modes. A warm light mode with a cool dark mode feels like
two products.

Mixing a brand hue into the neutrals (C 0.01 at the brand hue) is the
cheapest way to make a palette feel owned rather than stock.

## 12. Handoff to dataviz

Charts need their own categorical, sequential and diverging palettes, and
the `dataviz` skill owns those. What this skill decides:

- Chart colors are *not* the UI accent. If the accent is blue, the first
  series color should not be the same blue, or users cannot tell a chart
  mark from a button. Pick a categorical palette whose first color is
  adjacent (teal, indigo) or make the accent neutral in data-heavy screens.
- Chart neutrals (axes, gridlines, labels) come from the UI neutral ramp:
  gridlines at `border-subtle`, axis labels at `text-muted`.
- Semantic meanings in charts (red = down/bad, green = up/good) must use
  the UI semantic colors, so a red number in a table and a red bar in a
  chart agree.
- Provide dark-mode variants of the data palette (lighter, slightly
  desaturated) alongside the UI dark palette.

Pass these constraints to the dataviz skill; let it choose the actual
series hues.

## 13. Platform notes

- **iOS**: use semantic system colors (`.label`, `.secondaryLabel`,
  `.systemBackground`, `.secondarySystemBackground`) as the neutral layer;
  they adapt to dark mode and accessibility settings automatically. Brand
  the accent (`tintColor` / `.accentColor`). Elevated dark backgrounds are
  a system concept (`secondarySystemBackground` lightens in dark mode).
- **Android / Material 3**: generate a tonal palette from the seed color
  with the Material color utilities; it produces the full semantic set
  (`primary`, `onPrimary`, `primaryContainer`, `surface`, `surfaceVariant`,
  `outline`...). Override the neutrals' chroma if the generated tint is
  too strong. Dynamic color (user wallpaper) is optional; decide whether
  brand or personalization wins.
- **Flutter**: `ColorScheme.fromSeed` gives M3 tonal palettes; set
  `brightness` for dark. Use `Theme.of(context).colorScheme.surface`, not
  `Colors.white`.
- **Web**: `color-scheme`, `prefers-color-scheme`, `prefers-contrast:
  more` (raise border and text contrast), `forced-colors: active` (Windows
  High Contrast; use system color keywords for borders and ensure focus is
  visible with outline, not box-shadow).

## 14. Worked example: a full palette

Direction: Warm craft. Brand accent: terracotta.

```css
:root {
  color-scheme: light;
  /* primitives (warm, hue 70) */
  --sand-50:  oklch(0.985 0.008 80);  /* #FDFAF4 */
  --sand-100: oklch(0.965 0.012 80);  /* #F8F3EB */
  --sand-200: oklch(0.93 0.015 80);   /* #EDE7DD */
  --sand-300: oklch(0.88 0.018 75);   /* #DFD6CB */
  --sand-500: oklch(0.65 0.02 70);    /* #978D82  placeholders, disabled */
  --sand-600: oklch(0.55 0.02 70);    /* #797065  muted text (4.4:1 on sand-100; use for 14px+ 600 or large) */
  --sand-700: oklch(0.45 0.02 60);    /* #5E534A  secondary text, 6.8:1 */
  --sand-900: oklch(0.27 0.015 50);   /* #2D2420  primary text, 13.7:1 */
  --clay-100: oklch(0.94 0.04 45);    /* #FFE4D6 */
  --clay-500: oklch(0.55 0.14 40);    /* #B34F2A  sand-50 on it: 4.95:1 */
  --clay-600: oklch(0.48 0.14 40);    /* #9C3A11 */
  --moss-600: oklch(0.5 0.1 150);     /* #337344 success fg, 5.7:1 on white */
  --moss-100: oklch(0.95 0.03 150);
  --ember-600: oklch(0.52 0.17 28);   /* #B6322B danger fg, 6.0:1 on white */
  --ember-100: oklch(0.95 0.03 28);
  --honey-700: oklch(0.45 0.11 75);   /* #784A00 warning fg, 7.6:1 on white */
  --honey-100: oklch(0.96 0.04 85);

  /* semantic */
  --color-bg-page: var(--sand-100);
  --color-bg-surface: var(--sand-50);
  --color-bg-subtle: var(--sand-200);
  --color-text-primary: var(--sand-900);
  --color-text-secondary: var(--sand-700);
  --color-text-muted: var(--sand-700);      /* warm paper lowers contrast; muted body text needs 700 here */
  --color-text-placeholder: var(--sand-500);
  --color-border-default: oklch(0.27 0.015 50 / 0.14);
  --color-border-strong: oklch(0.27 0.015 50 / 0.28);
  --color-accent: var(--clay-500);
  --color-accent-hover: var(--clay-600);
  --color-accent-subtle: var(--clay-100);
  --color-accent-fg: var(--sand-50);
  --color-success-fg: var(--moss-600);  --color-success-bg: var(--moss-100);
  --color-danger-fg: var(--ember-600);  --color-danger-bg: var(--ember-100);
  --color-warning-fg: var(--honey-700); --color-warning-bg: var(--honey-100);
  --color-focus-ring: var(--clay-500);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --color-bg-page: oklch(0.18 0.012 60);
    --color-bg-surface: oklch(0.22 0.012 60);
    --color-bg-subtle: oklch(0.26 0.012 60);
    --color-text-primary: oklch(0.93 0.01 80);
    --color-text-secondary: oklch(0.76 0.012 75);
    --color-text-muted: oklch(0.62 0.015 70);
    --color-border-default: oklch(0.95 0.01 80 / 0.12);
    --color-border-strong: oklch(0.95 0.01 80 / 0.24);
    --color-accent: oklch(0.72 0.12 45);
    --color-accent-hover: oklch(0.78 0.11 45);
    --color-accent-subtle: oklch(0.28 0.05 45);
    --color-accent-fg: oklch(0.18 0.012 60);
    --color-success-fg: oklch(0.75 0.1 150); --color-success-bg: oklch(0.25 0.04 150);
    --color-danger-fg: oklch(0.75 0.13 28);  --color-danger-bg: oklch(0.26 0.05 28);
    --color-warning-fg: oklch(0.8 0.11 80);  --color-warning-bg: oklch(0.27 0.05 80);
  }
}
```

Verified pairs (`scripts/contrast.py`): sand-900 on sand-100 is 13.7:1;
sand-700 on sand-100 is 6.8:1; sand-600 on sand-100 is 4.4:1 (just under
AA for body text, fine for 600-weight labels and large text, which is why
muted body text maps to 700 on this warm paper); sand-500 on sand-100 is
2.8:1 (placeholder and disabled only); sand-50 on clay-500 is 4.95:1; dark
text-primary (#EBE7E1) on dark bg-page (#16100C) is 15.3:1; dark accent-fg
on the dark accent (#E28B63) is 7.3:1.

The lesson in these numbers: a warm paper background costs about 0.5 of
contrast ratio versus pure white at every step, so a palette that was
tuned on white needs its muted text one step darker when moved to paper.

## 15. Common mistakes

| Mistake | Why it looks wrong | Fix |
|---|---|---|
| Palette built from a gradient | Gradients are decoration; they do none of color's five jobs | Build neutrals and one accent; use the gradient once if the direction allows |
| Pure #000 text on pure #FFF | Harsh; vibrates on screens | Ink L 0.2-0.28, paper L 0.97-0.99 (unless Monochrome by choice) |
| Accent on everything | Nothing stands out | Audit uses; neutral secondary buttons; neutral icons |
| HSL ramps | Yellows blind, blues muddy, steps uneven | Build in OKLCH |
| Grey text that fails contrast | "Subtle" became unreadable | Muted text at L ≤ 0.56 on white (#767676 or darker); check with the script |
| Dark mode by inversion | Glowing accents, light shadows, vanished borders | Separate palette; lightness as elevation; desaturated accents |
| Saturated semantics on a muted palette | Alerts look like they came from another app | Match semantic C to accent C |
| Blue accent + blue info + blue links + blue charts | Four meanings, one color | Separate roles by hue or by treatment |
| Borders and shadows and tints all at once | Visual noise; nothing reads as "surface" | Pick one primary separation method per direction |
| Opacity for hover states | Muddy on colored backgrounds | Step the ramp instead |
| Brand color forced to be the button | Fails contrast or looks garish | Brand for expression; derived shade for interaction |
| Pastel text | Always fails contrast | Pastels are backgrounds; text is dark |
| No tint on neutrals | Palette feels stock | C 0.005-0.015 at the brand hue |
