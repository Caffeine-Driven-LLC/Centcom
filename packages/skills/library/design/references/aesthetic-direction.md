# Aesthetic direction

How to derive a visual direction from the product's purpose and audience,
commit to it, and recognize when you have drifted back to a default. The
companion file `direction-catalogue.md` holds fourteen fully specified
directions to choose from or blend.

## Contents

1. Why direction comes first
2. Deriving a direction: the four questions
3. Decoding references the user gives you
4. Writing the direction spec
5. The generic-check
6. Mixing directions
7. Committing: how to keep the direction alive over twenty screens

The catalogue of fourteen directions (Editorial, Swiss, Brutalist, Soft
organic, Industrial, Luxury minimal, Playful, Retro terminal, Scientific
instrument, Warm craft, High-contrast monochrome, Glassy, Corporate calm,
Kinetic), each with type, palette, space, shape, motion, signature devices
and failure modes, lives in `direction-catalogue.md`. Read this file first,
then pick from the catalogue.

## 1. Why direction comes first

A direction is a compression of hundreds of decisions into one idea. With it,
choosing a radius, a shadow, a hover color or a heading weight takes a second
and the answers agree with each other. Without it, each choice is made on its
own merits, and "on its own merits" always resolves to the safe median:
medium radius, medium shadow, medium weight, a blue. That median is the
generic look. It is not ugly; it is anonymous, and anonymity reads as "nobody
cared."

Direction also tells you what to leave out, which is most of the craft. A
scientific-instrument direction forbids decorative gradients. A warm-craft
direction forbids pure black. A luxury-minimal direction forbids a third
font weight. The forbiddings are what make the result coherent.

## 2. Deriving a direction: the four questions

Answer these in writing before choosing anything visual.

**Who is looking, and in what state?** A nurse at hour eleven of a shift, a
teenager on a bus, a CFO between meetings, a developer with four terminals
open, a bride planning a wedding at midnight. State implies density,
contrast, size, patience for motion, and tolerance for personality. Tired,
rushed or stressed users want calm, high-contrast, predictable UI. Relaxed,
browsing users will enjoy personality and reward it with attention.

**What is the job, and how often is it done?** A tool used eight hours a day
earns the right to be dense and quiet; its users will learn it. A flow
completed once (checkout, signup, a government form) must be generous,
explicit and forgiving. Marketing surfaces have ten seconds to communicate
a feeling and a fact; apps have ten thousand sessions to be trusted.

**What should it feel like, in three adjectives, one of them unexpected?**
"Clean, modern, professional" is not an answer; it describes everything.
"Precise, calm, slightly austere" is an answer. "Warm, generous, a little
old-fashioned" is an answer. The unexpected adjective is where the
personality comes from: a banking app that is "quietly playful," a developer
tool that is "editorial," a healthcare portal that is "frank."

**What must it never feel like?** Name the failure. "Never corporate." "Never
cute." "Never like a crypto dashboard." "Never like a government form."
Negative space in the brief is as useful as positive.

From the answers, the direction usually names itself. A tax tool for
freelancers who hate taxes: frank, warm, un-corporate, with a confident
plain voice and generous forms. That is Warm craft leaning toward Editorial,
not Corporate calm. A telemetry dashboard for SREs: dense, precise, dark by
default, zero decoration. That is Scientific instrument, maybe with a Retro
terminal accent in the type.

## 3. Decoding references the user gives you

Users say "make it like Linear," "like Stripe," "like Notion," "like
Apple," "like a Bloomberg terminal." Never copy the reference; decode it
into properties and then apply the properties to this product's content.

| Reference | What people actually mean |
|---|---|
| "Like Linear" | Dark-first, cool neutrals, 13-14px dense UI type, 6px radii, subtle 1px borders instead of shadows, keyboard-first, fast 120ms motion, one muted accent |
| "Like Stripe" | Light, generous whitespace, a confident gradient used once in the hero and nowhere else, excellent typography with a custom sans, code as a first-class visual, impeccable alignment |
| "Like Notion" | Warm near-white, system-ish type, soft greys, very low chrome, content is the UI, emoji as the only color |
| "Like Apple" | Massive type scale contrast, product imagery as hero, near-zero UI chrome, SF-style type, generous padding, slow confident motion |
| "Like Vercel" | Pure black and white, geometric sans, hairline borders, monospace accents, almost no color, rapid snappy transitions |
| "Like a Bloomberg terminal" | Black background, amber or green text, extreme density, monospaced tabular data, no padding, color as semantic signal only |
| "Like Airbnb" | Friendly rounded sans, coral accent, photography-led, 8-12px radii, soft shadows that are earned by elevation, warm neutrals |
| "Like a magazine / editorial" | Serif display type at large sizes, asymmetric grids, pull quotes, generous margins, black ink on paper white, strong image crops |
| "Like a Swiss poster" | Grid visibly structuring the page, Helvetica-like grotesque, flush-left ragged-right, one bold red or black, extreme size contrast |
| "Modern and clean" (the non-answer) | Ask one more question, or decide: this usually means Corporate calm or Swiss, and the user will know what they didn't want when they see it |

