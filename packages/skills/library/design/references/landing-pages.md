# Landing pages

Page anatomy and visual rhythm for marketing and landing pages, hero
patterns that are not the default, social proof layout, pricing table
design, how to make a page feel like a specific brand, performance budgets,
and responsive hero behavior.

Scope: this file is about layout, hierarchy, visual identity and the
rendering of marketing content. Headlines, value propositions, positioning,
CTA wording strategy, conversion optimization and SEO belong to the
`marketing` skill. When a user asks for a landing page, build the page with
this file and tell them the copy should go through the marketing skill (or
use it yourself for the words). Placeholder copy is acceptable for layout
only if clearly marked; a page designed around lorem ipsum will look wrong
once real copy arrives, so get real or realistic copy early.

## Contents

1. What a landing page has to do visually
2. Page anatomy and rhythm
3. Hero patterns beyond the default
4. The "features" problem
5. Social proof layout
6. Pricing tables
7. Making it feel like a brand
8. Imagery, illustration and product shots
9. Responsive hero behavior
10. Performance budgets
11. Dark heroes, light bodies and section transitions
12. Footer, nav and the small parts
13. The template tells, and fixes

## 1. What a landing page has to do visually

In the first viewport, within about three seconds: communicate what this
is, who it is for, and why it is credible, and make the next step obvious.
Below that: sustain attention through a rhythm of sections that each make
one point, and resolve into a decision (sign up, buy, contact, download).

Visually that means:

- One dominant element in the hero (the headline or the product), not
  three competing ones.
- A reading path: where the eye enters, where it goes next.
- Rhythm: sections that vary in weight, height and background so the
  scroll has beats.
- A consistent, specific visual identity so the page could not be mistaken
  for a competitor's.
- Speed: a marketing page that takes four seconds to render has lost the
  reader before the hero appears.

## 2. Page anatomy and rhythm

A typical structure, and what each section does visually:

| Section | Visual job | Typical height (desktop) |
|---|---|---|
| Nav | Orientation; one primary CTA | 64-80px |
| Hero | The one message plus proof of reality (product, image, demo) | 70-100vh, or content-sized 480-720px |
| Credibility strip | Logos or a single stat; low height, quiet | 80-120px |
| Problem / context (optional) | A pause; often text-led | 320-480px |
| Core value sections (2-4) | One point each, alternating layouts | 480-720px each |
| Deep proof (case study, numbers, testimonial) | Heavier, slower section | 480-640px |
| Secondary features (optional) | Denser, smaller type, grid | 400-600px |
| Pricing (if applicable) | Decision support; most structured section | 600-900px |
| FAQ (optional) | Compact accordion | content-sized |
| Final CTA | Restate; one action; a visual bookend to the hero | 320-480px |
| Footer | Navigation and legal | 240-400px |

Rhythm rules:

- **Alternate weight.** A heavy section (full-bleed color, big image) is
  followed by a light one (white, text-led). Two heavy sections in a row
  exhaust; two light ones blur together.
- **Vary section padding.** Core sections at 96-128px vertical; strips at
  48-64px; the hero and final CTA at the top end. Identical `py-24` on
  every section is the template rhythm.
- **Vary layout.** Text-left/image-right, then image-left/text-right, then
  a centered single statement, then a three-column grid. Never the same
  layout twice in a row.
- **Vary background.** Page, subtle tint, inverse (dark), a brand color
  band: at most three or four background treatments per page, used in a
  pattern.
- **One slow moment.** A section with a single large statement or image
  and lots of space gives the reader a rest and makes the next section
  land harder.

Section internals share a consistent stack: optional small label (only if
the direction uses labels; not a tracked-caps eyebrow by default), heading
(32-48px), supporting paragraph (18-20px, max 55ch), then content; 12-16px
between label and heading, 16-24px between heading and paragraph, 40-64px
before content.

## 3. Hero patterns beyond the default

The default (centered headline, centered subhead, two centered buttons,
screenshot below or three cards) is the single strongest template tell.
Alternatives, with when each fits:

**Left-aligned split (7/5 or 6/6).** Headline, paragraph and CTA in the left
column; the product (screenshot, device frame, illustration, video) in the
right column, often bleeding off the right edge. The workhorse for SaaS and
apps. Variation: the visual overlaps the section boundary below.

