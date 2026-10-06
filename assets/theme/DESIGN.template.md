# CENTCOM · DESIGN SYSTEM

**Theme:** Abyss (dark) / Shallows (light) · **Mascot:** Cento the octopus · **Version:** 1.0.0

> *An octopus has three hearts, eight arms, and a brain in every one of them. So does a good agent platform.*

This is the single reference for how Centcom looks, moves, sounds, and behaves. It covers the terminal client, the web app, the multiplayer layer, the mascot, the copy, and the brand surface. Everything here is backed by files in this repository; where a number appears (a hex value, a duration, a count) it is generated from, or checked against, those files.

**How to read this document**

| If you are... | Read |
|---|---|
| Building UI | §4 Colour, §5 Type, §6 Layout, §10 Components, §19 Implementation |
| Building the TUI | §10.1, §11 Agent states, §19.3 Terminal |
| Animating or drawing Cento | §3 Mascot, §9 Motion, §11 Agent states |
| Writing copy | §13 Voice, §14 Spinner lines |
| Designing multiplayer features | §12 Multiplayer |
| Reviewing a PR | §21 Review checklist |

**Source of truth.** `assets/theme/build_theme.py` generates `tokens.json`, `theme.css`, `tailwind.preset.js`, the terminal themes, `state-map.json` and `CONTRAST.md`. This document is rebuilt from `assets/theme/DESIGN.template.md` by `build_docs.py`. **Never edit the generated files by hand.** Change the generator, then rebuild.

---

## Table of contents

