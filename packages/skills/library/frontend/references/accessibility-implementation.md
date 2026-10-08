# Accessibility implementation

Semantic HTML first, the ARIA Authoring Practices (APG) patterns for the
widgets you will actually build, focus management in SPAs and dialogs,
keyboard interaction tables, live regions, form error wiring, and how to
test (axe, a keyboard pass, a screen reader smoke test). The design-side
decisions (contrast, target size, focus ring appearance, reading order as
layout) are in `design/references/accessibility.md`; this file is the
code that implements them.

## Contents

1. The order of operations
2. Semantic HTML: the free wins
3. ARIA rules
4. Focus management
5. Keyboard interaction tables for common widgets
6. APG patterns with code
7. Live regions and announcements
8. Forms: labels, errors, descriptions
9. Images, icons, SVG
10. Motion and `prefers-reduced-motion`
11. Testing
12. Framework notes
13. Anti-patterns with fixes

## 1. The order of operations

1. Use the native element that does the job (`<button>`, `<a>`, `<select>`,
   `<dialog>`, `<details>`, `<input type=...>`, `<table>`, `<nav>`, `<main>`).
2. If none exists, use the closest native element and extend it (a
   `<button aria-expanded>` for a disclosure, `<ul role="listbox">`).
3. Only then build from `<div>` with a full APG pattern: role, states,
   properties, keyboard, focus management.
4. Test with keyboard, axe, and a screen reader before calling it done.

The reason: each step down the ladder adds code you must write and
maintain, and each piece is a place to get it wrong. A native `<select>`
handles 30 keyboard and AT behaviors you would never think of.

## 2. Semantic HTML: the free wins

| Need | Use | Not |
|---|---|---|
| Clickable action | `<button type="button">` | `<div onClick>`, `<a href="#">`, `<span role="button">` |
| Navigation to a URL | `<a href>` (framework `Link` renders one) | `<button onClick={navigate}>`, `<div onClick>` |
| Page regions | `<header>`, `<nav aria-label>`, `<main>`, `<aside>`, `<footer>`; one `<main>` per page | `<div class="header">` |
| Headings | `<h1>`-`<h6>` in order, one `<h1>` | Styled `<div>`s; skipping levels for size |
| Lists | `<ul>/<ol>/<li>`, `<dl>` | `<div>`s with bullets |
| Tabular data | `<table>` with `<th scope>`, `<caption>` | `<div>` grid (unless virtualized; then `role="grid"` with full ARIA) |
| Form field | `<label for>` + `<input id>`; `<fieldset><legend>` for groups | Placeholder as label |
| Disclosure | `<details><summary>` | Custom toggle |
| Modal dialog | `<dialog>` + `showModal()` | `<div class="modal">` with hand-rolled trap |
| Tooltip/popover/menu | `popover` attribute + `popovertarget`; or APG pattern | Absolutely positioned `<div>` with hover |
| Progress | `<progress>`, `<meter>` | Divs with widths |
| Emphasis | `<strong>`, `<em>` | `<b>`, `<i>` for meaning |
| Hidden but present for AT | `.sr-only` utility | `display:none` (hides from AT too) |
| Hidden from everyone | `hidden` attribute | `opacity:0` (still focusable) |
| Disabled region | `inert` attribute | `pointer-events:none` (still focusable) |

Heading structure is navigation for screen reader users (they jump by
heading). Landmarks (`<nav>`, `<main>`) likewise. Give repeated landmarks
labels: `<nav aria-label="Main">`, `<nav aria-label="Breadcrumb">`.

Set `<html lang="en">` (and `lang` on foreign-language fragments); set
the document `<title>` per route (frameworks: `metadata`, `useHead`,
`<svelte:head>`, `Title` service).

## 3. ARIA rules

- No ARIA is better than bad ARIA. `role="button"` on a `<div>` without
  keyboard handling is worse than no role (AT announces a button that
  does not work).
- Do not change native semantics (`<h2 role="button">`). Nest a `<button>`
  inside the `<h2>` instead.
- Every interactive element needs an accessible name: text content,
  `aria-label`, `aria-labelledby`, or an associated `<label>`. Icon-only
  buttons always need `aria-label`.