**Product-first.** The product UI *is* the hero: a large, real screenshot
or an interactive embed fills 60-70% of the viewport, with a short headline
above or overlaid at the top-left. For products whose UI is the pitch
(design tools, dashboards, editors). Needs an excellent screenshot (real
data, good state, correct device frame or none).

**Typographic.** A huge headline (clamp 3rem to 8rem), nothing else above
the fold but a one-line subhead and one CTA. For brands with a strong voice,
agencies, developer tools with a clear one-liner. Works only if the type is
excellent and the sentence is short (under 8 words).

**Demo-led.** A live or simulated interaction in the hero: a terminal that
runs a command, an editor that types, a form that fills itself, a
before/after slider. For developer tools and anything where "show, don't
tell" is possible. Keep it under 6 seconds and loop with a pause; respect
reduced motion with a static final frame.

**Editorial.** A full-bleed photograph or illustration with the headline
set over it or beside it in a narrow column, serif display type, generous
margins. For hospitality, fashion, culture, premium services.

**Stat or number-led.** One enormous number with a short label ("4.2M
deploys last week") as the hero, headline secondary. For products whose
scale is the credibility. The frontend-design calibration note applies:
this is a common default when it does not fit; use only when the number is
genuinely the story.

**Problem-first.** The hero names the pain in the headline, with a visual of
the before state; the solution is the second section. For products in
crowded categories where differentiation is in framing.

**Two-column manifesto.** Short headline left, a longer paragraph right
(the only time a hero has 60+ words), no visual; typographically driven.
For agencies, funds, thoughtful B2B.

**Form-in-hero.** Email capture or a calculator embedded directly in the
hero column (replacing the buttons). For lead-gen, waitlists, tools with
instant output.

Whatever the pattern: one CTA is stronger than two; if there must be two,
the second is a ghost or link, not a second button of equal weight. And
there is always a real visual or a typographic statement; a hero with no
imagery and no typographic ambition is just a heading.

## 4. The "features" problem

"Three feature cards with icons in circles" is the default because
products have features and three is a nice number. Alternatives that
communicate better:

- **Alternating rows**: image or screenshot on one side, heading plus two
  sentences on the other, swapping sides each row. One feature per row, up
  to four rows. The most reliable pattern for showing real product.
- **Bento grid**: a grid of unequal tiles (2x2, 2x1, 1x1) each showing one
  capability with a real visual. Good for products with 5-7 features of
  varying importance; the tile size encodes importance. Avoid when every
  tile is a stock icon; the pattern lives on real visuals.
- **Tabbed or scroll-pinned showcase**: a sticky screenshot on one side
  that changes as the user scrolls through short feature descriptions on
  the other. Dense information, low vertical cost. Must degrade to stacked
  on mobile.
- **Dense list**: for secondary features, a 3- or 4-column list of
  one-line items with small icons or no icons, under a single heading
  ("Everything else"). Honest and scannable.
- **Single-column narrative**: for products with one big idea, three
  sequential sections telling how it works (and here numbered steps are
  legitimate, because it is a sequence).
- **Comparison table**: when the feature set is the differentiation
  versus a known alternative.

If three cards really are right (three genuinely parallel, equally
important things), make them specific: a real screenshot crop per card
instead of an icon, unequal widths (2+1), or a shared visual that spans
them.

Icons: one set, one stroke weight, same size, and never in colored circles
by default. If the direction wants icon containers, make them square with
the small radius and a subtle tint; or skip the container.

## 5. Social proof layout

**Logo wall.** 5-8 logos in a single row (wrap to two rows of 4 on
mobile), monochrome (`filter: grayscale(1)` plus opacity 0.6-0.8, or
provided mono SVGs), normalized to equal *visual* height (not equal
bounding box; a wide logo at the same height as a square one looks
larger; adjust each to similar optical mass, usually 24-32px cap height),
32-48px gaps, a short line above ("Trusted by teams at") in `text-muted`.
A marquee is acceptable only with 12+ logos and must pause on hover and
under reduced motion.

**Testimonials.** One strong testimonial beats six weak ones. Patterns:

- Single large quote: 24-32px, serif or display face if the direction has
  one, with a 40-48px avatar, name, role and company; maybe the company
  logo. Centered or left in a 8/12 column.
- Three-card grid: equal heights, quote clamped to 4-5 lines, author row
  pinned to the bottom; one card may be visually emphasized.
- Masonry wall: many short quotes (tweets, reviews) in 3 columns with
  varied heights; fine for consumer and developer products; use CSS
  columns or grid with `grid-auto-flow: dense`.

Always include a face or a logo; attribution without a visual anchor reads
as invented. Do not use five-star graphics unless the rating is real and
sourced.

**Numbers.** 3-4 stats in a row, 40-56px numerals in tabular figures, a
12-14px label below, left-aligned within each cell. Numbers with sources
or dates are more credible than round marketing numbers.

**Case study teaser.** Logo, a one-line result in large type, a 2-3
sentence summary, a link. Give it a full-width band with a distinct
background; it is the heaviest proof.

**Badges and ratings** (G2, App Store, SOC 2): small, in a quiet strip,
monochrome where possible, near the pricing or final CTA where trust is
needed.

## 6. Pricing tables

The most structured section; users read it carefully, so clarity beats
cleverness.

**Layout.** 2-4 plans in equal-width columns (3 is the sweet spot), 24-32px
gap. On mobile, stack vertically with the recommended plan first or keep
them as a horizontal scroll with snap. Above 4 plans, use a comparison
table instead.

**Column anatomy**, top to bottom: plan name (18-20px 600), one-line
description of who it is for (14px muted), price (40-48px tabular numerals
with the currency symbol smaller and the period in 14px muted: `$29 /month`),
billing toggle note if annual/monthly, CTA button (full width of the
column; primary on the recommended plan, secondary on others), then the
feature list (14-15px, check icons 16px in `text-muted` or accent,
left-aligned, 8-12px between items). Features in later columns list what
is *added* ("Everything in Starter, plus:") rather than repeating.

**Recommended plan.** One, clearly marked: a 1px accent border, a small
badge ("Most popular") at the top edge, a slightly raised surface, or a
4-8px vertical offset. Do not scale it 1.05x; it breaks alignment with
neighbors.

**Toggle** (monthly/annual): a segmented control above the table, with the
savings stated plainly next to the annual option. Animate the price change
with a 150ms crossfade, not a counter.

**Comparison table** (for detailed plans): sticky plan header row, feature
groups with section headers, checkmarks and values (not "yes/no"), the
recommended column tinted, first column (feature names) sticky on
horizontal scroll on mobile.

**Enterprise / custom** column: no price, "Contact sales" as a secondary
CTA, the list of what is different.

**Details that matter.** Equal column heights with CTAs aligned at the same
y; the price baseline aligned across columns; tabular figures so $9 and $49
align; currency and locale formatting; fine print (taxes, per-seat) in
12-13px muted under the price, not in a tooltip. Avoid: strikethrough
"was" prices unless the discount is real and time-bound; emoji checks;
more than seven features per column (link to the full comparison).

## 7. Making it feel like a brand

A page feels like a specific brand when the same few decisions repeat
everywhere and those decisions are distinctive:

- **Type is the fastest route.** A display face with character used in
  every heading, at consistent weights and tracking, does more than any
  color. See typography.md and aesthetic-direction.md.
- **One signature device**, repeated: a particular border treatment, a
  background texture, a way of framing screenshots (a specific device
  frame, a tilted card, a hairline window chrome), a shape motif (a
  rounded corner cut, a circle, a diagonal), a way of highlighting text
  (a marker underline in the brand hue). Choose one and use it 3-5 times.
- **A color used with discipline.** The brand color on the primary CTA,
  the highlight device and one background band; everywhere else, neutrals.
  A page that is 40% brand color has no brand color.
- **Imagery with a consistent treatment**: all photos duotoned, or all
  illustrations in one line weight and palette, or all screenshots in one
  frame style. Mixed imagery styles are the fastest way to look like a
  template.
- **Voice in the small type**: button labels, section labels and footer
  text in the brand's register (this is the marketing skill's territory;
  make sure there is room for it).
