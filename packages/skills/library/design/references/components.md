# Components

Anatomy, sizing, states and the quality bar for the core components:
buttons, inputs, selects and comboboxes, checkboxes and switches, dialogs,
menus and popovers, tabs, tables, cards (and when not to use them), toasts,
navigation, empty states, skeletons, badges and tooltips. Each with the
subtle details that separate polished from amateur. Implementation
mechanics (focus trapping code, ARIA wiring) belong to the frontend skill;
this file is what the result should look and behave like.

## Contents

1. The state matrix every control owes
2. Sizing system
3. Buttons
4. Text inputs and textareas
5. Selects, comboboxes, autocompletes
6. Checkboxes, radios, switches
7. Dialogs and drawers
8. Menus, popovers, tooltips
9. Tabs and segmented controls
10. Tables
11. Cards, and when not to use them
12. Toasts and inline alerts
13. Navigation (top bar, sidebar, bottom tabs, breadcrumbs)
14. Empty states
15. Skeletons and loading
16. Badges, tags, chips, avatars
17. Polish details that separate good from amateur

## 1. The state matrix every control owes

Every interactive element has at least these states, and each must be
visibly distinct from the others while belonging to the same family:

| State | What changes | Notes |
|---|---|---|
| Default | — | Must already look interactive (affordance) |
| Hover | Background or border one step; cursor | Not on touch devices; never the only indicator |
| Focus-visible | Ring 2px, offset 2px, accent or dedicated focus color | Keyboard only (`:focus-visible`), never `outline: none` without replacement |
| Active / pressed | One more step darker (light) or lighter (dark); optional 1px translateY or scale 0.98 | 50-100ms, no delay |
| Selected / checked | Accent fill or accent border + check | Must survive without color (icon or weight) |
| Disabled | 40-50% opacity *or* desaturated tokens; `cursor: not-allowed` optional | Keep readable; explain why nearby when non-obvious |
| Loading | Spinner replaces or precedes label; width preserved | Label stays or becomes "Saving..." |
| Error / invalid | Danger border + message | Only after the user has had a chance to be right |
| Read-only | Plain text look, no border, still selectable | Distinct from disabled |

Transitions between states: 100-150ms on `background-color`, `border-color`,
`color`, `box-shadow`, `transform`. Not on `all`.

Focus ring recipe that works on any background:

```css
:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
/* On dark or colored surfaces, double ring for guaranteed 3:1 */
.on-accent:focus-visible {
  outline: 2px solid #fff;
  box-shadow: 0 0 0 4px var(--color-focus-ring);
}
```

`outline` survives Windows High Contrast; `box-shadow` alone does not.

## 2. Sizing system

Define control heights once and use them for buttons, inputs, selects and
anything that sits in a row with them so they align:

| Size | Height | Font | Horizontal padding | Icon | Use |
|---|---|---|---|---|---|
| xs | 24px | 12px | 8px | 12px | Dense tables, chips |
| sm | 32px | 13px | 12px | 14px | Toolbars, compact UIs, table row actions |
| md (default) | 40px | 14px | 16px | 16px | Forms, most buttons |
| lg | 48px | 16px | 20-24px | 20px | Primary CTAs, mobile, marketing |
| xl | 56px | 18px | 28px | 24px | Hero CTAs only |

Mobile: minimum 44px touch height even when the visual is 40; extend the
hit area with padding or a pseudo-element.

Radius scale: 0 (sharp), 4 (controls, dense), 6-8 (controls, default), 12
(cards), 16-24 (large surfaces, soft directions), 9999 (pills). Smaller
elements get smaller radii; a nested element's radius should be its parent's
radius minus the padding between them (a 12px card with 8px padding holds
4px-radius children), otherwise the corners look misaligned.

## 3. Buttons

**Hierarchy.** One primary per view region. Secondary is neutral (outline or
subtle fill). Tertiary/ghost is text-only with hover background. Destructive
uses danger color and is never the default-focused action. Link-styled
buttons are for inline navigation, not for actions.

| Variant | Fill | Border | Text | Hover |
|---|---|---|---|---|
| Primary | accent | none | accent-fg | accent-hover |
| Secondary | surface | border-strong | text-primary | bg-subtle |
| Subtle / tonal | accent-subtle | none | accent-900 | accent-100 |
| Ghost | transparent | none | text-primary | bg-subtle |
| Destructive | danger | none | white | danger-hover |
| Destructive ghost | transparent | none | danger-fg | danger-bg |

