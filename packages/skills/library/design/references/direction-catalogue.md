# Direction catalogue

Fourteen distinct aesthetic directions, each with: feel, where it is right,
typography, palette, space and shape, motion, signature devices, and how it
goes wrong. Values are starting points, not prescriptions. Read
`aesthetic-direction.md` first for how to derive a direction from the brief
and how to blend two; this file is the menu.

## Contents

1. Editorial
2. Swiss / grid
3. Brutalist
4. Soft organic
5. Industrial / utilitarian
6. Luxury minimal
7. Playful / toy-like
8. Retro terminal
9. Scientific instrument
10. Warm craft
11. High-contrast monochrome
12. Glassy / translucent (done well)
13. Corporate calm
14. Kinetic / expressive
15. Choosing between neighbours

## 1. Editorial

**Feel:** considered, literate, confident, unhurried. Like a well-designed
magazine or a serious newspaper's feature section.

**Right for:** content products, long-form reading, publications, portfolio
and agency sites, documentation that wants to feel authored, fintech or
legal products that want gravitas without corporate stiffness.

**Type:** a serif with real character for display (Fraunces, Newsreader,
Source Serif 4, Playfair Display for more drama, GT Sectra or Tiempos if
paid), paired with a quiet humanist sans for UI (Source Sans 3, Work Sans,
Albert Sans). Display sizes go large: 48-96px on desktop, with tight leading
(1.05-1.15) and slight negative tracking (-0.01 to -0.02em). Body 17-19px at
1.55-1.65 leading, measure 60-70ch. Italics are used for emphasis and
captions; small caps for section labels if the face has them.

**Palette:** paper-and-ink. Off-white (not pure) background, near-black
ink (not pure), one accent used for links and a single highlight device.
Keep accent chroma moderate. Photography is often desaturated or
duotoned to sit with the type.

**Space and shape:** generous margins (page gutters 48-96px on desktop),
asymmetric column grids (5/7, 4/8), text columns that do not fill the
width. Radius 0-2px. Rules (1px) as separators, no shadows. Images bleed
to one edge rather than sitting centered.

**Motion:** slow and few. 300-400ms fades, a single reveal on load. No
hover lifts. Links underline on hover with a 150ms color change.

**Signature devices:** drop caps, pull quotes set in display size,
hanging punctuation, running heads, figure numbers, a visible baseline
rhythm, large folios.

**Goes wrong when:** it becomes "hairline rules and zero radius" without
the typographic skill underneath (bad leading, orphans, no measure
control); when the UI controls (buttons, inputs) are left as default
rounded SaaS kit so the page looks like two products stitched together;
when the serif is used for UI text at small sizes where it loses legibility.

## 2. Swiss / grid

**Feel:** rational, structured, objective, modern in the 1960s sense. The
grid is visible in how everything sits.

**Right for:** agency and studio sites, design tools, architecture and
engineering firms, event sites, anything that wants to feel organized and
intelligent without warmth.

**Type:** one grotesque sans, used at extreme size contrast. Neue Haas
Grotesk or Helvetica Now if paid; Inter *can* work here only if you commit
to the Swiss treatment, but better choices are Söhne, Unica77, Akzidenz
(paid) or Archivo, Schibsted Grotesk, Instrument Sans, Space Grotesk (free).
Headlines 64-120px, body 16px, almost nothing in between. Flush left,
ragged right, always. Tight tracking on display (-0.03em), normal on body.

**Palette:** white, black, one primary (classic red #E30613-ish, or a
chosen signal color). Rarely a fourth. Large flat areas of the primary are
allowed.

**Space and shape:** 12-column grid with visible columns (sometimes
literally drawn as hairlines), content aligned hard to columns, large
asymmetric voids. No radius. No shadows. Borders only as grid lines.

**Motion:** crisp and mechanical. 150-200ms linear-ish or ease-out,
elements slide along grid axes. No bounce, no fade-scale.

**Signature devices:** oversized numerals, text rotated 90 degrees on a
column edge, the grid itself revealed, extreme scale jumps in one
composition, photography in strict rectangles.

**Goes wrong when:** the grid is not actually used for alignment (so it is
Swiss costume without Swiss discipline); when text sizes drift into a
smooth scale and the size contrast disappears; when a second typeface
sneaks in.

## 3. Brutalist

