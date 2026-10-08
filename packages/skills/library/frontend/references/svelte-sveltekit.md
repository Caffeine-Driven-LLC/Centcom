# Svelte and SvelteKit

Svelte 5 runes versus Svelte 4 stores, component patterns, SvelteKit's
`load` functions and the server/universal split, form actions with
progressive enhancement, rendering options per route, and the mistakes
that show up when an agent writes Svelte like React.

## Contents

1. Detect: Svelte 4 vs 5, Kit version, adapter
2. Runes (Svelte 5)
3. Stores (Svelte 4, and still valid in 5)
4. Component API: props, events, snippets/slots
5. SvelteKit routing and file conventions
6. `load`: server vs universal, waterfalls, invalidation
7. Form actions and progressive enhancement
8. Rendering options per route
9. Hooks, errors, and `$app` modules
10. State on the server: never module scope
11. Performance notes
12. Anti-patterns with fixes

## 1. Detect

```bash
grep -E '"(svelte|@sveltejs/kit|@sveltejs/adapter-[a-z]+)"' package.json
ls src/routes 2>/dev/null | head
cat svelte.config.js
```

- `svelte@5`: runes are available (`$state`, `$derived`, `$effect`,
  `$props`). Files without runes still run in legacy mode. Check existing
  components: if they use `export let`, `$:`, and `on:click`, the codebase
  is in legacy style; match it or migrate the file wholesale (mixing in one
  file is an error).
- `svelte@4`: `export let`, `$:` reactive statements, stores,
  `createEventDispatcher`, slots.
- Adapter tells you the deploy target and what runtime APIs exist:
  `adapter-node` (full Node), `adapter-vercel`/`-netlify`/`-cloudflare`
  (edge or serverless constraints), `adapter-static` (prerender only, no
  server `load` at runtime, no form actions).

## 2. Runes (Svelte 5)

```svelte
<script lang="ts">
  import type { Product } from '$lib/types'

  let { products, pageSize = 20, onselect }: {
    products: Product[]; pageSize?: number; onselect?: (p: Product) => void
  } = $props()

  let page = $state(1)
  let query = $state('')

  // derived: recomputed lazily when dependencies change; pure
  let filtered = $derived(products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())))
  let visible = $derived(filtered.slice((page - 1) * pageSize, page * pageSize))

  // effect: only for synchronizing with the outside world
  $effect(() => {
    const id = setTimeout(() => localStorage.setItem('lastQuery', query), 300)
    return () => clearTimeout(id)
  })
</script>

<input type="search" bind:value={query} aria-label="Filter products" />
<ul>
  {#each visible as p (p.id)}
    <li><button type="button" onclick={() => onselect?.(p)}>{p.name}</button></li>
  {/each}
</ul>
```

Rules of runes:

- `$state` is deeply reactive for objects and arrays (proxied). Mutating
  `items.push(x)` works. `$state.raw` for large data you replace wholesale
  (no proxy cost). `$state.snapshot(x)` to get a plain object for
  `structuredClone`, `postMessage`, or sending to the server.
- `$derived(expr)` for simple expressions; `$derived.by(() => {...})` for
  multi-line. Derived values are read-only (in 5.25+ they can be
  temporarily overridden for optimistic UI).
- `$effect` runs after DOM update, tracks synchronously-read dependencies
  only (reads inside `await` or `setTimeout` are not tracked). Return a
  cleanup. Do not set state inside an effect that the effect also reads;
  that is a loop. The same "effects are for the outside world" rule as
  every other framework applies: if you are using `$effect` to compute a
  value, use `$derived`.
- `$props()` destructuring with defaults and rest (`...rest` to forward
  attributes). `$bindable()` marks a prop the parent may `bind:` to.
- Reactivity crosses module boundaries via `.svelte.ts` files, where runes
  are allowed. This is how you write shared reactive state and composable
  logic without stores:

```ts
// src/lib/cart.svelte.ts
class Cart {
  items = $state<CartItem[]>([])
  count = $derived(this.items.reduce((n, i) => n + i.qty, 0))
  add(item: CartItem) { this.items.push(item) }
}
export const cart = new Cart()   // client-only module: fine. Never do this with per-user data in SSR (section 10).
```

Passing reactive state across a function boundary: pass a getter
(`() => value`) or the state object itself, not the current value.

## 3. Stores (Svelte 4, and still valid in 5)

`writable`, `readable`, `derived` from `svelte/store`; auto-subscribe in
components with `$store`. Still the right tool when you need a
subscribe/unsubscribe contract (interop with RxJS, or a library that
expects the store contract) and in Svelte 4 codebases.

```ts
import { writable, derived } from 'svelte/store'
export const theme = writable<'light' | 'dark'>('light')
export const isDark = derived(theme, t => t === 'dark')
```

Custom stores wrap `writable` and expose methods instead of raw `set`:

```ts
function createCounter() {
  const { subscribe, update, set } = writable(0)
  return { subscribe, increment: () => update(n => n + 1), reset: () => set(0) }
}
```

