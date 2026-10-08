# React (18 and 19)

Server components versus client components, hooks discipline, the effect
misuse catalogue with fixes, when memoization is actually warranted, context
pitfalls, Suspense and transitions, forms with actions, and the anti-patterns
an agent produces most often. Assumes you read SKILL.md; framework-specific
routing and caching live in `nextjs.md`.

## Contents

1. Mental model: render is a pure function of props and state
2. Server components vs client components
3. Hooks discipline
4. The effect misuse catalogue
5. Memoization: only when measured
6. Context: what it is for and what it is not
7. Suspense, transitions and `use`
8. Forms with actions (React 19)
9. Refs, DOM and third-party libraries
10. Lists, keys and reconciliation
11. Error boundaries
12. Common anti-patterns with fixes
13. Version notes

## 1. Mental model

A component is a function from `(props, state, context)` to UI. React calls
it as often as it wants; your code must not care. Two consequences drive
everything else:

- Anything that runs during render must be pure: no mutation of outside
  variables, no network, no `Date.now()` for display (hydration), no
  `Math.random()`. Side effects go in event handlers (user did a thing) or
  effects (synchronize with something outside React).
- A re-render is not a problem. A re-render that does expensive work is. A
  re-render that triggers another re-render through an effect is a bug
  waiting to happen.

StrictMode double-invokes render and effects in development to flush out
impurity. Keep it on. If a component breaks under StrictMode, the component
is wrong, not StrictMode.

## 2. Server components vs client components

React Server Components (RSC) exist in Next.js App Router, React Router v7
framework mode (experimental), Waku, and some custom setups. If the codebase
has `'use client'` directives, it uses RSC.

| | Server component (default in RSC frameworks) | Client component (`'use client'`) |
|---|---|---|
| Runs | On the server only, at request or build time | On the server for SSR *and* in the browser |
| Can | `await` data directly, read files/env/secrets, import heavy server-only libs with zero client cost | Use hooks, state, effects, event handlers, browser APIs |
| Cannot | Use `useState`/`useEffect`, event handlers, browser APIs, Context consumption | Import server components (but can receive them as `children`) |
| Props | Must be serializable when passed to a client component (no functions except server actions, no class instances, no Dates without care) | Anything |
| Bundle | Zero JS shipped for the component itself | Shipped to browser |

The directive marks a *boundary*, not a file type: everything imported by a
client component becomes client code. Put the directive as low as possible.

```tsx
// app/products/page.tsx  (server component: no directive)
import { ProductGrid } from './product-grid'
import { AddToCartButton } from './add-to-cart-button'
import { db } from '@/lib/db'

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const products = await db.product.findMany({ where: { name: { contains: q } } })
  return (
    <ProductGrid>
      {products.map(p => (
        <article key={p.id}>
          <h2>{p.name}</h2>
          {/* Server component passes serializable props to a client leaf */}
          <AddToCartButton productId={p.id} />
        </article>
      ))}
    </ProductGrid>
  )
}
```

```tsx
// app/products/add-to-cart-button.tsx
'use client'
import { useTransition } from 'react'
import { addToCart } from './actions'

export function AddToCartButton({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button type="button" disabled={pending} onClick={() => startTransition(() => addToCart(productId))}>
      {pending ? 'Adding…' : 'Add to cart'}
    </button>
  )
}
```

The interleaving trick: a client component can render server components
passed as `children` or any prop. This is how you keep a provider or an
interactive shell on the client while its content stays on the server.

```tsx
// Wrong: makes the whole subtree client code
'use client'
export function Layout({ children }) { ... }   // fine, children stay server-rendered
// but importing a server component *inside* a client file is not allowed:
import { ServerThing } from './server-thing'   // error or silently becomes client
```

Mark `server-only` / `client-only` packages (`import 'server-only'`) on
modules that must never cross the boundary (DB clients, secrets).

## 3. Hooks discipline

