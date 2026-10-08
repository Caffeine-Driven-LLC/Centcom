# Vue 3 and Nuxt

Composition API idioms, the reactivity gotchas that bite everyone, Pinia
stores, composables as the unit of reuse, and Nuxt's rendering modes, data
fetching (`useFetch`, `useAsyncData`) and server/client boundary. Assumes
SKILL.md principles; this file is the Vue-specific leaf.

## Contents

1. Detect: Vue 2 vs 3, Options vs Composition, Nuxt version
2. Composition API and `<script setup>`
3. Reactivity: `ref`, `reactive`, `computed`, and where it breaks
4. `watch` and `watchEffect`: when, and when not
5. Props, emits, `defineModel`, slots
6. Composables
7. Pinia
8. Vue Router patterns
9. Nuxt: rendering modes and route rules
10. Nuxt: data fetching
11. Nuxt: server/client boundary, plugins, middleware
12. Performance notes specific to Vue
13. Anti-patterns with fixes

## 1. Detect

```bash
grep -E '"(vue|nuxt|pinia|vuex|vue-router|@vue/compat)"' package.json
grep -rl "export default {" src --include=*.vue | head   # Options API files
grep -rl "<script setup" src --include=*.vue | head      # Composition API files
```

- `vue@2` or `@vue/compat`: legacy. Options API, Vuex. Do not introduce
  Composition API unless the file already uses it.
- `vue@3` with mostly Options API files: match Options API for edits to
  those files; use `<script setup>` for new components only if the codebase
  already has some.
- `vuex` present: use it; do not add Pinia.
- `nuxt@3`/`nuxt@4`: auto-imports (`ref`, `computed`, `useFetch`,
  composables in `composables/`, components in `components/`). Do not add
  redundant imports; do check `nuxt.config` `imports.autoImport` is not
  disabled. Nuxt 4 uses `app/` as srcDir by default.

## 2. Composition API and `<script setup>`

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Product } from '@/types'

const props = withDefaults(defineProps<{ products: Product[]; pageSize?: number }>(), { pageSize: 20 })
const emit = defineEmits<{ select: [product: Product]; 'update:page': [page: number] }>()

const page = ref(1)
const visible = computed(() => props.products.slice((page.value - 1) * props.pageSize, page.value * props.pageSize))

function select(p: Product) { emit('select', p) }
</script>

<template>
  <ul>
    <li v-for="p in visible" :key="p.id">
      <button type="button" @click="select(p)">{{ p.name }}</button>
    </li>
  </ul>
</template>
```

Everything at the top level of `<script setup>` is exposed to the template.
Order: imports, props/emits, state, computed, watchers, functions,
lifecycle hooks. Keep one component per `.vue` file; use `defineOptions`
for `name`/`inheritAttrs` if needed. `defineExpose` for the rare imperative
API a parent needs via ref.

## 3. Reactivity: where it breaks

`ref(x)` wraps any value; access `.value` in script, auto-unwrapped in
template. `reactive(obj)` makes a deep proxy; no `.value`, but cannot be
reassigned or destructured without losing reactivity.

```ts
// Loses reactivity
const state = reactive({ count: 0, user: null })
const { count } = state                 // count is a plain number now
state = reactive({ ... })               // cannot reassign a reactive; the template still points at the old proxy