When the reference conflicts with the product (a brutalist reference for a
hospital intake form), say so and propose the compatible subset.

## 4. Writing the direction spec

Keep it to ten lines. It must be concrete enough that a second designer
could build a screen from it.

```
Direction:  Warm craft, leaning editorial
Feels:      frank, warm, a little old-fashioned; never corporate, never cute
Type:       Display: Fraunces (variable, opsz) at 600-700 for headings
            Body/UI: Source Sans 3 at 400/600; scale 1.25 from 16px
            Numbers: Source Sans 3 with font-variant-numeric: tabular-nums
Color:      Paper #F6F1E8 (oklch 0.955 0.012 80), ink #2A2320, muted #6B5F58
            Accent: oklch(0.55 0.14 40) terracotta; used only on primary action and links
            Semantic: success oklch(0.55 0.12 150), danger oklch(0.55 0.17 25), both desaturated
Space:      8px base; page gutters 20/32/64; section rhythm 48/96; cards 24 padding
Shape:      Radius 2px on controls, 6px on cards; borders 1px ink at 12% alpha; no shadows
Motion:     200-250ms ease-out; fades and 4-8px slides; one signature: headings settle in on page load
Signature:  Hairline rules between content sections, drop caps on article openers
Avoid:      Pure black, pure white, gradients, icons in circles, more than two weights per family
```

The `Signature` line is the one memorable device. The `Avoid` line is the
discipline. Both are required.

## 5. The generic-check

After writing the spec, run this test on each line: "If I had received no
brief at all, is this what I would have written?" Common lines that fail:

- Type: Inter / Roboto / system-ui. (Would you have picked it anyway? Yes.
  Change it, or justify it: "system font because this is a native-feeling
  settings panel inside the OS" is a justification.)
- Color: a blue primary around #3B82F6 with grey neutrals. (Default.)
- Shape: 8px radius everywhere. (Default. Decide radius per role.)
- Shadow: `0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)`. (Tailwind's
  default. Decide whether this direction uses shadow at all.)
- Motion: 200ms ease-in-out on everything. (Default. Ease-out for enters,
  ease-in for exits, and decide what does not move.)
- Layout: centered everything. (Default. Decide where the eye enters.)

Also check the output against the known clusters of AI-generated design.
These appear regardless of brief and are therefore tells, even when they
are good-looking:

1. Cream paper background with a high-contrast serif display and a
   terracotta accent. Lovely, and now so common it reads as a template.
   Use it only when the brief really is warm/editorial, and then make it
   specific: a different paper tone, a different accent hue, a display face
   nobody expects.
2. Near-black background, one acid-green or vermilion accent, monospace
   labels. The "developer tool" default.
3. Hairline rules, zero radius, dense newspaper columns. The "editorial"
   default.
4. The SaaS card kit: identical rounded cards, same shadow, gradient wash.
5. Template chrome: tracked ALL-CAPS eyebrows, middle-dot metadata,
   `WORD — fragment` labels, #0B0B0B as "black", an arrow after every link.

None is forbidden. Each is a default rather than a decision until you can
say why it is right for this product and what you changed to make it
specific.

With the brief answered and the generic-check in mind, choose a direction
from `direction-catalogue.md`, or blend two using the rules below.

## 6. Mixing directions

Most real products blend two: a dominant (80%) and an accent (20%). Good
blends share a logic:

- Scientific instrument + Retro terminal: data tool with a mono accent in
  labels and IDs. The mono carries the technical identity; the sans keeps
  prose readable.
- Corporate calm + Editorial: a bank that uses a serif only in marketing
  headlines and large numerals; the app stays sans and calm.
- Warm craft + Industrial: a tool for tradespeople; warm palette and type,
  industrial density and labeling.
- Soft organic + Scientific instrument: a health app; soft shapes and
  colors around precise, tabular health data.
- Luxury minimal + Kinetic: a fashion launch; one expressive typographic
  moment in an otherwise still, white page.

Bad blends fight: Brutalist + Corporate calm (the brutalism reads as
broken), Playful + Luxury minimal (the joy reads as cheap), Glassy +
Editorial (the glass undermines the paper).

When mixing, the dominant direction owns: palette, spacing, body type, and
all controls. The accent direction owns: display type or one device or the
motion signature. Never let the accent direction touch the controls.

## 7. Committing: keeping the direction alive over twenty screens

Direction dies by a thousand reasonable exceptions. Guard it:

- Put the spec in the repo (`DESIGN.md` or the top of the tokens file) so
  future sessions and other contributors read it.
- Encode the rules as tokens and lint where possible: if the spec says no
  shadows, do not define a shadow token; if it says two weights, load only
  two weights.
- When a new screen needs something the spec does not cover, extend the
  spec in writing before building, so the extension is a decision.
- Every few screens, screenshot them side by side. Drift is visible in
  aggregate even when each screen looks fine alone.
- Keep the Avoid list honest. If you find yourself wanting a gradient in a
  direction that forbids gradients, either the direction was wrong (change
  it, deliberately, everywhere) or the want is a reflex (resist it).