**Feel:** raw, direct, unpolished on purpose, anti-corporate. Shows its
structure.

**Right for:** art and culture, music, independent brands, personal sites,
developer side projects, zines, anything that wants to signal "not a
marketing department."

**Type:** either a default-looking system face used aggressively (Arial,
Times New Roman, Courier at 80px) or a heavy grotesque (Archivo Black,
Bricolage Grotesque, Anybody, Big Shoulders). Mono is common for body
(JetBrains Mono, IBM Plex Mono, Space Mono). Mixed sizes with abrupt jumps.
Underlines are thick (2-3px) and default blue is not a sin here.

**Palette:** high-contrast primaries, often pure black and pure white with
one screaming color (yellow #FFE600, cyan, hot pink) or unstyled browser
defaults used ironically. Backgrounds may be a flat saturated color.

**Space and shape:** tight or inconsistent spacing by design, elements
touching, thick borders (2-4px solid black), no radius, no shadow except a
hard offset shadow (`4px 4px 0 #000`). Layouts break the grid, overlap,
and use the full viewport edge.

**Motion:** either none or abrupt (0ms state changes, marquee text, cursor
followers). Hover states invert colors instantly.

**Signature devices:** marquees, visible borders on everything, raw
`<hr>`, exposed metadata, text that runs off the edge, default form
controls, cursor as a design element.

**Goes wrong when:** it is applied to a product people need to use daily
(brutalism taxes attention and tolerance); when it is "brutalist" only in
the hero and the rest is normal SaaS; when there is no system under the
chaos so it reads as broken rather than raw. Good brutalism is extremely
consistent about its rules.

## 4. Soft organic

**Feel:** gentle, approachable, human, calm. Rounded forms, natural
colors, nothing sharp.

**Right for:** wellness, health, education for young people, community
products, consumer finance that wants to feel kind, anything whose users
are anxious.

**Type:** a rounded or soft humanist sans (Nunito, Quicksand sparingly,
DM Sans, Outfit, Figtree, Plus Jakarta Sans; paid: Circular, Sofia Pro,
GT Walsheim). Avoid the fully rounded fonts for body (they tire the eye);
use them for display and a cleaner humanist for text. Scale 1.2, body 16-17px,
generous leading 1.6.

**Palette:** desaturated, mid-light tones from nature: sage, clay, sand,
dusty blue, warm grey. Avoid pure white; use warm off-whites. Accent chroma
low (0.08-0.12 in OKLCH). Dark mode is rarely needed; if present it is a
deep warm charcoal, not black.

**Space and shape:** generous. 8px base, padding 24-32px in cards, radius
16-24px on surfaces and 12px on controls, pill buttons. Shadows are soft,
large and tinted with the background hue (`0 8px 24px oklch(0.4 0.03 60 / 0.12)`),
or replaced by tonal layering.

**Motion:** slow and springy. 300-400ms with a soft spring or
`cubic-bezier(0.34, 1.56, 0.64, 1)` used sparingly on small elements;
ease-out elsewhere. Elements grow and fade rather than slide.

**Signature devices:** blob or wave section dividers (used once), tonal
layering instead of borders, illustrated spot icons with a consistent
stroke, big friendly empty states.

**Goes wrong when:** everything is a pill and nothing has edge, so the
hierarchy dissolves into pudding; when pastel accents fail contrast on
text; when it becomes "corporate Memphis" illustration soup; when the
rounded font is used for dense body text.

## 5. Industrial / utilitarian

**Feel:** built for work. Honest materials, labeled parts, nothing
decorative. Like a well-made tool or a control panel.

**Right for:** ops tooling, logistics, manufacturing, developer
infrastructure, admin panels, internal tools, anything used all day by
professionals.

**Type:** a neutral grotesque or a humanist with good small-size
legibility: IBM Plex Sans, Public Sans, Atkinson Hyperlegible, Inter (one
of the few directions where Inter is a *choice*, because neutrality is the
point), Geist. Mono for data: IBM Plex Mono, JetBrains Mono, Berkeley Mono
(paid). Body/UI 13-14px, scale 1.2, tight leading 1.4. Weights 400 and 600
only.

**Palette:** cool or neutral greys with a utility accent (safety orange,
signal blue, a yellow). Semantic colors are strong and conventional
(red/amber/green) because they carry meaning. Dark mode is often default.

**Space and shape:** compact density. 4px base, rows 32-36px, padding
8-12px, gutters 16-24px. Radius 2-4px. Borders 1px carry all structure; no
shadows except on floating menus. Everything aligns to a visible grid.

**Motion:** minimal and fast: 100-150ms, ease-out, opacity and small
translates only. No decorative motion at all. State changes are instant
or nearly so.

**Signature devices:** labeled everything, keyboard shortcuts shown
inline, status as colored dots with text, monospace IDs, dense tables
with sticky headers, a command palette.

**Goes wrong when:** it is dense without hierarchy (everything 13px grey
on grey); when the semantic colors are also used decoratively so red stops
meaning danger; when it gets a marketing-site hero bolted on.

## 6. Luxury minimal

**Feel:** restrained, expensive, slow, quiet. Confidence through absence.

**Right for:** fashion, hospitality, premium hardware, high-end services,
architecture, anything where price is part of the message.

**Type:** one refined face used in two sizes. A high-contrast serif
(Cormorant, Playfair, Bodoni Moda; paid: Canela, Ogg, Reckless) or a
light geometric sans (Jost, Josefin Sans at light weights; paid: Futura,
Neue Montreal, Suisse). Wide tracking on small caps labels (0.1-0.2em) is
appropriate here and almost nowhere else. Body light weight (300-400),
small (14-15px), with extremely generous leading (1.7-1.8).

**Palette:** monochrome with a single material tone: bone, charcoal,
stone, with occasional gold or deep green as the one color. Photography
carries the color; UI stays neutral. Pure black is acceptable here as a
material.

**Space and shape:** huge whitespace. Section padding 120-200px. Content
narrow (max 640-720px for text). Radius 0. No borders, no shadows; space
alone separates. Images are large and often full-bleed.

**Motion:** slow, 500-800ms, ease-out or ease-in-out, with long fades and
very small movements (4-8px). Cursor-driven parallax used once if at all.
Page transitions are considered.

**Signature devices:** small caps labels with wide tracking, hairline
rules used very sparingly, serif numerals, a single piece of imagery given
the whole viewport, text set vertically on an edge.

**Goes wrong when:** the light weights fail contrast (300 weight at 14px on
grey is unreadable); when "minimal" means missing states and affordances
so buttons are not recognizable; when the slow motion makes the product
feel sluggish on a repeated task.

## 7. Playful / toy-like

**Feel:** delightful, friendly, energetic. Things bounce, colors are
candy, shapes are chunky.

**Right for:** kids' products, games, consumer social, creative tools for
hobbyists, onboarding for otherwise dry products (one playful moment), brands
whose personality is joy.

**Type:** a chunky geometric or a display face with personality (Fredoka,
Baloo 2, Rubik at 700-800, Bricolage Grotesque, Gloock for headlines;
paid: Recoleta, Cooper, GT Maru). Body stays clear: Nunito Sans, DM Sans,
Rubik 400. Large sizes, heavy weights, tight leading.

**Palette:** saturated, 3-5 hues in a shared lightness band (OKLCH L
0.65-0.75, C 0.15-0.2) so they feel like a set. Backgrounds can be a
saturated tint. Black outlines (2-3px) are allowed and give the toy feel.

**Space and shape:** chunky. Radius 12-24px, big pill buttons with hard
offset shadows (`0 4px 0 darker-shade`) that press down on active. Padding
generous, elements large. Sticker-like cards.

**Motion:** springy and eager. `cubic-bezier(0.34, 1.56, 0.64, 1)` or a
real spring, 250-400ms, scale bounces on press, wiggles on success, confetti
once per rare celebration. Reduced motion must collapse these to fades.

**Signature devices:** button that physically presses (translateY 4px,
shadow collapses), stickers, hand-drawn underlines, mascots, sound where
appropriate.

**Goes wrong when:** it is applied to a tool used for hours (exhausting);
when every element bounces so nothing stands out; when the palette has
inconsistent lightness so it looks like a clown rather than a toy; when
contrast fails because saturated-on-saturated.

## 8. Retro terminal

**Feel:** hacker, technical, nostalgic, honest. Text is the interface.

**Right for:** developer tools, CLI companions, security products, crypto
(carefully), personal sites of engineers, status pages, anything where the
audience lives in a terminal.

**Type:** monospace everywhere, or mono for all UI with a grotesque for
long prose. JetBrains Mono, IBM Plex Mono, Fira Code, Commit Mono, Geist
Mono, Berkeley Mono (paid). 13-15px, leading 1.5-1.6. Uppercase labels are
tolerable here because terminals set the convention. Bold is rare; color
and brackets carry emphasis.

**Palette:** dark background (not pure black unless CRT theme: #0B0F0C,
#101418) with phosphor-ish text (amber #FFB000, green #33FF66 desaturated
to oklch(0.8 0.15 145), or soft white #E6E6E6). One or two ANSI-like
accents. Light mode is possible (paper terminal, #F4F4F0 with #1A1A1A) and
less expected.

**Space and shape:** character-grid spacing: use `ch` and `lh` units.
Radius 0. Borders as box-drawing characters or 1px lines. Dense but
regular. No shadows.

**Motion:** typewriter reveals (once), blinking cursor, instant state
changes. Scanline or CRT effects only as a toggle and never on body text.

**Signature devices:** prompt characters (`>` `$`), bracketed labels
`[OK]`, ASCII box borders, dotted leaders in lists, `--flag` style
metadata, a command palette as primary nav.

**Goes wrong when:** the monospace body text runs past 70ch and becomes
unreadable; when green-on-black fails contrast at 13px; when it is
nostalgia costume on a product with no technical audience; when the
typewriter effect plays every time.

## 9. Scientific instrument

**Feel:** precise, calibrated, trustworthy, calm under load. Like a
well-made oscilloscope or a lab notebook.

**Right for:** analytics, monitoring, fintech with real data, health data,
engineering tools, research software, dashboards that people make decisions
from.

**Type:** a neutral sans with excellent numerals and a matching mono: IBM
Plex Sans + Plex Mono, Source Sans 3 + Source Code Pro, Inter + JetBrains
Mono (defensible), Söhne + Söhne Mono (paid). Tabular figures are
mandatory. UI 13-14px, body 15px, scale 1.2. Numbers may be the largest
type on the screen.

**Palette:** cool neutral greys (OKLCH hue 240-260, C 0.005-0.015), one
calm accent (desaturated blue or teal), semantic colors desaturated to
match (red oklch(0.6 0.15 25), amber oklch(0.75 0.14 75), green
oklch(0.65 0.13 150)). Data colors come from the `dataviz` skill's palette.
Dark mode is first-class and often default.

**Space and shape:** 4px base, moderate density (rows 36-40px). Radius 4px
controls, 6-8px surfaces. 1px borders in a lifted neutral; shadows only on
overlays. Grid lines, tick marks and axes are part of the visual language.

**Motion:** 150-200ms ease-out for UI; data transitions 300-400ms with
easing that reads as physical (values interpolate, bars grow from their
baseline). Nothing decorative.

**Signature devices:** tick marks and rulers, unit labels in muted mono,
sparklines inline with numbers, reference lines, timestamps everywhere,
hairline crosshairs on hover.

**Goes wrong when:** the dashboard becomes a tile grid of identical KPI
cards (no hierarchy); when the accent is used for data *and* UI so the
chart and the button compete; when charts are decorated (3D, gradients,
drop shadows) rather than calibrated.

## 10. Warm craft

**Feel:** handmade, honest, human, hospitable. Like a good bakery's
packaging or a well-set book.

**Right for:** food, small business tools, independent commerce, community,
nonprofits, personal finance that wants to feel on your side, products for
makers.

**Type:** a warm serif for display (Fraunces, Lora, Literata, Gelasio;
paid: Tiempos, Freight) and a warm humanist sans for UI (Source Sans 3,
Figtree, Karla, Atkinson Hyperlegible). Or a single warm sans with real
character (Bricolage Grotesque, Epilogue). Body 16-17px, leading 1.55.
Weights 400 and 600-700.

**Palette:** warm paper (oklch 0.95-0.97, C 0.01-0.02, hue 70-90), warm
ink (oklch 0.25, C 0.02, hue 50), earth accents: terracotta, mustard,
olive, plum, at moderate chroma. No pure black or white. Dark mode is a
warm charcoal (oklch 0.2 0.01 60) with cream text.

**Space and shape:** 8px base, comfortable density, radius 4-8px, 1px
borders at low alpha of the ink color, no drop shadows or very warm soft
ones. Imagery is photography with natural light or hand-drawn.

**Motion:** gentle, 200-300ms, ease-out, small fades. One warm touch
(a checkmark that draws itself) is enough.

**Signature devices:** ornamental rules or dingbats used once, drop caps,
hand-drawn underlines, texture (subtle paper grain at 2-3% opacity),
numbered recipe-style steps where the content really is steps.

**Goes wrong when:** it collapses into the cream-serif-terracotta template
(see generic-check); when texture reduces contrast; when "handmade"
becomes inconsistent spacing; when the serif is used for dense data.

## 11. High-contrast monochrome

**Feel:** stark, graphic, decisive, photographic. Black, white and
nothing else, or nearly.

**Right for:** photography, fashion, architecture, portfolios, agencies,
developer tools wanting a Vercel-like clarity, products where imagery is
the color.

**Type:** one geometric or grotesque sans with wide weight range so weight
carries hierarchy instead of color: Geist, Inter Display, Manrope,
Archivo, Space Grotesk; paid: Neue Montreal, PP Mori, Söhne. Very large
display sizes, body 15-16px, mono for metadata is fine here.

**Palette:** #000 and #FFF are permitted; most monochrome directions use
#0A0A0A and #FAFAFA to soften screen glare, which is fine when it is a
choice rather than a reflex. 5-7 grey steps. If one color exists, it is a
single saturated signal (cobalt, red) used on exactly one kind of element.

**Space and shape:** hairline 1px borders (#E5E5E5 light / #262626 dark)
carry all structure. Radius 0-6px, consistent. No shadows in light mode;
in dark mode, borders brighten slightly instead of shadows. Large images
in strict rectangles.

**Motion:** fast and crisp, 120-180ms, ease-out, opacity and transform
only. Hover inverts or shifts a border from grey to black.

**Signature devices:** inverted blocks (white text on black band), image
hover revealing captions, weight-only hierarchy, hairline grids, oversized
numerals.

**Goes wrong when:** grey steps are too close so hierarchy vanishes; when
the one color sneaks into three roles; when dark mode is just inverted
(dark mode needs its own grey ramp and brighter borders).

## 12. Glassy / translucent (done well)

**Feel:** layered, atmospheric, modern in the OS sense. Surfaces float over
a colored backdrop.

**Right for:** media and music players, OS-like dashboards, creative tools,
consumer apps living over imagery or video, some fintech wanting a
premium-tech feel.

**Type:** a clean grotesque or SF-like humanist (Inter, Geist, SF Pro
where native, Manrope, Figtree). Medium weights (500) read better on
translucent surfaces than regular. Body 15-16px.

**Palette:** the backdrop carries color (a photo, a gradient mesh, a video,
a tinted scene). Surfaces are white or black at 60-80% alpha with
`backdrop-filter: blur(16-24px) saturate(140-180%)`. Text is near-opaque.
Borders are 1px white at 15-25% alpha (light) or white at 8-12% (dark) to
define the edge. Accents come from the backdrop or a single bright hue.

**Space and shape:** radius 12-20px on glass panels, 8px on controls
inside them. Shadows are soft and large (`0 8px 32px rgba(0,0,0,0.12)`) to
separate glass from backdrop. Padding generous (20-24px) because the
surface is already busy.

**Motion:** smooth, 250-350ms, ease-out; panels scale from 0.96 and fade;
the backdrop may move slowly behind (parallax or slow drift).

**Signature devices:** one translucent panel over a strong backdrop, a
tinted sidebar, a floating glass toolbar.

**Goes wrong when:** everything is glass so there is no solid ground (and
text contrast fails because the backdrop is unpredictable); when blur is
applied without the border and shadow so edges vanish; when it runs on
low-end devices and janks (backdrop-filter is expensive: limit it to one or
two surfaces and give a solid fallback with `@supports not`). Always check
contrast against the busiest part of the backdrop, not the calmest.

## 13. Corporate calm

**Feel:** trustworthy, competent, unsurprising. The direction most B2B
software needs and few execute well.

**Right for:** enterprise SaaS, banking, insurance, HR tooling, government
services, healthcare administration.

**Type:** a humanist sans with good screen rendering and a wide family:
Source Sans 3, Public Sans, Noto Sans, IBM Plex Sans, Open Sans
(defensible), Lato; paid: Graphik, Proxima Nova, Avenir. Scale 1.2, body
15-16px, UI 14px. Weights 400/600. Headings in the same family at 600,
with slight negative tracking at display sizes.

**Palette:** a neutral grey ramp with a slight cool or warm cast, one
brand primary (traditionally blue, but navy, teal, deep green and
aubergine all work and are less generic), full semantic set. Backgrounds
layered: page oklch 0.975, surface white, raised white with 1px border.
Dark mode optional and well-made.

**Space and shape:** 8px base, moderate density, radius 6px controls / 8px
surfaces, 1px borders plus a very light shadow on raised surfaces only
(`0 1px 2px rgba(16,24,40,.06)`). Consistent 24px card padding. Left-aligned
everything; no centered body text.

**Motion:** 150-200ms ease-out; no decorative motion. Skeletons for
loading. Toasts slide 8px and fade.

**Signature devices:** a confident, consistent iconography set (one
library, one stroke width); well-designed empty states; data tables that
are actually good; a brand color used on a few decisive elements.

**Goes wrong when:** it becomes the generic SaaS kit (this is the direction
where the generic-check matters most); when "calm" means no hierarchy and
everything is mid-grey; when the brand blue is used for primary buttons,
links, selected states, info banners, charts and icons so it means nothing.

## 14. Kinetic / expressive

**Feel:** alive, bold, contemporary, art-directed. Type and motion are the
imagery.

**Right for:** launches, event sites, creative agencies, music, fashion,
product marketing for brands that want to be noticed, portfolios.

**Type:** a variable display face with extreme axes (Anybody, Bricolage
Grotesque, Climate Crisis, Roboto Flex at odd settings, Fraunces with
WONK; paid: PP Editorial New, Monument Extended, Druk). Headlines fill the
viewport (clamp(3rem, 12vw, 14rem)). Body stays disciplined in a plain
sans.

**Palette:** either stark (black/white + one electric color) or a bold
two-color pairing with high chroma. Backgrounds change per section.

**Space and shape:** full-bleed sections, text overlapping imagery,
asymmetric placements, sticky elements that reveal as you scroll. Radius
is either 0 or very large (pills, circles). Minimal borders.

**Motion:** the point. Scroll-linked (via `animation-timeline: scroll()`
or a small library), variable-font axis animation on hover, staggered
word reveals (once, on load), marquees, cursor interactions. Durations
longer (400-800ms) with expressive curves. Must fully degrade under
reduced-motion to a static, still-good layout.

**Signature devices:** one viewport-filling typographic moment, type that
responds to the cursor, a horizontal scroll section, a sticky image that
changes as text scrolls.

**Goes wrong when:** the motion is everywhere so the eye never rests; when
performance tanks on phones; when the "expressive" page has a default
SaaS pricing table at the bottom; when reduced-motion is ignored.

## 15. Choosing between neighbours

Several directions sit close together; the brief's unexpected adjective
usually decides.

- Editorial vs Warm craft: Editorial is literate and cool-headed (paper and
  ink, authority); Warm craft is hospitable (earth tones, hand-made cues).
  A law firm is Editorial; a bakery's ordering tool is Warm craft.
- Industrial vs Scientific instrument: both dense and neutral; Industrial
  is about doing (labels, actions, status), Scientific about measuring
  (numbers, units, calibration). A dispatch tool is Industrial; an
  analytics product is Scientific.
- Corporate calm vs Industrial: Corporate is comfortable and brand-led for
  mixed audiences; Industrial is compact and function-led for operators.
- Swiss vs High-contrast monochrome: Swiss is grid-structured with one
  signal color and poster-scale type; Monochrome is image-led or product-led
  with hairlines and almost no color.
- Soft organic vs Playful: Soft is calm and low-chroma; Playful is energetic
  and high-chroma. A meditation app is Soft; a kids' learning app is Playful.
- Luxury minimal vs Editorial: Luxury removes almost everything and slows
  down; Editorial keeps structure and reads at a normal pace.
- Glassy vs Corporate calm: Glassy needs a colored backdrop to make sense;
  without one, choose Corporate calm with tonal surfaces.
- Kinetic vs Brutalist: both loud; Kinetic is polished and motion-led,
  Brutalist is raw and static. Kinetic for a launch; Brutalist for a zine.
