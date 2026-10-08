# Typography

Type carries more of a product's personality than any other single
decision, and more of its usability than anything but layout. This file
covers scale math (modular and fluid), pairing logic, loading, variable
fonts, measure, leading, tracking, numerals, and specific non-generic font
recommendations by direction, with the mistakes that mark amateur type.

## Contents

1. What type decides
2. Choosing families: the pairing logic
3. Font recommendations by direction (free and paid)
4. What to avoid and why
5. Type scale math: modular scales
6. Fluid type with clamp()
7. Line length (measure)
8. Leading (line-height)
9. Tracking (letter-spacing)
10. Weight and hierarchy
11. Numerals, figures and OpenType features
12. Variable fonts
13. Loading strategy
14. Platform notes (iOS, Android, Flutter, system stacks)
15. Setting a complete type system: worked example
16. Diagnosing bad type

## 1. What type decides

Before any color or layout exists, type decides whether a product feels
serious or friendly, dense or airy, technical or literary, expensive or
cheap. It also decides whether people can read it at the end of a long day.
A product with good type and a grey palette looks designed; a product with
default type and a beautiful palette looks like a template with a theme.

Three questions decide most of it:

- How much text, and how long are people reading? Long reading wants a
  text face with generous x-height and open apertures at 16-19px with real
  leading. Short labels in a dense UI want a compact, neutral sans at
  13-14px that stays crisp.
- What does the direction need the display sizes to say? Display type (24px
  and up) is where personality lives; body type is where legibility lives.
  They can be the same family or deliberately different.
- Are there numbers? If the product shows numbers in columns, tabular
  figures are not optional, and the family must have them.

## 2. Choosing families: the pairing logic

One family is the safest, strongest default when the family has range (a
wide weight axis, optical sizes, or display and text cuts). Two families
work when they are clearly different in construction and share something in
proportion. Three is almost never right outside of a mono for code.

Pairing rules that reliably work:

- **Contrast of construction, harmony of proportion.** Serif display + sans
  body works when both have similar x-heights and widths (Fraunces + Source
  Sans 3; Newsreader + Work Sans; Source Serif 4 + Source Sans 3, which were
  designed together). Two sans that are both "neutral grotesques" do not
  pair; they merely look like a mistake.
- **Same superfamily.** IBM Plex Sans + Plex Mono + Plex Serif. Source Sans
  + Source Serif + Source Code. Roboto + Roboto Mono + Roboto Serif. Noto.
  Geist + Geist Mono. These are designed to sit together and remove the
  pairing risk entirely.
- **One voice, one worker.** The display face has personality and appears
  in large sizes only; the body face is quiet and does all the small work.
  Do not let the display face do UI labels at 13px; display faces are
  rarely tuned for that.
- **Mono for data, not for mood.** A monospace face earns its place when
  content is code, IDs, hashes, timestamps, or columnar numbers. Used as a
  "techy" label font on a product with no technical content, it is a tell.

Test a pairing by setting a real heading, a real paragraph, a real caption
and a real button label together. If the pair looks like two products, it
fails.

## 3. Font recommendations by direction

Free fonts are from Google Fonts or open licenses unless noted. "Paid" lists
foundry faces worth recommending when the user has budget. Avoid
recommending Inter, Roboto, Open Sans, Lato, Montserrat or Poppins as a
reflex; each is listed below only where its neutrality is the point.