- Call hooks unconditionally at the top of the component. The rules-of-hooks
  lint rule exists because React tracks hooks by call order.
- Custom hooks are for *reusing stateful logic*, not for hiding complexity.
  If a hook returns twelve values, it is a component in disguise or several
  hooks.
- A custom hook that wraps a fetch should use the codebase's cache library
  inside; it should not be `useState` + `useEffect` + `fetch`.
- Name by what it gives you: `useDebouncedValue(value, 300)`,
  `useMediaQuery('(min-width: 768px)')`, `useProduct(id)`.
- Return a tuple for state-like hooks (`[value, setValue]`), an object for
  anything with more than two outputs.

```tsx
// Good custom hook: reusable stateful logic with a clear contract
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
```

`useEffectEvent` (React 19.1+) and the older `useRef` trick let an effect
read the latest callback without re-subscribing. Use it when a subscription
should not restart when a handler changes:

```tsx
function useWindowEvent<K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void) {
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    window.addEventListener(type, onEvent)
    return () => window.removeEventListener(type, onEvent)
  }, [type])
}
```

## 4. The effect misuse catalogue

Each row: the symptom, why it is wrong, the fix. This is the single most
common source of bugs in agent-written React.

### 4.1 Deriving state

```tsx
// Wrong: extra render, stale frame, dependency bugs
const [fullName, setFullName] = useState('')
useEffect(() => { setFullName(`${first} ${last}`) }, [first, last])

// Right: compute during render
const fullName = `${first} ${last}`
```

### 4.2 Resetting state when a prop changes

```tsx
// Wrong
useEffect(() => { setDraft(''); setStep(0) }, [userId])

// Right: give the subtree a key; React remounts it with fresh state
<EditorForm key={userId} userId={userId} />
```

If only *some* state should reset, compare the previous prop during render:

```tsx
const [prevUserId, setPrevUserId] = useState(userId)
if (userId !== prevUserId) { setPrevUserId(userId); setDraft('') }  // allowed: set state during render of the same component
```

### 4.3 Responding to an event

```tsx
// Wrong: event -> state -> effect -> side effect
const [submitted, setSubmitted] = useState(false)
useEffect(() => { if (submitted) { track('order_submitted'); navigate('/thanks') } }, [submitted])

// Right: do the work in the handler
async function handleSubmit() {
  await submitOrder(order)
  track('order_submitted')
  navigate('/thanks')
}
```

### 4.4 Fetching with no cache, no cancellation

```tsx
// Wrong: races, no dedupe, refetches on every mount, no error state
useEffect(() => { fetch(`/api/users/${id}`).then(r => r.json()).then(setUser) }, [id])

// Right with the codebase's cache library
const { data: user, isPending, error } = useQuery({
  queryKey: ['user', id],
  queryFn: ({ signal }) => api.getUser(id, { signal }),
})

// Right if there truly is no library and you cannot add one
useEffect(() => {
  const ac = new AbortController()
  setState({ status: 'loading' })
  api.getUser(id, { signal: ac.signal })
    .then(data => setState({ status: 'success', data }))
    .catch(err => { if (err.name !== 'AbortError') setState({ status: 'error', error: err }) })
  return () => ac.abort()
}, [id])
```

### 4.5 Chaining effects

Effect A sets state that triggers effect B that sets state that triggers
effect C. Each hop is a render. Replace with a single event handler or a
reducer that computes the full next state at once.

### 4.6 Notifying a parent

```tsx
// Wrong
useEffect(() => { onChange(value) }, [value])
// Right: call onChange in the same handler that sets value, or lift state so the parent owns it
```

### 4.7 Initializing app-level things

Effects run per mount, and twice in dev StrictMode. One-time setup belongs
at module scope guarded by a flag, or in a framework entry point.

### What effects *are* for

