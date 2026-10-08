# State management

The taxonomy of state and where each kind belongs, how to decide how far
to lift state, server-state libraries compared, URL state, global stores
(when one is justified and how to shape it), derived versus stored state,
and the migration path out of a store that has become a cache.

## Contents

1. The taxonomy
2. Decision procedure for any new piece of state
3. Server state: it is a cache, treat it as one
4. URL state
5. Form state
6. Local UI state and lifting
7. Shared client state: context, stores, and when a store is justified
8. Derived vs stored
9. Store shapes that age well
10. Persistence
11. Migrating a store that became a cache
12. Anti-patterns with fixes

## 1. The taxonomy

| Kind | Examples | Owner | Why |
|---|---|---|---|
| **Server state** | Users, orders, products, anything fetched | A cache library (TanStack Query, SWR, RTK Query, Apollo, urql) or the framework's loader/RSC layer | It is a *copy* of remote truth; it goes stale, needs dedupe, retry, invalidation, background refresh. Stores do none of that |
| **URL state** | Current page, filters, sort, selected tab, search query, open item id | The URL (`searchParams`, path) | Shareable, bookmarkable, back-button works, survives reload, free "deep linking" |
| **Form state** | Field values, touched, dirty, errors, submitting | The form library or the DOM (uncontrolled) | Transient, high-frequency, scoped to the form; see `forms.md` |
| **Local UI state** | Menu open, hover, accordion expanded, input focus, which row is being edited | The component (`useState`, `ref`, `$state`, `signal`) | No one else needs it |
| **Shared UI state** | Sidebar collapsed, active modal, selected items across a page | Nearest common ancestor; context for a subtree | A few components need it; still not global |
| **Global client state** | Auth session/current user, theme, locale, cart (if client-owned), feature flags, websocket connection | A global store (Zustand, Jotai, Redux, Pinia, NgRx signalStore, Svelte runes module) | Many unrelated parts read it; it is not a copy of server data |
| **Persisted client state** | Draft text, recently viewed, dismissed banners | localStorage/IndexedDB via the store's persistence layer | Survives reload but is device-local |

Most "state management is hard" pain comes from server state in the wrong
box. A `usersSlice` with `loading`, `error`, `data`, `lastFetched` fields is
a cache written by hand, and it will be missing dedupe, cancellation,
stale-while-revalidate, garbage collection and focus refetch.

## 2. Decision procedure for any new piece of state

