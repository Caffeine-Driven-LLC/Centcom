# Vanilla JS, web components, islands, and HTML-over-the-wire

When a framework is the wrong tool, how to structure plain JavaScript so it
does not rot, custom elements (with and without Lit), progressive
enhancement as a discipline, Astro's islands model, and the htmx / Turbo /
LiveView family where the server renders HTML and the client stays thin.

## Contents

1. When no framework is right
2. Structuring vanilla JS: modules, state, rendering
3. Progressive enhancement as the default posture
4. Custom elements
5. Lit
6. Astro and islands
7. HTML-over-the-wire: htmx, Turbo/Hotwire, LiveView, Livewire
8. Working with the DOM efficiently
9. Anti-patterns with fixes

## 1. When no framework is right

A framework pays for itself when UI state is complex and changes often in
response to user actions: editors, dashboards with live data, multi-step
flows with cross-field dependencies. It costs bundle size, hydration time,
a build step, and a dependency treadmill.

Prefer no framework (or a micro one) when:

- The page is mostly content with a few interactive widgets (nav toggle,
  accordion, carousel, form validation). Each widget is independent.
- You are adding behavior to a server-rendered app (Rails, Django,
  Laravel, Phoenix, Go templates) that already owns routing and state.
- The deliverable is an embeddable widget for third-party pages, where you
  cannot assume a framework and must not conflict with the host's.
- Performance budget is tight (e-commerce landing pages, news) and the
  interactive surface is small.

Prefer a framework when: state is shared across many components, the UI
is mostly derived from client state, there are many list/form/modal
interactions, or the team already has one.

The middle ground: Alpine.js / petite-vue for sprinkles with declarative
templates; Preact for a React-like model in 4 KB; Lit for reusable custom
elements; Astro when the site is content-first but some islands need a
framework. Match whatever the repo already uses.

## 2. Structuring vanilla JS: modules, state, rendering

Vanilla does not mean unstructured. The same principles apply: one source
of truth, render from state, events update state.

```js
// widgets/accordion.js: one widget per module, initialized from data attributes
export function initAccordion(root) {
  const triggers = root.querySelectorAll('[data-accordion-trigger]')
  for (const trigger of triggers) {
    const panel = root.querySelector(`#${trigger.getAttribute('aria-controls')}`)
    const setOpen = (open) => {
      trigger.setAttribute('aria-expanded', String(open))
      panel.hidden = !open
    }
    setOpen(trigger.getAttribute('aria-expanded') === 'true')
    trigger.addEventListener('click', () => setOpen(trigger.getAttribute('aria-expanded') !== 'true'))
  }
}

// main.js: discover and initialize; re-run for dynamically inserted content
import { initAccordion } from './widgets/accordion.js'
const registry = { accordion: initAccordion }
export function hydrate(scope = document) {
  for (const [name, init] of Object.entries(registry)) {
    scope.querySelectorAll(`[data-widget="${name}"]:not([data-ready])`).forEach(el => { init(el); el.dataset.ready = '' })
  }
}
hydrate()
```

For state that several widgets share, use a tiny observable store:

```js
export function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set(partial) { state = { ...state, ...partial }; listeners.forEach(l => l(state)) },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
  }
}
```

Render from state with small, idempotent functions (`renderCart(state)`)
that update text and attributes rather than rebuilding `innerHTML` (which
destroys focus and event listeners). Use `<template>` elements for
repeated markup and `cloneNode(true)`. Use event delegation on a container
for lists (`container.addEventListener('click', e => { const btn =
e.target.closest('[data-action]'); ... })`) so dynamically added rows work.

Use ES modules (`<script type="module">`), which defer by default and give
you scoping. A bundler (Vite with no framework plugin) is still worth it
for TypeScript, minification and hashing; `esbuild` alone works for small
projects.

## 3. Progressive enhancement as the default posture

Build the HTML that works, then layer behavior. The payoff is resilience
(JS fails to load more often than people think: ad blockers, flaky
networks, CDN outages, a syntax error in an unrelated script), SEO, and
accessibility for free.

- Links are `<a href>`; forms are `<form method="post" action="/x">`. JS
  intercepts (`fetch` + `preventDefault`) to make them smoother.
- Native elements first: `<details>/<summary>` for disclosure, `<dialog>`
  with `showModal()` for modals (focus trap and Escape built in),
  `<input type="date|color|range">`, `<datalist>`, `popover` attribute for
  tooltips and menus, `<select>` (customizable via `appearance: base-select`
  where supported). Check caniuse for the project's browser targets
  (`browserslist` in `package.json`).
- Feature detection, not UA sniffing: `if ('IntersectionObserver' in window)`,
  `CSS.supports(...)`, `@supports` in CSS.
- `hidden` attribute and `aria-expanded` toggles instead of class-based
  show/hide, so the state is in the DOM and readable by AT.
- Render the "no JS" state in HTML and *remove* it when JS boots
  (`document.documentElement.classList.add('js')`), rather than rendering
  the JS state and hoping.

## 4. Custom elements

Custom elements give you encapsulated, reusable components without a
framework, usable from any framework's templates.

```js
class CopyButton extends HTMLElement {
  static observedAttributes = ['value', 'label']
  #button
  #timeout

