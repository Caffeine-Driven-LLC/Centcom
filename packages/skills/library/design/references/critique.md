# Critique

How to critique a screen like a design lead: a structured pass over
hierarchy, alignment, consistency, contrast, rhythm, affordance and copy;
what to look for in a screenshot; how to prioritize fixes; and a bank of
specific "this looks amateur because..." diagnoses with their fixes. Use it
on your own output before handing over, and on screens the user shares.

## Contents

1. The stance
2. Before the pass: squint, scan, read
3. The structured pass
4. Reading a screenshot
5. Prioritizing fixes
6. Writing the critique
7. The diagnosis bank
8. Self-critique protocol for your own work

## 1. The stance

Critique is not taste; it is diagnosis against intent. The question is
never "do I like this" but "does this do what it is for, for the people it
is for, and does every part agree with every other part." A screen can be
not to your taste and correct; it can be beautiful and wrong.

Three habits of a good critic:

- **Name the intent first.** What is this screen for, who uses it, what
  direction was chosen (or implied)? Critique against that. If no
  direction is discernible, that is the first finding.
- **Be specific and locatable.** "The hierarchy is weak" is a mood. "The
  page title (18px, 500) and the section headings (18px, 500) are
  identical, so the eye has no first stop" is a finding with a fix.
- **Separate severity from frequency.** One failing contrast ratio on the
  primary button outranks ten slightly inconsistent paddings. Fix in
  severity order.

## 2. Before the pass: squint, scan, read

Three quick looks before the structured pass; they catch most problems.

**Squint** (or blur the screenshot, or zoom out to 25%). What remains
visible? The shapes that survive are the hierarchy. If nothing stands out,
there is no hierarchy. If the wrong thing stands out (a decorative
gradient, a logo, a secondary button), the hierarchy is misdirected. If
everything is the same grey mass, contrast and grouping are missing.

**Scan** as a first-time user for 5 seconds. Where did the eye go first,
second, third? Was that the intended order? What would you click? Is there
an obvious next action? Did anything confuse you?

**Read** every word. Buttons, labels, headings, empty states, errors,
placeholders. Do they name outcomes? Are they consistent (the same thing
called the same name)? Is there filler or jargon? Is there any lorem,
"Submit," "Click here," "Error," or an exclamation mark?

## 3. The structured pass

Go through these seven lenses in order. Each has questions and the
evidence to look for.

### Hierarchy

- Is there one clear primary element and does it correspond to the
  screen's purpose?
- Can you name the first, second and third thing the eye reads?
- Are heading levels visually distinct (size jumps of at least one scale
  step, or clear weight/color differences)?
- Is there exactly one primary button per region?
- Are secondary things visually secondary (smaller, lighter, muted) or are
  they competing?
- Does the layout's visual weight match the importance of the content, or
  is a sidebar heavier than the main content, a footer louder than the
  hero?

Evidence of failure: everything the same size; multiple primaries; a
decorative element outcompeting the content; muted and primary text at
similar greys.

### Alignment

- Do elements share edges? Pick the left edge of the main content: does
  every heading, paragraph, card edge and button align to it (or to a
  deliberate indent)?
- Are baselines aligned across columns?
- Are icons optically aligned with their text?
- Are things that are supposed to be centered actually centered (and
  should they be)?
- Do card footers, pricing CTAs, and grid items align across the row?
- Is there a grid, and is it followed?

Evidence of failure: a heading indented 4px from the paragraph; buttons
at different heights in a row; cards whose contents sit at different
vertical positions; mixed centered and left-aligned text in one region.

### Consistency

- Are the same kinds of things styled the same way (all primary buttons
  identical, all cards the same radius and border, all section headings
  the same size)?
- Is the spacing from a scale (count the distinct padding and gap values;
  more than ~8 means drift)?
- Are radii consistent per role (controls one radius, surfaces another)?
- Is the icon set single (same stroke weight and style)?
- Is the vocabulary consistent (Delete vs Remove vs Trash for the same
  action)?
- Do states look like a family (hover, focus, selected derived from the
  same tokens)?
- Does this screen look like the other screens in the product?

Evidence of failure: three shades of grey border; two different shadow
styles; buttons with 6px and 8px radii; a mix of outline and filled icons.