| Direction | Display | Body / UI | Mono (if needed) | Paid alternatives |
|---|---|---|---|---|
| Editorial | Fraunces, Newsreader, Playfair Display, Source Serif 4, Literata | Source Sans 3, Work Sans, Albert Sans | Source Code Pro | GT Sectra, Tiempos, Freight Text, Canela |
| Swiss / grid | Archivo, Schibsted Grotesk, Instrument Sans, Space Grotesk | same family | Space Mono | Neue Haas Grotesk, Söhne, Unica77, Akzidenz-Grotesk |
| Brutalist | Archivo Black, Anybody, Big Shoulders Display, Bricolage Grotesque, or Arial/Times used huge | Space Mono, JetBrains Mono, or Arial | Courier Prime | Druk, Monument Extended, Favorit |
| Soft organic | Outfit, Figtree, Plus Jakarta Sans, Nunito (display only) | DM Sans, Figtree, Nunito Sans | — | Circular, GT Walsheim, Sofia Pro |
| Industrial | IBM Plex Sans, Public Sans, Geist | same; Atkinson Hyperlegible for max legibility | IBM Plex Mono, JetBrains Mono | Berkeley Mono, Söhne Mono, Untitled Sans |
| Luxury minimal | Cormorant Garamond, Bodoni Moda, Jost (light) | Jost, Josefin Sans, or the same serif at text size | — | Canela, Ogg, Reckless, Futura, Suisse Int'l |
| Playful | Fredoka, Baloo 2, Rubik 800, Gloock, Bricolage Grotesque 800 | Nunito Sans, Rubik 400, DM Sans | — | Recoleta, Cooper, GT Maru, Gooper |
| Retro terminal | JetBrains Mono, IBM Plex Mono, Commit Mono, Fira Code, Geist Mono | same | same | Berkeley Mono, Operator Mono, MD IO |
| Scientific instrument | IBM Plex Sans, Source Sans 3 | same | IBM Plex Mono, Source Code Pro | Söhne, Graphik, National 2 |
| Warm craft | Fraunces, Lora, Literata, Gelasio, Bricolage Grotesque | Source Sans 3, Figtree, Karla, Atkinson Hyperlegible | — | Tiempos, Freight, Founders Grotesk |
| High-contrast mono | Geist, Manrope, Archivo, Space Grotesk, Inter Display | Geist, Manrope | Geist Mono | Neue Montreal, PP Mori, Söhne |
| Glassy | Inter, Geist, Manrope, Figtree (medium weights) | same | — | SF Pro (native only), Söhne |
| Corporate calm | Source Sans 3, Public Sans, IBM Plex Sans, Noto Sans | same | — | Graphik, Proxima Nova, Avenir Next, Inter (as a decision) |
| Kinetic | Anybody, Bricolage Grotesque, Roboto Flex (extreme axes), Climate Crisis, Fraunces WONK | Archivo, Instrument Sans | — | PP Editorial New, Monument Extended, Druk, Migra |

Notes on specific faces:

- **Fraunces** has optical size (`opsz`), `WONK` and `SOFT` axes; set
  `font-variation-settings: "SOFT" 50, "WONK" 1` on display for a warmer,
  quirkier feel and `"SOFT" 0` for text.
- **Bricolage Grotesque** has `opsz` and width axes and reads as
  characterful without being a novelty; a good one-family solution for
  warm or playful products.
- **Atkinson Hyperlegible** was designed for low vision; use it when the
  audience is older, tired, or the environment is poor. It has distinct
  `Il1` and `0O`.
- **Source Sans 3 / Source Serif 4 / Source Code Pro** were designed as a
  family and are the lowest-risk serious pairing on Google Fonts.
- **IBM Plex** is the best free "instrument" superfamily; its mono has
  excellent tabular figures.
- **Geist / Geist Mono** are the clearest free choice for the monochrome
  developer-tool look; using them signals Vercel to anyone who knows, so
  decide if that is acceptable.
- **Newsreader** has optical sizes for 6pt to 72pt and is one of the few
  free serifs that is genuinely good at both caption and display size.

## 4. What to avoid and why

- **Inter/Roboto/system-ui by reflex.** Not because they are bad (they are
  excellent) but because they signal no decision. Use them when neutrality
  is the deliberate direction (Industrial, Corporate calm, Glassy) and say so.
- **Montserrat, Poppins, Raleway, Lato, Open Sans as display faces.** They
  were the default of 2015-2020 templates and they read as such.
- **Rounded fonts (Nunito, Quicksand, Comfortaa) for body text.** The
  rounded terminals blur at small sizes and tire the eye. Display only.