In Svelte 5 codebases prefer `.svelte.ts` runes modules for new shared
state unless the codebase is store-heavy. Do not mix both for the same
concern.

## 4. Component API: props, events, snippets/slots

Svelte 5: events are callback props (`onclick`, `onselect`), no
`createEventDispatcher`. Content projection uses snippets:

```svelte
<!-- Card.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  let { header, children, footer }: { header?: Snippet; children: Snippet; footer?: Snippet<[{ close: () => void }]> } = $props()
  let open = $state(true)
</script>
<article>
  {#if header}<header>{@render header()}</header>{/if}
  <div>{@render children()}</div>
  {#if footer}<footer>{@render footer({ close: () => (open = false) })}</footer>{/if}
</article>

<!-- usage -->
<Card>
  {#snippet header()}<h2>Title</h2>{/snippet}
  Body text
  {#snippet footer({ close })}<button onclick={close}>Close</button>{/snippet}
</Card>
```

Svelte 4: `<slot name="header" />`, `<slot {item} />` for scoped,
`createEventDispatcher` + `on:select`. Forward native events with
`on:click` (no handler) in 4; in 5 spread `{...rest}` onto the element.

Two-way binding: `bind:value` on inputs; `bind:prop` on components only
when the child marks it `$bindable()` (5) or exports it (4). Prefer
one-way data + callback for anything beyond form inputs.

## 5. SvelteKit routing and file conventions

```
src/routes/
  +layout.svelte          wraps children; persists across navigation
  +layout.ts / .server.ts load for the layout
  +page.svelte            the page
  +page.ts                universal load (server + client)
  +page.server.ts         server-only load + form actions
  +server.ts              API endpoint (GET/POST/... handlers)
  +error.svelte           error boundary for the segment
  products/[id]/+page.svelte       dynamic param
  (marketing)/about/+page.svelte   group without URL segment
  blog/[...slug]/+page.svelte      rest param
```

`+page.svelte` receives `data` (from load) and `form` (from actions) as
props: `let { data, form } = $props()` (5) or `export let data` (4). Layout
data merges into child page data. Use `$lib` (`src/lib`) for shared code;
`$lib/server` for server-only modules (Kit errors if a client bundle
imports them).

## 6. `load`: server vs universal, waterfalls, invalidation