  connectedCallback() {
    if (this.#button) return                     // connectedCallback can run more than once
    this.#button = document.createElement('button')
    this.#button.type = 'button'
    this.#button.addEventListener('click', this.#copy)
    this.append(this.#button)
    this.#render()
  }
  disconnectedCallback() { clearTimeout(this.#timeout) }
  attributeChangedCallback() { this.#render() }

  #render() { if (this.#button) this.#button.textContent = this.getAttribute('label') ?? 'Copy' }

  #copy = async () => {
    await navigator.clipboard.writeText(this.getAttribute('value') ?? '')
    this.#button.textContent = 'Copied'
    this.dispatchEvent(new CustomEvent('copied', { bubbles: true, composed: true, detail: { value: this.getAttribute('value') } }))
    this.#timeout = setTimeout(() => this.#render(), 1500)
  }
}
customElements.define('copy-button', CopyButton)
```

Decisions:

- **Shadow DOM or not.** Shadow DOM gives style encapsulation and slots,
  but isolates from page styles (you must pass tokens via CSS custom
  properties, which do inherit), complicates forms (use
  `formAssociated = true` and `ElementInternals`), and makes global
  querySelector-based tooling miss content. For design-system primitives
  shipped to many apps: shadow DOM. For app-internal widgets: light DOM is
  often simpler. Declarative shadow DOM (`<template shadowrootmode="open">`)
  lets the server render shadow content for SSR.
- **Attributes vs properties.** Attributes are strings and are what HTML
  authors set; properties can hold objects. Reflect the important ones
  both ways. Boolean attributes: presence means true.
- **Events.** Dispatch `CustomEvent` with `bubbles: true, composed: true`
  so listeners outside the shadow root hear it. Name in kebab or
  lowercase; frameworks bind with `@copied` (Lit/Vue), `oncopied`
  (Svelte 5), `onCopied` only in React 19+ (earlier React needs a ref +
  addEventListener).
- **Accessibility.** The custom element itself has no role. Put the
  semantics on an inner native element (`<button>`) or set `role`, `tabindex`,
  and keyboard handling yourself. `ElementInternals` can set `role` and
  ARIA states on the host.
- **Lifecycle.** Guard against double `connectedCallback` (moving a node
  re-fires it). Clean up timers, observers and listeners in
  `disconnectedCallback`.
- Scope tag names with a prefix (`acme-`) to avoid collisions.

## 5. Lit

Lit adds reactive properties, declarative templates and efficient updates
on top of custom elements, at about 5 KB.

```ts
import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'

@customElement('acme-rating')
export class AcmeRating extends LitElement {
  static styles = css`
    :host { display: inline-flex; gap: var(--acme-rating-gap, 4px); }
    button { all: unset; cursor: pointer; font-size: 1.5rem; color: var(--acme-rating-off, #bbb); }
    button[aria-pressed="true"] { color: var(--acme-rating-on, gold); }
    button:focus-visible { outline: 2px solid var(--acme-focus, currentColor); outline-offset: 2px; }
  `
  @property({ type: Number, reflect: true }) value = 0
  @property({ type: Number }) max = 5
  @property({ type: Boolean, reflect: true }) readonly = false
  @state() private hover = 0

  render() {
    return html`
      <div role="radiogroup" aria-label="Rating">
        ${Array.from({ length: this.max }, (_, i) => i + 1).map(n => html`
          <button type="button" role="radio" aria-checked=${this.value === n} aria-pressed=${n <= (this.hover || this.value)}
                  aria-label="${n} of ${this.max}" ?disabled=${this.readonly}
                  @click=${() => this.#select(n)} @mouseenter=${() => (this.hover = n)} @mouseleave=${() => (this.hover = 0)}>★</button>
        `)}
      </div>`
  }
  #select(n: number) {
    this.value = n
    this.dispatchEvent(new CustomEvent('change', { detail: { value: n }, bubbles: true, composed: true }))
  }
}
```

Notes: `@property` reactive attributes, `@state` internal; `render()` is
pure; `willUpdate` for derived values, `updated` for DOM effects; `repeat`
directive with a key function for lists; `classMap`/`styleMap` directives;
theming through CSS custom properties with fallbacks; `@lit-labs/ssr` for
server rendering. A radiogroup with arrow-key navigation would also need
roving tabindex (see `accessibility-implementation.md`); the example shows
the structure, not a finished APG widget.

## 6. Astro and islands

Astro renders `.astro` components to HTML at build (or on request in SSR
mode) with zero client JS by default. Framework components (React, Vue,
Svelte, Solid, Preact) are islands: they ship JS only when given a `client:`
directive.

```astro
---
// src/pages/products/[slug].astro  (frontmatter runs on the server only)
import Layout from '../../layouts/Layout.astro'
import AddToCart from '../../components/AddToCart.tsx'
import Reviews from '../../components/Reviews.svelte'
const { slug } = Astro.params
const product = await getProduct(slug)
if (!product) return Astro.redirect('/404')
---
<Layout title={product.name}>
  <h1>{product.name}</h1>
  <p>{product.description}</p>
  <AddToCart client:load productId={product.id} />      <!-- hydrates immediately: it's the primary action -->
  <Reviews client:visible productId={product.id} />      <!-- hydrates when scrolled into view -->
</Layout>
```

Directives: `client:load` (critical interactivity), `client:idle` (soon
but not blocking), `client:visible` (below the fold), `client:media="(min-width: 768px)"`,
`client:only="react"` (skip SSR for window-dependent libs). Choose the
laziest that does not hurt the user.

Rules: islands cannot share React state with each other directly (they are
separate roots); share via nanostores, URL, or custom events. Props must
be serializable. Content collections (`src/content/`) with zod schemas for
Markdown/MDX. `output: 'server'` or `'hybrid'` with an adapter for SSR
routes and API endpoints (`src/pages/api/*.ts`). Server islands
(`server:defer`, Astro 5) stream personalized fragments into a cached
static page.

## 7. HTML-over-the-wire: htmx, Turbo/Hotwire, LiveView, Livewire

The server renders HTML fragments; the client swaps them into the page.
State lives on the server. This fits CRUD apps, admin tools and anything
where the backend framework already owns templates. The frontend job is to
keep the client layer thin and the HTML semantic.

### htmx

```html
<form hx-post="/todos" hx-target="#todo-list" hx-swap="beforeend" hx-on::after-request="this.reset()">
  <label for="title">New todo</label>
  <input id="title" name="title" required />
  <button>Add</button>
</form>
<ul id="todo-list" hx-target="closest li" hx-swap="outerHTML">
  <li>
    Buy milk
    <button hx-delete="/todos/1" hx-confirm="Delete this?">Delete</button>
  </li>
</ul>
<input type="search" name="q" hx-get="/search" hx-trigger="input changed delay:300ms, keyup[key=='Enter']" hx-target="#results" hx-indicator="#spinner" />
```

Rules: the server returns fragments for htmx requests (check the `HX-Request`
header) and full pages otherwise, so URLs still work without JS; use
`hx-push-url` for navigations that should be bookmarkable; `hx-boost` on a
container turns plain links/forms into AJAX with graceful fallback; return
`HX-Trigger` response headers to fire client events (toast, refresh another
region); validate on the server (there is nowhere else); CSRF token via
`hx-headers` on `<body>`. Accessibility: swapped content does not announce
itself; add `aria-live` regions for status, and manage focus after swaps
(`hx-on::after-swap` to focus the new content or `autofocus` in the
fragment). Pair with Alpine.js or small vanilla modules for purely
client-side interactions (dropdowns, tabs) rather than round-tripping.

### Turbo (Hotwire)

Turbo Drive (full-page navigation via fetch, persistent `<head>`), Turbo
Frames (`<turbo-frame id="x" src="...">` scoped navigation), Turbo Streams
(server-pushed `<turbo-stream action="append" target="...">` over
WebSocket or in form responses). Stimulus controllers for client behavior
(`data-controller="dropdown"`, `data-action="click->dropdown#toggle"`,
`data-dropdown-target="menu"`). Form responses must return 422 on
validation error for Turbo to render them. `data-turbo-permanent` for
elements that should survive navigation (audio player). Rails codebases
nearly always use this; match the existing Stimulus controller patterns.

### LiveView (Phoenix) and Livewire (Laravel)

The server holds component state over a WebSocket (LiveView) or via AJAX
round-trips (Livewire) and pushes diffs. Client hooks (`phx-hook`,
Alpine for Livewire) handle what must be local: focus, text selection,
third-party widgets. Keep per-keystroke events debounced (`phx-debounce`,
`wire:model.live.debounce`); never send one event per animation frame.
Optimistic UI is limited; design interactions that tolerate 50-200 ms.

### What to watch in all of them

- Fragment responses must include the same ARIA states as full renders.
- Swapping a region containing the focused element drops focus to `<body>`;
  restore it.
- Scroll position and form state are lost on full swaps; scope swaps as
  narrowly as possible.
- Duplicate IDs after partial swaps are a common bug; keep IDs unique per
  record (`todo-123`).

## 8. Working with the DOM efficiently

- Batch reads then writes; interleaving `offsetHeight` reads with style
  writes forces synchronous layout (layout thrash). `requestAnimationFrame`
  for visual updates.
- `IntersectionObserver` for lazy loading and "in view" logic, not scroll
  handlers. `ResizeObserver` instead of `window.resize` for element sizes.
- `textContent` over `innerHTML` for text; `insertAdjacentHTML` or
  templates for markup; sanitize anything user-provided (DOMPurify) before
  `innerHTML`.
- `element.hidden = true`, `inert` for disabled regions, `popover` and
  `<dialog>` for layers; the platform handles focus and top-layer stacking.
- `AbortController` to remove many listeners at once:
  `el.addEventListener('click', fn, { signal })` then `controller.abort()`.
- `structuredClone` for deep copies; `URLSearchParams` for query strings;
  `Intl.*` for formatting; `FormData` for forms. Do not import a utility
  library for what the platform provides.
- Keep third-party scripts (analytics, chat widgets) off the critical
  path: `defer`/`async`, or load on interaction/idle (Partytown in Astro).

## 9. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| jQuery-style global spaghetti with IDs everywhere | Modules per widget, data-attribute discovery, delegated events |
| Rebuilding `innerHTML` of a list on every change | Keyed updates or `<template>` clones; or use a framework if this is the whole app |
| `<div onclick>` menu with no keyboard | `<button>` + `popover`, or APG menu pattern |
| Custom element with no role and a `click` handler on the host | Inner `<button>`, or `ElementInternals` role + keyboard |
| Shadow DOM component unstyleable by consumers | Expose CSS custom properties and `::part()` |
| `client:load` on every Astro island | `client:visible`/`idle`; or make it a plain `.astro` component |
| htmx fragment that returns a full page or vice versa | Branch on `HX-Request` |
| Swap that loses focus silently | Focus management after swap; `aria-live` for status |
| UA sniffing | Feature detection |
| Inline `<script>` blocks with globals and no CSP nonce | Module files; nonces if inline is unavoidable |
| Loading Lodash for `debounce` and `pick` | 10 lines of code or the platform |
| Scroll handler computing visibility | `IntersectionObserver` |
