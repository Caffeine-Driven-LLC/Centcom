# Next.js

The App Router mental model, where the server/client boundary goes, caching
semantics (which changed materially between 13, 14 and 15), route handlers,
metadata, `next/image` and `next/font`, and how to behave when a `pages/`
directory is still present. Assumes `react.md` for component-level rules.

## Contents

1. Detect the version and router
2. App Router mental model: files are the tree
3. Server/client boundary in practice
4. Data fetching and caching semantics by version
5. Mutations: server actions and revalidation
6. Route handlers
7. Metadata, Open Graph and sitemaps
8. Images and fonts
9. Rendering modes per route
10. Middleware (proxy) and the edge
11. Pages Router: when it is present
12. Common errors and what they mean
13. Project conventions to match

## 1. Detect the version and router

```bash
grep '"next"' package.json          # version
ls app pages src/app src/pages 2>/dev/null
cat next.config.* | head -50
```

- `app/` only: App Router. Follow this file.
- `pages/` only: Pages Router. Section 11.
- Both: mid-migration. New routes go in `app/` unless the user says
  otherwise. Shared components must not import `next/router` (pages) and
  `next/navigation` (app) in the same module.
- Version matters for caching (section 4). `next@15` defaults differ from
  `next@14`.

## 2. App Router mental model: files are the tree

Each folder segment is a route. Special files compose into a nested React
tree:

```
app/
  layout.tsx        root layout: <html>, <body>, providers. Required.
  page.tsx          the route's UI
  loading.tsx       Suspense fallback for this segment and below
  error.tsx         error boundary ('use client' required)
  not-found.tsx     rendered by notFound()
  template.tsx      like layout but remounts on navigation
  route.ts          API handler (cannot coexist with page.tsx in same folder)
  dashboard/
    layout.tsx      nested layout: persists across /dashboard/* navigations
    page.tsx
    [id]/page.tsx   dynamic segment, params.id
    @sidebar/       parallel route slot
    (group)/        route group: organizes without affecting the URL
```

Rendered tree for `/dashboard/42`:
`RootLayout > DashboardLayout > Suspense(loading) > ErrorBoundary(error) > Page`.

Layouts do not re-render on navigation between their children; they keep
state. This is why layouts cannot read `searchParams` and why putting a
data fetch in a layout means it runs once per layout mount, not per page.

`params` and `searchParams` are Promises in Next 15 (`await params`). In 14
they are plain objects. Check the version.

## 3. Server/client boundary in practice

Defaults: everything in `app/` is a server component. Add `'use client'`
only to leaves that need state, effects, event handlers, browser APIs, or
hooks from client libraries.

Decision procedure for a new component:

1. Does it use `useState`, `useEffect`, `onClick`, `useRouter`,
   `usePathname`, `useSearchParams`, a browser API, or a client library
   hook (TanStack Query, react-hook-form, framer-motion)? Client.
2. Otherwise, server. It can `await` data, read env, import server-only
   modules.
3. If it is mostly static with one interactive piece, split: the server
   component renders content and passes serializable props to a small
   client leaf.

Providers (theme, query client, auth context) are client components placed
in the root layout; they accept `children` so pages remain server
components:

```tsx
// app/providers.tsx
'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  // useState so the client is created once per browser session, not per render; a module-level
  // singleton would be shared across requests on the server.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

Things that break the boundary and how to recover:

- Passing a function (not a server action) from server to client: not
  serializable. Pass data and let the client component own the handler, or
  make it a server action.
- Passing a `Date`: serializes fine via RSC protocol (as of 14+), but
  `class` instances, `Map`, `Set` do not. Convert to plain objects.
- Importing a server component into a client file: not allowed. Pass it as
  `children` from a server parent.
- Using `useSearchParams` in a statically rendered page without a Suspense
  boundary: build error. Wrap the component that uses it in `<Suspense>`.
- `cookies()`, `headers()` in a component: makes the route dynamic. Call
  them as deep as possible (and in Next 15 they are async).

## 4. Data fetching and caching semantics by version

Four caches exist. Confusing them is the number one Next.js bug.

| Cache | Where | What | Controlled by |
|---|---|---|---|
| Request memoization | Server, per request | Deduplicates identical `fetch` calls (same URL and options) in one render pass | Automatic for `fetch`; use `React.cache()` for non-fetch functions |
| Data cache | Server, persistent across requests | Stores `fetch` responses | `fetch` options `cache`, `next.revalidate`, `next.tags`; `unstable_cache` / `'use cache'` for non-fetch |
| Full route cache | Server, build/revalidate | The rendered HTML + RSC payload for static routes | Static vs dynamic rendering; `revalidatePath` |
| Router cache | Browser, per session | RSC payload of visited routes for instant back/forward and prefetch | `staleTimes` config; `router.refresh()`; `revalidatePath` from an action |

**Next 13/14 defaults**: `fetch` is cached forever (`force-cache`) unless
the route is dynamic or you pass `cache: 'no-store'` or `revalidate`. Pages
are static unless they use a dynamic function. The router cache kept
dynamic pages for 30 s.

**Next 15 defaults**: `fetch` is *not* cached (`no-store`) by default. GET
route handlers are not cached. Router cache `staleTimes.dynamic` is 0.
Static rendering still happens when no dynamic APIs are used, but you must
opt into data caching explicitly.

Practical rules that work in both:

```ts
// Explicit is better than default. Say what you mean on every fetch.
const res = await fetch(url, { next: { revalidate: 300, tags: ['products'] } })  // cache 5 min, taggable
const res = await fetch(url, { cache: 'no-store' })                              // always fresh
const res = await fetch(url, { cache: 'force-cache' })                           // cache until revalidated by tag/path
```

For non-`fetch` data (ORM, SDK), dedupe within a request with `React.cache`
and cache across requests with `unstable_cache` (14/15) or `'use cache'`
(15 canary / 16 with `cacheComponents`/`dynamicIO`):

```ts
import { cache } from 'react'
import { unstable_cache } from 'next/cache'

export const getUser = cache(async (id: string) => db.user.findUnique({ where: { id } }))  // per-request dedupe

export const getProducts = unstable_cache(
  async (category: string) => db.product.findMany({ where: { category } }),
  ['products-by-category'],
  { revalidate: 300, tags: ['products'] },
)
```

Route segment config (exported constants from `page.tsx`/`layout.tsx`):

```ts
export const dynamic = 'force-dynamic'   // or 'force-static', 'error', 'auto'
export const revalidate = 60             // ISR interval for the whole segment
export const runtime = 'nodejs'          // or 'edge'
```

Fetch in parallel, not in sequence:

```tsx
// Waterfall: product waits, then reviews
const product = await getProduct(id)
const reviews = await getReviews(id)

// Parallel: start both, await together
const [product, reviews] = await Promise.all([getProduct(id), getReviews(id)])

// Streaming: render product now, stream reviews
const product = await getProduct(id)
return (
  <>
    <ProductHeader product={product} />
    <Suspense fallback={<ReviewsSkeleton />}>
      <Reviews promise={getReviews(id)} />   {/* child awaits or uses use() */}
    </Suspense>
  </>
)
```

Preload pattern for data a child will need: call the cached function
early without awaiting, so the request is in flight while the parent
renders.

### Client-side data in the App Router

Use TanStack Query or SWR for data that changes while the page is open
(polling, user-driven refetch, optimistic updates). Hydrate it from the
server to avoid a double fetch:

```tsx
// page.tsx (server)
const queryClient = new QueryClient()
await queryClient.prefetchQuery({ queryKey: ['orders'], queryFn: getOrders })
return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <OrdersTable />          {/* client component using useQuery(['orders']) gets data instantly */}
  </HydrationBoundary>
)
```

## 5. Mutations: server actions and revalidation

Server actions are POST endpoints Next generates. Use them for form
submissions and mutations from client components.

```ts
'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export async function deleteOrder(id: string) {
  const session = await auth()
  if (!session) throw new Error('Unauthorized')          // actions are public; always authorize
  await db.order.delete({ where: { id, userId: session.user.id } })
  revalidateTag('orders')                                 // purge data cache entries tagged 'orders'
  revalidatePath('/orders')                               // purge route cache + router cache for this path
}