- States are dynamic: `aria-expanded`, `aria-selected`, `aria-checked`,
  `aria-pressed`, `aria-current`, `aria-disabled`, `aria-invalid`,
  `aria-busy`. Update them when state changes; they are the only way AT
  knows.
- Relationships: `aria-controls`, `aria-describedby`, `aria-labelledby`,
  `aria-owns` (rare), `aria-activedescendant` (for composite widgets where
  focus stays on one element).
- `aria-hidden="true"` removes a subtree from AT; never put it on a
  focusable element or its ancestor.
- `aria-live` for content that changes without focus moving (section 7).
- Prefer native attributes over ARIA equivalents: `disabled` over
  `aria-disabled` (unless you need it focusable to explain why),
  `required` over `aria-required`, `hidden` over `aria-hidden`.
- Roles have required children/parents (`listbox` > `option`, `tablist` >
  `tab`, `menu` > `menuitem`). axe flags violations.

## 4. Focus management

Focus is the keyboard user's cursor. Every time you change what is on
screen, ask where focus is now and where it should be.

| Event | Focus should go to |
|---|---|
| Dialog opens | The first focusable element in the dialog, or the dialog heading (`tabindex="-1"`) for long content |
| Dialog closes | The element that opened it |
| Route change in a SPA | The new page's `<h1>` or `<main tabindex="-1">`; announce the new title |
| Item deleted from a list | The next item, or the previous if it was last, or the list heading/"Add" control if empty |
| Form submitted with errors | The first invalid field, or an error summary with links to fields |
| Form submitted successfully, stays on page | The success message (`tabindex="-1"`) or the next logical control |
| Toast appears | Nowhere (do not steal focus); announce via live region |
| Expand a disclosure/accordion | Stays on the trigger |
| Open a menu | First menu item (or the menu container with `aria-activedescendant`) |
| Infinite scroll loads more | Stays; announce count via live region |
| Tab switched | Stays on the tab; panel content is next in Tab order |

```tsx
// Return focus on close; React example, same idea everywhere
function useReturnFocus(open: boolean) {
  const previous = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) previous.current = document.activeElement as HTMLElement
    else previous.current?.focus()
  }, [open])
}

// Route change focus (React Router). SvelteKit: afterNavigate. Vue Router: router.afterEach. Angular: NavigationEnd.
function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const h1 = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: false }) }
  }, [pathname])
  return null
}
```

Focus trapping in modals: `<dialog>.showModal()` does it natively, with
Escape to close and the rest of the page `inert`. For custom overlays,
use a maintained utility (`focus-trap`, Radix/Headless UI/React Aria
primitives) rather than hand-rolling Tab cycling.

Visible focus: `:focus-visible` styles that meet contrast (design decides
the look). Never `outline: none` without a replacement. Avoid `tabindex`
values > 0 (they break the natural order); use `0` to add to order, `-1`
for programmatic-only focus.

Roving tabindex for composite widgets (toolbar, tabs, radio group, grid):
one element in the group has `tabindex="0"`, the rest `-1`; arrow keys
move focus and update which one is `0`. Tab leaves the group.

## 5. Keyboard interaction tables for common widgets

| Widget | Keys |
|---|---|
| Button | Enter, Space activate |
| Link | Enter activates (Space scrolls; do not override) |
| Checkbox | Space toggles |
| Radio group | Arrows move and select; Tab enters/leaves group |
| Tabs | Arrows move between tabs (Left/Right for horizontal), Home/End; activation automatic on focus or manual with Enter/Space (choose and be consistent); Tab goes to panel |
| Menu button | Enter/Space/Down opens and focuses first item; Up opens and focuses last; in menu: arrows move, Home/End, Escape closes and returns focus to button, Enter/Space activates, typing a letter jumps |
| Disclosure/accordion | Enter/Space toggles; optional arrows between headers |
| Dialog | Escape closes; Tab cycles within; focus returns on close |
| Listbox (single) | Arrows move selection, Home/End, type-ahead; Space/Enter select if selection follows focus is not used |
| Combobox | Down opens/moves, Up, Enter selects, Escape closes (second Escape clears), typing filters; `aria-activedescendant` keeps focus in the input |
| Slider | Arrows ±step, PageUp/Down ±large step, Home/End min/max |
| Tree | Right expands/moves in, Left collapses/moves out, Up/Down move, Home/End, `*` expands all |
| Grid/table navigation | Arrows between cells, Home/End row, Ctrl+Home/End grid, PageUp/Down |
| Toolbar | Left/Right between controls (roving tabindex), Tab leaves |
| Drag and drop | Must have a keyboard alternative: a "Move" menu, or Space to pick up, arrows to move, Space to drop, Escape to cancel; announce positions |