- **Light weights (100-300) for body or UI text.** They fail contrast and
  render inconsistently across platforms. Light is a display weight.
- **Three or more families.** Almost always a sign that nobody chose.
- **Decorative display faces for anything but the one hero moment.**
- **Faux bold and faux italic.** If you load 400 only and set
  `font-weight: 700`, the browser synthesizes a smeared bold. Load the
  weights you use, or use a variable font.
- **ALL CAPS for body-size labels with no tracking.** Caps need +0.05 to
  +0.1em tracking and belong to a few directions (Luxury, Swiss labels,
  Retro terminal). Everywhere else, sentence case.
- **Justified text on screen.** Rivers and bad hyphenation. Flush left,
  ragged right.
- **Centered body text over about 2 lines.** The eye cannot find the start
  of the next line. Center only short display text and single-line captions.
- **Gradient text.** The most reliable AI tell of all.

## 5. Type scale math: modular scales

A modular scale multiplies a base size by a ratio repeatedly. The ratio
decides the drama; the base decides the comfort.

| Ratio | Name | Steps from 16px (up) | Character |
|---|---|---|---|
| 1.125 | Major second | 16, 18, 20.25, 22.8, 25.6, 28.8 | Very tight; dense UIs, many levels |
| 1.2 | Minor third | 16, 19.2, 23, 27.6, 33.2, 39.8 | Default for apps and dashboards |
| 1.25 | Major third | 16, 20, 25, 31.3, 39, 48.8 | Default for content sites |
| 1.333 | Perfect fourth | 16, 21.3, 28.4, 37.9, 50.5, 67.3 | Editorial, marketing |
| 1.414 | Augmented fourth | 16, 22.6, 32, 45.3, 64, 90.5 | Dramatic; hero-led pages |
| 1.5 | Perfect fifth | 16, 24, 36, 54, 81 | Posters, Swiss, few levels |
| 1.618 | Golden | 16, 25.9, 41.9, 67.8, 109.7 | Very few sizes, huge display |

Practical rules:

- Round to whole or half pixels for the sizes you actually use; nobody
  needs 22.78px. A real system has 7-9 sizes, named by role, not by number:
  `caption 12, small 13-14, body 16, lead 18-20, h4 20-24, h3 24-28,
  h2 32-40, h1 40-56, display 64-96`.
- Dense UI products often use *two* scales: a tight one (1.125-1.2) for
  UI chrome (12, 13, 14, 16, 18, 20) and a wider one for content and
  marketing (1.25-1.333).
- Smaller than 12px is for legal text only; 11px is tolerable in dense
  data tables with excellent fonts and never for anything a user must read
  to proceed.
- Mobile scales can be one step smaller at the top (h1 32-36px instead
  of 48-56) but body stays 16px or larger; the iOS default is 17px.

Use `scripts/typescale.py 16 1.25` to print a table with px, rem and
suggested line-heights, and `--fluid` for clamp() values.

## 6. Fluid type with clamp()

Fluid type scales continuously with viewport width between a min and a
max, removing the breakpoint jumps for headings. The formula for a size
that goes from `min` at viewport `vmin` to `max` at viewport `vmax`:

```
slope      = (max - min) / (vmax - vmin)
intercept  = min - slope * vmin
font-size  = clamp(min, intercept + slope * 100vw, max)
```

Example: h1 from 32px at 360px to 56px at 1280px.

```
slope = 24 / 920 = 0.02609
intercept = 32 - 0.02609 * 360 = 22.6px
font-size: clamp(2rem, 1.413rem + 2.609vw, 3.5rem);
```

Rules of thumb:

- Fluid type is for display sizes (24px+). Body text should stay fixed or
  move by at most 1-2px between phone and desktop; fluid body text makes
  measure unpredictable.
- Always express the `rem` parts in rem so browser zoom still works; the
  `vw` part can stay in vw. Never use a pure `vw` size without clamp.