**Anatomy.** Optional leading icon, label, optional trailing icon (chevron
for menus, external-link arrow for new tab). Icon-to-label gap 8px (6px at
sm). Icon-only buttons are square (height = width) and need a tooltip or
`aria-label`.

**Label.** A verb phrase naming the outcome: "Save changes", "Create
project", "Send invite", "Delete 3 files". Never "Submit", "OK", "Yes",
"Click here". Sentence case. Keep under 3 words where possible. The
destructive button repeats the noun: "Delete project", not "Delete".

**Details that matter.**
- `font-weight: 500-600`; 400 looks like a link, 700 looks shouty.
- `line-height: 1` and explicit height prevents vertical misalignment.
- Width: hug content by default; full width only on mobile forms and in
  narrow dialogs. Never stretch a primary to 100% of a 1200px container.
- Min width 64-80px so "OK"-length labels do not produce square-ish
  buttons.
- Loading: keep width stable (set `min-width` from the measured label or
  render the spinner over a transparent label), disable, keep the label or
  switch to present progressive ("Saving...").
- Pressed: `transform: translateY(1px)` or `scale(0.98)`, 80ms. Playful
  directions use a hard offset shadow that collapses.
- Groups: equal heights, 8-12px gap, primary on the right (web, iOS) and
  trailing on dialogs. Android historically also trails the affirmative.
- Pairing a primary with a ghost "Cancel" is cleaner than primary +
  secondary.
- Icon-only buttons: 32-40px square, icon 16-20px, hover background, and a
  tooltip after 500ms.

## 4. Text inputs and textareas

**Anatomy.** Label (above, always visible), optional required marker or
"(optional)" suffix (mark the minority), input, optional helper text below,
error text replacing or following helper text, optional leading/trailing
icon or affix (`$`, `.com`, a clear button).

**Sizing.** Same heights as buttons. Padding 12px horizontal. Text 14-16px;
on mobile use 16px to prevent iOS zoom-on-focus.

**Visuals.** 1px border `border-strong` (not `border-default`, which is too
faint for a control boundary and fails 3:1), 6px radius, surface fill
(white in light mode; one step lighter than surface in dark). Placeholder in
`text-muted` and never as the label. Focus: border becomes accent *and* a
2px ring at 20-30% alpha, or the standard outline.

```css
.input {
  height: 2.5rem; padding: 0 0.75rem;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px; background: var(--color-bg-surface);
  color: var(--color-text-primary); font: inherit;
  transition: border-color 120ms, box-shadow 120ms;
}
.input::placeholder { color: var(--color-text-muted); }
.input:hover { border-color: var(--color-text-muted); }
.input:focus-visible { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 25%, transparent); }
.input[aria-invalid="true"] { border-color: var(--color-danger); }
.input[aria-invalid="true"]:focus-visible { box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-danger) 25%, transparent); }
.input:disabled { background: var(--color-bg-subtle); color: var(--color-text-disabled); }
```

**Label.** 13-14px, 500-600 weight, 6-8px above the input. Floating labels
are a design flourish that costs legibility; avoid unless the direction is
Material and the platform expects them.

**Helper and error text.** 12-13px, 6px below. Error text in `danger-fg`
with an icon, and it says what to do: "Enter a valid email like
name@example.com", not "Invalid input". Reserve the space (min-height) so
the layout does not jump when the error appears, or animate the height.

**Widths.** Match the expected content: a ZIP code input at 100% of a
600px form looks wrong. Postal code 8ch, phone 16ch, date 12ch, email and
name full width. Use `max-width` in `ch`.

**Textareas.** Minimum 3 rows, auto-grow up to a max (`field-sizing:
content` where supported), explicit resize handle vertical only
(`resize: vertical`). Character count only when there is a limit, shown at
the bottom right in `text-muted`, turning `danger-fg` near the limit.

**Affordances.** Clear button on search inputs once there is a value.
Password toggle (eye icon) as a trailing button. Prefix/suffix as flat text
in `text-muted` inside the border, not as separate boxes.

## 5. Selects, comboboxes, autocompletes

**Native select** is right for short, known lists (country, month) and on
mobile where the native picker is excellent. Style the trigger to match
inputs: same height, border, radius, with a chevron 16px at the right,
`appearance: none` plus a background SVG chevron.

