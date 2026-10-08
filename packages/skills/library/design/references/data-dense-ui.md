# Data-dense UI

Tables, dashboards, admin panels and anything where many numbers compete:
density, numeric alignment and tabular figures, sticky headers, row actions,
filters, bulk actions, chart placement, and how to build hierarchy when
everything is "important." The dataviz skill owns chart design itself; this
file owns the screen around the charts and the tables that carry most of the
data in real products.

## Contents

1. The dense-UI mindset
2. Density settings for data screens
3. Tables: structure
4. Tables: cells and alignment
5. Tables: interaction (sort, select, row actions, inline edit)
6. Tables: large data (virtualization, sticky, horizontal scroll, mobile)
7. Filters, search and saved views
8. Bulk actions
9. Dashboards: hierarchy when everything is important
10. KPI tiles done properly
11. Chart placement and the chart/UI boundary
12. Admin panels and CRUD screens
13. Detail pages and master-detail
14. Live and real-time data
15. Dense-UI anti-patterns

## 1. The dense-UI mindset

Users of dense screens are usually professionals doing a repeated task.
They value scan speed, comparison, and keeping context over
approachability. Whitespace that helps a consumer breathe makes an
operator scroll. The craft is to pack information without losing
structure: alignment, consistent rhythm, and hierarchy by weight and
position rather than by size and space.

The question for every element is "does this help the user find, compare
or act?" Decoration (icons in every cell, colored backgrounds on every
status, zebra plus borders plus hover) adds noise that competes with the
data. The data should be the loudest thing on the screen.

## 2. Density settings for data screens

| Setting | Compact | Comfortable | Spacious |
|---|---|---|---|
| Row height | 32px | 40px | 48px |
| Body text | 13px | 13-14px | 14px |
| Cell padding (h) | 8px | 12px | 16px |
| Header height | 32-36px | 40px | 44px |
| Toolbar height | 40px | 48px | 56px |
| Sidebar filter width | 220px | 240-260px | 280px |
| Page padding | 16px | 24px | 32px |

Start at Comfortable for most products; offer Compact as a user setting for
power users (many ops tools default to Compact). On mobile, rows need 44px
hit areas even when visually 40.

Type sizes below 13px are legible only with excellent fonts and high
contrast; 12px is acceptable for header labels and metadata, 11px only in
extreme cases (trading, logs) with a mono font.

Keep the type scale narrow in dense UIs: 12, 13, 14, 16, 20 covers nearly
everything. A 32px heading in a dense admin screen wastes vertical space;
page titles at 18-20px 600 are enough.

## 3. Tables: structure

A table is for comparing records across attributes. If users do not
compare across rows, a list or cards may serve; if they do, nothing beats a
table.

**Column order**: identifier first (name, ID), then the most-compared
attributes, then status, then dates, then actions. The first column is
what users scan to find a row; make it the most recognizable field, often
with a secondary line (email under name) at 12px muted.

**Column widths**: set explicit widths for predictable columns (dates,
status, numbers, actions) and let one or two text columns flex. Use
`table-layout: fixed` with widths on `<col>` or headers for stable layouts.
Minimum widths so headers do not wrap: a date column 110-120px, a currency
column 100-120px, a status column 110-140px, an actions column 48-96px.
Allow user resizing in power tools; persist widths.

**Header**: sticky (`position: sticky; top: 0`) with a solid background and
a 1px bottom border; 12-13px, 600 weight, `text-secondary`; sentence case
(uppercase with tracking is a direction choice; it costs width). Alignment
matches the column's content alignment (numeric headers right-aligned).
Sort indicator 12px, shown for the active sort; appears on hover for
others. Column menu (filter, hide, pin) on hover via a small icon button.

**Row separation**: pick one. The quiet default is a 1px `border-subtle`
line between rows plus `bg-subtle` on hover. Zebra striping helps on very
wide tables (10+ columns) where the eye loses the row; then drop the
borders. Vertical lines only in spreadsheet-like editors.

**Grouping**: group headers as full-width rows with a slightly tinted
background and a 600 label, collapsible; summary rows (totals) in 600 with
a top border `border-strong`.

**Footer**: totals and pagination. Pagination on the left reads "1-50 of
1,204" with page size; controls on the right. Or infinite scroll with a
sticky footer for totals.

**Toolbar above the table**: search left, filters next, view controls
(density, columns) and primary action right. 48px tall, 12px gap, controls
at `sm` size (32px).