## 6. APG patterns with code

### Disclosure (the simplest, and the base of accordions)

```html
<h3><button type="button" aria-expanded="false" aria-controls="sec1-panel" id="sec1-btn">Shipping details</button></h3>
<div id="sec1-panel" role="region" aria-labelledby="sec1-btn" hidden>…</div>
```
Toggle `aria-expanded` and `hidden` together. That is the whole pattern.

### Tabs

```tsx
function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0].id)
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const idx = tabs.findIndex(t => t.id === active)
  function onKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowRight: idx + 1, ArrowLeft: idx - 1, Home: 0, End: tabs.length - 1 }
    if (!(e.key in moves)) return
    e.preventDefault()
    const next = tabs[(moves[e.key] + tabs.length) % tabs.length]
    setActive(next.id); refs.current[next.id]?.focus()            // automatic activation
  }
  return (
    <>
      <div role="tablist" aria-label="Order sections" onKeyDown={onKeyDown}>
        {tabs.map(t => (
          <button key={t.id} ref={el => (refs.current[t.id] = el)} role="tab" id={`tab-${t.id}`} aria-selected={t.id === active}
                  aria-controls={`panel-${t.id}`} tabIndex={t.id === active ? 0 : -1} onClick={() => setActive(t.id)}>{t.label}</button>
        ))}
      </div>
      {tabs.map(t => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} tabIndex={0}>{t.content}</div>
      ))}
    </>
  )
}
```

### Modal dialog with `<dialog>`

```tsx
function ConfirmDialog({ open, onClose, onConfirm, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current; if (!d) return
    if (open && !d.open) d.showModal()           // native: focus trap, Escape, inert background, top layer
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dlg-title" aria-describedby="dlg-desc" onClick={e => { if (e.target === ref.current) onClose() }}>
      <h2 id="dlg-title">{title}</h2>
      <div id="dlg-desc">{children}</div>
      <form method="dialog" onSubmit={e => { e.preventDefault(); onConfirm() }}>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" autoFocus>Delete</button>      {/* autoFocus the safe or primary action deliberately */}
      </form>
    </dialog>
  )
}
```
Focus returns to the opener automatically when closed with `close()`. If
the opener unmounted (deleted row), move focus manually (section 4).

### Menu button

```html
<button type="button" id="more-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu">More actions</button>
<ul id="more-menu" role="menu" aria-labelledby="more-btn" hidden>
  <li role="none"><button role="menuitem" type="button" tabindex="-1">Duplicate</button></li>
  <li role="none"><button role="menuitem" type="button" tabindex="-1">Archive</button></li>
  <li role="separator"></li>
  <li role="none"><button role="menuitem" type="button" tabindex="-1">Delete</button></li>
</ul>
```
Behavior per table in section 5: open focuses the first item, arrows move
(wrapping), Escape closes and refocuses the button, click outside closes.
`role="menu"` is for *action* menus; a navigation dropdown is a `<nav>` with
a list of links and a disclosure button, not a menu.

### Combobox (autocomplete)

```html
<label for="city">City</label>
<input id="city" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="city-list" aria-activedescendant="city-opt-2" autocomplete="off" />
<ul id="city-list" role="listbox" aria-label="Suggestions">
  <li id="city-opt-1" role="option" aria-selected="false">Berlin</li>
  <li id="city-opt-2" role="option" aria-selected="true">Bern</li>
</ul>
<div aria-live="polite" class="sr-only">2 suggestions available.</div>
```
Focus stays in the input; `aria-activedescendant` points to the visually
highlighted option; the options are not tabbable. This is hard to get
right; use Downshift, React Aria `useComboBox`, Headless UI, Radix, or
the equivalent in the repo's component library when available.

### Toast / notification

Not focusable, not a dialog. `role="status"` (polite) for success/info,
`role="alert"` (assertive) for errors. Pausable on hover/focus, and the
same information must be available elsewhere if it times out (an error in
a toast that disappears in 3 s is not accessible). Provide a close button
with `aria-label="Dismiss"`.