### Contrast and color

- Does body text pass 4.5:1 and muted text pass at least 4.5:1 where it
  carries information? (Check with the script.)
- Do controls' borders and focus rings pass 3:1?
- Is the accent used only for interactive and attention elements, or is
  it everywhere?
- Do semantic colors appear only when their state occurs?
- Is anything communicated by color alone?
- In dark mode: do surfaces layer, do borders show, does the accent glow,
  are shadows light (wrong)?
- Is the palette coherent (one temperature, consistent chroma) or does it
  look assembled from parts?

Evidence of failure: light grey text on white; a blue that appears on
buttons, links, icons, headings and chart bars; a red used decoratively; a
dark mode with pure black and saturated accents.

### Rhythm and space

- Is spacing proportional to relationship (tighter within groups, looser
  between)?
- Do headings sit closer to what follows than to what precedes?
- Is there variation in section spacing (a rhythm) or uniform padding?
- Is the density right for the audience?
- Is there breathing room where the eye needs to rest, and compactness
  where the task needs it?
- Are line lengths within 45-75 characters?
- Is whitespace doing work or is it just leftover?

Evidence of failure: 16px between everything; a heading floating
equidistant between sections; a marketing-page airiness in an admin tool;
text spanning 140 characters.

### Affordance and states

- Does every clickable thing look clickable, and does nothing
  unclickable look clickable?
- Are links distinguishable from text and from buttons?
- Do controls have visible hover, focus-visible, active and disabled
  states, and are they distinguishable?
- Are the empty, loading and error states present and specific?
- Are destructive actions distinguishable and separated?
- Are form fields clearly labeled with visible labels, helper text and
  error placement?
- Are touch targets adequate on mobile?

Evidence of failure: text that is a link but looks like body; a card
with a hover shadow that does nothing on click; a disabled button
indistinguishable from enabled; a blank area where a table should show an
empty state; a 28px icon button on a phone layout.

### Copy

- Do buttons name outcomes? ("Save changes," not "Submit")
- Do headings describe content? Do empty states explain and invite? Do
  errors say what happened and what to do?
- Is it sentence case, active, specific, free of filler and jargon?
- Is the same thing called the same name everywhere?
- Is the tone appropriate to the audience and the moment (no jokes in
  errors, no exclamation marks in a finance tool)?
- Is any placeholder text still present?

Evidence of failure: "Submit," "OK," "Oops!", "Something went wrong,"
"Lorem ipsum," "Welcome to the future of X," title-case buttons, a toast
that says "Success!"

## 4. Reading a screenshot

When the user shares a screenshot, or when you review your own:

1. **Establish scale.** Find a known element (a 40px button, 16px body
   text) to calibrate sizes.
2. **Identify the direction** the screen is attempting, or note its
   absence. Everything else is judged against it.
3. **Squint, scan, read** (section 2).
4. **Run the seven lenses** (section 3), writing one line per finding with
   location ("top-right toolbar," "second card," "the email field").
5. **Measure what matters.** Zoom into the screenshot to check: alignment
   of edges (are they within 1px?), consistency of gaps (are the three
   cards' gaps equal?), text contrast (sample the colors if possible and
   run the script), radius consistency.
6. **Look at the edges and corners.** The periphery is where neglect
   shows: footer, status bar, scrollbars, the last row of a table, the
   corners of cards, the gap between the last section and the footer.
7. **Look for the generic tells** (see SKILL.md's list and section 7
   below). Each one found is a finding.
8. **Check the states you cannot see.** Ask (or test) for hover, focus,
   empty, error and dark mode. A screenshot of the ideal state tells you
   little about the product's quality.
9. **Check at other widths** if possible. A screen that works at 1440 may
   fall apart at 1024 and 375.

For mobile screenshots additionally check: safe areas respected, targets
44pt, tab bar labels present, platform conventions honored, text scaling
headroom.

## 5. Prioritizing fixes

Rank findings by this order, and fix the top three before anything else:

1. **Blocks the task or excludes users.** Contrast failures on text and
   controls; missing focus visibility; targets too small on touch;
   missing labels; destructive action without protection; error states
   that give no way forward; content unreadable at a common width.