export async function createOrder(formData: FormData) {
  const parsed = orderSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }
  const order = await db.order.create({ data: parsed.data })
  redirect(`/orders/${order.id}`)                         // redirect() throws; call it outside try/catch
}
```

Rules: validate and authorize inside the action; `redirect` and
`notFound` throw, so never wrap them in `try/catch`; return serializable
values; after a mutation, revalidate the tag or path or the UI will show
stale data from the cache. For optimistic UI see `react.md` section 8.

## 6. Route handlers

`app/api/.../route.ts` exports HTTP verb functions. Use them for webhooks,
third-party callbacks, endpoints consumed by non-Next clients, and
streaming responses. Do not use them for your own page's data when a
server component or server action does the job with less code.

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const query = z.object({ q: z.string().min(1).max(100), page: z.coerce.number().int().min(1).default(1) })

export async function GET(req: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const results = await search(parsed.data)
  return NextResponse.json(results, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  // validate, authorize, act
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

Dynamic params: `{ params }: { params: Promise<{ id: string }> }` in 15.
Webhook handlers must verify signatures before parsing; read raw body with
`await req.text()`.

## 7. Metadata, Open Graph and sitemaps

Static: export `metadata` from `layout.tsx` or `page.tsx`. Dynamic: export
`generateMetadata`. Both are merged down the tree.

```tsx
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)          // deduped with the page's call by React.cache / fetch memo
  if (!post) return { title: 'Not found' }
  return {
    title: post.title,                       // root layout can define title: { template: '%s | Acme', default: 'Acme' }
    description: post.excerpt,
    openGraph: { title: post.title, images: [{ url: `/api/og?slug=${slug}`, width: 1200, height: 630 }] },
    alternates: { canonical: `/blog/${slug}` },
  }
}
```

File conventions: `app/sitemap.ts`, `app/robots.ts`, `app/opengraph-image.tsx`
(renders with `ImageResponse`), `app/icon.png`, `app/manifest.ts`.

## 8. Images and fonts

`next/image` resizes, serves modern formats, lazy loads, and prevents CLS
by requiring dimensions.

```tsx
import Image from 'next/image'
import hero from '@/public/hero.jpg'          // static import: width/height inferred, blur placeholder available