### Skip link

```html
<a href="#main" class="skip-link">Skip to main content</a>   <!-- first focusable element; visible on focus -->
<main id="main" tabindex="-1">
```

## 7. Live regions and announcements

Live regions announce DOM changes without moving focus. They must exist
in the DOM *before* the content changes (AT registers them on page load);
inject text into an existing region, do not create the region with its
text.

```tsx
// One app-level announcer; call announce('3 results found')
const AnnouncerContext = createContext<(msg: string, mode?: 'polite' | 'assertive') => void>(() => {})
export function Announcer({ children }) {
  const [polite, setPolite] = useState(''); const [assertive, setAssertive] = useState('')
  const announce = useCallback((msg: string, mode: 'polite' | 'assertive' = 'polite') => {
    const set = mode === 'assertive' ? setAssertive : setPolite
    set(''); setTimeout(() => set(msg), 50)        // clear then set so repeated identical messages re-announce
  }, [])
  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{polite}</div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">{assertive}</div>
    </AnnouncerContext.Provider>
  )
}
```

Use polite for: results count after filtering, "Saved", items loaded,
progress milestones. Assertive for: errors that block, session expiring.
Never announce on every keystroke or every progress percent; batch.
`aria-busy="true"` on a region while it loads suppresses partial
announcements. Route changes: announce the new page title (the framework
may do this; check), or focus the `<h1>` which announces itself.

`.sr-only`:
```css
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
```

## 8. Forms: labels, errors, descriptions

```html
<div class="field">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required
         aria-describedby="email-hint email-error" aria-invalid="true" />
  <p id="email-hint">We'll send the receipt here.</p>
  <p id="email-error" role="alert">Enter an email address like name@example.com.</p>
</div>
```

Rules: a visible `<label>` for every control (placeholder is not a label;
`aria-label` is a fallback for visually-labeled-by-layout cases like
search boxes with a button). Hints and errors linked through
`aria-describedby` (multiple ids allowed). `aria-invalid` toggled with the
error. Errors appear next to the field *and* are announced (either `role=
"alert"` on the error element when it appears, or focus moves to the first
invalid field on submit). Group related controls in `<fieldset>` with a
`<legend>` (radio groups, address blocks). `autocomplete` tokens on
identity fields (`name`, `email`, `tel`, `street-address`, `postal-code`,
`cc-number`) help everyone. `inputmode="numeric"` for numeric strings
(OTP, card). Do not disable the submit button until valid; let users
submit and see what is wrong. Submit on Enter from any text field (native
form behavior; do not break it with `preventDefault` on keydown). Form
state management is in `forms.md`.

Error summary pattern for long forms: on submit with errors, render a
`<div role="alert" tabindex="-1">` at the top listing errors as links to
fields (`<a href="#email">`), focus it.

## 9. Images, icons, SVG

- Informative image: `alt` describes the content/purpose in context.
  Decorative: `alt=""` (not missing). Complex (chart): short `alt` plus a
  longer description nearby or via `aria-describedby`.
- Icon-only button: `<button aria-label="Close"><svg aria-hidden="true" focusable="false">…</svg></button>`.
- Icon with text: the SVG gets `aria-hidden="true"`; the text is the name.
- Inline SVG that conveys meaning: `role="img"` + `<title>` linked by
  `aria-labelledby`, or `aria-label`.
- Icon fonts: `aria-hidden` and provide text; prefer SVG.
- `<svg focusable="false">` for old Edge/IE if still supported.

## 10. Motion and `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```
Or opt-in per animation. In JS (Framer Motion `useReducedMotion`, GSAP
`matchMedia`), skip parallax, autoplay and large movements; keep
opacity/color changes. Autoplaying video: `muted`, with controls, and
paused under reduced motion. Design decides which motion is meaningful;
you ensure the preference is honored.

## 11. Testing

Layered, like everything else.

1. **Lint**: `eslint-plugin-jsx-a11y` (React), `eslint-plugin-vuejs-
   accessibility`, Angular ESLint template a11y rules, `svelte-check`
   warnings (Svelte has built-in a11y warnings; do not disable them).
2. **Automated audit** in component/e2e tests. axe catches ~30-40% of
   issues (missing names, contrast, invalid ARIA, structure); zero
   violations is necessary, not sufficient.