- **Consistency with the product**: if the app is dense and cool, the
  marketing page can be more generous but should share the type, the
  accent and the radius. A warm, rounded marketing page for a stark,
  square product undermines both.

Avoid signature devices that have become generic: gradient mesh blobs,
glassmorphism cards floating over gradients, dot grids, "glow" borders,
isometric illustrations, 3D abstract shapes.

## 8. Imagery, illustration and product shots

- **Real product screenshots** are the most convincing imagery for
  software. Take them at 2x, with realistic data (real names, real-looking
  numbers, no "Lorem" or "Test 1"), in the best state (not empty), with
  the UI in the direction's theme. Frame consistently: no frame, a
  hairline-bordered rounded rectangle, or a minimal window chrome (three
  dots is fine; a full macOS chrome dates quickly). Crop tightly on the
  relevant part for feature sections; show the whole thing once in the hero.
- **Device frames** for mobile apps: one realistic frame, consistent across
  the page, with the status bar showing a sensible time and full battery.
- **Photography**: one treatment (color grade, crop ratio) throughout;
  people photographed in the product's context, not stock handshakes.
  Check licensing.
- **Illustration**: if used, one style with a limited palette drawn from
  the tokens, consistent line weight, and a reason to exist (explaining a
  concept a screenshot cannot). Avoid the flat-vector-people style that
  signals "we bought a pack."