// Fixes
const { count } = toRefs(state)         // refs linked to state
const count = ref(0)                    // or just use refs for primitives
```

Default to `ref` for everything; use `reactive` only for a grouped object
you never destructure or replace. `shallowRef` for large immutable data
(API responses you replace wholesale, big arrays for a chart) to skip deep
proxying cost.

Other gotchas:

- Replacing an array index or adding a key works in Vue 3 (unlike Vue 2),
  but a `Map`/`Set` must be wrapped in `reactive`/`ref` to track.
- `ref` of a DOM element: `const el = ref<HTMLElement | null>(null)` and
  `<div ref="el">`. It is `null` until mounted; read it in `onMounted` or a
  watcher, not in setup body.
- Props are reactive but read-only. `const { title } = props` loses
  reactivity unless the project enables reactive props destructure (Vue
  3.5+ default on). Prefer `props.title` or `toRef(props, 'title')` in
  older versions.
- `computed` caches by dependency; it must be pure. A computed that
  mutates state or calls an API is a bug.
- `computed` with a setter exists for two-way derived values (`v-model` on
  a formatted field) but is rarely the clearest option.

## 4. `watch` and `watchEffect`

Same rule as React effects: watchers synchronize with the outside world
(fetch, localStorage, a third-party widget, logging). They are not for
deriving state (use `computed`) or for handling events (use the handler).

```ts
// Wrong: deriving with a watcher
const total = ref(0)
watch(items, (v) => { total.value = v.reduce((s, i) => s + i.price, 0) }, { immediate: true, deep: true })
// Right
const total = computed(() => items.value.reduce((s, i) => s + i.price, 0))

// Legitimate: persist a preference
watch(theme, (t) => localStorage.setItem('theme', t))

// Legitimate with cleanup: refetch when id changes, cancel stale
watch(id, async (newId, _old, onCleanup) => {
  const ac = new AbortController()
  onCleanup(() => ac.abort())
  data.value = await api.get(newId, { signal: ac.signal })
}, { immediate: true })
```

`watch(source, cb)` is lazy and explicit about sources; `watchEffect(fn)`
runs immediately and tracks whatever it reads. Prefer `watch` for clarity
of intent. `deep: true` on large objects is expensive; watch the specific
property instead. `flush: 'post'` if the callback needs the updated DOM.

## 5. Props, emits, `defineModel`, slots

- Props down, events up. Never mutate a prop; emit and let the parent
  change it.
- Two-way binding: `defineModel` (Vue 3.4+) replaces the
  `modelValue`/`update:modelValue` boilerplate.

```vue
<script setup lang="ts">
const value = defineModel<string>({ required: true })
const checked = defineModel<boolean>('checked', { default: false })
</script>
<template>
  <input :value="value" @input="value = ($event.target as HTMLInputElement).value" />