- Pair fluid type with fluid space (`clamp(1.5rem, 1rem + 2vw, 3rem)` for
  section padding) so rhythm scales together.
- Check at 320px, 768px and 1920px. Fluid headlines at 1920px can become
  absurd without the max.

Tailwind: `text-[clamp(2rem,1.413rem+2.609vw,3.5rem)]` or define it in
`theme.fontSize` as `'display': ['clamp(...)', { lineHeight: '1.05' }]`.

## 7. Line length (measure)

The comfortable measure for continuous reading is 45-75 characters per
line, with 60-66 the sweet spot. Below 40 the eye jumps too often; above 80
it loses the line on return.

- Set `max-width` on text containers in `ch` units: `max-width: 65ch` for
  body, `max-width: 40ch` for large display headlines (which should break
  into 2-3 lines, not run across the screen), `max-width: 50ch` for lead
  paragraphs at 20px.
- Captions and small UI text can run narrower (30-45ch).
- Monospace is wider per character; limit mono prose to 60ch.
- Serif text faces tolerate slightly longer measures (up to 75ch); sans
  bodies prefer 55-70ch.
- Do not let a hero paragraph span a 1200px container. Three full-width
  lines of 18px text at 150 characters per line is unreadable and is the
  most common marketing-page measure failure.

In a two-column layout, each column should still respect measure. A 50/50
split of a 1200px container gives 600px columns, which at 16px is about
70ch: fine. A 50/50 split at 1440px with 24px gutters gives 708px, about
85ch: too wide. Add max-width to the text or make the text column narrower.

## 8. Leading (line-height)

Leading is set unitless (a multiplier) so it scales with the font size.

| Role | Size | Leading | Why |
|---|---|---|---|
| Display / h1 | 48-96px | 0.95-1.1 | Large type has visual leading built in; loose leading makes headlines fall apart |
| Headings h2-h3 | 24-40px | 1.1-1.25 | Tight enough to read as a unit |
| Subheadings h4-h5 | 18-22px | 1.25-1.35 | Transitional |
| Body | 15-19px | 1.5-1.65 | Comfortable continuous reading; longer measures want the upper end |
| UI labels, buttons | 13-15px | 1.2-1.4 | Usually single line; tight so vertical centering is predictable |
| Captions, small | 12-13px | 1.4-1.5 | Small type needs air |
| Code | 13-15px | 1.5-1.7 | Blocks read line by line |

Adjustments:

- Serifs want slightly more leading than sans at the same size (+0.05).
- Longer measures want more leading; a 75ch line at 1.5 feels cramped, at
  1.65 reads well.
- Dark backgrounds read as tighter; add 0.05 to body leading in dark mode
  if the design allows.
- Tall x-height fonts (Inter, Source Sans) need less leading than low
  x-height fonts (Garamond-likes).
- `line-height: 1` on buttons and badges plus explicit padding gives
  precise control; combine with `display: inline-flex; align-items: center`.

A visible baseline rhythm (every vertical measurement a multiple of the
body line-height, e.g. 24px) is a mark of editorial craft. It is hard to
hold perfectly on the web; aim for section and paragraph spacing to use
the same 8px or 4px scale as line-heights so things land near the grid.

## 9. Tracking (letter-spacing)

Tracking changes with size. Fonts are drawn to look right at text size;
large sizes look loose and small sizes look tight.

| Size | Tracking | Notes |
|---|---|---|
| 64px+ | -0.03 to -0.04em | Grotesques especially; serifs less (-0.01) |
| 32-56px | -0.02em | |
| 20-28px | -0.01em | |
| 15-18px (body) | 0 | Never track body text |
| 12-14px (UI, captions) | 0 to +0.01em | A touch of positive tracking helps tiny type |
| ALL CAPS, any size | +0.05 to +0.12em | Caps need air between letters; uppercase without tracking looks jammed |
| Small caps | +0.03 to +0.08em | |