Subscribing to browser events or external stores (prefer
`useSyncExternalStore` for stores), measuring the DOM after layout
(`useLayoutEffect`), driving a non-React widget (map, chart, editor),
analytics on route change, focusing an element after mount. Always return a
cleanup. Always let the lint rule fill the dependency array; if the array
"wants" something you don't want to depend on, that is a design problem
(usually fixed by `useEffectEvent`, moving the logic into a handler, or
moving the value into a ref).

## 5. Memoization: only when measured

React re-renders a component when its parent re-renders, when its state
changes, or when a context it reads changes. Re-rendering is cheap unless
the component does expensive work or has a huge subtree.

Before reaching for `memo`, `useMemo`, `useCallback`:

1. Open React DevTools Profiler, record the interaction, look at what
   rendered and how long it took.
2. Ask whether the parent should be re-rendering at all. Often the fix is
   moving state down (into the component that uses it) or passing children
   (so the expensive subtree is created once by the grandparent and not
   re-created by the parent's render).

```tsx
// Moving state down: typing in the search box no longer re-renders the heavy table
function Page() {
  return (
    <>
      <SearchBox />           {/* owns its own query state */}
      <HeavyTable />
    </>
  )
}

// Children as a stable subtree: Sidebar re-renders on toggle, children do not
function Sidebar({ children }) {
  const [open, setOpen] = useState(false)
  return <aside data-open={open}>{children}</aside>
}
```

Memoize when: the profiler shows a component rendering often with
unchanged props and a measurable cost (say > 2 ms per render in a list of
hundreds); a value is passed to a dependency array or a memoized child and
its identity must be stable; a computation is genuinely heavy (sorting
10k rows, building a search index).

Do not memoize: primitives, cheap JSX, callbacks passed to DOM elements,
anything "just in case". Each `useMemo` is code to read and a cache that
can be wrong.

With the React Compiler (React 19, opt-in via `babel-plugin-react-compiler`
or Next config), most manual memoization becomes unnecessary; the compiler
memoizes automatically if your components follow the rules. Check if the
codebase has it enabled before adding manual memo.

## 6. Context

Context is a dependency injection mechanism for a subtree, not a state
manager. Every consumer re-renders when the provider's `value` changes,
with no selector.

Good uses: theme, current locale, current user (changes rarely), a form's
field registry, a compound component's shared state (`<Tabs>` children
finding their parent).

Pitfalls and fixes:

```tsx
// Wrong: new object every render, every consumer re-renders every time the provider's parent renders
<UserContext.Provider value={{ user, setUser }}>

// Right: stable value
const value = useMemo(() => ({ user, setUser }), [user])
<UserContext.Provider value={value}>

// Better for frequently-changing state: split contexts by update frequency
<UserContext.Provider value={user}>
  <UserActionsContext.Provider value={actions}>   {/* actions are stable */}
```

If you find yourself wanting selectors (`useContextSelector`), you want a
store (Zustand, Jotai, Redux) instead. Those subscribe per-slice. See
`state-management.md`.

React 19: `<Context>` can be rendered directly as the provider, and `use(Context)` can be called conditionally.

## 7. Suspense, transitions and `use`

Suspense lets a component "wait" for data and shows a fallback at the
nearest boundary. In RSC frameworks it also defines streaming chunks: each
`<Suspense>` becomes a part of the page that can arrive later.

Placement rules:

- Put boundaries around *units the user perceives as one thing* (a card, a
  sidebar, a table), not around every component. Too many boundaries means
  a page of popping spinners; too few means the whole page waits on the
  slowest query.
- The fallback should match the dimensions of the content (skeleton) to
  avoid layout shift. See `performance.md` on CLS.
- Wrap each boundary in an error boundary too, or use a library that
  combines them (`react-error-boundary` with `QueryErrorResetBoundary`).

```tsx
<Suspense fallback={<TableSkeleton rows={10} />}>
  <OrdersTable />          {/* uses useSuspenseQuery or awaits in RSC */}
</Suspense>
```