</template>
```

- Slots for composition: named slots `<slot name="header" />`, scoped slots
  to hand data back up `<slot :item="item" />`. A component with six
  boolean display props usually wants slots instead.
- `inheritAttrs: false` + `v-bind="$attrs"` on the inner element when a
  wrapper component should forward `class`, `id`, aria attributes to the
  real input (essential for accessible form wrappers).
- `v-model` on a component that wraps an `<input>`: forward `$attrs` so
  `aria-describedby`, `required` etc. reach the native element.

## 6. Composables

A composable is a function using Composition API that returns reactive
state and functions. It is the reuse unit; mixins are legacy.

```ts
// composables/useProducts.ts
export function useProducts(category: Ref<string>) {
  const products = shallowRef<Product[]>([])
  const status = ref<'idle' | 'loading' | 'error' | 'success'>('idle')
  const error = ref<Error | null>(null)

  watch(category, async (c, _o, onCleanup) => {
    const ac = new AbortController()
    onCleanup(() => ac.abort())
    status.value = 'loading'
    try {
      products.value = await api.products.list(c, { signal: ac.signal })
      status.value = 'success'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      error.value = e as Error; status.value = 'error'
    }
  }, { immediate: true })

  return { products, status, error }
}
```

Conventions: `useX` naming; accept refs or getters (`MaybeRefOrGetter<T>`
+ `toValue()`) so callers can pass static values or reactive ones; return
an object of refs (callers destructure safely); clean up in
`onUnmounted`/`onScopeDispose`. If `@vueuse/core` is in the project, use
its `useLocalStorage`, `useMediaQuery`, `useDebounceFn`, `useIntersection
Observer` etc. before writing your own. If TanStack Query for Vue
(`@tanstack/vue-query`) is present, server state goes through `useQuery`,
not hand-rolled composables.

## 7. Pinia

Pinia is the standard store. Use it for truly global client state (auth
session, cart, UI preferences). Server data belongs in `useFetch`/TanStack
Query, not in a store with a hand-written `loading` flag.

```ts
// stores/cart.ts (setup-store syntax; matches Composition API)
export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])
  const count = computed(() => items.value.reduce((n, i) => n + i.qty, 0))
  const total = computed(() => items.value.reduce((s, i) => s + i.qty * i.price, 0))

  function add(product: Product, qty = 1) {
    const existing = items.value.find(i => i.productId === product.id)
    if (existing) existing.qty += qty
    else items.value.push({ productId: product.id, price: product.price, qty })
  }
  function remove(productId: string) { items.value = items.value.filter(i => i.productId !== productId) }
  function clear() { items.value = [] }

  return { items, count, total, add, remove, clear }
})
```

Using it: `const cart = useCartStore()`; `cart.count` is reactive on the
store instance; destructuring requires `storeToRefs(cart)` for state and
getters (actions can be destructured directly). Match the existing syntax
(options-store with `state/getters/actions` vs setup-store). In Nuxt, call
`useXStore()` inside setup or composables, never at module scope (SSR
cross-request leakage). `pinia-plugin-persistedstate` if persistence is
needed and already present.

## 8. Vue Router patterns

- Lazy-load route components: `component: () => import('@/views/Admin.vue')`.
- Route params in a component: `useRoute().params.id`, typed via
  `unplugin-vue-router` if present. Watch `route.params` for in-place
  navigation between `/users/1` and `/users/2` (the component is reused,
  not remounted). Or add `:key="route.fullPath"` on `<RouterView>` to force
  remount when that is the desired behavior.
- Navigation guards for auth: `router.beforeEach` checking the auth store;
  return a redirect location, don't `next()` twice.
- URL state (filters, pagination) goes in `route.query`; update with
  `router.replace({ query: { ...route.query, page } })`.
- `<RouterLink>` for internal navigation, never `<a href>` (full reload) or
  `<div @click="router.push">` (inaccessible).

## 9. Nuxt: rendering modes and route rules

Nuxt renders universally (SSR + hydration) by default. Per-route behavior
is set in `nuxt.config.ts` `routeRules`:

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },                          // SSG at build
    '/blog/**': { isr: 3600 },                         // ISR: regenerate hourly (platform-dependent)
    '/docs/**': { swr: 600 },                          // stale-while-revalidate cache on the server
    '/dashboard/**': { ssr: false },                   // SPA mode for this subtree (auth-heavy app)
    '/api/**': { cors: true, headers: { 'cache-control': 'no-store' } },
    '/old-path': { redirect: '/new-path' },
  },
})
```

`ssr: false` globally makes the whole app an SPA. Nuxt also supports
hybrid rendering (mix of the above) and `nuxt generate` for full static
export. Choose per route using the table in SKILL.md Stage 2.

Islands/server components: `<ComponentName.server.vue>` or
`experimental.componentIslands` renders a component only on the server
(zero client JS). Useful for heavy markdown or chart-to-SVG rendering.

## 10. Nuxt: data fetching

Three tools, and choosing wrong causes double fetches or hydration
mismatches:

| Tool | Use when |
|---|---|
| `useFetch(url, opts)` | Fetching a URL in a component/page during setup. Runs on server, result is serialized into the payload, client does not refetch on hydration. Deduped by key (URL + options). |
| `useAsyncData(key, () => fn())` | Same lifecycle, but for any async function (SDK call, multiple fetches). You provide the key. |
| `$fetch(url)` | Imperative calls in event handlers, actions, server routes. Does *not* participate in the payload; calling it in setup causes a fetch on server *and* client. |

```vue
<script setup lang="ts">
const route = useRoute()
const { data: product, status, error, refresh } = await useFetch(`/api/products/${route.params.id}`, {
  key: `product-${route.params.id}`,
  pick: ['id', 'name', 'price', 'images'],    // shrink the payload to what the template uses
})
if (!product.value) throw createError({ statusCode: 404, statusMessage: 'Product not found' })

const { data: reviews } = useLazyFetch(`/api/products/${route.params.id}/reviews`)   // don't block navigation; render skeleton

async function addToCart() {
  await $fetch('/api/cart', { method: 'POST', body: { productId: product.value!.id } })
  await refreshNuxtData('cart')
}
</script>
```