Tailwind: `tracking-tight` (-0.025em) and `tracking-tighter` (-0.05em) for
display, `tracking-wide` (0.025em) and `tracking-wider` (0.05em) for caps.
Define `--tracking-display: -0.02em` as a token so it is applied
consistently.

Do not track lowercase text positively except at tiny sizes. Loose
lowercase reads as amateur.

## 10. Weight and hierarchy

Weight is the second most powerful hierarchy tool after size, and the most
abused. Rules:

- Pick two weights for text (400 and 600, or 400 and 700, or 450 and 650
  with a variable font). Add a third only for display (700-900) or for a
  specific "lead" role (500).
- A weight jump should be at least 200 (400 to 600) to be visible at UI
  sizes. 400 to 500 is a hint, not a level.
- Headings do not need to be bold if they are large enough; a 40px heading
  at 500 looks more refined than at 700. Reserve heavy weights for small
  headings that need help, or for directions that want impact.
- Never bold an entire paragraph. Bold is for a phrase, a label, or a
  number.
- Pair weight with color: body at 400 in `text-primary`, meta at 400 in
  `text-muted`, labels at 600 in `text-primary`. Three levels with two
  weights and two colors.
- Variable fonts let you use 450 or 550 to fine-tune, and also to compensate
  for dark mode (text on dark looks bolder; drop 20-50 units of weight, or
  use `-webkit-font-smoothing: antialiased` deliberately).

## 11. Numerals, figures and OpenType features

- **Tabular figures** (`font-variant-numeric: tabular-nums`) give every
  digit the same width so columns of numbers align and live-updating
  numbers do not jitter. Mandatory in tables, timers, prices in lists,
  dashboards, and anything that updates in place. Check that the chosen
  font has them (Plex, Source, Inter, Geist, Roboto, SF do; many display
  faces do not).
- **Proportional figures** (default) read better in prose. Do not force
  tabular on body text.
- **Lining vs oldstyle figures**: lining (cap-height digits) for UI and
  data; oldstyle (`font-variant-numeric: oldstyle-nums`) for running prose
  in editorial directions where digits should sit with lowercase.
- **Slashed zero** (`slashed-zero`) where 0/O confusion matters (codes,
  IDs).
- **Fractions**: `diagonal-fractions` for recipes and measurements.
- **Ligatures**: leave standard ligatures on for prose (`font-variant-
  ligatures: common-ligatures`), off in code blocks unless the mono font's
  programming ligatures are wanted (JetBrains Mono, Fira Code).
- **Contextual alternates / stylistic sets**: `font-feature-settings:
  "ss01"` etc. are the way to switch Inter's alternate `a` or Fraunces'
  swashes. Use them as one deliberate signature.
- **Kerning**: `font-kerning: normal` (default) and
  `text-rendering: optimizeLegibility` for display text; the latter has a
  minor cost on huge bodies of text.
- **Hanging punctuation** (`hanging-punctuation: first last` in Safari) and
  optical margin alignment make quotes and bullets hang into the margin
  so the text edge stays clean. Use where supported; it degrades gracefully.
- **Hyphenation**: `hyphens: auto` with a `lang` attribute on narrow
  columns prevents ragged right edges from becoming absurd; combine with
  `overflow-wrap: anywhere` only for URLs and long tokens, never for prose.
- **Widows and orphans**: `text-wrap: balance` on headings (2-4 lines)
  prevents a single word on the last line; `text-wrap: pretty` on
  paragraphs in supporting browsers. Both are progressive enhancements
  worth applying globally to `h1-h4` and `p` respectively.

## 12. Variable fonts

One file, continuous axes. Benefits: fewer requests, exact weights, and
animated or responsive axes.

- Declare once with ranges:

```css
@font-face {
  font-family: "Fraunces";
  src: url("/fonts/Fraunces[SOFT,WONK,opsz,wght].woff2") format("woff2-variations");
  font-weight: 100 900;
  font-stretch: 75% 125%;
  font-display: swap;
}
```

- Use `font-weight: 560` freely; use `font-variation-settings` for custom
  axes only (`"opsz"` is usually automatic via `font-optical-sizing: auto`).
