# Data fetching

Waterfalls and how to see them, parallelization, the layers of caching
between the browser and the database, optimistic updates with rollback,
invalidation strategies, error handling and retries, pagination and infinite
scroll, streaming, and the loader model in meta-frameworks. Code is mostly
TanStack Query (the most common cross-framework choice) with notes for
loaders and other libraries.

## Contents

1. Where to fetch: the ladder
2. Waterfalls: seeing and removing them
3. Caching layers
4. Query hooks done right
5. Mutations, optimistic updates, rollback
6. Invalidation strategies
7. Errors, retries, cancellation
8. Pagination and infinite scroll
9. Streaming and partial data
10. Real-time: polling, SSE, websockets
11. The loader model (Remix/React Router, SvelteKit, Nuxt, Next RSC)
12. The API client layer
13. Anti-patterns with fixes

## 1. Where to fetch: the ladder

From most to least preferred for a page's primary data:

1. **Server, at the route level** (RSC `await`, loader, `load`, `useFetch`
   in setup). Zero client JS for fetching, parallel by construction, data
   arrives with HTML, no spinner on first load.
2. **Client, at the route/page component** via the cache library, hydrated
   from server where possible. For data that changes while the page is
   open.
3. **Client, in the component that owns the interaction** (a combobox's
   suggestions, a row's expanded details). Still via the cache library so
   it is deduped and cancellable.
4. **Client, in a leaf, with raw `fetch` in an effect.** Only when none of
   the above are available, and then with cancellation and explicit state.

The lower you fetch, the more waterfalls and duplicate requests you get;
the higher you fetch, the more the page waits on the slowest request. The
balance: fetch critical data high and in parallel; defer secondary data
behind Suspense/lazy so it streams in.

## 2. Waterfalls: seeing and removing them

A waterfall is a request that cannot start until another finishes for
reasons other than true data dependency. Open the network tab, sort by
start time; stair steps are waterfalls.

Common causes and fixes:

```tsx
// Cause: component tree. Parent fetches, renders child, child fetches.
function Order({ id }) {
  const order = useQuery(orderQ(id))
  if (!order.data) return <Spinner />
  return <Customer id={order.data.customerId} />   // Customer fetches only after order resolves: unavoidable dependency, but...
}
// ...the *items* and *shipping* queries do not depend on the customer; they should start with the order.
function Order({ id }) {
  const order = useQuery(orderQ(id))
  const items = useQuery(orderItemsQ(id))          // parallel: both start on mount
  const shipping = useQuery(shippingQ(id))
  ...
}

// Cause: sequential awaits on the server
const user = await getUser(id); const posts = await getPosts(id)
// Fix
const [user, posts] = await Promise.all([getUser(id), getPosts(id)])

// Cause: lazy-loaded route component that then fetches. Fix: loaders run before/with the import (React Router), or prefetch on hover.

// Cause: auth check that blocks everything, then data. Fix: run the auth check and the data fetch in parallel on the server; or make data fetch take the session cookie directly.
```

Dependent data that cannot be parallelized: ask whether the API should
return it embedded (`/orders/1?include=customer`), or whether a backend
endpoint can aggregate (BFF). That is `backend`'s call; raise it.

Prefetch on intent: `queryClient.prefetchQuery` on link hover/focus, the
framework's `<Link prefetch>`, or `router.prefetch`. The user's hand gives
you 100-300 ms for free.

## 3. Caching layers

From the browser outward. Know which one you are configuring.

| Layer | Controlled by | Typical use |
|---|---|---|
| In-memory client cache (TanStack Query, SWR, Apollo) | `staleTime`, `gcTime`, keys | Dedupe within session, instant back-navigation, optimistic UI |
| Persisted client cache | `persistQueryClient`, IndexedDB | Offline, instant cold start |
| Browser HTTP cache | `Cache-Control`, `ETag` on the response | Static assets; GET API responses that tolerate staleness; `stale-while-revalidate` |
| Service worker | Workbox strategies | PWA offline, asset precaching |
| Framework server cache (Next data cache, Nuxt `routeRules` swr/isr, SvelteKit `setHeaders`) | Framework config | Per-route or per-fetch caching on the server |
| CDN / edge | `Cache-Control: s-maxage`, `Surrogate-Control`, tags | Shared across users; purge on publish |
| Server application cache (Redis) | `backend` | Expensive queries |

Client-side defaults to set once, in the QueryClient:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // treat data as fresh for 1 min: no refetch on remount/focus within that window
      gcTime: 5 * 60_000,           // keep unused data 5 min for instant back-nav
      retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 2,   // don't retry 4xx
      refetchOnWindowFocus: 'always' in some apps, false in dashboards with heavy queries; decide deliberately
    },
  },
})
```

`staleTime: 0` (the library default) means every mount refetches. That is
rarely what you want for data a user just saw. Per-query overrides for
hot data (`staleTime: 0` on a stock ticker) and cold data (`staleTime:
Infinity` for a country list).

For HTTP-level caching of your own GET endpoints, `Cache-Control:
private, max-age=0, must-revalidate` + `ETag` lets the browser skip
downloading unchanged bodies (304). Public, user-independent data can use
`s-maxage` for CDN caching. Coordinate with `backend`.

## 4. Query hooks done right

```ts
// api/orders.ts: one module per resource; the only place that knows URLs
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { http } from '@/lib/http'