Rules: `await useFetch` in setup blocks navigation until it resolves
(good for the critical data); `useLazyFetch`/`lazy: true` for secondary
data; `server: false` for client-only data (user-specific widgets that
should not be in the HTML); `watch` option or reactive URL (pass a getter
`() => \`/api/x/${id.value}\``) to refetch on change; `transform` to shape
data once; `getCachedData` to reuse across navigations. For mutation-heavy
or polling data, `@tanstack/vue-query` is a reasonable addition if the
project already leans client-side; do not add it to a mostly-SSR Nuxt app
without a reason.

Server routes live in `server/api/*.ts` using `defineEventHandler`; read
body with `readBody`, validate with `readValidatedBody(event, schema.parse)`,
query with `getValidatedQuery`. Backend design is `backend`'s domain; the
rule here is validate and authorize in every handler.

## 11. Nuxt: server/client boundary, plugins, middleware

- Code in `<script setup>` runs on the server during SSR and again on the
  client. Browser-only APIs go in `onMounted` or `if (import.meta.client)`.
  `<ClientOnly>` wraps components that cannot SSR; give it a `#fallback`
  slot sized like the real content.
- `useState('key', () => init)` is Nuxt's SSR-safe shared state (serialized
  into payload). Plain `ref` at module scope is shared across requests on
  the server: never do that.
- `useRequestHeaders(['cookie'])` to forward cookies in server-side
  `useFetch` to your own API.
- Plugins (`plugins/*.ts`) run once per app instance; suffix `.client.ts`
  / `.server.ts` to restrict. Route middleware (`middleware/*.ts`,
  `definePageMeta({ middleware: 'auth' })`) runs on both sides; use
  `navigateTo` for redirects. Server middleware (`server/middleware/`) runs
  on every request.
- Hydration mismatch sources in Nuxt: `Date`/locale formatting in
  templates, random IDs (use `useId()`), `v-if` on `import.meta.client`
  (renders different trees; wrap in `<ClientOnly>` instead), invalid HTML
  nesting, browser extensions.

## 12. Performance notes specific to Vue

- `v-once` for static subtrees; `v-memo="[dep]"` for list rows that rarely
  change (the Vue equivalent of `memo`, and equally rarely needed).
- Avoid `deep` watchers on large structures; watch specific keys.
- `shallowRef` for large data you replace wholesale.
- Lazy components: `defineAsyncComponent(() => import('./Heavy.vue'))`;
  in Nuxt prefix with `Lazy` (`<LazyHeavyChart v-if="show" />`).
- Virtualize long lists (`vue-virtual-scroller`, `@tanstack/vue-virtual`).
- `<Transition>`/`<TransitionGroup>` use CSS; prefer transform/opacity.
- Nuxt: `pick`/`transform` on `useFetch` to shrink payload; check
  `.output/public/_nuxt` sizes after build; `nuxi analyze`.

## 13. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `watch` to compute a derived value | `computed` |
| `reactive` destructured, reactivity lost | `toRefs`, or `ref` per value |
| Mutating a prop (`props.items.push(x)`) | Emit an event; parent owns the data |
| `$fetch` in `<script setup>` (double fetch, mismatch) | `useFetch`/`useAsyncData` |
| Module-scope `ref` or store instance in Nuxt | `useState`, or call `useStore()` inside setup |
| Server data in Pinia with manual `loading`/`error` | `useFetch`/`useAsyncData` or vue-query; store only client state |
| `v-html` with user content | Sanitize with DOMPurify, or render text |
| `<div @click>` for navigation | `<NuxtLink>`/`<RouterLink>` |
| `:key="index"` on editable lists | Stable id |
| Giant `index.vue` page with all logic | Extract composables and child components |
| Options API and `<script setup>` mixed in one file | Pick the file's existing style |
| `window.*` in setup body | `onMounted` or `import.meta.client` guard |
| `v-if` and `v-for` on the same element | Wrap in `<template v-for>` with inner `v-if`, or filter in `computed` |
| Props typed as `Object`/`Array` with no shape | `defineProps<{ ... }>()` with real types |