## 4. Tables: cells and alignment

Alignment is what makes a table scannable; get it wrong and no amount of
styling helps.

| Content | Alignment | Format |
|---|---|---|
| Text, names, IDs | Left | Truncate with ellipsis + title; one wrapping column at most |
| Numbers, currency, percentages | Right | Tabular figures; same decimals in a column; thousands separators; unit in header not cell |
| Dates and times | Left (or right if compared numerically) | One format per table; relative for recent in activity feeds, absolute elsewhere; ISO or locale, never both |
| Status | Left | Badge or dot + text; one badge per cell |
| Booleans | Center or left | Icon (check / dash) or short word (Yes / No); never true/false |
| Actions | Right | Icon buttons revealed on hover/focus, or a menu |
| Checkbox (select) | Center in a 40px column | |
| Avatars / thumbnails | Left, 24-32px | With text, not alone |

Numeric specifics:

- `font-variant-numeric: tabular-nums` on numeric cells, always.
- Same precision per column (`1,204.50` and `98.00`, not `98`).
- Negative numbers: minus sign (not parentheses, unless the audience is
  accounting and expects them) and optionally `danger-fg`; positive
  changes do not need green by default.
- Align decimal points by right-aligning with fixed precision; for mixed
  precision, pad or use `ch` width tricks.
- Large numbers: abbreviate in dashboards (1.2M), never in tables users
  reconcile against (1,204,500).
- Units in the header ("Revenue (USD)") and currency symbols either in
  every cell or in the header; be consistent.
- Zero and null differ: show `0` for zero, `—` (em dash, `text-muted`) for
  missing, not blank and not `null`.
- Percent bars (a thin bar behind or beside a percentage) help comparison
  in a column; keep them at 4px tall in `accent-subtle` or neutral.

Text cells:

- Truncate with `text-overflow: ellipsis` and `title` or a tooltip; the
  one wrapping column (description) gets `white-space: normal` with a
  max of 2 lines.
- Secondary text (12px `text-muted`) under the primary is the way to add
  context without a column.
- Links in cells: `text-primary` with underline on hover only, or accent;
  but in a table full of links, accent everywhere is noise. Prefer the row
  to be clickable (whole-row link) and keep cells plain.

Icons in cells: only when they carry meaning (status, file type) and
always with text or a tooltip. A column of 16px icons at `text-muted` is
fine; a column of colored icons is confetti.

## 5. Tables: interaction

**Sorting**: click header toggles asc/desc; a third click clears or returns
to default (decide and be consistent). Multi-sort via shift-click in power
tools with numbered indicators. Default sort is the most useful (newest
first, highest value) and is shown.

**Selection**: a checkbox column; header checkbox selects the page (with
an option to "Select all 1,204"); selected rows get `accent-subtle`
background; the toolbar becomes a bulk-action bar (see section 8).
Shift-click range selection in power tools. Clicking a row (not the
checkbox) opens the record; clicking the checkbox selects. Do not make the
whole row a selection toggle unless selection is the primary task.

**Row actions**: 1-3 icon buttons (32px) revealed on hover and focus-
within, right-aligned in a fixed column, or a single "..." menu. On touch,
the menu is always visible or actions are in the detail view. The most
common action (open, edit) can be the whole-row click.

**Inline editing**: click a cell (or an edit icon) to turn it into an input
with the same height; Enter saves, Escape cancels, Tab moves to the next
editable cell; saved cells flash `success-bg` for 600ms. Keep validation
inline. Not every column should be editable; mark editable cells with a
subtle affordance on hover (pencil icon, border).

**Expandable rows**: a chevron in the first column; the expanded content
is indented and on a tinted background; only one level deep.

**Column controls**: show/hide, reorder (drag), pin left/right, resize.
Persist per user per table. A "Reset columns" option.

**Keyboard**: arrow keys move focus between rows (and cells in editors);
Enter opens; Space selects; the frontend skill implements the grid pattern,
but the design must show a visible focused-row state distinct from hover
and selected (a 2px inset ring or a left bar).

**Context menu**: right-click on a row offers the row actions.

## 6. Tables: large data

**Virtualization** for more than a few hundred rows: render only visible
rows; keep row heights fixed for smooth scrolling (variable heights make
virtualization hard; prefer truncation to wrapping). Show a scroll
position indicator ("Rows 240-290 of 12,000") in power tools.