const Order = z.object({ id: z.string(), status: z.enum(['open', 'paid', 'shipped']), total: z.number(), customerId: z.string() })
export type Order = z.infer<typeof Order>

export const orderKeys = { all: ['orders'] as const, detail: (id: string) => ['orders', 'detail', id] as const, list: (f: OrderFilters) => ['orders', 'list', f] as const }

// queryOptions: reusable, typed, usable in useQuery, prefetchQuery, loaders, and ensureQueryData
export const orderQuery = (id: string) => queryOptions({
  queryKey: orderKeys.detail(id),
  queryFn: ({ signal }) => http.get(`/orders/${id}`, { signal }).then(Order.parse),   // validate at the boundary
  staleTime: 30_000,
})

export function useOrder(id: string) { return useQuery(orderQuery(id)) }
export function useOrderSuspense(id: string) { return useSuspenseQuery(orderQuery(id)) }
```

In a component, render by status, not by truthiness:

```tsx
const { data, status, error, isFetching } = useOrder(id)
if (status === 'pending') return <OrderSkeleton />
if (status === 'error') return <InlineError error={error} onRetry={() => refetch()} />
return <OrderView order={data} refreshing={isFetching} />      // data is typed non-null here
```

`enabled: Boolean(id)` for dependent queries; `select: (d) => d.items`
to subscribe to a slice and avoid re-rendering when other fields change;
`placeholderData: keepPreviousData` to keep the old page visible while the
next page loads (no layout flash).

## 5. Mutations, optimistic updates, rollback

Three levels of ambition. Pick the lowest that gives acceptable UX.

**Level 1: invalidate after success.** Simplest, always correct, shows a
pending state until the refetch lands.

```ts
export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Order['status'] }) => http.patch(`/orders/${id}`, { status }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: orderKeys.detail(id) })
      qc.invalidateQueries({ queryKey: orderKeys.all, exact: false })   // lists too
    },
  })
}
```

**Level 2: write the server response into the cache.** No refetch needed
when the API returns the updated entity.

```ts
onSuccess: (updated) => { qc.setQueryData(orderKeys.detail(updated.id), updated); qc.invalidateQueries({ queryKey: orderKeys.list }) }
```

**Level 3: optimistic update with rollback.** UI changes instantly; revert
on error; refetch to reconcile.

```ts
export function useToggleTodo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todo: Todo) => http.patch(`/todos/${todo.id}`, { done: !todo.done }),
    onMutate: async (todo) => {
      await qc.cancelQueries({ queryKey: todoKeys.list() })                 // don't let an in-flight refetch overwrite the optimistic state
      const previous = qc.getQueryData<Todo[]>(todoKeys.list())
      qc.setQueryData<Todo[]>(todoKeys.list(), old => old?.map(t => t.id === todo.id ? { ...t, done: !t.done } : t))
      return { previous }
    },
    onError: (_err, _todo, ctx) => { if (ctx?.previous) qc.setQueryData(todoKeys.list(), ctx.previous); toast.error('Could not update. Reverted.') },
    onSettled: () => qc.invalidateQueries({ queryKey: todoKeys.list() }),   // reconcile with the server either way
  })
}
```

Optimistic UI is right for toggles, likes, reorder, adding to a list,
deleting (with undo). It is wrong when the server decides the outcome
(payment, inventory, permissions) or when the user cannot easily understand
a revert. Mark optimistic items visually (`opacity`, "Saving…") when the
operation can take more than a moment. React 19's `useOptimistic` and
Svelte's `$derived` override are framework-level equivalents for the simple
cases.

Concurrent mutations on the same entity: use `mutationKey` + `scope` to
serialize, or disable the control while pending (`isPending`).

## 6. Invalidation strategies

| Strategy | When |
|---|---|
| Invalidate by key prefix after mutation | Default. `['orders']` catches lists and details |
| `setQueryData` from response | API returns the full updated entity; avoids a round trip |
| Tag-based server invalidation (Next `revalidateTag`, CDN surrogate keys) | Server-rendered/cached data; purge on publish/mutation |
| Time-based (`staleTime`, `refetchInterval`, ISR) | Data changes on a schedule or you can tolerate N seconds of staleness |
| Event-based (websocket "order.updated" → invalidate `orders.detail(id)`) | Collaborative or live data |
| Focus/reconnect refetch | Default on; the user came back, show fresh data |
| Manual `refetch` button | Reports, dashboards where the user controls freshness |

Over-invalidation (`invalidateQueries()` with no key) refetches everything
and is a hidden performance bug. Under-invalidation leaves stale lists
after a detail edit. The key factory (section 4) makes the right prefix
easy.

## 7. Errors, retries, cancellation

- Classify errors at the HTTP client: network (retryable), 5xx (retryable
  with backoff), 429 (retry after header), 4xx (not retryable; 401 →
  re-auth flow; 403 → show permission state; 404 → not-found state; 422 →
  validation errors to the form).
- Retry only idempotent requests (GET, PUT, DELETE with idempotency keys).
  Never auto-retry a POST that creates something unless the backend
  supports idempotency keys.
- Exponential backoff with jitter: `delay = min(1000 * 2 ** attempt, 30_000) * (0.5 + Math.random())`.
- Cancellation: pass the `signal` from `queryFn` into `fetch`; the library
  aborts when the query is unmounted or superseded. In raw effects, create
  an `AbortController` and abort in cleanup. Ignore `AbortError` in catch.
- Error UI lives at the granularity of the data: inline for a widget,
  route-level for primary data, toast for background refetch failures (do
  not replace data the user is looking at with an error because a
  background refresh failed; TanStack keeps `data` alongside `error`).
- Report to the error tracker in `onError`/global `QueryCache` handlers,
  with the query key for context.

```ts
// lib/http.ts: typed client with error classification
export class HttpError extends Error { constructor(public status: number, public body: unknown, message?: string) { super(message ?? `HTTP ${status}`) } }
export async function request<T>(path: string, init: RequestInit & { parse?: (u: unknown) => T } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers }, credentials: 'include' })
  if (!res.ok) throw new HttpError(res.status, await res.json().catch(() => null))
  const json = res.status === 204 ? undefined : await res.json()
  return init.parse ? init.parse(json) : (json as T)
}
```

## 8. Pagination and infinite scroll

**Offset pagination** (`?page=3&limit=20`): simple, supports "jump to
page", breaks when items are inserted/deleted between requests (skipped or
duplicated rows). Fine for admin tables.

**Cursor pagination** (`?after=eyJpZCI6...&limit=20`): stable under
inserts, no "jump to page", the right choice for feeds and infinite scroll.

```ts
export function useOrdersInfinite(filters: OrderFilters) {
  return useInfiniteQuery({
    queryKey: orderKeys.list(filters),
    queryFn: ({ pageParam, signal }) => http.get<OrdersPage>(`/orders?${qs({ ...filters, after: pageParam })}`, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,     // undefined = no more pages
    maxPages: 10,                                                  // cap memory for long sessions; bi-directional with getPreviousPageParam
  })
}

// Trigger: IntersectionObserver on a sentinel, not a scroll handler
const sentinel = useRef<HTMLDivElement>(null)
useEffect(() => {
  const el = sentinel.current; if (!el) return
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage() }, { rootMargin: '400px' })
  io.observe(el); return () => io.disconnect()
}, [hasNextPage, isFetchingNextPage, fetchNextPage])
```

Infinite scroll needs: a "Load more" button as a fallback (keyboard and
screen reader users, and a footer that is reachable), `aria-live="polite"`
announcement of loaded count, virtualization past a few hundred rows (see
`performance.md`), and URL state for filters so refresh does not lose
context. The page number itself usually should not be in the URL for
infinite scroll; for paged tables it should.

`keepPreviousData` (`placeholderData: keepPreviousData`) for paged tables
so the table does not collapse to a skeleton between pages; show a subtle
`isFetching` indicator instead.

## 9. Streaming and partial data

Server frameworks can send the shell first and stream slow parts:

- Next/RSC: `<Suspense>` boundaries around components that `await`;
  `loading.tsx`.
- SvelteKit: return unawaited promises from server `load`; `{#await}` in
  the template.
- Remix/React Router: `defer()` (older) or returning promises from loaders,
  `<Await>`.
- Nuxt: `useLazyFetch`/`lazy: true` plus `<Suspense>`-like handling via
  `status`.

Rules: stream secondary content (recommendations, comments, analytics),
not the primary content the page is for; reserve space with skeletons
sized like the result so CLS stays near zero; set `<title>` and critical
metadata in the shell, not in a streamed part; make sure error boundaries
exist per streamed region.

Partial data from the client cache: with `placeholderData` or `initialData`
from a list query, a detail view can render the known fields immediately
and fill in the rest when the detail query lands:

```ts
useQuery({ ...orderQuery(id), placeholderData: () => qc.getQueryData<Order[]>(orderKeys.list(currentFilters))?.find(o => o.id === id) })
```

## 10. Real-time: polling, SSE, websockets

| Mechanism | Fits |
|---|---|
| Polling (`refetchInterval`) | Low frequency (≥ 10 s), simple infra, data that changes occasionally. Stop when tab hidden (`refetchIntervalInBackground: false`) |
| Server-Sent Events | One-way server→client updates (notifications, progress, feeds). Simple, auto-reconnect, works over HTTP/2 |
| WebSocket | Bi-directional, high frequency (chat, collaboration, live cursors). Needs reconnect/backoff logic and a heartbeat |

Integrate with the cache rather than bypassing it: on a message, either
`setQueryData` with the payload (if it is the full entity) or
`invalidateQueries` for the affected key. This keeps one source of truth and
makes components agnostic to how data arrived.

```ts
useEffect(() => {
  const es = new EventSource('/api/orders/stream')
  es.addEventListener('order.updated', (e) => { const order = Order.parse(JSON.parse(e.data)); qc.setQueryData(orderKeys.detail(order.id), order); qc.invalidateQueries({ queryKey: orderKeys.list }) })
  return () => es.close()
}, [qc])
```

## 11. The loader model (Remix/React Router, SvelteKit, Nuxt, Next RSC)

Meta-frameworks move primary data fetching to the route:

- Loaders run on the server (and, for client navigations, either on the
  server via fetch or in the browser), in parallel for nested routes.
- Mutations go through actions; after an action, the framework revalidates
  loaders automatically.
- Forms submit to actions and work without JS.

This replaces a client cache for the page's primary data. Keep the client
cache library for interaction-heavy data (optimistic toggles, polling,
infinite scroll) and hydrate it from the loader data to avoid double
fetching (TanStack `HydrationBoundary`, or `initialData` from loader).

```ts
// React Router v7 framework mode
export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const [order, items] = await Promise.all([getOrder(params.id), getItems(params.id, url.searchParams.get('page'))])
  return { order, items }
}
export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  await updateOrder(params.id, parse(form))
  return redirect(`/orders/${params.id}`)    // loaders revalidate on the new route
}
```

See the framework references for specifics.

## 12. The API client layer

One module owns: base URL, auth header or cookie mode, JSON encoding,
error classification, response validation hooks, request IDs/tracing
headers. Resource modules (`api/orders.ts`) own URLs and schemas. Hooks
(`useOrder`) own cache config. Components own nothing about HTTP.

If the backend publishes OpenAPI or GraphQL schemas, generate the client
and types (`openapi-typescript` + `openapi-fetch`, `orval`, `graphql-codegen`)
rather than hand-writing them; see `typescript.md`. If the repo already
has a client (`lib/api.ts`, `services/`, tRPC, generated SDK), extend it;
never add a parallel one.

## 13. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `useEffect` + `fetch` + `useState` per component | Cache library hook or loader |
| Same resource fetched by several components independently | Shared query key; the library dedupes |
| Sequential `await`s for independent data | `Promise.all` |
| Child fetches what parent could have included | Fetch at parent in parallel; or embed in API |
| `staleTime: 0` everywhere (default) | Set sensible defaults; override per query |
| `invalidateQueries()` with no key | Target the prefix |
| Optimistic update without `cancelQueries` and rollback | Full `onMutate`/`onError`/`onSettled` |
| Retrying POSTs | Idempotency keys or no retry |
| Swallowing errors (`catch(() => {})`) | Classify, surface, report |
| Scroll handler for infinite scroll | `IntersectionObserver` + Load more button |
| Offset pagination for a live feed | Cursor pagination |
| Websocket messages that bypass the cache | `setQueryData`/`invalidateQueries` |
| Raw `fetch` with hand-typed `as Order` | Client layer + schema parse |
| Secrets in client fetch (API keys in `VITE_*`) | Proxy through your server |
| Fetching on the client what the server already had | Loader/RSC + hydration |