**Custom select / listbox** when options need icons, descriptions,
grouping or search. Trigger looks like an input with a chevron. Popover:
same radius as cards (8px), 1px border, elevation-2 shadow, 4px padding,
options 32-36px tall with 8-12px horizontal padding, selected shown with
a check icon (leading or trailing, consistently) and `accent-subtle`
background, hover `bg-subtle`, keyboard highlight identical to hover.
Max height around 320px then scroll. Position below with 4px gap; flip
above when it does not fit.

**Combobox / autocomplete** when the list is long (users, cities, tags).
Input with type-ahead; results appear after 1-2 characters; show the match
highlighted in 600 weight; show an empty result row ("No matches for
'xyz'") rather than an empty popover; allow creation inline when
appropriate ("Create tag 'xyz'").

**Multi-select**: chips inside the input showing selections, each with a
remove ×; or a listbox with checkboxes and a summary ("3 selected") in the
trigger. Chips wrap and the control grows; cap at 2-3 rows then "+4 more".

**Details.** Keep the chevron static or rotate 180° over 150ms on open;
either is fine, mixing is not. The option list should never be narrower
than the trigger. Long option text truncates with an ellipsis and gets a
title tooltip. Group headers in 12px caps or 600 weight `text-muted`.

## 6. Checkboxes, radios, switches

**Checkbox**: 16-20px square (18 is a good default), 4px radius, 1.5-2px
border `border-strong`, checked = accent fill + white check 12px stroke 2px,
indeterminate = horizontal bar. Label to the right, 8-10px gap, vertically
centered to the first line of text. Hit area 44px via the label.

**Radio**: same size, circular, dot 8px when selected. Radios need 2+
options and one is always selected (or an explicit "none" option); a single
checkbox is not a radio. For 2-4 options with short labels consider a
segmented control instead; for 5+ consider a select.

**Switch**: 36-44px wide, 20-24px tall track, thumb 16-20px, 2px inset.
Off = `border-strong` track (not grey fill that looks disabled), on =
accent. Thumb slides 120-150ms ease-out. Switches are for settings that
take effect immediately; if the change needs a Save button, use a checkbox.
Label to the left in settings lists (label left, control right); to the
right in inline forms.

**Cards as radios** (selectable cards with price plans etc.): the entire
card is the target; selected state = accent border 2px + accent-subtle
background + a check icon. Do not rely on border color alone.

## 7. Dialogs and drawers

**When to use a dialog**: a focused task that should block the page
(confirm, short form, pick something). Not for: long forms (use a page or a
drawer), content browsing, or anything the user might want to reference the
page while doing.

**Anatomy.** Overlay (`rgb(0 0 0 / 0.4-0.6)` light, `0.6-0.7` dark; optional
`backdrop-filter: blur(4px)`), panel with header (title 18-20px 600, optional
description 14px muted, close button top right 32px), body, footer with
actions right-aligned (primary rightmost; destructive primary styled as
danger; Cancel as ghost).

**Sizing.** Widths 400/520/680/880 by content. Max height 85vh with the body
scrolling and header and footer fixed. Padding 24px (20 on mobile). Radius
12px (or the direction's large-surface radius). Elevation 4 shadow.

**Motion.** Overlay fades 150-200ms; panel fades + scales from 0.96 (or
slides up 8px) 200ms ease-out; exit faster (120-150ms, ease-in). On mobile,
dialogs become bottom sheets sliding up with a drag handle, full width,
rounded top corners 16px.

**Behavior that is design.** Focus moves to the panel (first field or the
title); Escape closes unless there are unsaved changes, in which case ask;
clicking the overlay closes only for non-destructive, non-form dialogs;
the primary action is not auto-focused when it is destructive. The frontend
skill implements the focus trap.

**Drawers / side panels.** For edit-in-context: 400-560px wide from the
right, full height, same header/footer pattern, slide 250ms ease-out. The
page behind can remain interactive (non-modal) when the drawer is a detail
view; modal when it is a form.

**Confirmation dialogs.** Title asks the question ("Delete 'Q3 report'?"),
body states consequence in one sentence ("This can't be undone."), buttons
name the action ("Delete report" / "Cancel"). For high-stakes deletes,
require typing the name. Prefer undo over confirmation for reversible
actions (see ux-and-flows.md).

## 8. Menus, popovers, tooltips

**Dropdown menu.** Trigger button with chevron or an icon-only "more"
(three dots: horizontal in rows, vertical in headers; pick one). Panel:
min-width 180px (or trigger width), max-width 320px, 4px padding, items
32-36px with 8-12px padding, 6px radius on items inside an 8px panel, icon
16px with 10px gap, keyboard shortcut right-aligned in `text-muted` mono or
small text, separators 1px `border-subtle` with 4px margin, destructive
items in `danger-fg` placed last after a separator, section labels 12px
muted. Submenus open to the right with a chevron; on mobile they flatten.

**Popover.** For small interactive content (date picker, color picker,
filter builder). Same surface as a menu, 12-16px padding, optional arrow
(arrows are a direction choice; most modern systems omit them). Position
with 8px gap and collision flipping.

**Tooltip.** Non-interactive text, 12-13px, max-width 240px, dark surface
(`bg-inverse`) with light text in light mode, lifted surface in dark mode,
6px radius, 6-8px padding. Appear after 400-600ms hover, instantly on
focus, disappear instantly. Never put essential information only in a
tooltip, and never on touch devices as the sole affordance. No tooltip on an
element that already has visible text saying the same thing.

**Context menus** (right click): same as dropdown; appear at the cursor.

## 9. Tabs and segmented controls

**Tabs** switch views of the same object. 2-7 tabs; beyond that use a
select or a sidebar. Underline style (2px accent indicator sliding 150ms
between tabs, text 14px 500, active `text-primary`, inactive
`text-secondary`, hover `text-primary`) is the quiet default. Enclosed
(pill or boxed) tabs read heavier and suit toolbars. Tabs sit flush with
the content border below them. Counts in tabs as a small muted badge. Do
not nest tabs inside tabs.

**Segmented control** switches a setting or filter among 2-5 short
options; it is a radio group that looks like a button group. Height 32-36px,
container `bg-subtle` with 2px padding and radius 8px, the selected segment
is a surface-colored pill with elevation-1 shadow that slides 150ms. Equal
widths unless labels vary wildly.

**Vertical tabs / side nav within a page** for settings with 6+ sections:
200-240px column, items 36px, active with `accent-subtle` background and
600 weight (not just color).

## 10. Tables

The component that most separates professional products from amateur ones.
Full treatment in data-dense-ui.md; the essentials:

- Row height by density: 32/40/48. Header 36-40px, 12-13px 600 caps-or-not
  per direction, `text-secondary`, sticky.
- Cell padding 8-12px horizontal; first and last cells get the table's
  outer padding (16-24px) so content aligns with the page.
- Text left, numbers right with tabular figures, dates left or right
  consistently, booleans as icons or short words not "true/false".
- Separation: 1px row borders `border-subtle` *or* zebra striping *or*
  hover highlight; never all three. Hover highlight (`bg-subtle`) plus a
  hairline is the standard.
- No vertical borders unless the direction is spreadsheet-like.
- Truncate long text with ellipsis and a title; wrap only in the one
  column designed to wrap (description).
- Row actions: an icon-button group revealed on hover/focus at the right,
  or a "more" menu; always keyboard reachable.
- Selection: checkbox column 40px wide at left; selected rows get
  `accent-subtle` background; a bulk-action bar replaces or overlays the
  toolbar when 1+ rows are selected.
- Sorting: clickable header with a 12px arrow indicator on the active
  column; inactive columns show the arrow only on hover.
- Empty: a real empty state inside the table body area, not a blank space.
- Loading: skeleton rows in the same height, 5-10 of them.
- Mobile: horizontal scroll with a sticky first column and a visible
  shadow at the scroll edge, or restructure into a card list for 3-4 key
  fields.

## 11. Cards, and when not to use them

A card is a bounded surface that groups content *that is one unit* and
usually *that can be acted on as a unit* (open, select, drag). Cards earn
their chrome when the grid is of peers (products, projects, people) or
when the content must be visually movable.

Do not use cards for: a single piece of content on a page (just lay it out);
form sections (use headings and space); a dashboard where every metric is
a card (hierarchy dies); content inside a card (nested cards); a list that
would be better as a table (anything users compare across rows).

**Anatomy.** Optional media (`aspect-ratio: 16/9` or `4/3`, `object-fit:
cover`, radius matching the card's top), body with 16-24px padding, title
(16px 600), description (14px `text-secondary`, clamp to 2-3 lines with
`-webkit-line-clamp`), metadata row (13px muted), optional footer with
actions separated by a hairline or by space.

**Visuals.** One separation method: border (`1px border-default`) or tone
(`bg-surface` on `bg-page`) or a light shadow (elevation 1). Radius
8-12px. Hover for clickable cards: border darkens one step and/or shadow
goes from elevation 1 to 2, 150ms; a 2-4px lift (`translateY(-2px)`) is
acceptable in soft directions and a tell when applied everywhere.

**Clickable cards.** The whole card is one link; secondary actions inside
need to stop propagation and be reachable by keyboard. Show the pointer
cursor on the whole card; do not put a "View" button inside a card that is
already a link.

**Alignment across a grid.** Equal heights (`grid` does this; flex with
`align-items: stretch`), titles clamped to the same line count, footers
pinned to the bottom (`margin-top: auto`), images fixed ratio. Misaligned
card footers are an instant tell.

## 12. Toasts and inline alerts

**Toast** (transient notification): for confirming an action that
succeeded elsewhere or asynchronously ("Report exported", "3 files
deleted. Undo"). Not for errors that need action (use an inline alert at
the point of failure) and not for information the user needs to keep.

- Position: bottom-left or bottom-center on desktop (does not cover primary
  content or the top nav), top-center on mobile below the status bar, or
  bottom above the tab bar. Pick one place for the whole product.
- Size: 320-420px wide, 12-16px padding, 8px radius, elevation 3, surface
  `bg-inverse` with light text (reads as transient) or `bg-raised` with a
  semantic left border 3px.
- Content: icon (semantic), one line of text (max two), optional single
  action ("Undo", "View"), optional close ×. No titles for simple toasts.
- Timing: 4-6s for info, 6-8s if there is an action, persistent for errors
  until dismissed. Pause the timer on hover and focus.
- Stack: newest on top, max 3 visible, older ones compress or collapse.
- Motion: slide 8-16px + fade in 200ms ease-out; fade out 150ms. Reduced
  motion: fade only.

**Inline alert / banner**: persistent message in context. Semantic
background (`danger-bg` etc.), 1px semantic border or a 3px left border,
12-16px padding, icon 16-20px aligned to the first line, title optional
(600), body 14px, actions as text buttons at the end or below. Page-level
banners sit under the header, full width, 40-48px tall. Form-level error
summaries sit above the form and link to the fields.

## 13. Navigation

**Top bar.** 56-64px desktop, 48-56px mobile. Logo left (clickable to
home), primary nav center or left, utilities right (search, notifications,
avatar menu). Active item: 600 weight and/or a 2px underline; color alone
is not enough. Sticky with a 1px bottom border or a shadow that appears
after scroll (not always-on).

**Sidebar.** 240-280px expanded, 56-64px collapsed to icons with tooltips.
Items 36-40px, icon 18-20px, label 14px, 8px radius on the item hover
background, active item `accent-subtle` + `text-primary` 600 + optional
3px accent bar on the left edge. Group labels 12px muted with 24px top
margin. Pin account/settings to the bottom. Nested items indent 28px
(icon width + gap) and show a chevron that rotates.

**Bottom tab bar (mobile).** 3-5 items, 56px + safe area, icon 24px with
11-12px label below (labels always; icon-only tab bars fail
comprehension), active in accent with a filled icon variant, inactive in
`text-secondary`. Never put "More" as the fifth tab if it can be avoided.

**Breadcrumbs.** 13-14px, `text-secondary` with the current page in
`text-primary` and not a link, separators as chevrons (not slashes unless
the direction is terminal-like), collapse the middle with "..." past 4
levels. Breadcrumbs for hierarchy depth, not for history.

**Command palette.** For power tools: ⌘K/Ctrl+K, 560-640px wide dialog
near the top (15vh), search input 48px, results 40px with icon, label,
section tag and shortcut. Recent items first when the input is empty.

**Pagination.** Prefer "Load more" or infinite scroll for feeds; numbered
pages for tables and search results where position matters. Numbered:
previous/next as icon buttons, current page as a filled pill, ellipsis for
gaps, page size selector and "1-25 of 1,204" range text left-aligned.

## 14. Empty states

Every list, table, search and dashboard has a first-run or no-results
state, and it is the state new users see most. Three kinds:

- **First use** ("You haven't created any projects yet"): explain what the
  thing is for in one sentence, offer the primary action as a button, and
  optionally a secondary ("Import from CSV", "See an example").
- **No results** (after a search or filter): say what was searched, offer
  to clear filters, suggest a nearby action. Do not show the first-use
  illustration here.
- **Cleared** (inbox zero, all tasks done): a quiet, positive note, no
  call to action pressure.

**Design.** Centered in the content area, vertical padding 48-96px,
optional illustration or icon 48-96px (one consistent style; avoid stock
"corporate Memphis"), title 16-18px 600, body 14px `text-secondary` max
40ch, button md. In tables, the empty state sits inside the body below the
header so the table structure remains. In sidebars or small panels, a
single line of muted text is enough.

**Copy.** Specific to the object: "No invoices yet. Create your first
invoice to start tracking payments." Not "Nothing to see here" or "No data".

## 15. Skeletons and loading

**Skeletons** stand in for content whose shape is known (cards, rows, a
profile). Draw the actual layout in `bg-subtle` blocks: text lines as
rounded bars at 60-90% width (vary them; identical widths look fake),
titles taller, avatars as circles, images as the final ratio. Shimmer:
a 1.2-1.6s linear gradient sweep, subtle (contrast between base and
highlight about 3-5% lightness), or a simple opacity pulse. Disable the
shimmer under reduced motion. Show skeletons only when the wait is likely
to exceed 300ms; for shorter waits show nothing (a flash of skeleton is
worse than a brief pause). Replace skeletons with content without layout
shift: same heights.

**Spinners** for unknown shape or small waits (button loading, inline
refresh). 16px in buttons, 20-24px inline, 32-40px for a panel. Animate
with `transform: rotate` 0.8-1s linear. Delay appearance by 200-300ms.

**Progress bars** when progress is measurable. 4-8px tall, radius full,
track `bg-subtle`, fill accent; show percentage or step text alongside.
Indeterminate bars (sweeping) only for medium waits where a spinner is too
small.

**Optimistic UI**: show the result immediately and reconcile; on failure,
revert and toast. This is the best loading state: none.

## 16. Badges, tags, chips, avatars

**Badge / status pill**: 20-24px tall, 11-12px 500-600 text, 6-8px padding,
full radius or 4px (choose per direction), semantic `bg` + `fg` pairs
(`success-bg` + `success-fg`), optional 6px dot. Text is sentence case.
Never more than one badge per row cell unless they are tags.

**Tag**: user-generated categories; neutral `bg-subtle` + `text-secondary`
or a hue from a fixed set at equal L and C; removable tags show × at 12px
on hover or always on touch.

**Chip** (filter chip): toggleable, 32px, outlined when off and
`accent-subtle` with a check when on.

**Count badge**: on icons, 16-18px circle, 10-11px 600, danger or accent
fill, positioned top-right overlapping by 25%; caps at "99+".

**Avatar**: circle (or 6-8px-radius square for workspaces/orgs to
distinguish from people). Sizes 24/32/40/48/64. Fallback: initials (1-2
letters, 40% of size, 600) on a hue derived from the name at fixed L 0.75 C
0.1. Stacks overlap by 25% with a 2px surface-colored ring; "+3" as the
last item.

## 17. Polish details that separate good from amateur

- Controls in a row share exactly one height; a 40px input next to a 38px
  button is visible.
- The focus ring exists and is the same everywhere.
- Icons come from one set, one stroke width (1.5px or 2px), one size per
  context, and are optically aligned to text.
- Hover states exist on every clickable thing and nowhere else.
- Disabled is not the same as loading is not the same as read-only.
- Text in a button or badge is vertically centered after rendering, not
  just in theory (check the screenshot).
- Nested radii decrease toward the inside.
- Borders are 1px and `border-strong` on controls, `border-default` on
  surfaces, `border-subtle` on dividers.
- Truncation uses ellipsis, not clipping, and a tooltip or title reveals
  the rest.
- Numbers are right-aligned and tabular.
- Empty, loading and error states exist for every data-bearing component.
- Dialog actions name the outcome and the destructive one looks destructive.
- Toasts do not cover the thing they are confirming.
- The cursor is a pointer on links and buttons, text on inputs, default on
  everything else (and `not-allowed` on disabled is optional, never
  `wait` for the whole page).
- Nothing animates for more than 300ms except the one intentional moment.