1. [Principles](#1-principles)
2. [Brand](#2-brand)
3. [The mascot: Cento](#3-the-mascot-cento)
4. [Colour](#4-colour)
5. [Typography](#5-typography)
6. [Layout, spacing and density](#6-layout-spacing-and-density)
7. [Shape, borders, elevation](#7-shape-borders-elevation)
8. [Iconography and pixel art](#8-iconography-and-pixel-art)
9. [Motion](#9-motion)
10. [Components](#10-components)
11. [Agent states and mascot behaviour](#11-agent-states-and-mascot-behaviour)
12. [Multiplayer](#12-multiplayer)
13. [Voice and microcopy](#13-voice-and-microcopy)
14. [Spinner lines](#14-spinner-lines)
15. [Sound and haptics](#15-sound-and-haptics)
16. [Accessibility](#16-accessibility)
17. [Plans, tiers and monetisation surfaces](#17-plans-tiers-and-monetisation-surfaces)
18. [Marketing and brand assets](#18-marketing-and-brand-assets)
19. [Implementation guide](#19-implementation-guide)
20. [Governance](#20-governance)
21. [Review checklist](#21-review-checklist)
22. [Appendix](#22-appendix)

---

## 1. Principles

Seven rules. When two of them conflict, the lower number wins.

**1. Legible before lovable.** Cento is charming, but the user came to get work done. Text contrast, layout and speed come first. The mascot never covers content, never blocks input, and can always be turned off.

**2. The terminal is home.** Centcom is a terminal-first product. Every visual idea must survive in a 24-bit-colour terminal, degrade in a 256-colour one, and stay readable in 16 colours or with `NO_COLOR` set. The web app is a sibling of the terminal, not a different product.

**3. Pixels are the brand.** Cento is built on a 12×12 grid; the interface borrows that grid. Hard edges, 4 px steps, offset shadows instead of blurs, `steps()` easing for anything mascot-related. Smooth gradients, soft glows and glassmorphism are off-brand.

**4. Deep water, bright signals.** The canvas is calm and dark-blue (Abyss). Colour is rare and means something: violet for *you / actions*, mint for *signals and live things*, status colours for *outcomes*. If everything is bright, nothing is.

**5. Show the fleet.** Centcom is about many agents and many people at once. The UI must make parallel work legible: who is doing what, where, and what needs a human. Presence, queues and ownership are first-class visuals.

**6. Personality in the gaps.** Humour lives in spinners, empty states, success moments and the mascot. It never lives in errors that block work, billing, security prompts, or destructive confirmations. Those are plain, calm and exact.

**7. Earn every animation.** Motion communicates state change. If an animation does not tell the user something, it is decoration, and decoration must be skippable, throttled, and off under reduced-motion.

---

## 2. Brand

### 2.1 Names

| Thing | Name | Notes |
|---|---|---|
| Company / product | **Centcom** | One word, capital C. Never "CentCom", "Cent-Com", "CENTCOM" in prose (the logotype is all-caps pixel; prose is not). |
| Mascot | **Cento** | Always "Cento", never "the octopus" in UI copy. In docs "Cento the octopus" is fine on first mention. |
| Multiple Centos | **the fleet** | "Your fleet is working on 3 branches." |
| A running agent | **a Cento** or **an agent** | "Cento" for the one the user is talking to; "agents" for sub-agents. |
| A unit of work | **a mission** | A task handed to one or more agents. |
| A shared session | **a command post** | The room where a team works together. The *host* runs it. |
| The hosted relay | **the relay** | The paid routing layer. |
| A teammate's agent | **a Cento in {colour}** | "Maya's green Cento". |

The name works twice: *Cent* from "centipede / cento (a patchwork of many parts)" and *Com* from "command". A command post for a patchwork of many parts. The octopus is eight arms, one head: one command, many hands.

### 2.2 Personality

Cento is **capable, curious, a little dramatic, never smug.**

| Cento is | Cento is not |
|---|---|
| Calm under pressure | Panicky (even when the animation panics, the copy stays calm) |
| Curious about the problem | Cutesy for its own sake |
| Dry, quick humour | Slapstick, memes, forced catchphrases |
| Honest about failure | Defensive or apologetic in a grovelling way |
| Generous with credit | Self-congratulating |
| Quietly competent | Loud |

Mental model: a very good colleague with a mild sense of theatre, who happens to have eight arms and does not mention it.

### 2.3 Brand attributes in one line each

- **Deep**: dark-blue water, bioluminescent accents.
- **Pixel**: 12×12 grid, hard edges, offset shadows.
- **Many hands**: parallel agents, shared sessions.
- **Playful precision**: jokes in the spinner, exactness in the diff.

### 2.4 Logo and wordmark

| Asset | Construction | Notes |
|---|---|---|
| **Mark** | Cento, idle pose, violet, at 12×12 grid | Antenna in mint. Use `mascot/svg/idle_blink.svg` or the static `mascot/cento-idle-a.svg`. |
| **Wordmark** | `CENTCOM` in Silkscreen Bold, letter-spacing +0.08em | Cap height = 2 mascot pixels at the lockup scale. |
| **Lockup (horizontal)** | Mark left, wordmark right, 1 mascot-body-width gap | Mark height = 1.5 × wordmark cap height. |
| **Lockup (stacked)** | Mark above, wordmark centred below | Gap = 1 mascot pixel × 3. |
| **Monogram** | Antenna + eyes only (a 12×7 crop, rows 0–7) | For favicons under 32 px. |

**Clear space:** one mascot-body-width (12 mascot pixels) on every side of the mark at any scale.
**Minimum sizes:** mark 24 px tall on screen (2 px per mascot pixel), 12 terminal rows tall never, use the half-block render (§8.4) at 6 rows minimum. Wordmark 10 px cap height.
**Never:** recolour the antenna, change the eye shape in the mark, add outlines, rotate the mark, place on a busy photographic background, stretch non-uniformly, or interpolate (always `image-rendering: pixelated`).

### 2.5 Taglines (pick one per surface, don't stack)

- *Command many hands.*
- *Eight arms. One command post.*
- *Your whole fleet, one terminal.*
- *Build together. Deep.*
- *Many agents. One mission.*

---

## 3. The mascot: Cento

### 3.1 Anatomy

Cento lives on a **12 × 12 pixel body grid**. Arms, props and effects extend outside it.

```
col  0 1 2 3 4 5 6 7 8 9 A B
row0 . . . . . T T . . . . .     T = antenna tip   (mint, or red in error)
row1 . . . . . S S . . . . .     S = antenna stalk (shadow shade)
row2 . . B B B B B B B B . .
row3 . H B B B B B B B B B .     H = highlight pixel, one only
row4 . B B B B B B B B B B .
row5 B B B B B B B B B B B B
row6 B B B P B B B B P B B B     eyes: ink pixels P at cols 3 and 8, rows 6-7
row7 B B B P B B B B P B B B
row8 B B B B B P P B B B B B     mouth: ink pixels P at cols 5-6, rows 8-9 (smile uses cols 4-7)
row9 D B B B B B B B B B B D     D = shadow pixels at both edges
row10 B B . B B . . B B . B B    legs, frame "a"
row11 B . B B . . . . B B . B
```

| Part | Spec |
|---|---|
| Body | 12 × 10 rows + 2 leg rows. Dome: row 2 is 8 wide, row 3–4 are 10 wide, rows 5–9 are the full 12. |
| Highlight | Exactly one `H` pixel at (row 3, col 1). It sits top-left. Never add more highlights. |
| Shadow | `D` pixels at (row 9, col 0) and (row 9, col 11). Two only. |
| Antenna | 2 px wide, 2 rows tall, centred on cols 5–6. The tip is the **only** place bioluminescent mint (`glow-400`) appears on the mascot. |
| Eyes | Single-column ink pixels, 2 tall, at cols 3 and 8 (default). Eyes are always dark ink (`ink-900 #1B1530`, or `ink-800` in the warm variant). No whites, no pupils. |
| Mouth | 1 to 3 ink pixels on rows 8–9, centred on cols 5–6. |
| Legs | Two rows. Four frames (`a`, `b`, `tuck`, `wide`). `a`/`b` alternate to make the idle wiggle. |
| Arms | Drawn outside the body, 1 px thick. Hands are one `D` pixel at the tip. Reach: up to 3 px beside the body (`far`) or 6 px (`reach`). |

### 3.2 The five colours (and what each means)

| Colour | Body | Shadow | Highlight | Role |
|---|---|---|---|---|
| **Violet** (default) | `#7C5CFF` | `#5A3FD1` | `#A892FF` | **You.** The primary Cento. Also the brand colour. |
| **Red** | `#FF2D2D` | `#B80F0F` | `#FF8080` | A teammate's Cento, slot 2. Never used to mean *error*; errors use the antenna turning red, not the body. |
| **Yellow** | `#FFD500` | `#C99A00` | `#FFEA70` | Teammate slot 3. |
| **Green** | `#22C55E` | `#15803D` | `#86EFAC` | Teammate slot 4. |
| **Brown** | `#8B5A2B` | `#5C3A1A` | `#B5895A` | Teammate slot 5. Needs a light outline on dark surfaces (§4.6). |

Rules:
1. The *signed-in user* is always violet on their own screen. Everyone else gets the next free colour in the order red → yellow → green → brown, assigned in join order and **stable for the life of the session**.
2. A sixth person reuses violet with a **crown-less, outlined** treatment (§12.4). Do not invent a sixth body colour.
3. Colour is never the only identifier. Presence always pairs colour with a **letter** (initial) and a **name** (§16.3).
4. In marketing, any colour may be used. In product UI, colour is meaningful: do not use "red Cento" as decoration.

### 3.3 Expression vocabulary

All expressions are made from combinations of eyes, mouth, arms, and accessories. This is the full set the engine supports.

**Eyes (20):** `open`, `closed`, `happy` (^), `ring` (surprised), `left`, `right`, `up`, `down`, `x`, `squint`, `dot`, `heart`, `star`, `dz1`/`dz2` (dizzy), `shine`, `tear`, `angry`, `sad`, `none`. Asymmetric combinations are allowed: `("up","right")` for a confused look, `("happy","open")` for a wink.

**Mouths (10):** `flat`, `smile`, `grin`, `open`, `gasp`, `frown`, `zig`, `small`, `tongue`, `none`.

**Arms (14):** `down`, `side`, `out`, `far`, `up`, `upw` (wave), `high`, `flex`, `cheer`, `dn` (hands on hips), `reach`, `hand`, `hand2`, `cover`.

**Accessories (14):** `headphones`, `sunglasses`, `glasses`, `party`, `cap`, `crown`, `wizard`, `headband`, `mask`, `cape`, `blush`, `sweat`, `bandage`, `green` (queasy).

**Reading the face:** the face is deliberately minimal. Meaning comes from the *combination* and from motion, not from detail. A neutral Cento has two dark vertical eyes and a two-pixel mouth; that is the baseline for every other expression.

### 3.4 Pixel rules (for anyone drawing new art)

1. **One grid.** Everything is on integer pixels of the same size within a single image. No half-pixels, no rotation (the lying-down pose uses a true 90° grid rotation).
2. **Max five body shades per character:** body, shadow, highlight, ink, plus the antenna tip. Props may add colours from the palette in `cento_lib.PAL_HEX`.
3. **No anti-aliasing, no dithering on the mascot.** (Dither is allowed in large illustrations only.)
4. **Silhouette first.** Every pose must read as "octopus blob with antenna" in a one-colour silhouette.
5. **Antenna always visible** unless covered by a hat accessory.
6. **Props are 3–11 px.** If a prop needs more than 11 px it is a scene element, not a prop.
7. **Text in pixels** uses the built-in 3×5 font (`cento_lib.FONT`), upper-case only, 1 px letter-spacing.
8. **Effects** (sparkles, confetti, flames, bursts) are 1–5 px and use the bright palette entries (`Y`, `p`, `c`, `b`, `r`, `G`, `w`).

### 3.5 The animation library

**{{ANIM_TOTAL}} animations** across {{ANIM_CATS}} categories, each available as:

| Format | Where | Notes |
|---|---|---|
| Data | `mascot/animations.json` | Frames as pixel rows + palette + colour maps. The runtime source of truth. |
| SVG (animated, CSS) | `mascot/svg/<name>.svg` | Violet, one loop, resolution-independent. |
| GIF, solo × 5 colours | `mascot/gif/{violet,red,yellow,green,brown}/<name>.gif` | Loops to ≥ 4 s. Scale 5×. |
| GIF, crowds | `mascot/gif/{duo,trio,squad,group}/<name>.gif` | Mixed colours, staggered timing. Scale 4×. |
| Terminal | `python3 mascot/play.py <name> [--color red]` | 24-bit half-block render. |
| Gallery | `mascot/gallery.html` | Browse, recolour, and tile all of them. |

Category breakdown:

{{ANIM_TABLE}}

**Stories** are chains of existing animations (e.g. `story_deploy_day`: commit → push → CI → deploy). They are for marketing, onboarding and demos, not for the live product.

### 3.6 Creating a new animation

1. Add a `reg(category, name, frames, description)` call in `mascot/animations.py` (or `animations_ui.py` for UI states).
2. A frame is `f(duration_ms, e=..., m=..., al=..., ar=..., p=[props], fr=dict(...) )`. Position props relative to Cento's top-left; `y < 0` is above the head.
3. Run `python3 mascot/build.py` and open `mascot/gallery.html`.
4. Check: silhouette reads, 2–8 frames, 80–500 ms per frame, loop point is seamless, nothing clipped.
5. Add it to `state-map.json` (via `build_theme.py`) **only if** it represents a real product state (§11).

Naming: `snake_case`, verb-or-state first (`file_locked`, `ci_failed`, `pr_merged`). Category prefix `ui_` is for product-state animations.

### 3.7 Mascot sizes

| Context | Scale | Pixel size of 12×12 body | Format |
|---|---|---|---|
| Favicon | 2× | 24 px | PNG from monogram |
| Inline status (web) | 3× | 36 px | SVG |
| Header / empty state | 6× | 72 px | SVG |
| Onboarding hero | 10× | 120 px | SVG |
| Marketing hero | 16–24× | 192–288 px | SVG / GIF |
| Terminal status line | — | 2 rows × 6 cols (half-blocks) | ANSI |
| Terminal hero | — | 6 rows × 12 cols (half-blocks) | ANSI |

Always integer scales. Always `image-rendering: pixelated` on rasters.

---

## 4. Colour

### 4.1 The four ramps

Raw palette values. **Components never use these directly**; they use semantic tokens (§4.2).

{{PALETTE}}

**Why these blues.** *Abyss* is a desaturated deep-sea navy tuned so large dark areas are comfortable for hours, with enough blue that it reads as "water" next to a neutral grey terminal. *Cento* is the mascot's own violet-blue and doubles as the brand and action colour. *Current* is a clear open-water blue for links and info. *Glow* is the bioluminescent mint of the antenna: used sparingly, for anything alive or live.

### 4.2 Semantic tokens

Components use these. Dark = **Abyss** (default), Light = **Shallows**.

{{SEMANTIC}}

CSS names replace `.` with `-`: `bg.surface` → `var(--bg-surface)`.

### 4.3 Colour roles (when to use what)

| Role | Token | Use for | Never for |
|---|---|---|---|
| Page | `bg.base` | The page/terminal background | Cards |
| Surface | `bg.surface` | Panels, cards, sidebars | Text |
| Raised | `bg.raised` | Inputs, popovers, selected row | Page background |
| Overlay | `bg.overlay` | Modals, command palette | Inline content |
| Sunken | `bg.sunken` | Code blocks, terminal wells | Interactive controls |
| Primary action | `accent.fill` + `accent.on` | The one main button per view | Body text |
| Accent text/icon | `accent.primary` | Active tab icon, selection edges | Large fills |
| Signal | `signal` | Live/active/online, running agent, focus ring | Decorative flourishes |
| Link | `text.link` | Hyperlinks, file paths | Buttons |
| Success / Warning / Danger / Info | `status.*` | Outcomes only | Branding |

**The 60-30-10 rule** for a typical screen: ~60 % `bg.*`, ~30 % `text.*` and `border.*`, ~10 % colour (`accent`, `signal`, `status`). If a screen has more than ~10 % saturated colour, remove some.

**One primary action per view.** One `accent.fill` button. Everything else is secondary or ghost.

### 4.4 Status colours

| Status | Dark | Light | Means | Always paired with |
|---|---|---|---|---|
| Success | `#4ADE80` | `#14733A` | Done, passed, merged, saved | ✓ and the word |
| Warning | `#FFD166` | `#8A5A00` | Needs attention, near a limit | ! and the word |
| Danger | `#FF5C5C` | `#C21B1B` | Failed, destructive, blocked | ✗ and the word |
| Info | `#5AA9FF` | `#1B5FB8` | Neutral news, updates | i and the word |

Each has a `.subtle` tint for banner backgrounds. **Status colour is never the only signal** (§16).

### 4.5 Contrast report

All pairs below are computed from the actual token values (WCAG 2.1). Targets: body text ≥ 7 : 1 (AAA), secondary and muted text ≥ 4.5 : 1 (AA), non-text UI ≥ 3 : 1.

{{CONTRAST}}

If you add or change a token, run `python3 assets/theme/build_theme.py`; it prints any pair that fails.

### 4.6 Presence colours on dark surfaces

The five Cento body colours are *not* all text-safe on Abyss. They are used as **fills with a letter inside**, never as text colour.

| Colour | Hex | Contrast on `bg.base` | Initial colour | Initial contrast | Treatment |
|---|---|---|---|---|---|
| Violet | `#7C5CFF` | 4.55 | white | 4.35 | fill |
| Red | `#FF2D2D` | 5.33 | `ink-900` | 4.73 | fill |
| Yellow | `#FFD500` | 13.89 | `ink-900` | 12.34 | fill |
| Green | `#22C55E` | 8.67 | `ink-900` | 7.70 | fill |
| Brown | `#8B5A2B` | 3.38 | white | 5.84 | fill + 1 px `abyss-300` ring so it never sinks into the background |

The initial is redundant with the name shown next to or in the tooltip of every avatar, so it is a recognition aid, not the only carrier of text; all five pairs still clear 3 : 1.

### 4.7 Colour-blind safety

The five Cento colours were chosen so they differ in **lightness as well as hue** (yellow brightest, brown darkest, violet/red/green mid). Combined with the mandatory letter and name, no information is lost for deuteranopia, protanopia or tritanopia. Status colours are always accompanied by an icon glyph and a word. Red/green are never the only difference between two states.

### 4.8 Data visualisation palette

For charts (usage, cost, agent activity). Use in this order; never more than 6 series in one chart.

| # | Name | Hex | Notes |
|---|---|---|---|
| 1 | Cento | `#7C5CFF` | Primary series |
| 2 | Glow | `#3DF2C8` | |
| 3 | Current | `#5AA9FF` | |
| 4 | Sun | `#FFD166` | |
| 5 | Coral | `#FF7A6B` | |
| 6 | Mist | `#A9B6E8` | Neutral / "other" |

Gridlines `border.subtle`, axis text `text.muted`. Direct-label series where possible instead of a legend.

### 4.9 Gradients and glow

Mostly **no**. The only sanctioned effects:
- `shadow.glow-signal`: a 1 px mint ring + 16 px soft glow on *live* elements (the running agent card, the recording indicator). Max one glowing element per screen region.
- A vertical `abyss-950 → abyss-900` page gradient on marketing hero sections only ("light fading with depth").

---

## 5. Typography

### 5.1 Families

| Role | Family | Fallbacks | Use |
|---|---|---|---|
| **Mono** (primary) | JetBrains Mono | Berkeley Mono, IBM Plex Mono, system monospace | The terminal, code, paths, tokens, numbers in tables, most UI labels in the TUI |
| **Sans** | Inter | system-ui stack | Web UI body, marketing body, forms |
| **Pixel** | Silkscreen | Pixelify Sans, Press Start 2P | Wordmark, big numbers, level-up/achievement moments, section "stamps". **Never body text. Never below 12 px.** |

Why mono first: the product is a terminal. The web app uses Inter for reading comfort but keeps mono for anything technical so users see the same glyphs in both places.

### 5.2 Scale

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `xs` | 11 / 16 | 400 | Fine print, timestamps |
| `sm` | 12 / 18 | 400 | Captions, chips, table meta |
| `base` | 14 / 22 | 400 | Body, UI default |
| `md` | 16 / 24 | 400 | Marketing body, long-form |
| `lg` | 18 / 28 | 500 | Card titles |
| `xl` | 22 / 30 | 600 | Section headings |
| `2xl` | 28 / 36 | 600 | Page headings |
| `3xl` | 36 / 44 | 700 | Hero (app) |
| `display` | 56 / 60 | 700 | Hero (marketing) |

Line height is always a multiple of 2 px so text sits on the 4 px grid every other line.

### 5.3 Rules

- Measure: 60–75 characters for prose. Terminal output is wrapped by the terminal, not by us.
- Weight: 400 body, 500 emphasis, 600 headings. Avoid 300 on dark backgrounds (it thins out).
- Letter-spacing: 0 for body; +0.02em for the pixel font; +0.08em for ALL-CAPS labels (use `h3` style: 12 px mono 600, uppercase).
- Numerals: use tabular figures in tables and counters (`font-variant-numeric: tabular-nums`). Token and cost numbers are right-aligned.
- Case: sentence case everywhere. ALL-CAPS only for small section labels, pixel-font stamps, and keycaps.
- Ligatures: **off** in code (`font-variant-ligatures: none`) so `=>` and `!=` look the way they were typed.
- Truncation: middle-truncate file paths (`src/…/client.ts`), end-truncate everything else, always with `…` and a tooltip/expand.

### 5.4 Terminal typography

The TUI cannot choose a font, only styles:

| Style | Used for |
|---|---|
| **Bold** | Headings, the active tab, the user's own prompt, key names in help |
| *Dim* | Secondary text, timestamps, hints, spinner timers |
| Italic | Tool descriptions, thinking summaries (avoid; support is uneven) |
| Underline | Links, `[a]ccept` hotkeys |
| Reverse | Selection, the current row in lists |
| Strikethrough | Rejected diff lines (rare) |

Never use blink. Never rely on italic or underline alone to carry meaning.

---

## 6. Layout, spacing and density

### 6.1 The 4 px grid

Everything snaps to 4 px (web) or 1 cell (terminal). The mascot's pixel scale is always a multiple of 2 so mascot and UI share the grid.

| Token | px | Typical use |
|---|---|---|
| `space-1` | 4 | Icon-to-label gap |
| `space-2` | 8 | Inline gaps, chip padding |
| `space-3` | 12 | Control padding, stack gap |
| `space-4` | 16 | Card padding, section gap |
| `space-6` | 24 | Between cards |
| `space-8` | 32 | Page gutters |
| `space-12` | 48 | Between page sections |
| `space-16` | 64 | Hero spacing |

### 6.2 Breakpoints

`sm 480 · md 768 · lg 1024 · xl 1280 · 2xl 1600`. Design mobile-first; the multiplayer view degrades to a single column with a presence strip on top.

### 6.3 Page frame (web)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▣ CENTCOM   Session ▾    ● live · 3 agents · 2 online        [Invite] ◐  │ 48px top bar
├────────┬─────────────────────────────────────────────────┬───────────────┤
│        │                                                 │               │
│ Fleet  │   Main conversation / terminal view             │  Inspector    │
│ 240px  │   (fluid, max 880px line length)                │  320px        │
│        │                                                 │  (files,      │
│ agents │                                                 │   diff, tools,│
│ branch │                                                 │   queue)      │
│ team   │                                                 │               │
├────────┴─────────────────────────────────────────────────┴───────────────┤
│ ▸ message the fleet…                                          ⏎ send    │ input, 56px min
└──────────────────────────────────────────────────────────────────────────┘
```

Left rail collapses under `lg`; inspector becomes a bottom sheet under `md`.

### 6.4 Terminal frame (TUI)

```
 cento · ~/centcom · main                          ● 3 agents · 2 online · $0.42
────────────────────────────────────────────────────────────────────────────────
  (scrollback: messages, tool calls, diffs)

● you  add retry logic to the relay client

  Inking…  (12s · ↑ 1.4k tokens · esc to interrupt)

────────────────────────────────────────────────────────────────────────────────
 ▸ _
────────────────────────────────────────────────────────────────────────────────
 ⏵⏵ accept edits on   ·   agent/feature-retry   ·   ctrl+t tasks   ·   ? help
```

- Header and footer are one line each, `text.muted`.
- The prompt box is bordered with `border.default`; the border turns `signal` while an agent is running.
- Minimum supported size: **80 × 24**. Below 80 columns the status line drops optional fields in this order: cost → branch → agent count → hints.

### 6.5 Density modes

| Mode | Row height | Padding | Where |
|---|---|---|---|
| Comfortable (default) | 36 px | 12 px | Web |
| Compact | 28 px | 8 px | Tables of agents, long diffs |
| Terminal | 1 row | 1 col | TUI |

Density is a user setting, not an automatic switch.

---

## 7. Shape, borders, elevation

### 7.1 Radius

| Token | px | Use |
|---|---|---|
| `none` | 0 | Terminal-style panels, code blocks, the pixel look |
| `px` | 2 | Tiny chips, keycaps |
| `sm` | 4 | Tags, inline code |
| `md` | 8 | Buttons, inputs |
| `lg` | 12 | Cards, modals |
| `pill` | 999 | Status chips, avatars (circular variant only) |

Pick **one** radius per component family and keep it. Mascot art and pixel-style panels use `none`.

### 7.2 Borders

1 px, `border.default` for containers, `border.subtle` for dividers, `border.strong` for the focused container and drag handles. Borders are the primary separator; shadows are secondary.

### 7.3 Elevation

Elevation is shown by **lightness + a hard offset shadow**, not by blur.

| Level | Surface | Shadow | Use |
|---|---|---|---|
| 0 | `bg.base` | none | Page |
| 1 | `bg.surface` | none | Panels |
| 2 | `bg.raised` | `pixel-sm` (2 px 2 px 0) | Cards, popovers |
| 3 | `bg.overlay` | `pixel-md` (4 px 4 px 0) | Modals, menus |
| Live | any | `glow-signal` | The running agent only |

In the terminal, elevation is simulated with box-drawing borders and a one-cell dim shadow (`▒` or `░`) to the right and below.

---

## 8. Iconography and pixel art

### 8.1 Icon grid

- 16 × 16 px canvas, 1 px stroke equivalent, **pixel-drawn** (no curves), 2 px padding.
- 12 px and 20 px variants are scaled integers of a 4 px-aligned redraw, never browser-scaled.
- Colour: icons inherit `currentColor`. Two-tone icons use `signal` for the single "live" detail.

### 8.2 The prop set doubles as the icon set

The mascot's props are already pixel icons and should be reused to keep one visual language.

| Meaning | Prop | | Meaning | Prop |
|---|---|---|---|---|
| File | `file` | | Folder | `folder` |
| Delete | `trash` / `trash_open` | | Security | `shield`, `shield_ok`, `shield_x` |
| Cost / tokens | `coin` | | Notification | `bell` |
| MCP / connection | `plug` | | Skill / plugin | `puzzle` |
| Memory | `brain` | | Save | `floppy` |
| Clipboard | `clipboard` | | Screenshot | `camera` |
| Hook | `lightning` | | Pin / comment | `pin` |
| API key | `key` | | Diff | `diff` |
| CI status | `traffic_r/y/g` | | Theme toggle | `toggle_on/off` |
| Settings | `gear`, `wrench` | | Billing | `card` |
| Online | `wifi` | | Release | `flag` |
| Search | `magnifier` | | Message | `envelope` |
| Locked | `lock` | | Time | `hourglass_a/b` |

### 8.3 Pixel illustration style (empty states, onboarding)

- Scene width 96–160 px at 1× pixel (scaled up by an integer).
- Palette: Abyss ramp + Cento + at most two accent colours.
- Cento is the only character. Teammates are Cento in their colour.
- A thin 1 px `abyss-600` baseline (seafloor) anchors every scene.

### 8.4 Terminal rendering of pixel art

Use the **half-block technique**: every character cell carries two vertical pixels (`▀` with foreground = top pixel, background = bottom pixel). A 12×12 Cento is 6 rows × 12 columns. `mascot/play.py` is the reference implementation.

Fallbacks:
1. No true colour → quantise to xterm-256 (`{{FALLBACK_NOTE}}`).
2. Under 16 colours or `NO_COLOR` → render a two-line ASCII Cento: `(•‿•)` with the antenna `¡` (see §19.3).
3. Narrow terminal (< 60 cols) or `CENTO_MASCOT=off` → no mascot.

---

## 9. Motion

### 9.1 Principles

1. **Communicate change.** Animate arrival, departure, and state transition; never idle decoration beyond the mascot's breathing.
2. **Quick in, quiet out.** Enter fast, exit faster.
3. **Pixel-step the mascot, ease the UI.** Mascot frames use hard cuts (`steps(1)`); UI uses the standard easings.
4. **Never block.** No animation delays input. Animations are interruptible.
5. **Respect the user.** `prefers-reduced-motion` and `CENTO_REDUCE_MOTION=1` replace motion with instant changes plus a static mascot pose.

### 9.2 Duration and easing tokens

| Token | ms | Use |
|---|---|---|
| `instant` | 0 | Reduced-motion, state toggles in the TUI |
| `fast` | 80 | Hover, press, tooltip |
| `base` | 160 | Menu open, tab switch, toast in |
| `slow` | 280 | Panel slide, modal |
| `slower` | 480 | Page transitions, onboarding steps |
| `mascot-tick` | 120 | Default mascot frame length |

| Easing | Curve | Use |
|---|---|---|
| `standard` | cubic-bezier(.2, 0, 0, 1) | Most UI transitions |
| `enter` | cubic-bezier(0, 0, .2, 1) | Things appearing |
| `exit` | cubic-bezier(.4, 0, 1, 1) | Things leaving |
| `pixel` | steps(4, end) | Pixel-style progress and mascot movement |

### 9.3 Mascot timing

- Frame durations are 80–500 ms. Typing and panic are fast (70–110 ms); sleeping and meditation are slow (450–550 ms).
- Idle loop: `idle_breathe` (900 ms cycle). After 20 s idle: `idle_blink`. After 3 min idle: `look_around`. After 10 min: `status_away` / `sleeping`.
- Transitions between states are **hard cuts**; if you want a bridge, play at most one 200 ms "ring eyes + `!`" beat (`prompt_received`) first.
- A one-shot animation (celebrate, error, level-up) plays once, then returns to the state the agent is actually in.

### 9.4 Loading patterns

| Wait time | Pattern |
|---|---|
| < 100 ms | Nothing |
| 100 ms – 1 s | Subtle: dim the target, no spinner |
| 1 – 4 s | Spinner glyph + verb (§14), no mascot |
| 4 s – 30 s | Mascot `thinking` / `tool_running` + verb + elapsed time |
| 30 s+ | Add token count, "esc to interrupt", and if truly stuck, a `waiting` mascot with a calm message |
| Unknown / stalled | Mascot `waiting` (hourglass); say what we are waiting on |

### 9.5 Spinner glyphs (terminal)

A 10-frame braille spinner at 80 ms: `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`, coloured `signal`. The mascot never replaces the glyph in the terminal footer; it appears in the transcript area only when there is room (§10.1.9).

---

## 10. Components

Each component lists: purpose, anatomy, states, and rules. Sizes are web px; the terminal analogue is described where it differs.

### 10.1 Terminal (TUI) components

#### 10.1.1 Prompt box
- Bordered box (`border.default`), 3 rows minimum; grows to 12 rows then scrolls.
- Left gutter: `▸` in `accent.primary` (idle), `signal` (agent running), `status.warning` (awaiting approval).
- Placeholder in `text.muted`: *"Message the fleet…"* (teams) / *"What should we build?"* (solo).
- Multiline: `shift+⏎` newline, `⏎` send. Slash commands open the command palette inline.
- States: idle, focused (border `border.strong`), running (border `signal`), disabled (dim, with reason), error (border `status.danger` + message below).

#### 10.1.2 Message blocks
| Block | Marker | Colour |
|---|---|---|
| User message | `●` + "you" | marker `signal`, name `accent.hover` |
| Assistant text | none, left-aligned, 2-col indent | `text.primary` |
| Tool call | `●` + `Name(arg)` | marker `signal`, arg `text.link` |
| Tool result | `└` + summary | `text.muted` |
| Thinking | `∴` + dim italic text, collapsible | `text.muted` |
| System / notice | `※` | `status.info` |

Message spacing: one blank row between blocks, zero between a tool call and its result.

#### 10.1.3 Diff view
- Added lines: `status.success` text on `status.success.subtle` background, prefixed `+`.
- Removed lines: `status.danger` on `status.danger.subtle`, prefixed `-`.
- Context: `text.secondary`, 3 lines either side.
- Line numbers in `text.muted`, right-aligned, 5 cols wide.
- Word-level highlights invert the changed span (bold + brighter background).
- Long hunks collapse with `⋯ 42 unchanged lines` (expandable).

#### 10.1.4 Permission prompt
```
 ┌ Allow Cento to run a command? ─────────────────────────────────────────┐
 │  npm test -- --watch=false                                             │
 │  in ~/centcom (agent/feature-retry)                                    │
 │                                                                        │
 │  [y] yes    [a] always for this project    [n] no    [e] edit command  │
 └────────────────────────────────────────────────────────────────────────┘
```
- Border `status.warning`. Mascot: `permission_prompt` (shield) in the web version only.
- The default key is *never* the destructive one. Destructive actions (delete, force-push, deploy to prod) get a red border and require typing `y` plus `⏎`, never just `y`.
- Always show *what*, *where* (directory + branch), and *whose agent*.

#### 10.1.5 Status line
Fields, in drop priority (last to drop first): mode · branch · agent count · online count · cost · hints.
`⏵⏵ accept edits on · agent/feature-retry · ● 3 agents · ☻ 2 online · $0.42 · ? help`

#### 10.1.6 Task / agent list
One row per agent: `[colour dot] name · branch · state · elapsed`. State word uses the status colour; the active row has reverse video. Rows needing a human sort to the top and show `needs you` in `status.warning`.

#### 10.1.7 Progress
- Determinate: `▕████████░░░░▏ 62 %` using `█` and `░`, coloured `signal` on `border.subtle`.
- Indeterminate: sliding 6-cell block `▏░░▓▓▓░░░░▕` at 80 ms.
- Always show a label of *what* is progressing.

#### 10.1.8 Toasts (terminal)
One line above the prompt, 4 s, dismissible with `esc`. Prefix glyph: `✓` success, `!` warning, `✗` error, `i` info. Max one visible; later ones queue.

#### 10.1.9 Mascot in the terminal
- Appears in: first-run, empty states, long waits (≥ 8 s) beside the spinner line, success/failure moments, and `/mascot`.
- Size: 6 rows × 12 cols. Never when the terminal is shorter than 30 rows or narrower than 80 cols.
- Never appears inside a tool result, diff, or code block.
- Frequency cap: one celebratory animation per 10 minutes; one error animation per failure (no repeat on retry).
- Off switch: `/mascot off` or `CENTO_MASCOT=off`.

#### 10.1.10 Command palette
Centred box, 60 cols, fuzzy search, grouped results (Commands · Files · Sessions · Skills). Matched characters in `signal` bold. Max 8 visible rows. Footer hints: `↑↓ move · ⏎ run · esc close`.

#### 10.1.11 Empty and first-run
First run shows Cento waving (`first_run_welcome`), one sentence, one command to try, and where to read more. No multi-step tour in the terminal.

#### 10.1.12 Providers, sign-in and "who pays"

Centcom drives the user's **own** `claude` (Claude Code) and `codex` CLIs (contract CT-PROVIDER). We never see a login, so the UI is mostly honest *status* and *handoff*.

**First-run step** (after the welcome): "Centcom works with your own Claude Code and Codex. We never see your login."
```
 Models
   Claude Code   ✓ installed 2.1.x   ✓ signed in (subscription)      [use]
   Codex         ✓ installed 0.xx    ✗ not signed in                  [sign in…]
```
- `[sign in…]` launches the vendor's own login **in this terminal** and re-checks when it exits. No custom OAuth screen, no password or token field, ever.
- If a CLI is missing: one line with the official install hint for the user's OS.
- Names appear as plain text ("Claude Code", "Codex"). No vendor logos, no "Sign in with Claude/ChatGPT" button of our own, no vendor words in our product or feature names.

**Who pays (always visible):** every agent card and the status line show `runs on <name> · <provider>`. In a command post:
- the guest composer says **"Your prompt will run on Maya's account."**
- the host sees **"2 guests can spend your Claude Code usage"** with a one-key pause.
- a subscription-backed engine is **blocked by default** for shared sessions; the notice says plainly why and offers the API-key route. Copy: *"This session would run other people's prompts on your Claude Code login. Use an API key for shared sessions, or run your own agent on a branch."*

**Limits and failures:** show the tool's own message verbatim in a dim frame under a calm headline ("Claude Code reached its usage limit"), switch the mascot to `quota_reached`, never retry in a loop. States: `provider-auth-required` (`auth_needed`), `provider-cap-reached` (`quota_reached`), `provider-policy-blocked` (`permission_denied`).

**No jokes** in provider, billing or policy messages (principle 6).

### 10.2 Web components

#### 10.2.1 Buttons
| Variant | Fill | Label | Border | Use |
|---|---|---|---|---|
| Primary | `accent.fill` | `accent.on` | none | One per view |
| Secondary | `bg.raised` | `text.primary` | `border.default` | Default |
| Ghost | transparent | `text.link` | none | Tertiary, inline |
| Danger | `status.danger.subtle` | `status.danger` | `status.danger` | Destructive |

Height 36 (comfortable) / 28 (compact); padding 8×16; radius `md`; label 14/22 600. Hover: fill → `accent.hover` (primary) or `bg.hover` (others). Pressed: 1 px down, shadow removed. Disabled: 40 % opacity, `not-allowed`, and a tooltip saying *why*. Focus: 2 px `focus.ring`, 2 px offset. Loading: label replaced by the spinner glyph, width held, never shrink.

#### 10.2.2 Inputs
Sunken fill (`bg.sunken`), 1 px `border.default`, radius `md`, mono 14. Label above (12 px, `text.secondary`), helper text below (12 px, `text.muted`), error text replaces helper in `status.danger` with a ✗ glyph. Focus: ring + border `border.strong`. Placeholder is `text.muted`, which meets 4.5 : 1, but never use placeholder as the label.

#### 10.2.3 Cards
`bg.surface`, 1 px `border.default`, radius `lg`, padding 16, shadow `pixel-sm`. A card has one title (lg), one meta line (sm, `text.muted`), optional chips, and at most one primary action.
**Agent card** adds: colour dot + initial, branch, current state with mascot thumbnail (36 px) for the running state, elapsed time. The running card gets `glow-signal`.

#### 10.2.4 Chips and badges
Pill, 18/24 high, mono 12, 1 px border, optional 8 px status dot. Types: **status** (dot + word), **role** (ADMIN, HOST, VIEW, EDIT), **plan** (FREE/PRO/TEAM), **count**.

#### 10.2.5 Tabs
Underline style. Active: `text.primary` with a 2 px `signal` underline. Inactive: `text.secondary`. Keyboard: arrow keys move, `⏎` activates. Max 6 visible; overflow into a `⋯` menu.

#### 10.2.6 Banners
Full-width inline banners with icon glyph, one line of text, optional action. Types: success, warning, danger, info. Persistent banners (offline, quota) are not dismissible until resolved. Max two stacked.

#### 10.2.7 Toasts
Bottom-right, 360 px max, 4 s (8 s for errors; errors with an action persist). `bg.overlay`, `pixel-md`, 3 px left bar in the status colour. Never stack more than 3; collapse into "+2 more".

#### 10.2.8 Modals
`bg.overlay`, radius `lg`, 480 px (small) / 720 px (large), backdrop `#000a`. Title (xl), body, footer with right-aligned actions (primary rightmost). `esc` and backdrop click close unless there is unsaved input or a destructive confirm. Focus is trapped; initial focus on the first field or the safest action.

#### 10.2.9 Tables
Row 36 / 28; header 12 px mono uppercase `text.muted`; zebra off; hover `bg.hover`; selected `bg.selected` with a 2 px `accent.primary` left edge. Numeric columns right-aligned, tabular figures. Sticky header. Empty tables show the empty-state pattern (§10.2.12).

#### 10.2.10 Avatars and presence
32 px square, radius `md` (not circular; the pixel look), fill = Cento colour, 11 px pixel-font initial (white on violet and brown, `ink-900` on the others; §4.6). 2 px ring in `bg.base` to separate overlapping avatars (−8 px overlap). Presence dot (8 px) bottom-right: `status.success` online, `status.warning` away, `border.strong` offline, `status.danger` busy/DND. Stack shows ≤ 5, then `+N`.

#### 10.2.11 Cursors (multiplayer)
A 4×6 pixel arrow in the person's Cento colour with a 1 px `bg.base` outline and a name tag (mono 11, fill = their colour, text `ink-900`/white) offset 8 px right-down. Tags fade to 40 % after 3 s of no movement and disappear after 10 s. Your own cursor is never labelled.

#### 10.2.12 Empty states
Anatomy: pixel scene (Cento in a situation, 96 px) → one-line headline (xl) → one sentence (base, `text.secondary`) → one primary action. Examples: no sessions (`empty_state`), no results (`no_results`), no team (`welcome`), offline (`offline`). Never more than one action; never a sad face on an empty list that is simply new.

#### 10.2.13 Skeletons
Use `bg.raised` blocks pulsing 60→100 % opacity over 1.2 s. Under reduced motion: static. Never show a skeleton for less than 300 ms; delay it by 150 ms to avoid flashing.

#### 10.2.14 Tooltips
`bg.overlay`, 12 px, 8 px padding, max 240 px, appears after 400 ms on hover and immediately on keyboard focus. Tooltips never carry information that isn't available elsewhere.

#### 10.2.15 Command post header
Session name (xl), host crown chip, presence stack, invite button (primary only if the user is host and the session has capacity), connection state chip (`● relay`, `● lan`, `● offline`).

---

## 11. Agent states and mascot behaviour

Every product state maps to one canonical mascot animation. The map lives in `state-map.json` and is validated against the animation library each time the theme is built, so a renamed or missing animation fails the build.

### 11.1 The state map

{{STATEMAP}}

### 11.2 Priority

When several states apply at once, the visible one is the **highest** in this list:

1. `crash`, `error`, `auth-required`, `session-expired`, `offline`
2. `awaiting-approval`, `asking-question`, `merge-conflict`
3. `rate-limited`, `quota-reached`, `context-full`, `cost-alert`, `provider-cap-reached`, `provider-policy-blocked`
4. `tool-running`, `editing-file`, `running-command`, `streaming`, `thinking`
5. `ci-*`, `pr-*`, `deploying`
6. `background-task`, `compacting`, `saving`
7. `teammate-*`, `host-session`, `message-queued`
8. `idle`, `ready`, `sleeping`, `away`

Lower-priority states are still shown as chips or in the status line; they just don't own the mascot.

### 11.3 State machine (single agent)

```
            ┌──────────── esc / interrupt ────────────┐
            ▼                                          │
 idle ──► prompt-received ──► thinking ──► planning? ──► tool-running ──► streaming ──► success ──► idle
            │                    │                         │   ▲              │
            │                    ▼                         ▼   │              ▼
            │             asking-question           awaiting-approval      error ──► idle
            │                    │                         │ approved/denied   │
            ▼                    └────────────►────────────┘                   ▼
        auth-required                                                      (retry → tool-running)
```

### 11.4 Behaviour rules

1. **State drives the mascot; the mascot never drives state.** The animation is a view of real state, not a toy.
2. **One mascot per agent.** In multi-agent views, each agent card shows its own 36 px Cento in its owner's colour.
3. **Minimum dwell:** a mascot state shows for ≥ 600 ms before switching, to avoid flicker when states change rapidly (e.g. reading ten files in a row stays on `reading_file`).
4. **Bursty tool calls collapse:** more than three tool calls in 2 s show `tool_running` once instead of cycling.
5. **Completion beats:** success plays its one-shot (`thumbs_up`, or `celebrate` only for milestones: first commit, PR merged, release) then settles to `idle`.
6. **Failures are acknowledged once:** `error` plays once per failure. Retries do not replay it; the second consecutive failure shows `worried` and a calm explanation.
7. **Night mode:** between local 23:00 and 06:00 after 30 minutes of inactivity, Cento shows `sleeping` instead of `idle`. Never wake with a sound.
8. **Easter eggs** are allowed, must be discoverable by accident, and must never appear during errors, billing or security prompts. Examples: typing `/dance` plays `dance`; running `git push` on a Friday after 17:00 triggers a `worried` glance.
9. **No state shows the mascot in a way that implies blame** (no pointing, no `facepalm` at the user, `git_blame` is a joke only in the opt-in fun pack).

### 11.5 Mascot-free surfaces

The mascot does not appear in: payment forms, legal/consent text, security warnings, destructive confirmations, accessibility settings, and any region with `aria-live="assertive"`. These stay plain.

---

## 12. Multiplayer

### 12.1 Modes

| Mode | What it is | Visual language |
|---|---|---|
| **Branch mode** | Each agent works on its own branch/worktree; people merge later | Fleet board: one card per agent, branch graph, merge actions |
| **Command post** | One host session; others queue messages into it | One transcript, a queue strip, host crown |
| **Both** | Command post that can spawn branch agents | Transcript + fleet board in the left rail |

Transport (LAN direct / hosted relay) is shown as a chip, never as a mode: `● lan`, `● relay`, `○ offline`.

### 12.2 Presence

- Presence stack in the header (§10.2.10). Click opens the roster: avatar, name, role, colour name, what they're doing ("typing", "reviewing diff", "away 4m"), and a nudge button.
- A person's Cento colour is also the colour of their: cursor, message gutter bar (3 px), queued message chip, selection highlight (20 % alpha), and branch dot.
- When someone joins: `join_session` plays once in the roster, a toast says "Maya joined", and the avatar slides in (`base`, `enter`). When they leave: `leave_session`, a toast, avatar fades (`slow`, `exit`).

### 12.3 The queue (command post)

- Messages from non-hosts appear as **queued chips** above the prompt: `[colour dot] Maya · "add tests for the…" · #2`.
- The host sees `approve`, `edit`, `reorder`, `drop` on each; guests see only their own with `cancel`.
- Position badge counts down; the head of the queue pulses `signal` once when it starts running.
- Mascot: `queue_position` for the guest's own message; the host's Cento stays on the agent's actual state.
- Auto-approve is a host setting with three levels: *ask each time* (default), *trusted teammates*, *everyone*.

### 12.4 Roles

| Role | Chip | Can | Visual |
|---|---|---|---|
| **Host** | `HOST` + crown accessory in roster | Run the session, approve queue, change settings, end session | `signal` chip |
| **Editor** | `EDIT` | Send messages, queue, review, approve own messages | `accent.primary` chip |
| **Viewer** | `VIEW` | Watch, comment | `text.muted` chip with `glasses` |
| **Admin** (workspace) | `ADMIN` | Manage seats, billing, members | `status.warning`-tinted chip, crown |

The sixth and later participants reuse violet with a 1 px `abyss-300` outline and a distinct initial (§3.2).

### 12.5 Conflicts and handoffs

- **File conflicts** (two agents editing the same file): both agent cards show `file_locked`; the later one waits with `waiting`; the inspector shows who holds the lock and for how long. Resolution actions: *wait*, *take turns*, *branch off*.
- **Merge conflicts** surface as `merge_conflict` on the owning agent plus a banner with a *Resolve with Cento* action.
- **Handoffs** ("pass this to Maya's Cento") animate the task chip moving between roster rows, with `handoff` on the sender and `welcome` on the receiver.
- **Pairing**: two people on one agent show `pair_programming` in the roster and merge cursors into one shared selection.

### 12.6 Independent actions in a duo (design spec)

Two Centos in the same scene may do **different** things at once. The animation engine already supports separate poses per character; the product rules are:

1. Each character's pose derives from **its own agent's state**, never from the pair.
2. Props stay on the owner's side of the scene (laptop to the right of the left character, to the left of the right character) to avoid collisions.
3. A shared prop (a gift being handed over, a laptop in `pair_programming`) goes in the middle and counts as an interaction, not an independent action.
4. Interactions (`high_five`, `dap_up`, `hug`, `handoff`) only trigger on explicit user gestures (a reaction button) or on a *completed* shared event (merged PR), never on timers.

### 12.7 Reactions

Quick reactions available on any message or agent card: 👍 → `reaction_thumbs`, ❤️ → `reaction_heart`, 🎉 → `reaction_party`, 😂 → `reaction_laugh`. The pixel version is shown at 24 px in the thread; emoji are used only as the *picker* icons. Max 3 reactions per person per message.

### 12.8 Presence etiquette

- No "X is typing…" for solo sessions.
- Typing indicators debounce for 400 ms and expire after 5 s.
- Read receipts are off by default.
- Nudges (poke) are rate-limited to one per person per minute and always dismissible.

---

## 13. Voice and microcopy

### 13.1 Voice

Cento's voice is **clear, kind, brief, with a flicker of play.** Imagine a seasoned engineer who likes their job.

| Do | Don't |
|---|---|
| Say what happened, then what to do | Apologise three times |
| Use plain verbs: "Couldn't connect" | "Oops! Something went wrong 😅" |
| Name the thing: "relay.centcom.dev" | "the server" |
| Give one next step | List five |
| Be specific about numbers | "a lot", "soon" |
| Keep jokes to spinners, success and empty states | Joke in errors, billing, security |

### 13.2 Grammar and style

- Sentence case. No trailing full stop on single-sentence UI strings; full stops on multi-sentence ones.
- Oxford comma. Contractions are fine ("can't", "we'll").
- Use "you" for the user, "we" for Centcom only when the company is acting (billing, outages). Cento speaks as "I" only in chat replies, never in system UI.
- Numbers: digits always ("3 agents"), thousands separator, `1.4k` for compact token counts.
- Time: relative under 24 h ("4m ago"), absolute afterwards; always with a tooltip on hover.
- Emoji: allowed in user-generated reactions only. Product UI uses pixel icons and glyphs.
- Never blame the user. "That file is outside the project" not "You can't do that".

### 13.3 Message templates

**Error:** `<what failed> <why, if known>. <one next step>.`
- *Couldn't reach the relay. Check your connection; Cento will retry in 4s.*
- *That branch has uncommitted changes. Commit or stash them, then try again.*
- *Payment didn't go through. Your card was declined; try another card or contact your bank.*

**Warning:** `<state> <consequence>.`
- *Usage is at 82% of this month's quota. Agents pause at 100%.*

**Success:** `<did the thing>` (short; the UI already shows what).
- *Merged into main.* · *Invite sent to maya@…* · *Saved.*

**Confirm destructive:** `<Verb> <object>? <Consequence>.` Button labels repeat the verb.
- Title: *Delete branch agent/feature-retry?* Body: *This also removes its worktree. Unmerged commits can't be recovered.* Buttons: **Delete branch** / Cancel.

**Empty:**
- No sessions: *No missions yet. Start one and Cento will keep the log.*
- No results: *Nothing matches "relay timeout". Try fewer words or check the spelling.*
- No team: *It's just you in here. Invite someone and Cento will make room.*

**Permission prompts:** `Allow Cento to <verb> <object>?` + exact command/path + where.

**Onboarding:** one idea per screen, under 20 words each.

### 13.4 Notification copy (examples)

| Event | Title | Body |
|---|---|---|
| Needs approval | `agent/fix-flaky-test needs you` | `Wants to run npm test in ~/centcom.` |
| Teammate joined | `Maya joined the command post` | — |
| Queue moved | `You're next in the queue` | `Maya's message is running.` |
| CI failed | `CI failed on agent/feature-retry` | `1 test failing: relay/client.test.ts:88.` |
| PR merged | `Merged: Add retry to relay client` | `main is green.` |
| Quota | `82% of your monthly usage` | `Upgrade or wait until Nov 1.` |
| Update | `Cento 1.4 is ready` | `Restart to update. Release notes.` |

### 13.5 Terminology cheat-sheet

| Say | Not |
|---|---|
| mission | task, ticket, job (internally fine) |
| command post | room, lobby, server |
| host | owner, master |
| fleet | agents list |
| relay | proxy, cloud |
| queue | inbox |
| approve / deny | allow / block (except in permission prompts, which say Allow) |
| session | chat, conversation (in UI) |

---

## 14. Spinner lines

The "thinking" line while an agent works: a rotating verb + `…`, in `text.muted`, next to the braille spinner. The full list is in **`assets/The-Lines.txt`** ({{LINES_COUNT}} lines; also `spinner_verbs.json` for the first 250).

### 14.1 Format

```
⠹ Tentacle-wrangling…   (12s · ↑ 1.4k tokens · esc to interrupt)
```
- Spinner glyph: `signal`. Verb: `text.muted`. Meta in parentheses: `text.muted`, dim.
- Elapsed time appears after 2 s; token count after 5 s; "esc to interrupt" always for interruptible work.

### 14.2 Rotation rules

1. Pick a random line when work starts; **change it every 3–6 s** (random in range). Never faster than 3 s.
2. Never repeat a line within the same session until the whole list has been used.
3. **Context-aware pools** are allowed and preferred when state is known (§14.3).
4. Never show a joke line for: auth, billing, permissions, destructive actions, or after an error. Use a plain verb ("Retrying…", "Reconnecting…").
5. Respect the user: `CENTO_SPINNER=plain` forces "Working…".
6. Max display length 40 characters in the TUI (truncate with `…`); lines longer than that are skipped on narrow terminals. A short-lines variant (≤ 24 chars) can be generated by filtering the list.

### 14.3 Pools

| Pool | When | Examples |
|---|---|---|
| Default | Thinking, general work | Discombobulating, Noodling, Percolating |
| Ocean | Any (flavour) | Tentacle-wrangling, Kelp-weaving, Inking |
| Signals | Network / relay / sync | Antenna-tuning, Signal-hunting, Pinging |
| Code | Editing, refactoring | Refactoring, Untangling, Soldering |
| Search | Grep / reading | Spelunking, Trawling, Excavating |
| Build | Compile / test / deploy | Bootstrapping, Compiling, Launching |
| Math / ML | Long reasoning | Extrapolating, Walking the latent space |
| Absurd | After 30 s of waiting | Teaching the electrons to sit still, Bribing the garbage collector |

Longer waits get sillier lines on purpose: it signals "this is taking a while but we're alive".

### 14.4 Line-writing guide

A good line is: (1) an `-ing` verb or short verb phrase, (2) concrete, (3) a little absurd, (4) never about the user's code quality or the user, (5) harmless out of context, (6) 1–5 words.
Avoid: real product names, real people, politics, anything about failure or harm, double meanings, and anything that reads as a promise ("Fixing everything…").

---

## 15. Sound and haptics

Sound is **off by default** and always optional. When enabled:

| Event | Cue | Notes |
|---|---|---|
| Needs approval | Single soft ping (≈ 880 Hz, 120 ms) | The one sound worth having while the window is in the background |
| Task complete | Two-note rise (E5→A5, 200 ms) | Only for tasks > 30 s |
| Error | Low single note (A3, 150 ms) | No alarm sounds |
| Teammate message | Light tick | Off in command posts with > 3 people |

Terminal: the BEL character (`\a`) is used only for "needs approval" and only if the user enables it. Haptics (mobile web): none.

---

## 16. Accessibility

### 16.1 Targets

WCAG 2.2 AA everywhere; AAA for body text (the contrast table meets ≥ 7 : 1 for `text.primary` on every surface).

### 16.2 Checklist

- **Contrast:** use semantic tokens only; they're verified in §4.5.
- **Focus:** a visible 2 px `focus.ring` on every interactive element, never removed. Focus order follows visual order. Modals trap focus and restore it on close.
- **Keyboard:** everything reachable and operable without a mouse. Shortcuts are listed in `?` help and never conflict with screen-reader or OS shortcuts. All shortcuts are remappable.
- **Targets:** ≥ 32 × 32 px hit area (24 px minimum with spacing), 44 px on touch.
- **Motion:** honour `prefers-reduced-motion` and `CENTO_REDUCE_MOTION`. Mascot becomes a static frame of the current state; spinners become a static `…` with elapsed time; no parallax or bouncing.
- **Flashing:** nothing flashes more than 3 times per second. `crash`, `glitch` and `panic` animations are on the **reduced-motion exclude list** and never autoplay.
- **Screen readers:** the mascot is `aria-hidden` and its meaning is always also in text (the status line). Status changes use `aria-live="polite"`; errors that block use `assertive`. Agent states have text equivalents ("Cento is editing 3 files").
- **Colour independence:** every colour-coded state also has a glyph and a word (§4.4, §4.7).
- **Zoom:** layouts hold at 200 % zoom and 400 % reflow. No horizontal scroll at 320 px except for code.
- **Text:** user-resizable; no fixed pixel heights on text containers; line spacing ≥ 1.4 for paragraphs.
- **Language:** `lang` set; plain, short sentences; avoid idioms in system messages (jokes live in spinner lines only, and are skippable).
- **Time limits:** no auto-dismissing content that requires action. Toasts with actions persist.
- **Terminal:** `NO_COLOR` honoured; no information conveyed by colour alone; high-contrast theme provided (§19.5).

### 16.3 Identity without colour

A teammate is always identified by **initial + name**, never by colour alone. The roster reads "M · Maya · green". Cursor tags show the name.

### 16.4 Testing

Run before release: keyboard-only walkthrough, 200 % zoom, forced-colours mode (Windows High Contrast), screen reader pass (NVDA/VoiceOver), reduced-motion pass, colour-blind simulation (all three types) on the fleet board.

---

## 17. Plans, tiers and monetisation surfaces

Money surfaces are **calm, exact and honest**. No mascot, no jokes, no dark patterns.

| Plan | Badge | Colour | Includes (design-level) |
|---|---|---|---|
| Free | `FREE` | `border.strong` outline | Local sessions, LAN multiplayer |
| Pro | `PRO` | `accent.fill` | Hosted relay for one workspace, history (we meter relay time, never model usage) |
| Team | `TEAM` | `signal` outline | Seats, roles, audit log, shared fleet board |

(Plan contents are product decisions; this section only defines their *presentation*.)

### 17.1 Rules

1. Show usage and limits before they bite: a persistent usage meter in settings; a warning banner at 80 %; a firm banner at 100 %.
2. Upgrade prompts appear **only** when the user hits a limit or opens billing. Never mid-flow, never as a modal over active work.
3. Prices are shown with currency, period and tax status. The total is always visible before a button that spends money.
4. Cancelling takes the same number of clicks as subscribing.
5. Seat changes show the prorated amount before confirming.
6. `upgrade_pro` (crown + confetti) plays only after a successful payment. `payment_failed` is plain: card icon, calm text, one action.

### 17.2 Invite flow visuals

Invite = envelope sliding to a new roster slot (`invite`), seat count updating (`seat_added`), then `welcome` when they accept. Show remaining seats as pixel pips: `■■■□□`.

---

## 18. Marketing and brand assets

### 18.1 Assets already in the repo

| Asset | Path |
|---|---|
| Mascot sprites and GIFs | `assets/mascot/` |
| Desktop-ready images | `~/Desktop/cento.png`, `cento_idle.gif`, `cento_coding.gif`, `cento_celebrate.gif` |
| Spinner lines | `assets/The-Lines.txt` |
| Live style guide | `assets/theme/preview.html` |
| Tokens and terminal themes | `assets/theme/` |

### 18.2 To produce

README banner (1280×320, Abyss gradient, Cento + wordmark), social card (1200×630), favicon set (16/32/48/180 from the monogram), app icon (512, Cento on `cento-600` square), OG image per feature, a 10-second demo GIF (`story_agent_task`), sticker sheet (all five colours × six poses), terminal screenshot template, pitch-deck master (dark, pixel dividers).

### 18.3 Photography and illustration

No stock photography. Illustration is pixel-scene only (§8.3). Screenshots are real product, dark theme, 2× retina, with a 1 px `border.default` and `pixel-md` shadow, cropped to content.

### 18.4 Merch ideas (pixel-friendly)

Enamel pins of the five colours, a "fleet" sticker pack, a mousepad with the antenna-tip mint as the single accent, a hoodie with the monogram on the chest, plushie octopus in violet with a tiny LED antenna.

### 18.5 Voice in marketing

Same as product, with more room for play. Headlines are short and concrete ("Eight agents. One branch each. Zero stepping on toes."). Lead with the benefit, show the product within the first screen, and keep the mascot beside the product, never replacing it.

---

## 19. Implementation guide

### 19.1 Files

```
assets/
├── DESIGN.md                    ← this document (generated)
├── The-Lines.txt                ← spinner lines
├── mascot/                      ← sprites, animations, gallery, player
└── theme/
    ├── build_theme.py           ← source of truth for all tokens
    ├── build_preview.py         ← writes preview.html
    ├── build_docs.py            ← writes ../DESIGN.md from DESIGN.template.md
    ├── tokens.json              ← design tokens (generated)
    ├── theme.css                ← CSS variables, dark + light (generated)
    ├── tailwind.preset.js       ← Tailwind preset (generated)
    ├── state-map.json           ← UI state → mascot animation (generated)
    ├── CONTRAST.md              ← contrast report (generated)
    ├── preview.html             ← live style guide (generated)
    └── terminal/
        ├── alacritty.toml
        ├── kitty.conf
        └── ansi.json
```

**Repositories.** This repo holds the client, the mascot and this design system. The server (relay, accounts, billing) lives in the private repo `Caffeine-Driven-LLC/Centcom-backend`. The design system has no runtime dependency on it: the client reads tokens and animation data from here, and only the *product states* in §11 and §12 (agent state, presence, queue position, plan, quota) arrive from the backend as data. Keep state names in `state-map.json` in sync with whatever the backend emits; if the backend adds a state, add a row to `build_theme.py`.

Rebuild everything: `python3 assets/theme/build_theme.py && python3 assets/theme/build_preview.py && python3 assets/theme/build_docs.py`.

### 19.2 Web

```html
<link rel="stylesheet" href="theme.css">
<html data-theme="dark">   <!-- or "light"; omit to follow the OS -->
```
```css
.card { background: var(--bg-surface); border: 1px solid var(--border-default);
        border-radius: var(--radius-lg); box-shadow: var(--shadow-pixel-sm); }
.btn-primary { background: var(--accent-fill); color: var(--accent-on); }
```
Tailwind: `presets: [require('./assets/theme/tailwind.preset.js')]`, then `bg-bg-surface text-text-primary border-border-default`. The preset maps names to CSS variables, so the theme switches without rebuilding.

Mascot in React: render `mascot/animations.json` frames to a `<canvas>` at an integer scale (the gallery's `player()` is ~25 lines), or inline the SVG for static poses. Look up the animation by `state-map.json`.

### 19.3 Terminal (TUI)

**Colour tiers.** Detect once at startup:

| Tier | Detect | Behaviour |
|---|---|---|
| Truecolor | `COLORTERM=truecolor|24bit` | Use token hex values directly |
| 256 | `TERM` contains `256color` | Use the nearest xterm-256 index (table below) |
| 16 | otherwise | Use ANSI names (table below) |
| None | `NO_COLOR` set or not a TTY | No colour; use bold/dim/reverse and glyphs |

{{FALLBACKS}}

**ANSI 16 mapping.** Applied via the shipped terminal themes (`terminal/alacritty.toml`, `terminal/kitty.conf`, `terminal/ansi.json`). The app should *use ANSI names* for status (`green` for success, `red` for danger, `yellow` for warning, `cyan` for signal, `blue` for info, `magenta` for accent) so it inherits any user theme, and use truecolor hex only for brand moments (the mascot, the wordmark).

**ASCII Cento (no-colour / tiny fallback):**
```
   ¡
 (•_•)
 /|||\
```
Frames: idle `(•_•)`, happy `(^_^)`, thinking `(•_•?)`, error `(x_x)`, sleeping `(-_-)zZ`, working `(•_•)⌨`.

**Terminal themes.** Alacritty: add `import = ["~/path/to/terminal/alacritty.toml"]` under `[general]`. Kitty: `include /path/to/terminal/kitty.conf`.

**Rendering the mascot.** Use the half-block pixel renderer from `mascot/play.py`. Cache the rendered ANSI strings per frame; clear only the mascot's rectangle each tick (move cursor up, redraw), never the whole screen.

### 19.4 Theme switching

- Default to the OS preference (`prefers-color-scheme` / terminal background detection via OSC 11 where supported).
- Persist the user's explicit choice; `data-theme` wins over the media query.
- Switching is instant (no cross-fade) so mascot pixels never smear.
- The mascot's body colours are identical in both themes; only the surrounding UI changes.

### 19.5 High-contrast mode

Provide `data-theme="hc"` (planned): `bg.base #000`, `text.primary #FFF`, borders `#FFF`, accent `#9FD0FF`, signal `#5FF5D2`, status colours at their light-theme-on-black equivalents; mascot gets a 1 px white outline. Also honour `forced-colors: active`.

### 19.6 Performance budgets

- Mascot GIF/SVG ≤ 200 KB each; `animations.json` loaded lazily by category.
- Animations decoded once and cached; ≤ 1 animated mascot per visible agent card, ≤ 6 on screen at once (pause the rest at their first frame).
- TUI frame budget: mascot redraw ≤ 2 ms; never redraw faster than the frame duration.
- First paint of the web shell < 1 s on a mid-range laptop; mascot is non-blocking.

### 19.7 Asset sizes (current build)

The full mascot GIF set is committed under `assets/mascot/gif/` (about 173 MB: five solo colours plus the duo, trio, squad and group crowds; the group and squad crowds are ~75 MB and ~38 MB). Regenerate any time with `python3 assets/mascot/build.py` (about two minutes). The app does **not** ship these GIFs: it reads `animations.json` and renders or recolours at runtime. If the repo size becomes a problem, move `assets/mascot/gif/` to Git LFS or a release asset without changing any path.

---

## 20. Governance

### 20.1 Ownership

One person owns the design system at a time (currently: the founders). Changes go through a PR that updates the **generator**, not the outputs.

### 20.2 Versioning

Semantic versioning on `tokens.json`'s `$version`:
- **Patch:** a value tweak with no visible meaning change (e.g. 2 % lightness).
- **Minor:** new tokens, new animations, new components.
- **Major:** renamed or removed tokens, palette changes that alter meaning.

Deprecate for one minor version before removing. Keep a `CHANGELOG` section at the end of this document.

### 20.3 Adding things

| Adding | Process |
|---|---|
| A colour | Must have a semantic role. If it doesn't, it isn't added. Run the contrast build. |
| A component | Needs: anatomy, all states, keyboard behaviour, a11y notes, and an example in `preview.html`. |
| An animation | §3.6. Must also appear in the gallery. Add to `state-map` only if it's a product state. |
| A spinner line | §14.4. One per PR line; no duplicates (`sort -u`). |
| A new mascot colour | Don't. See §3.2 rule 2. |

### 20.4 Deprecation and removal

Mark in the generator with `# deprecated: <version>`; list in the changelog; remove after one minor.

---

## 21. Review checklist

Copy into every UI PR.

**Visual**
- [ ] Uses semantic tokens only (no raw hex, no ramp values)
- [ ] ≤ ~10 % saturated colour on screen; one primary action
- [ ] Spacing is on the 4 px grid; radius consistent within the component
- [ ] No blur shadows, no gradients (except §4.9)
- [ ] Looks right in **both** Abyss and Shallows

**Behaviour**
- [ ] All states: default, hover, focus, active, disabled, loading, error, empty
- [ ] Keyboard-operable, visible focus, logical order
- [ ] Reduced-motion variant exists
- [ ] Nothing blocks input while animating

**Mascot**
- [ ] State-driven, not decorative; uses an animation from `state-map.json`
- [ ] Absent from payment, security, destructive and `aria-live="assertive"` surfaces
- [ ] Integer scale, `image-rendering: pixelated`
- [ ] Frequency caps respected (§10.1.9, §11.4)

**Copy**
- [ ] Sentence case, specific, one next step
- [ ] No jokes in errors/billing/security
- [ ] Passes the terminology cheat-sheet (§13.5)

**Accessibility**
- [ ] Colour is never the only signal
- [ ] Contrast report passes (`build_theme.py` prints no failures)
- [ ] Works at 200 % zoom and with `NO_COLOR`

**Terminal**
- [ ] Works at 80 × 24
- [ ] Degrades through 256 → 16 → none
- [ ] No mascot in output meant for piping

---

## 22. Appendix

### 22.1 Token quick reference

See `tokens.json`. Highlights:

| Token | Dark | Light |
|---|---|---|
| `bg.base` | `#07091A` | `#F3F6FF` |
| `bg.surface` | `#0B1026` | `#FFFFFF` |
| `text.primary` | `#E6EBFF` | `#0B1026` |
| `text.secondary` | `#A9B6E8` | `#3B4678` |
| `accent.fill` | `#6B49F0` | `#5A3FD1` |
| `signal` | `#3DF2C8` | `#07765F` |
| `status.success` | `#4ADE80` | `#14733A` |
| `status.warning` | `#FFD166` | `#8A5A00` |
| `status.danger` | `#FF5C5C` | `#C21B1B` |
| `status.info` | `#5AA9FF` | `#1B5FB8` |

### 22.2 Keyboard shortcuts (proposed defaults)

| Key | Action |
|---|---|
| `⏎` / `shift+⏎` | Send / newline |
| `esc` | Interrupt agent; close overlays |
| `ctrl+k` | Command palette |
| `ctrl+t` | Task / agent list |
| `ctrl+b` | Toggle fleet rail |
| `shift+tab` | Cycle mode (ask → accept edits → plan) |
| `y` / `n` / `a` | Approve / deny / always (in permission prompts) |
| `?` | Help |
| `/mascot` | Toggle the mascot |

### 22.3 Slash commands that touch the design

`/mascot [on|off|<colour>]`, `/theme [dark|light|auto|hc]`, `/spinner [fun|plain]`, `/motion [full|reduced]`, `/density [comfortable|compact]`.

### 22.4 Environment variables

`NO_COLOR`, `COLORTERM`, `CENTO_MASCOT=on|off`, `CENTO_REDUCE_MOTION=1`, `CENTO_SPINNER=fun|plain`, `CENTO_THEME=dark|light|auto`.

### 22.5 Glossary

| Term | Meaning |
|---|---|
| Abyss / Shallows | The dark / light themes |
| Cento | The mascot (and the user's own agent) |
| Command post | A shared, hosted multi-person session |
| Fleet | All agents in a workspace |
| Host | The person whose machine/session runs the command post |
| Mission | A unit of work given to an agent |
| Relay | The hosted routing service |
| Signal | The mint accent; "this is alive" |
| Pixel | One cell of the mascot grid |
| Prop | A small pixel object in a scene (laptop, trophy…) |
| Story | A chained animation sequence for marketing |

### 22.6 Open design questions

1. Final names for the three plans, and the exact feature line between Free and Pro.
2. Whether guests in a command post can see the host's tool output by default.
3. High-contrast theme: final values and QA (§19.5).
4. A sixth-participant treatment that's more distinct than an outlined violet.
5. Whether the web UI should render mascot animations on `<canvas>` or SVG-with-CSS by default (SVG is simpler; canvas scales better for crowds).
6. A sound design pass (§15) with an actual sound designer.
7. Localisation: spinner lines are English-only puns; decide whether to translate or localise-by-pool.

### 22.7 Roadmap for this document

- Figma library mirroring `tokens.json` (the Figma plugin in this workspace can sync it).
- Storybook for the web components, driven by the same tokens.
- Visual regression snapshots for the TUI (`asciinema` + `termtosvg`).
- A "mascot lint": script that checks new sprites against §3.4 (palette, grid, silhouette).
- Auto-generate §10 component specs from component metadata.

### 22.8 Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-05 | First complete system: Abyss/Shallows theme, tokens, terminal themes, mascot bible, 319 animations, 743 spinner lines, state map, this document. |

---

*End of document. If something here and the generator disagree, the generator wins; fix the document.*