<Image src={hero} alt="Team working at a whiteboard" priority placeholder="blur" sizes="(max-width: 768px) 100vw, 50vw" />
<Image src={user.avatarUrl} alt="" width={40} height={40} />   // remote: needs images.remotePatterns in next.config
<Image src={cover} alt="..." fill className="object-cover" sizes="33vw" />  // fill: parent must be position: relative with size
```

Rules: `priority` on the LCP image only (usually one per page); `sizes`
whenever the image is not full-width, or the browser will download the
largest candidate; `alt=""` for decorative images; configure
`remotePatterns` for external hosts.

`next/font` self-hosts Google or local fonts, generates `@font-face` with
`size-adjust` fallback metrics (no CLS), and exposes a CSS variable:

```tsx
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export default function RootLayout({ children }) {
  return <html lang="en" className={`${inter.variable} ${mono.variable}`}><body>{children}</body></html>
}
```

Then in CSS: `font-family: var(--font-sans)`. Tailwind: `fontFamily: { sans: ['var(--font-sans)'] }`.

## 9. Rendering modes per route

| Want | Do |
|---|---|
| Static at build (SSG) | No dynamic APIs, no uncached fetch; for dynamic segments export `generateStaticParams` |
| Static with periodic refresh (ISR) | `export const revalidate = N` or `fetch(..., { next: { revalidate: N } })` |
| On-demand refresh | `revalidateTag`/`revalidatePath` from an action or route handler (e.g. CMS webhook) |
| Dynamic per request (SSR) | Read `cookies()`, `headers()`, `searchParams`, or `export const dynamic = 'force-dynamic'` |
| Streaming | `loading.tsx` or `<Suspense>` around slow parts; happens automatically in dynamic routes |
| Partial prerendering (PPR) | Next 15 experimental `experimental.ppr`: static shell + dynamic holes in one route |
| Client-only widget | `'use client'` + `next/dynamic` with `ssr: false`, only when the component truly cannot SSR (canvas libs, window-dependent) |

Check which mode a route got: `next build` prints a legend (○ static,
● SSG, ƒ dynamic). If a route is unexpectedly dynamic, find the dynamic API
call (often a `cookies()` in a shared helper).

## 10. Middleware (proxy) and the edge

`middleware.ts` (renamed `proxy.ts` in Next 16) runs before every matched
request. Use it for redirects, rewrites, locale detection, lightweight
auth gating via cookie presence. Do not do database calls or heavy auth
there; verify sessions in the server component or action. Keep the
`matcher` tight so static assets skip it.

```ts
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
```

Edge runtime has no Node APIs (no `fs`, limited `crypto`, no most ORMs).
Only choose `runtime = 'edge'` when you need global low-latency and your
dependencies support it.

## 11. Pages Router: when it is present

If the codebase is Pages Router only and the task is small, stay in Pages
Router. Idioms:

- `getServerSideProps` (SSR per request), `getStaticProps` +
  `getStaticPaths` (SSG/ISR with `revalidate`), `pages/api/*` handlers.
- Data goes to the page as props; there are no server components. Client
  data via TanStack Query/SWR.
- `next/router` (not `next/navigation`), `_app.tsx` for providers,
  `_document.tsx` for `<html>`.
- `next/head` for metadata (not the `metadata` export).

Mixed repos: `app/` and `pages/` can coexist; a URL can exist in only one.
Shared components that use routing hooks need separate variants or must be
leaf components receiving data as props. Migrate route by route; start
with leaf pages that have no shared layout state.

## 12. Common errors and what they mean

| Error | Cause | Fix |
|---|---|---|
| `You're importing a component that needs useState. It only works in a Client Component` | Hook in a server component | Add `'use client'` to the leaf, or restructure |
| `Hydration failed because the server rendered HTML didn't match the client` | Non-deterministic render, invalid HTML nesting, browser extension, `Date`/locale differences | Compute on server and pass down; `suppressHydrationWarning` only for truly expected diffs (timestamps); fix nesting |
| `window is not defined` / `document is not defined` | Browser API during server render | Move into `useEffect`; `next/dynamic(..., { ssr: false })`; guard with `typeof window !== 'undefined'` inside effect only |
| `Functions cannot be passed directly to Client Components` | Non-action function prop across boundary | Mark `'use server'` or move the handler into the client component |
| `useSearchParams() should be wrapped in a suspense boundary` | Static page reading search params | Wrap in `<Suspense>` |
| `Dynamic server usage: cookies` | `cookies()`/`headers()` in a route meant to be static | Accept dynamic, or move the call to a client component / action |
| `Error: NEXT_REDIRECT` caught in logs | `redirect()` inside try/catch | Move redirect outside try |
| Stale data after mutation | Forgot to revalidate | `revalidateTag`/`revalidatePath` in the action |
| Page is dynamic unexpectedly | A shared util calls `headers()`/`cookies()`, or an uncached fetch in 15 | Trace with the build output; add caching |
| `Text content does not match server-rendered HTML` | Same as hydration failed | Same |
| `Each child in a list should have a unique "key"` | Missing key | Stable id |
| `Image with src ... is missing required "width" property` | Remote image without dimensions | Provide `width`/`height` or `fill` |

## 13. Project conventions to match

- Where do server actions live: `app/.../actions.ts` colocated, or
  `lib/actions/`? Match.
- Is there a `lib/db.ts` or `server/` folder with `import 'server-only'`?
  Put data access there, not in components.
- `src/` vs root: match the existing tree.
- Does the project use `@/` alias? Use it.
- Route groups `(marketing)`, `(app)`: new routes go in the right group.
- Check `next.config.*` for `images.remotePatterns`, `experimental` flags
  (`ppr`, `reactCompiler`, `typedRoutes`), `output: 'standalone'`/`export`
  (static export disables dynamic features entirely).
- With `output: 'export'`, there are no server components at runtime, no
  actions, no route handlers, no ISR. Everything must be static.