Transitions mark a state update as non-urgent so React can keep showing the
old UI while the new one prepares, instead of flashing a fallback:

```tsx
const [tab, setTab] = useState('overview')
const [isPending, startTransition] = useTransition()
function selectTab(next: string) {
  startTransition(() => setTab(next))   // old tab stays visible, isPending lets you dim it
}
```

Use `startTransition` for navigation-like updates (tabs, filters, pages).
Do not use it for typing in an input; the input must update urgently.
`useDeferredValue(query)` is the right tool for "search as you type with
an expensive result list".

`use(promise)` (React 19) reads a promise during render and suspends.
Create the promise *outside* render (in a parent, a loader, a cache) or
you will create a new promise each render and loop forever.

## 8. Forms with actions (React 19)

`<form action={fn}>` calls `fn(formData)` on submit, works without JS when
the action is a server action, and integrates with `useActionState` for
pending and result state.

```tsx
'use client'
import { useActionState } from 'react'
import { updateProfile, type ProfileState } from './actions'

export function ProfileForm({ initial }: { initial: ProfileState }) {
  const [state, formAction, pending] = useActionState(updateProfile, initial)
  return (
    <form action={formAction}>
      <label htmlFor="name">Name</label>
      <input id="name" name="name" defaultValue={state.values.name} aria-describedby={state.errors.name ? 'name-error' : undefined} aria-invalid={!!state.errors.name} />
      {state.errors.name && <p id="name-error" role="alert">{state.errors.name}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
```

```ts
// actions.ts
'use server'
import { z } from 'zod'
const schema = z.object({ name: z.string().min(1, 'Name is required').max(80) })

export async function updateProfile(prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { values: Object.fromEntries(formData) as any, errors: parsed.error.flatten().fieldErrors }
  }
  await db.user.update(...)
  revalidatePath('/profile')
  return { values: parsed.data, errors: {} }
}
```

`useOptimistic` gives you an optimistic value that reverts automatically if
the action throws:

```tsx
const [optimisticTodos, addOptimistic] = useOptimistic(todos, (state, newTodo: Todo) => [...state, newTodo])
async function action(formData: FormData) {
  const todo = { id: crypto.randomUUID(), title: String(formData.get('title')), pending: true }
  addOptimistic(todo)
  await createTodo(todo)
}
```

Server actions are public endpoints. Validate input and check authorization
inside every action as if it were a route handler, because it is one. See
`forms.md` for validation and accessibility of errors in depth.

## 9. Refs, DOM and third-party libraries

- `useRef` for values that persist across renders without causing one
  (timers, previous values, DOM nodes, imperative library instances).
- Reading `ref.current` during render is a bug (it may be null or stale).
  Read it in effects and handlers.
- React 19: `ref` is a regular prop; `forwardRef` is unnecessary. In 18,
  wrap with `forwardRef` and `useImperativeHandle` only for a small,
  deliberate imperative API (`focus()`, `scrollToRow()`).
- Ref callbacks can return a cleanup in React 19.
- Wrapping a non-React widget: create in an effect, destroy in cleanup,
  push prop changes to it in separate effects keyed on each prop.

```tsx
function MapView({ center }: { center: LatLng }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  useEffect(() => {
    map.current = createMap(el.current!)
    return () => { map.current?.destroy(); map.current = null }
  }, [])
  useEffect(() => { map.current?.setCenter(center) }, [center])
  return <div ref={el} className="map" />
}
```

## 10. Lists, keys and reconciliation