- Optical size matters: faces with `opsz` (Fraunces, Newsreader, Roboto
  Flex, Source Serif 4) automatically thicken hairlines at small sizes and
  refine at large sizes; this is why they look good at both ends.
- Subset. A full variable font with Latin Extended, Cyrillic and Greek can
  be 300KB+; a Latin subset is 40-80KB. Use `unicode-range` in `@font-face`
  or pre-subset with `pyftsubset` / `glyphhanger`.
- Animating `font-variation-settings` repaints text each frame; keep it to
  one hero element and under 1s, and disable under reduced motion.

## 13. Loading strategy

Fonts are the first thing users notice loading badly. Decide the behavior.

- **Self-host** when possible (privacy, one fewer origin, control over
  caching). `next/font`, Astro's font integration, and Vite plugins handle
  this; otherwise download WOFF2 and serve from `/fonts`.
- **Preload the one or two files above the fold**:
  `<link rel="preload" href="/fonts/x.woff2" as="font" type="font/woff2" crossorigin>`.
  Preloading everything defeats the purpose.
- **`font-display`**: `swap` for body text (show fallback immediately, swap
  in; accept a flash of unstyled text); `optional` for decorative display
  fonts where it is better to skip the font on slow connections than to
  reflow; `fallback` as a middle ground. Never `block` on the web.
- **Size-adjusted fallbacks** eliminate layout shift: match the fallback's
  metrics to the web font with `size-adjust`, `ascent-override`,
  `descent-override`, `line-gap-override` in a second `@font-face`.
  `next/font` does this automatically; otherwise use a tool like
  Fontaine or the "capsize" metrics database to compute values.

```css
@font-face {
  font-family: "Source Sans Fallback";
  src: local("Arial");
  size-adjust: 94.2%;
  ascent-override: 97%;
  descent-override: 26%;
  line-gap-override: 0%;
}
body { font-family: "Source Sans 3", "Source Sans Fallback", sans-serif; }
```

- Load only the weights and styles in use. Two weights of a static font are
  two files; a variable font is one. Italic is a separate file; include it
  only if the design uses italics.
- Budget: under 100KB of fonts total for an app, under 150KB for a
  marketing page with a display face. If the display face is a one-time
  hero, consider `optional`.
- System font stacks are a legitimate choice for native-feeling apps:
  `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif;` and `ui-monospace, SFMono-Regular,
  Menlo, Consolas, monospace`. Use them deliberately (settings panels, OS
  companions), not as the thing you forgot to change.

## 14. Platform notes

- **iOS / SwiftUI**: SF Pro is the system font and users expect it in
  system-like contexts. Use Dynamic Type text styles (`.body`, `.headline`,
  `.title2`) so sizes respond to user settings; custom fonts should use
  `.custom("Name", size:, relativeTo: .body)` to keep scaling. Default body
  is 17pt; minimum readable 11pt (caption2). SF has tabular figures via
  `.monospacedDigit()`.
- **Android / Compose**: Roboto is the default; Material 3's type scale
  (display/headline/title/body/label, each large/medium/small) is the
  expected structure. Body large is 16sp. Always use `sp` so user font
  scaling works. Custom fonts go in `Typography()` once; do not set sizes
  per screen.
- **Flutter**: `TextTheme` mirrors Material 3's scale. Use
  `Theme.of(context).textTheme.bodyLarge` not `TextStyle(fontSize: 16)`.
  Set `fontFeatures: [FontFeature.tabularFigures()]` on numeric text.
  Google Fonts package for web-style faces; respect `textScaler`.
- **React Native**: fonts are loaded per platform; set a single
  `Text` wrapper component that applies the family and `allowFontScaling`.
- **Desktop web apps**: 13-14px UI type is the convention (Linear, Figma,
  Notion all sit there); 16px UI looks oversized in a dense tool. Content
  stays 15-16px.

## 15. Setting a complete type system: worked example