- **Abstract visuals** (gradients, generative art, 3D): only if the
  direction is Kinetic or the brand is abstract (infrastructure, AI, data),
  and even then one, in the hero, with text contrast checked against its
  busiest region.
- **Video**: muted, autoplaying hero video only if it is the product in
  use, short, with a poster image, and paused under reduced motion. Never
  a stock background video.
- **Format and weight**: WebP or AVIF, `srcset` with 1x/2x, explicit
  dimensions, lazy loading below the fold, `fetchpriority="high"` on the
  hero image only.

## 9. Responsive hero behavior

The hero is where responsive design is most visible.

- **Type scales fluidly** with clamp(): headline from ~32px at 360 to
  ~64-72px at 1440; subhead from 16-17px to 20px; never let the headline
  exceed ~12vw on phones or it becomes two letters per line.
- **Split heroes stack**: text first, visual second on mobile; the visual
  gets a fixed aspect ratio and may be cropped (`object-fit: cover` with
  `object-position` set to the important side) or swapped for a mobile
  crop via `<picture>`.
- **Product-first heroes** on mobile: show a mobile-appropriate screenshot
  or a tight crop; a desktop app screenshot scaled to 360px wide is
  unreadable.
- **Buttons go full-width** on phones (stacked, 8-12px gap), primary
  first.
- **Height**: avoid `height: 100vh` heroes on mobile (browser chrome makes
  them jump); use `min-height: 100dvh` or, better, content-sized heroes
  with generous padding (`padding-block: clamp(4rem, 10vw, 8rem)`).
- **Decorative elements** (blobs, grids, floating cards) are the first
  things to drop on mobile; they crowd the text.
- **Nav collapses** to logo + CTA + menu button; keep the CTA visible on
  mobile, do not bury it in the menu.
- **Test at 360 and 390 widths in portrait and at 768 in both
  orientations**; the iPad portrait width is where split heroes most often
  break (two cramped columns).

## 10. Performance budgets

Marketing pages are judged on first impression and search ranking; both
depend on speed. Budgets for a landing page on a mid-range phone on 4G:

| Metric | Target | How |
|---|---|---|
| Largest Contentful Paint | under 2.0s | Hero image preloaded, sized, AVIF/WebP; fonts preloaded with swap; no render-blocking scripts |
| Interaction to Next Paint | under 200ms | Minimal JS on the page; defer analytics; no heavy animation libraries for a single reveal |
| Cumulative Layout Shift | under 0.05 | Explicit image dimensions; size-adjusted font fallbacks; reserved space for embeds and cookie banners |
| Total page weight (first view) | under 1.5MB; under 800KB is good | Images are the bulk; compress and lazy-load below the fold |
| JavaScript | under 150KB compressed; under 50KB is good | A marketing page rarely needs a framework runtime; ship static HTML where the stack allows |
| Fonts | under 150KB total | Subset; variable fonts; two files above the fold at most |
| Third-party scripts | as few as the business tolerates | Load after interaction or on idle; each tag manager pixel is 50-200KB |
| Hero video | under 3MB, or stream | Poster image; `preload="none"` until visible |