`key` tells React which element is which across renders. Use a stable id
from the data. Index as key is acceptable only for static lists that are
never reordered, filtered or edited. A wrong key causes state to attach to
the wrong row (the classic "I deleted item 3 and item 4's checkbox became
checked").

Keys also *reset* components: changing the key remounts the subtree. This
is the intended way to reset state (section 4.2).

Lists longer than a few hundred rows that are all rendered: virtualize
(`@tanstack/react-virtual`, `react-window`). See `performance.md`.

## 11. Error boundaries

Rendering errors unmount the whole tree to the nearest boundary. Put
boundaries at the same granularity as Suspense boundaries, plus one at the
route level. Class components are still required to define one; use
`react-error-boundary` to avoid writing the class.

```tsx
<ErrorBoundary FallbackComponent={CardError} onReset={() => queryClient.resetQueries({ queryKey: ['orders'] })} resetKeys={[orderId]}>
  <Suspense fallback={<CardSkeleton />}>
    <OrderCard id={orderId} />
  </Suspense>
</ErrorBoundary>
```

Error boundaries do not catch errors in event handlers, async code, or
during SSR. Handle those in the handler (try/catch, toast) and with the
framework's `error.tsx` / `ErrorBoundary` route conventions. Report caught
errors to your error tracker in `onError`.

## 12. Common anti-patterns with fixes

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| `useState` for a value that is always derived | Two sources of truth | Compute in render |
| `useEffect` that only calls `setState` | Extra render, stale frame | Derive, or move to handler, or `key` |
| `useEffect(() => { fetch... }, [])` | No cache, no cancel, no dedupe, StrictMode double fetch | Cache library / loader / RSC |
| Boolean prop explosion (`isPrimary isLarge isDisabled isLoading`) | Combinatorial API | `variant`/`size` unions + composition |
| `{list.map(x => <Row {...x} />)}` with spread of unknown shape | Leaks unknown props to DOM, kills type safety | Pass explicit props or the item object |
| Index as key on an editable list | State attaches to wrong item | Stable id |
| `useCallback` on every handler | Noise, no benefit unless child is memoized | Remove; measure |
| Fetching in a `useEffect` inside each list item | N requests | Fetch the collection at the list; or batch |
| `useContext` for high-frequency state (mouse position, form values) | Whole subtree re-renders | Store with selectors, or keep local |
| Component defined inside another component | Remounts every render, loses state | Hoist to module scope |
| Mutating state (`items.push(x); setItems(items)`) | No re-render, stale closures | New array/object; or `useImmer` |
| `async` function passed directly to `useEffect` | Returns a promise, not a cleanup | Define async fn inside and call it |
| `window`/`document`/`localStorage` in render | Breaks SSR, hydration mismatch | Effect, or `useSyncExternalStore` with server snapshot |
| `Date.now()`, `Math.random()`, `new Date().toLocaleString()` in render | Hydration mismatch | Compute on server and pass down; or `useId`; or render after mount |
| `<div onClick>` | Not focusable, no keyboard, no role | `<button type="button">` |
| 600-line page component | Untestable, re-renders everything | Extract by responsibility: data hook, sections, sub-components |
| `dangerouslySetInnerHTML` with user content | XSS | DOMPurify, or render as text |
| Catching all errors in one top-level boundary | One widget failure blanks the page | Boundaries per Suspense unit |

## 13. Version notes

**React 18**: automatic batching, `useTransition`, `useDeferredValue`,
`useId`, `useSyncExternalStore`, Suspense for data (via libraries),
streaming SSR (`renderToPipeableStream`). `forwardRef` still needed.

**React 19**: `ref` as a prop, `use()`, actions (`<form action>`,
`useActionState`, `useOptimistic`, `useFormStatus`), `<Context>` as
provider, document metadata hoisting (`<title>`, `<meta>` in components),
stylesheet and script preloading APIs, ref cleanup functions, better
hydration error diffs, `useEffectEvent` (19.1+), React Compiler (opt-in).
`propTypes`, `defaultProps` on functions, string refs and legacy context
are removed.

Check `react` version in `package.json` before using 19-only APIs. In a
React 18 codebase, use `react-hook-form` or the existing form approach
instead of actions, and `forwardRef` for ref passing.