```ts
// Playwright
import AxeBuilder from '@axe-core/playwright'
test('settings page has no a11y violations', async ({ page }) => {
  await page.goto('/settings')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(results.violations).toEqual([])
})
// Vitest/Jest with Testing Library
import { axe } from 'jest-axe'
expect(await axe(container)).toHaveNoViolations()
```

3. **Keyboard pass** (manual or scripted in Playwright): Tab through the
   whole flow. Every interactive element reachable; focus visible; order
   matches visual order; Enter/Space/Escape/arrows per section 5; no
   traps; focus lands correctly after dialogs, deletions, route changes.

```ts
await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused()
await page.keyboard.press('Enter'); await expect(page.getByRole('menu')).toBeVisible()
await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused()
```

4. **Screen reader smoke test**: VoiceOver (macOS: Cmd+F5; navigate with
   VO+arrows, rotor VO+U), NVDA (Windows, free; Insert+arrows, H for
   headings, F for forms, B for buttons), TalkBack/VoiceOver on mobile for
   touch flows. Check: names make sense out of context ("Delete" ×10 is
   not; "Delete order 1042" is), states announced on toggle, errors
   announced, dialog announced on open, live regions fire once.
5. **Zoom and reflow**: 200% browser zoom and 320 px width; no horizontal
   scroll, no clipped controls.
6. **Testing Library queries** (`getByRole`, `getByLabelText`) are
   themselves an accessibility check: if you cannot query a control by its
   role and name, a screen reader user cannot find it either. See
   `testing.md`.

## 12. Framework notes

- **React**: `htmlFor`, `tabIndex`, `aria-*` lowercase as-is; `useId()`
  for label/description ids (SSR-safe). Portals keep DOM position for
  dialogs; `<dialog>` handles layering natively.
- **Vue**: `v-bind="$attrs"` on the inner input so aria attributes reach
  it; `useId()` (3.5+); `eslint-plugin-vuejs-accessibility`.
- **Svelte**: compile-time a11y warnings (`a11y-click-events-have-key-
  events`, `a11y-no-static-element-interactions`); fix them, do not
  `<!-- svelte-ignore -->` without a reason comment. `bind:this` for focus.
- **Angular**: CDK `a11y` module: `FocusTrap`/`cdkTrapFocus`,
  `LiveAnnouncer`, `FocusMonitor`, `ListKeyManager` for roving tabindex,
  `cdkAriaLive`. Use them.
- **Component libraries**: Radix, React Aria, Headless UI, Ark UI, Reka
  UI (Vue), Melt UI / Bits UI (Svelte), Angular CDK/Material implement
  the APG patterns. Prefer them to hand-rolled widgets when present or
  acceptable to add; verify their output with axe anyway (composition
  mistakes, missing labels, are still on you).

## 13. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `<div onClick>` / `<span onClick>` | `<button type="button">` or `<a href>` |
| `<a href="#" onClick>` | `<button>` |
| `outline: none` with no replacement | `:focus-visible` style |
| Placeholder as the only label | Visible `<label>` |
| Icon button with no name | `aria-label` |
| Modal that doesn't trap focus or return it | `<dialog>` or focus-trap utility + return focus |
| `aria-label` on a `<div>` with no role | Give it a role or use a landmark/heading |
| `role="button"` without `tabindex="0"` and key handling | Native button |
| `aria-hidden="true"` on a focusable element | Remove or make it non-focusable |
| Live region created at the same time as its message | Mount region at app start |
| Toast is the only place an error appears | Also inline/persistent |
| `tabindex="5"` | Reorder DOM; use 0/-1 |
| Route change with no focus/announcement | Focus `<h1>`/`<main>`; set title |
| Deleted item leaves focus on `<body>` | Move focus to neighbor |
| Disabled submit until form valid | Enabled; validate on submit |
| Custom `<select>` from divs with no listbox semantics | Native `<select>`, or full APG listbox/combobox via library |
| Virtualized list with no row count | `aria-rowcount`/`aria-rowindex` or `aria-setsize`/`aria-posinset` |
| Drag and drop with no keyboard path | Move menu or keyboard DnD with announcements |
| Autoplaying carousel with no pause | Pause control; respect reduced motion |
| `<table>` built from divs for layout | CSS grid for layout; `<table>` for data |