Design decisions that protect the budget: one display font; one hero
visual rather than five floating cards; CSS animations over JS animation
libraries; SVG for logos and icons; no autoplay carousel; no chat widget
on load (load on first scroll or after 5s).

Verify with Lighthouse in mobile mode and with the Performance panel
throttled; look at the filmstrip to see what the user sees at 1s and 2s.

## 11. Dark heroes, light bodies and section transitions

Many pages open with a dark hero and continue with light sections. Make the
boundary deliberate:

- **Hard cut** with a shared element crossing it (the hero screenshot
  overlapping 64-96px into the light section) is the cleanest.
- **Tonal step** (dark -> dark-tinted light -> white) over two sections
  for a gradual descent.
- **Angled or curved dividers** are a direction choice (Soft organic,
  Playful) and look dated elsewhere.
- **Gradient fade** from dark to light is almost always muddy; avoid.

Within a dark hero: text is off-white, the accent is the lighter dark-mode
variant, buttons on dark use the inverse primary (light fill, dark text)
or the accent with checked contrast, and the product screenshot is in dark
theme (a light-theme screenshot on a dark hero glows and looks pasted).

Alternating section backgrounds (white, tint, white, tint) are a rhythm
tool; give each tinted section a reason (grouping related content) rather
than striping mechanically.

## 12. Footer, nav and the small parts

**Nav**: logo left (SVG, 24-32px tall), 4-6 links, one primary CTA right,
optionally a secondary "Sign in" as text. Sticky with a backdrop blur or a
solid surface after scroll; transparent over a dark hero at the top if the
hero is dark. On scroll, add a hairline bottom border or a faint shadow.
Mobile: logo, CTA, menu icon; the menu is a full-screen or drawer panel
with large (18-20px) links and the CTA at the bottom.

**Footer**: columns of links (3-5) for larger sites, or a single row for
small ones; logo and one-line description left; legal line and social
icons at the bottom in `text-muted`; a newsletter field if the marketing
skill wants one. Background: subtle tint or inverse; keep contrast for the
small text (muted text on dark footers often fails 4.5:1).

**Cookie banner**: bottom, compact, two buttons of *equal* visual weight
if the law requires, dismissible, not covering the CTA.

**Announcement bar**: 36-40px above the nav, one line, one link, dismissible,
not animated.

**Scroll indicators, back-to-top buttons, progress bars**: skip unless the
page is very long and the direction is editorial.

**404 and legal pages** inherit the system; they are often the most
neglected and most visited by search engines.

## 13. The template tells, and fixes

| Tell | Fix |
|---|---|
| Centered hero, two buttons, screenshot below | Left-aligned split or product-first; one CTA |
| Gradient text in the headline | Solid ink; put the brand color on the CTA or one highlight device |
| Three cards with icons in circles | Alternating rows with real screenshots; bento with visuals; dense list |
| Every section `py-24` | Vary 48/96/128 with a rhythm; one slow section |
| ALL-CAPS tracked eyebrow above every heading | Remove; or one quiet label where the content needs categorizing |
| Gradient mesh blob behind the hero | A real visual, or typographic hero with space |
| Glass cards floating over a gradient | Solid surfaces on a disciplined background |
| Logo wall in full color at mixed sizes | Monochrome, optically equalized, one row |
| Five-star graphics with generic quotes | One real quote with face, name, company |
| Pricing cards with the middle one scaled up | Accent border and badge; equal heights |
| "Features" and "Benefits" and "Why us" sections all as card grids | Different layout per section |
| Isometric illustration of people and screens | Real product; or one illustration style drawn from the tokens |
| Fade-up on every section | One load moment in the hero; nothing else moves |
| Footer with 5 columns on a 3-page site | One row |
| Dark hero with a light-theme screenshot | Dark-theme screenshot, or a light hero |
| Hero paragraph spanning 1200px | `max-width: 55ch`, left-aligned |
| Lorem ipsum as layout filler | Realistic copy from the marketing skill before finalizing layout |