2. **Breaks comprehension.** No hierarchy; multiple primaries; unclear
   next action; copy that misleads; inconsistent naming; affordance
   errors (clickable-looking non-clickables).
3. **Breaks the direction.** Generic tells; off-system values; the wrong
   density for the audience; mixed icon styles; a dark mode that is an
   inversion.
4. **Polish.** Optical alignment; nested radii; shadow consistency; micro-
   interaction timing; orphaned words.

Within a tier, prefer fixes with leverage: a token change that fixes 40
instances beats 40 local fixes; fixing the button component fixes every
button.

Resist the urge to list everything. A critique with 30 findings is
ignored; a critique with 5 prioritized findings and a note that polish
items exist gets acted on.

## 6. Writing the critique

Structure for a critique delivered to the user:

```
What this screen is doing well: (1-2 lines; genuine, specific)

Top issues (in priority order):
1. [Location] [What] [Why it matters] [Fix, concretely]
2. ...
3. ...

Direction check: (does the screen have a coherent direction; if not,
what direction its content suggests; the one change that would most
move it there)

Smaller items: (a short list, or "a handful of polish items: ...")
```

Each finding is one to three sentences. Include a value when you can
("the muted grey #9CA3AF on white is 2.5:1; use #6B7280 or darker for
4.5:1"). Offer the fix, not just the problem. Where there is a legitimate
alternative, say so ("either remove the card borders and rely on spacing,
or keep borders and drop the shadows; not both").

Tone: direct and specific, never sneering. The screen's author made
reasonable local decisions; the critique shows the global consequence.

## 7. The diagnosis bank

Specific tells, why they read as amateur, and the fix. Use the names to
communicate quickly.

**Typography**

- *Default face*: Inter/Roboto/system with no reason. Reads as "nobody
  chose." Fix: choose for the direction (typography.md), or make neutrality
  a stated choice.
- *Flat scale*: headings barely larger than body; everything 14-18px.
  Fix: ratio 1.25+; jump two steps for the page title.
- *Everything bold*: labels, headings, values, buttons all 700. Fix: two
  weights; size and color carry the rest.
- *Loose headline*: 48px heading at 1.5 line-height with +tracking. Fix:
  1.1 leading, -0.02em tracking.
- *Wall of text*: a 1200px-wide paragraph. Fix: `max-width: 65ch`.
- *Caps everywhere*: tracked-caps labels above every section. Fix: remove;
  sentence case; caps only where the direction uses them, and only once
  per view.
- *Gradient text*. Fix: solid ink.
- *Mixed numerals*: columns of numbers wobbling. Fix: tabular figures,
  right alignment.
- *Orphan*: a single word on the last line of a headline. Fix:
  `text-wrap: balance`.

**Color**

- *Rainbow icons*: each feature icon a different saturated color. Fix: one
  neutral or one accent for all icons.
- *Accent flood*: blue headings, blue icons, blue borders, blue buttons.
  Fix: accent only on primary action, links, active state.
- *Grey soup*: five greys within 10% lightness of each other. Fix: a
  ramp with real steps; text at 3 distinct levels.
- *Ghost text*: muted text at 2-3:1. Fix: L ≤ 0.56 on white (#767676 or darker).
- *Inverted dark mode*: pure black background, light shadows, glowing
  accent. Fix: color.md section 8.
- *Decorative semantics*: red used for a brand element. Fix: red is for
  danger only.
- *Clown palette*: 5 saturated hues at different lightnesses. Fix: same L
  and C across hues.
- *Gradient wash*: purple-to-blue background or button. Fix: solid; use
  a gradient once if the direction allows, never on controls.

**Layout and space**

- *Center-everything*: hero, headings, paragraphs all centered. Fix:
  left-align; give the eye an entry point.
- *Uniform gaps*: 16px between everything. Fix: proximity by
  relationship.
- *Py-20 syndrome*: identical section padding throughout. Fix: rhythm.
- *Card prison*: every piece of content in a card, cards inside cards.
  Fix: cards only for peer units; use space and headings otherwise.
- *Triple separation*: border + shadow + tint on one element. Fix: pick
  one.
- *Floating sticker*: `shadow-lg` white card on white page. Fix: tone or
  border; shadows for overlays.
- *Equal tiles*: 8 identical KPI tiles. Fix: size by importance.
- *Chrome stack*: header + title bar + tabs + toolbar before content.
  Fix: merge levels.
- *Orphan card*: a grid of 3 with 4 items. Fix: `auto-fill` or design the
  last row.
- *Misaligned edges*: heading 3px left of body. Fix: optical alignment;
  shared grid.
- *Radius chaos*: 4, 8, 12 and 16px radii on the same screen without
  role logic; or `rounded-2xl` on everything. Fix: a radius scale by role,
  nested radii decreasing.

**Components and states**

- *Placeholder label*: inputs with no visible label. Fix: label above.
- *Dead primary*: disabled submit with no explanation. Fix: enable and
  validate.
- *Invisible focus*: `outline: none`. Fix: designed ring.
- *Hover-only*: actions only on hover. Fix: focus and touch equivalents.
- *Blank empty*: a table with no rows and nothing else. Fix: empty state.
- *Spinner flash*: a loader that appears for 100ms. Fix: delay 200-300ms;
  skeleton.
- *Mystery icon*: icon-only buttons with no label or tooltip. Fix: tooltip
  and accessible name; or add the label.
- *Height mismatch*: a 40px input beside a 36px button. Fix: shared
  control height.
- *Toast as error*: an error that disappears after 4s. Fix: inline,
  persistent error.
- *Are-you-sure*: generic confirm with Yes/No. Fix: specific title,
  named action, or undo.
- *Emoji icons*. Fix: an icon set.

**Motion**

- *Scroll fade-up everywhere*. Fix: remove; one load moment.
- *Hover lift on every card*. Fix: border/shadow step only; lift only in
  soft directions and only on clickable cards.
- *Slow UI*: 400ms transitions on menus. Fix: 120-200ms.
- *Bouncing serious*: overshoot easing in a finance app. Fix: ease-out.
- *Pulse CTA*: a pulsing primary button. Fix: static; hierarchy by design.

**Copy**

- *Submit*. Fix: name the outcome.
- *Oops*. Fix: state what happened.
- *Title Case Everything*. Fix: sentence case.
- *Lorem*. Fix: real or realistic copy.
- *Jargon*: "Configure webhook payload." Fix: user's words.
- *Inconsistent nouns*: Workspace / Space / Team for one thing. Fix: one
  noun.
- *Marketing in the app*: "Supercharge your workflow" as an empty state.
  Fix: "No tasks yet. Create one to get started."

**Marketing-specific**

- *Three cards with circle icons*. Fix: landing-pages.md section 4.
- *Logo wall in color at mixed sizes*. Fix: mono, optically equalized.
- *Scaled-up pricing column*. Fix: border and badge.
- *Mesh blob hero*. Fix: a real visual or typographic hero.
- *Stock illustration people*. Fix: product screenshots or one owned
  illustration style.

**Mobile-specific**

- *Hamburger primary nav*. Fix: tabs.
- *Desktop select on phone*. Fix: native picker or sheet.
- *Bottom button under the home indicator*. Fix: safe inset.
- *Phone layout on tablet*. Fix: list-detail.
- *Tiny close*. Fix: 44pt; swipe to dismiss.

## 8. Self-critique protocol for your own work

Your own output is the hardest to critique because you know what you
meant. Protocol:

1. **Wait for the render.** Critique the screenshot, not the code.
2. **Change context.** Look at it at a different zoom level, in dark mode,
   at 360px wide. Each change breaks your familiarity.
3. **Run the generic-check** from aesthetic-direction.md: would you have
   produced this with no brief? Each "yes" is a finding.
4. **Run the seven lenses** and write the findings down even when they
   feel minor; writing surfaces patterns.
5. **Count**: distinct font sizes (target 5-8), distinct spacing values
   (target 6-8), distinct greys (target 6-8), distinct radii (target 2-3),
   distinct shadows (target 0-3), accent occurrences per screen (target
   1-5). High counts mean drift.
6. **Fix the top three**, then re-render and look again; fixes have side
   effects.
7. **Remove one thing.** Almost every screen has one element that is
   there because it was easy, not because it was needed: a decorative
   icon, a second button, a border, a label, an animation. Take it off.
8. **Report** to the user what you chose and what you considered, so they
   can disagree with the decision rather than with the result.