**Sticky columns**: the first column (identifier) and the actions column
stick on horizontal scroll, with a shadow or border on their inner edge
when scrolled (`box-shadow: 2px 0 4px rgb(0 0 0 / 0.06)` on the left
sticky column, mirrored on the right). Sticky header and sticky column
corners need a solid background and the right z-index.

**Horizontal scroll**: inevitable beyond 8-10 columns on a laptop. Signal
it (a gradient fade at the scroll edge, a visible scrollbar) and keep the
identifier column sticky. Alternative: column visibility defaults that fit
the width, with "more columns" available.

**Loading**: skeleton rows matching the layout (same heights, bars at the
column widths), 8-10 rows; pagination loads replace rows without
collapsing the table height.

**Empty**: inside the table body under the header, with filter-aware copy
("No orders match these filters" + Clear filters).

**Mobile**: three options, by use case. (1) Card list: each row becomes a
card with the 3-4 key fields labeled; tap opens the detail with all
fields. (2) Horizontal scroll with a sticky first column, for tables where
comparison matters. (3) Priority columns: show 2-3 columns on narrow
widths, expand row for the rest. Never shrink the whole table to fit.

## 7. Filters, search and saved views

**Placement**: filters above the table as a row of chips/dropdowns for
3-6 filters; a left sidebar (240-260px, collapsible) for 7+ or faceted
filters with counts; a "Filters" button opening a panel on mobile.

**Filter controls**: a dropdown per attribute (multi-select with search
for long lists; date range picker with presets: Today, Last 7 days, Last
30 days, This month, Custom; numeric range with min/max inputs), each
showing its applied value in the trigger ("Status: Open, Pending").

**Applied filters**: visible as removable chips in a row under the toolbar
("Status: Open ×", "Owner: me ×") with "Clear all". The result count
updates immediately ("312 orders").

**Search**: a box with an icon, placeholder naming what it searches,
debounced, highlighting matches in the identifier column, with a clear
button.

**Saved views**: when users build the same filter sets repeatedly, let
them save and name a view; show views as tabs above the toolbar ("All",
"My open", "Overdue", "+ Save view"). Persist in the URL as well so views
are linkable.

**Filter logic visibility**: default AND across attributes, OR within a
multi-select; state it when the UI gets complex ("Matches all of these").
Advanced query builders (nested AND/OR) for power tools only, with a plain
text summary.

**Defaults**: open with a useful filter applied (my items, active items)
rather than everything; make it obvious and removable.

## 8. Bulk actions

When 1+ rows are selected:

- The toolbar transforms (or a bar slides in above/below the table) with:
  the count ("3 selected"), a "Select all 1,204" link when the page is
  fully selected, the actions as buttons (3-5 most common; the rest in a
  "More" menu), and a clear/× to deselect.
- Keep the bar sticky so it is reachable while scrolling.
- Destructive bulk actions are placed last, styled as ghost-danger, and
  confirm with the count and consequence.
- Progress for long bulk operations: a progress bar in the bar or a
  toast with progress; rows update as they complete; failures are
  listed, not just counted ("2 of 50 failed: #1043 (locked), #2210 (not
  found)").
- After completion, selection clears and a toast confirms with Undo where
  possible.

## 9. Dashboards: hierarchy when everything is important

A dashboard that treats every metric equally communicates nothing. The
design question is: what decision does this dashboard support, and what
is the one number that most informs it? That number gets the top-left and
the largest type. Everything else supports it.

Structure, top to bottom:

1. **Header**: dashboard name, time range control (the most important
   control; make it prominent and persistent), refresh state ("Updated 2
   min ago"), export/share.
2. **Primary metrics row**: 3-5 KPI tiles, with the primary one visually
   dominant (wider, or larger number). Not 8 identical tiles.
3. **Primary chart**: the main trend, full width or 2/3 width, 280-360px
   tall. Charts need height to read; a 160px line chart is a sparkline.
4. **Supporting charts and tables**: 2-3 columns, 240-320px tall, each
   with one clear title stating what it shows ("Revenue by region, last
   30 days"), not "Chart 2".
5. **Detail table**: the underlying records, filterable, at the bottom or
   on a separate tab.

Hierarchy tools when space and size are constrained:

- **Position**: top-left is first; the eye moves in an F or Z pattern.
- **Weight**: 600 for primary values, 400 for secondary; `text-primary`
  versus `text-secondary`.
- **Size**: one or two sizes larger for the primary KPI, not for all.
- **Width**: a 2-column-span tile reads as more important than 1-column
  tiles.
- **Color**: used for semantic status only (a red delta, an amber
  threshold); never to make a tile "pop."
- **Grouping**: related tiles share a container or a header; unrelated
  ones are separated by space.
- **Suppression**: metrics that are stable and unremarkable can be
  smaller, collapsed, or on a secondary tab. Not everything belongs
  above the fold.

Grid: 12 columns, 16-24px gap, tiles at spans of 3/4/6/8/12; fixed row
heights per tile type for alignment (KPI tiles 100-120px, charts 300px,
tables variable). Avoid masonry; aligned rows read as a system.

Responsive: tiles stack to 2 columns on tablet and 1 on phone, in
priority order; charts drop to simplified versions (fewer series, bigger
labels); tables become key-field lists.

## 10. KPI tiles done properly

Anatomy: label (12-13px `text-secondary`, sentence case), value (24-32px
600 tabular; up to 40px for the primary), delta (12-13px, with arrow or
sign, semantic color only when the direction of good is unambiguous; a
cost going up is not green), comparison context ("vs. last 30 days" in
`text-muted`), optional sparkline (40-60px tall, neutral or accent-300,
no axes), optional link to detail.

Sizing: 100-120px tall, padding 16-20px, 1px border or tone, no shadow in
dense directions. Primary tile spans 2 columns or has a 40px value.

Details:

- Label above value (eye reads context then number) is the common
  pattern; value above label works for a very prominent primary.
- Units attached to the value in a smaller size ("$1.2M", "48%", "3.2s")
  or in the label.
- Abbreviate consistently (K, M, B) with one decimal; show the exact value
  in a tooltip.
- Deltas: "+12.4%" with an up arrow; red/green only when good/bad is
  clear; use neutral when it is not (number of tickets created).
- Loading: a skeleton of the value width; do not animate counting from
  zero on every load (once, on first load, if the direction is playful,
  and never again).
- Thresholds: a small colored dot or a tinted border edge, with the
  threshold stated in a tooltip ("Target: 95%").
- Empty or no data: "—" with a muted "No data for this period."

Six identical tiles with the same type size and random colored icons is
the dashboard version of three feature cards. Vary size by importance,
drop the icons, and let the numbers carry.

## 11. Chart placement and the chart/UI boundary

The dataviz skill decides chart type, encoding and palette. This skill
decides where charts sit and how they coexist with UI:

- **Chart container**: a title (14-15px 600) stating what the chart shows
  and the period; a subtitle for the metric definition if needed; a
  toolbar on hover or right-aligned (range, export, fullscreen); the
  chart; a legend (horizontal above or below for 2-6 series; interactive
  toggles). Padding 16-20px; no border inside the border.
- **Height**: time series 240-360px; bar charts scale with categories
  (24-32px per bar for horizontal bars); donuts and gauges are small
  (120-160px) and should be rare.
- **Chart colors versus UI colors**: the UI accent is not a series color
  (see color.md). Gridlines at `border-subtle`; axis text at `text-muted`
  12px; tooltips use the UI tooltip style.
- **Context**: a chart beside a table of the same data lets users see
  both shape and values; clicking a chart element should filter the table
  (cross-filtering) in analytical tools.
- **Side-by-side comparisons**: same scale, same height, same color
  mapping across the row; mismatched y-axes mislead.
- **Density**: never more than 4-6 charts in view at once; beyond that,
  tabs or scrolling with a clear order.
- **Empty and error states** for charts: a centered muted message in the
  chart area at the same height, not a collapsed container.

## 12. Admin panels and CRUD screens

The shape of most internal tools: a list of records, a detail/edit view,
and create. Make the shape consistent across every entity.

- **List page**: title + primary "New X" button top right; toolbar
  (search, filters, views); table; pagination. Identical structure for
  every entity so users learn it once.
- **Detail page**: header with the record's identifier, status badge,
  primary actions (Edit, and the most common state action) and a "..."
  menu; then either a tabbed layout (Overview, Activity, Settings) or a
  two-column layout (main fields left 2/3, metadata and related records
  right 1/3). Key-value pairs as a definition list: label 13px
  `text-secondary` above or beside value 14px `text-primary`, 12-16px
  between pairs, grouped under headings.
- **Edit**: inline on the detail page (fields become inputs, Save/Cancel
  appear) or a drawer; a separate edit page only for very long forms.
  Dirty state indicator; unsaved-changes guard.
- **Create**: a dialog for 1-5 fields; a drawer or page for more; defaults
  pre-filled; the created record opens or is highlighted in the list.
- **Activity / audit log**: a vertical timeline, 12-13px, with actor,
  action, object, relative time, and expandable details; icons per event
  type in `text-muted`.
- **Permissions**: controls the user cannot use are hidden if irrelevant
  to their role, disabled with a tooltip reason if they may have the
  right some day.
- **Danger zone**: delete/archive/transfer at the bottom of detail or
  settings with a `danger-border` container.

Visual tone for admin: Industrial or Scientific instrument directions;
13-14px type; borders over shadows; semantic colors for status only;
`sm` controls in toolbars and `md` in forms.

## 13. Detail pages and master-detail

**Master-detail** (list left, detail right): list 320-400px with compact
rows (each showing 2-3 fields), detail fills the rest; selected row
highlighted; keyboard up/down moves selection; URL reflects the selected
record. On narrow screens the list and detail become two screens with a
back action. Email clients, ticketing, inboxes.

**Detail layouts**: a sticky header with identifier and actions so they
remain reachable while scrolling; a summary band (status, owner, key
dates) under the header; the body in sections with headings and hairline
rules; related records as compact tables or lists at the bottom; a right
rail for metadata and activity on wide screens, folding below on narrow.

**Key-value density**: two-column key-value grids (label left 140-180px,
value right) in comfortable density; stacked (label above value) in
compact or narrow. Align values in a column so the eye runs down them.

## 14. Live and real-time data

Logs, monitors, trading, ops boards.

- **Updating values** change in place with a brief 300-600ms background
  flash (`accent-subtle` or semantic tint) that fades; the value itself
  does not animate (no rolling digits in serious tools) unless the
  direction wants it.
- **Streaming lists** (logs, events) append at the bottom with auto-scroll
  that pauses when the user scrolls up ("Paused; 24 new. Resume" sticky
  pill), or prepend at the top with a "12 new items" button rather than
  shifting content under the cursor.
- **Freshness**: a visible "Live" indicator (a small dot that pulses
  slowly, disabled under reduced motion) and a last-updated timestamp;
  stale data (connection lost) switches to a warning state with the
  stale timestamp.
- **Sparklines and mini-charts** for trend at a glance beside the
  current value.
- **Thresholds and alerts**: color by state against stated thresholds
  (shown in a tooltip or legend); amber before red; the alert list
  sorted by severity then recency.
- **Dark mode default** is common and appropriate for monitors watched
  for hours; design the dark palette first in these products.
- **Mono type** for logs and IDs; wrap off by default with horizontal
  scroll; a wrap toggle.
- **Performance**: cap re-render frequency (throttle updates to 2-4/s for
  visuals; humans cannot read faster) and virtualize long streams.

## 15. Dense-UI anti-patterns

| Anti-pattern | Fix |
|---|---|
| Centered text in table cells | Left for text, right for numbers |
| Numbers in proportional figures | `tabular-nums`; right-align; fixed precision |
| Zebra + borders + hover + vertical lines | One separator plus hover |
| 56px rows in a tool used all day | 36-40px; Compact option |
| Every status a saturated colored badge | Dot + text; color only for states that need it; neutral for the normal state |
| 8 identical KPI tiles with icons | 3-5 tiles; primary larger; no decorative icons |
| Charts at 160px tall | 280-360px for the primary; sparklines only when a sparkline is meant |
| Chart series in the UI accent color | Separate data palette (dataviz) |
| Actions as four tiny colored icons in every row | Hover-revealed 32px icon buttons or a menu |
| Filters hidden behind a single "Filter" button on desktop | Visible filter row; chips for applied |
| No applied-filter visibility | Chips + count + Clear all |
| Blank table when empty | Empty state inside the body with filter-aware copy |
| Table shrinks to fit mobile | Card list, sticky-column scroll, or priority columns |
| `true` / `false` / `null` in cells | Icons or words; `—` for missing |
| Headers in 11px uppercase with no contrast | 12-13px 600 sentence case `text-secondary` (caps only if the direction wants it and width allows) |
| Page title at 32px eating the viewport | 18-20px in a 56px header |
| Live values animating constantly | Flash-and-settle; throttle |
| Mixed date formats in one table | One format; relative only in activity feeds |
| Tooltip as the only place to see the full value | Truncation + title, or widen the column |