| | `+page.server.ts` `load` | `+page.ts` `load` |
|---|---|---|
| Runs | Server only | Server on first visit, client on navigation |
| Can | Access DB, env secrets, cookies, `locals` | Call `fetch` (Kit's enhanced fetch, credentials forwarded, response inlined in SSR), use browser APIs after hydration |
| Return | Serializable data (devalue: Dates, Maps, Sets ok; no functions, class instances) | Anything, including components and functions |
| Use when | Data needs secrets or the DB | Data comes from a public API, or you need non-serializable results |

```ts
// src/routes/products/[id]/+page.server.ts
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, locals, depends }) => {
  depends('app:product')                                // custom invalidation key
  const product = await locals.db.product.find(params.id)
  if (!product) error(404, 'Product not found')
  return {
    product,
    // Streaming: return a promise (not awaited) and the page renders before it resolves.
    reviews: locals.db.reviews.forProduct(params.id),
  }
}
```

```svelte
<h1>{data.product.name}</h1>
{#await data.reviews}
  <ReviewsSkeleton />
{:then reviews}
  <Reviews {reviews} />
{:catch}
  <p>Couldn't load reviews.</p>
{/await}
```

Avoid waterfalls: inside one `load`, start independent requests together
(`Promise.all`). Across layout and page loads, Kit runs them in parallel
already; do not `await parent()` unless you truly need the parent's data,
because that serializes them.

Invalidation: after a mutation, `invalidate('app:product')` or
`invalidateAll()` re-runs matching loads. Form actions trigger
`invalidateAll` automatically with `use:enhance`. Loads also re-run when
`params` or `url.searchParams` they read change (dependency tracking is
automatic for `url`, `params`, `fetch` URLs).

URL state: read `url.searchParams` in `load` for filters and pagination;
navigate with `goto(\`?page=${n}\`, { keepFocus: true, noScroll: true })`
or plain `<a href>` links.

## 7. Form actions and progressive enhancement

Actions are the idiomatic mutation path. They work without JS and get
better with it.

```ts
// +page.server.ts
import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import type { Actions } from './$types'

const schema = z.object({ email: z.string().email(), name: z.string().min(1).max(80) })

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const raw = Object.fromEntries(await request.formData())
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return fail(400, { values: raw, errors: parsed.error.flatten().fieldErrors })
    }
    if (!locals.user) return fail(401, { message: 'Sign in first' })
    await locals.db.profile.update(locals.user.id, parsed.data)
    redirect(303, '/profile')             // throws; keep outside try/catch
  },
  // named actions: <form method="POST" action="?/delete">
  delete: async ({ locals, request }) => { /* ... */ },
}
```

```svelte
<script lang="ts">
  import { enhance } from '$app/forms'
  let { form } = $props()
  let submitting = $state(false)
</script>

<form method="POST" use:enhance={() => { submitting = true; return async ({ update }) => { await update(); submitting = false } }}>
  <label for="name">Name</label>
  <input id="name" name="name" value={form?.values?.name ?? ''} aria-invalid={!!form?.errors?.name} aria-describedby={form?.errors?.name ? 'name-err' : undefined} />
  {#if form?.errors?.name}<p id="name-err" role="alert">{form.errors.name}</p>{/if}
  <button disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
</form>
```

`use:enhance` without a callback already does the right thing: submits via
fetch, updates `form`, re-runs loads, resets the form on success, keeps
focus. Customize only to add optimistic UI or to skip reset
(`update({ reset: false })`). `sveltekit-superforms` + zod is common in
larger codebases; if present, use its `superForm` API instead of raw
`enhance`.

Rules: `fail()` for validation errors (returns data, not a thrown error);
never return passwords back in `values`; `redirect` after success to avoid
resubmission; authorize inside every action.

## 8. Rendering options per route

Exported from `+page.ts` / `+layout.ts` / `+page.server.ts`:

```ts
export const prerender = true        // SSG at build; 'auto' to prerender but still serve dynamically
export const ssr = false             // SPA for this route (and children if in layout)
export const csr = false             // no client JS at all; pure HTML page
export const trailingSlash = 'always'
```

Decision: marketing/docs `prerender = true`; authenticated app shell
`ssr = true` by default (fast first paint, works without JS) unless it is a
canvas/editor that cannot SSR; `csr = false` for content pages with no
interactivity (zero JS shipped). `adapter-static` requires `prerender =
true` everywhere (or a SPA fallback page) and removes form actions and
server loads at runtime.

Streaming (returning unawaited promises from server `load`) requires a
platform that supports streaming responses; check the adapter docs.

## 9. Hooks, errors, and `$app` modules

- `src/hooks.server.ts` `handle`: runs on every request; set `event.locals`
  (user session, DB client), rewrite responses, add headers. `handleError`
  for logging. `handleFetch` to rewrite internal fetch targets.
- `src/hooks.client.ts` `handleError` for client-side errors.
- `error(status, message)` from `@sveltejs/kit` to produce an error page;
  `+error.svelte` renders `page.error` and `page.status`.
- `$app/state` (5.x) or `$app/stores` (older): `page` for URL/params/data;
  `navigating` for pending navigation UI. `$app/navigation`: `goto`,
  `invalidate`, `beforeNavigate`, `afterNavigate` (focus management on
  route change goes here). `$app/environment`: `browser`, `dev`.
- `$env/static/private`, `$env/dynamic/private` are server-only and the
  build fails if imported client-side; `$env/static/public` requires the
  `PUBLIC_` prefix. Use these, not `process.env`.

## 10. State on the server: never module scope

During SSR, one server process serves many users. A `writable` or
`$state` at module scope in a `.ts` file that is imported by server code is
shared across all requests. Keep per-user state in `locals` (server) or in
component state and `load` data (which is per request). Client-only
singletons (`cart.svelte.ts` used only after hydration) are fine if the
module is never read during SSR with user-specific data; when in doubt,
use `setContext`/`getContext` in the root layout to scope state to the
component tree.

## 11. Performance notes

- Svelte compiles to small, targeted DOM updates; the main costs are bundle
  size from dependencies and heavy `load` data, not re-renders.
- Keep `load` returns lean: select only fields the page uses.
- Code-split by route happens automatically; lazy-load heavy components
  with `{#await import('./Heavy.svelte') then { default: Heavy }}` or a
  dynamic `import()` in an event handler.
- `{#each items as item (item.id)}` keyed blocks always; unkeyed `each`
  reuses DOM in order and breaks transitions and state.
- Virtualize long lists (`@tanstack/svelte-virtual`).
- `svelte-check` for types; `vite-bundle-visualizer` or `rollup-plugin-
  visualizer` for size.
- Prefetch: `<a data-sveltekit-preload-data="hover">` (default on `<body>`
  in the template); check `src/app.html`.

## 12. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `$effect` that assigns a computed value | `$derived` |
| `onMount(() => fetch(...))` for page data | `load` function |
| Fetching in `+page.svelte` with `fetch` directly | `load` with Kit's `fetch` (SSR inlining, credentials) |
| `await parent()` in every `load` | Only when the parent data is needed; otherwise parallel |
| Module-scope writable with user data under SSR | `locals` / context / `load` data |
| `<div on:click>` / `onclick` for navigation or actions | `<a href>` / `<button type="button">` |
| Unkeyed `{#each}` on editable lists | `(item.id)` key |
| Mixing `export let` and `$props()` in one component | Pick one per file; migrate whole file |
| Mutation via `+server.ts` POST + manual fetch when a form action fits | Form action with `use:enhance` |
| `goto()` on a `<button>` for a link | `<a href>` |
| `process.env.SECRET` in a `.svelte` file | `$env/static/private` in server code only |
| Returning class instances from server `load` | Plain objects |
| `$state` destructured into plain variables and expected to stay reactive | Keep the object, or use getters |