1. Did it come from a request? Server state. Use the cache library the
   repo already has. If none exists and this is the first fetch, see
   section 3 on choosing one (or using the framework's loader layer).
2. Would the user want to share or bookmark it, or expect back-button to
   undo it? URL state.
3. Is it a form field? Form state.
4. Is it needed by exactly one component? Local.
5. Is it needed by a few components in one subtree? Lift to the nearest
   common ancestor; pass down or use context if the subtree is deep.
6. Is it needed across unrelated routes and is not a copy of server data?
   Global store.
7. Can it be computed from things already in boxes 1-6? Then it is not
   state at all; derive it (section 8).

## 3. Server state: it is a cache, treat it as one

What a server-state library gives you that a store does not:

- Dedupe: ten components asking for `['user', 1]` cause one request.
- Stale-while-revalidate: show cached data instantly, refetch in the
  background, update when fresh arrives.
- Cache lifetime: `staleTime` (how long data is considered fresh),
  `gcTime` (how long unused data stays in memory).
- Automatic refetch on window focus, reconnect, interval.
- Mutation lifecycle: pending state, optimistic updates with rollback,
  invalidation of affected queries.
- Cancellation on unmount, retries with backoff, pagination/infinite query
  helpers, Suspense integration, devtools.

### Choosing (only if the repo has none)

| Library | Fits when |
|---|---|
| TanStack Query (`@tanstack/react-query`, `vue-query`, `svelte-query`, `angular-query-experimental`) | Default choice for REST/RPC in any framework. Framework-agnostic core, largest ecosystem |
| SWR | React only, smaller API, fine for read-heavy apps with simple mutations |
| RTK Query | Already on Redux Toolkit; want generated hooks from an `createApi` definition and normalized cache in the store |
| Apollo Client / urql | GraphQL. Apollo for normalized cache and large ecosystems; urql for a lighter, more composable approach |
| Framework loaders (Next RSC + actions, Remix/React Router loaders, SvelteKit `load`, Nuxt `useFetch`) | The page's primary data. These already dedupe and cache at the server/route level; use a client cache library on top only for data that changes while the page is open (polling, optimistic interactions, infinite scroll) |

### Query keys are the schema of your cache

```ts
// Key factory: one place to get keys right; invalidation uses prefixes
export const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: OrderFilters) => [...orderKeys.lists(), filters] as const,
  details: () => [...orderKeys.all, 'detail'] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
}

useQuery({ queryKey: orderKeys.detail(id), queryFn: () => api.orders.get(id) })
queryClient.invalidateQueries({ queryKey: orderKeys.lists() })   // every list, any filters
```

Keys must include everything the fetch depends on (ids, filters, page,
locale). A key that omits a dependency serves wrong data from cache.
Objects in keys are compared structurally, so order of properties does not
matter but presence does.

### Where the hook lives

Wrap each query in a named hook (`useOrder(id)`, `useOrders(filters)`)
next to the API module, not inline in components. Components call the
hook; tests mock the network (MSW), not the hook. Mutations likewise
(`useDeleteOrder()`), with invalidation inside the hook so every caller
gets it right.

The detailed mechanics (optimistic updates, pagination, invalidation
strategies, waterfalls) are in `data-fetching.md`.

## 4. URL state

Anything that changes what the page shows and that a user might want to
return to belongs in the URL. Benefits: refresh keeps state, share a link,
back button undoes filter changes, server can render the right thing on
first load.

```tsx
// React (Next App Router)
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export function useQueryParam(key: string, defaultValue = '') {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams()
  const value = params.get(key) ?? defaultValue
  const set = useCallback((next: string) => {
    const sp = new URLSearchParams(params)
    next ? sp.set(key, next) : sp.delete(key)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }, [key, params, pathname, router])
  return [value, set] as const
}
```

If the repo has `nuqs` (Next), `@tanstack/react-router` (typed search
params), `vue-router` query, SvelteKit `url.searchParams` + `goto`, or
Angular `queryParams`, use that. Rules: parse and validate URL values
(they are user input: `z.coerce.number().int().min(1).catch(1)`); use
`replace` for high-frequency changes (typing) and `push` for discrete
navigation (page, tab); keep the URL readable (`?status=open&sort=-created`,
not base64 blobs); do not put sensitive data in the URL (it is logged).

## 5. Form state

Lives in the form library (react-hook-form, TanStack Form, vee-validate,
superforms, Angular reactive forms) or in the DOM via uncontrolled inputs
and `FormData`. It does not belong in a global store, and usually not even
in component `useState` per field. Details in `forms.md`.

## 6. Local UI state and lifting

Start local. Lift only when a second component needs the same value, and
only as far as the nearest common ancestor. Three techniques before
reaching for context or a store:

**Move state down.** If only a leaf uses it, the parent should not own it.

**Lift state up.** Siblings need it: the parent owns it, passes value and
setter.

**Pass components, not data.** When an intermediate component only
forwards props, let the grandparent render the child and pass it as
`children`/a slot. The intermediate never sees the data.

```tsx
// Drilling through Layout, which doesn't care about `user`
<Layout user={user}><Page user={user} /></Layout>
// Composition: Layout is agnostic
<Layout header={<UserMenu user={user} />}>{page}</Layout>
```

Context (React), provide/inject (Vue), setContext (Svelte), DI (Angular) is
the next step for a subtree where many descendants need the value and it
changes rarely. For high-frequency shared state (selection in a 1,000-row
table, drag position) a store with per-slice subscriptions avoids
re-rendering the whole subtree.

## 7. Shared client state: context, stores, and when a store is justified

A global store is justified when state is read in unrelated parts of the
app, is not server data, and would otherwise be lifted to the root and
drilled everywhere. Typical real contents: session/user, theme, locale,
notifications/toast queue, websocket connection status, shopping cart in a
client-heavy storefront, undo/redo history in an editor, multi-select
across pages.

| Library | Shape | Pick when |
|---|---|---|
| Zustand | Single store (or several), hooks with selectors, middleware (persist, devtools, immer) | Default for React. Minimal, no provider, selective subscriptions |
| Jotai | Atoms composed bottom-up, derived atoms | State is many small independent pieces; you want derived state as first-class |
| Redux Toolkit | Slices, reducers, actions, RTK Query | Already in the repo; large team wants strict unidirectional flow and time-travel debugging |
| MobX / Valtio | Mutable proxies, automatic tracking | Already in the repo; OO-style domain models |
| XState | State machines, statecharts | Complex multi-step flows with explicit transitions (checkout, media player, wizards) |
| Pinia | Vue stores, setup or options style | Vue default |
| NgRx signalStore / plain signal services | Angular | Angular default; `@Injectable({ providedIn: 'root' })` with signals is often enough |
| Svelte runes module / stores | `.svelte.ts` with `$state` | Svelte default |

```ts
// Zustand: slice per concern, selectors at call sites, actions colocated
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UIState = {
  sidebarOpen: boolean
  theme: 'light' | 'dark' | 'system'
  toggleSidebar: () => void
  setTheme: (t: UIState['theme']) => void
}
export const useUIStore = create<UIState>()(persist((set) => ({
  sidebarOpen: true,
  theme: 'system',
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
}), { name: 'ui', partialize: s => ({ theme: s.theme }) }))   // persist only what should survive reload

// Component: subscribe to one field; re-renders only when it changes
const theme = useUIStore(s => s.theme)
```

Rules: select narrowly (`useStore(s => s.x)`, not `const store = useStore()`);
keep actions in the store so logic is not duplicated across components;
no server data inside unless it is the cache library itself (RTK Query);
no derived values stored (compute in a selector or `computed`); one store
instance per request on the server (create in a provider, not at module
scope) if the app SSRs.

## 8. Derived vs stored

Store the minimal set of facts; compute everything else at read time.

```ts
// Stored: selectedIds, items
// Derived: selectedItems, allSelected, someSelected, selectedTotal
const selectedItems = items.filter(i => selectedIds.has(i.id))
const allSelected = items.length > 0 && selectedIds.size === items.length
```

Signs you stored a derivation: two fields that must always agree
(`items` and `itemCount`), an effect/watcher whose only job is to keep one
field in sync with another, a bug where they disagreed. Memoize a
derivation only if profiling shows it is expensive (sorting thousands of
rows, building an index) and its inputs change rarely; in Vue/Svelte/
Angular, `computed`/`$derived` already memoize.

Normalize when the same entity appears in many places (a user in a list
and in a detail panel and in comments). Store entities by id and lists as
id arrays; derive the joined view. TanStack Query does not normalize; if
you need cross-query consistency after a mutation, update both caches with
`setQueryData` or invalidate the lists. Apollo and RTK Query normalize.

## 9. Store shapes that age well

- Model the state's *possible states*, not flags: `status: 'idle' |
  'connecting' | 'open' | 'closed'` rather than `isConnecting`, `isOpen`,
  `hasError` (which allow impossible combinations). See `typescript.md`.
- Keep stores small and by concern (`useAuthStore`, `useUIStore`,
  `useCartStore`), not one `useAppStore` with everything.
- Actions are verbs that describe intent (`addToCart`, `dismissBanner`),
  not setters (`setCartItems`). Logic lives in the action, so the UI does
  not compute the next state.
- Side effects (API calls, analytics) in actions or dedicated effects, not
  in components reacting to store changes.
- Expose read-only views (`asReadonly()`, selectors) and mutate only via
  actions.
- Devtools middleware in development; it makes "why did this change"
  answerable.

## 10. Persistence

Persist deliberately and partially. `localStorage` is synchronous and
string-only (~5 MB); `IndexedDB` for anything large or binary. Version
persisted state and write a migration when the shape changes (Zustand
`persist` has `version` + `migrate`). Never persist server data as the
source of truth (persist the cache if you need offline: TanStack Query
`persistQueryClient`), never persist secrets or tokens meant to be
`httpOnly`. Hydration of persisted state on the client happens after first
render; design for the brief default state (or use `skipHydration` and a
loading gate) so SSR output does not mismatch.

## 11. Migrating a store that became a cache

Typical symptom: a `products` slice with `fetchProducts` thunk, `loading`,
`error`, `byId`, and every page dispatches `fetchProducts()` on mount.

1. Add the cache library (or RTK Query if already on Redux) alongside.
2. Write `useProducts(filters)` with a query key; make it the only reader.
3. Replace readers page by page; delete the thunk and slice when no
   reader remains.
4. Mutations move to `useMutation` with invalidation; remove manual
   `refetch` calls.
5. What remains in the store is genuinely client state (selected ids, UI
   prefs). Usually it is a tenth of what was there.

Do this incrementally, one entity at a time, behind the same component
props so nothing else changes.

## 12. Anti-patterns with fixes

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| Server data in a global store with `isLoading` flags | Hand-written cache without dedupe/invalidation/GC | Cache library or loaders |
| Filters/pagination in component state | Lost on refresh, not shareable, back button broken | URL |
| One mega store for everything | Every change re-renders every subscriber; impossible to reason about | Stores by concern, narrow selectors |
| Context for high-frequency updates | Whole subtree re-renders | Store with selectors, or keep local |
| Prop drilling through 5 layers of components that don't use the prop | Brittle, noisy | Composition (pass components), then context |
| Storing derived values (`total`, `filteredItems`) | Sync bugs | Compute at read time |
| Boolean flag soup (`isLoading`, `isError`, `isSuccess` all true) | Impossible states | Discriminated union `status` |
| Effects syncing store A to store B | Hidden data flow, loops | Single source; derive |
| Module-scope store instance in an SSR app | Shared across users | Per-request instance via provider |
| Persisting the whole store | Stale/secret data, hydration mismatch | `partialize`, versioned migrations |
| `setState` setters as the store's API | Logic scattered across components | Intent-named actions |
| Introducing a second store library | Two mental models | Use the existing one; propose migration separately |