Direction: Scientific instrument, web app with a marketing site.

```css
:root {
  /* Families */
  --font-sans: "IBM Plex Sans", "IBM Plex Sans Fallback", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Scale: 1.2 for UI, 1.25 for content; base 15px app, 16px site */
  --text-xs:   0.75rem;    /* 12  captions, table meta */
  --text-sm:   0.8125rem;  /* 13  dense UI, table body */
  --text-base: 0.9375rem;  /* 15  app body */
  --text-md:   1rem;       /* 16  site body */
  --text-lg:   1.125rem;   /* 18  lead, h4 */
  --text-xl:   1.375rem;   /* 22  h3 */
  --text-2xl:  1.75rem;    /* 28  h2 */
  --text-3xl:  2.25rem;    /* 36  h1 app */
  --text-display: clamp(2.25rem, 1.5rem + 3.3vw, 4rem); /* 36 -> 64 site hero */

  /* Leading by role */
  --leading-tight: 1.1;
  --leading-snug: 1.3;
  --leading-normal: 1.5;
  --leading-relaxed: 1.65;

  /* Tracking */
  --tracking-display: -0.025em;
  --tracking-heading: -0.01em;
  --tracking-caps: 0.06em;

  /* Weights (only these two are loaded) */
  --weight-regular: 400;
  --weight-semibold: 600;
}

body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  font-weight: var(--weight-regular);
  -webkit-font-smoothing: antialiased;   /* decide; many prefer default on light bg */
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4 { text-wrap: balance; font-weight: var(--weight-semibold); }
h1 { font-size: var(--text-3xl); line-height: var(--leading-tight); letter-spacing: var(--tracking-display); }
h2 { font-size: var(--text-2xl); line-height: var(--leading-tight); letter-spacing: var(--tracking-heading); }
h3 { font-size: var(--text-xl); line-height: var(--leading-snug); }
h4 { font-size: var(--text-lg); line-height: var(--leading-snug); }
p  { max-width: 65ch; text-wrap: pretty; }
small, .caption { font-size: var(--text-xs); line-height: 1.45; color: var(--color-text-muted); }
.numeric, td.num, .kpi { font-variant-numeric: tabular-nums; }
code, .mono { font-family: var(--font-mono); font-size: 0.9em; }
.label-caps { text-transform: uppercase; letter-spacing: var(--tracking-caps); font-size: var(--text-xs); font-weight: var(--weight-semibold); }
```

Tailwind equivalent: define `fontFamily`, `fontSize` (with line-height and
letter-spacing tuples), and `fontWeight` in `theme.extend`, then build
`@layer base` rules for headings so markup does not repeat the classes.

## 16. Diagnosing bad type

| Symptom | Likely cause | Fix |
|---|---|---|
| Page feels "template" | Default family, single weight, smooth 1.125 scale | Choose a family for the direction; widen the ratio; add weight contrast |
| Headlines feel weak | Too small, too loose leading, positive tracking | Jump two scale steps; leading 1.05-1.15; tracking -0.02em |
| Headlines feel shouty | Too heavy at too large a size | Drop to 500-600; let size do the work |
| Body hard to read | Measure over 80ch, leading under 1.4, weight 300, grey on grey | 65ch max; 1.55; 400; contrast 7:1 for long reading |
| Numbers jitter / misalign | Proportional figures | `tabular-nums`; right-align numeric columns |
| Labels look jammed | Uppercase without tracking | +0.06em, or drop the caps |
| Everything same size | Scale ratio too small or too many sizes used | Use fewer sizes with bigger jumps |
| Text shifts on load | No size-adjusted fallback | Add metric overrides or `next/font` |
| Bold looks smeared | Synthesized bold | Load the 600/700 file |
| Last line is one word | No balancing | `text-wrap: balance` on headings |
| Hero paragraph spans screen | No max-width | `max-width: 55ch`; left-align it |
| Dark mode text looks heavier | Light-on-dark gain | Drop weight 20-50 with a variable font; increase leading slightly |
