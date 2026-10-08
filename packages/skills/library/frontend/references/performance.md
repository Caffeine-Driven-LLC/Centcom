# Performance

Measure first, then fix the biggest thing. Core Web Vitals targets with
numbers, the tools and what each tells you, images, fonts, code splitting,
hydration cost, long tasks and INP, re-render discipline, virtualization,
and memory leaks in long-lived SPAs. Nothing here applies until you have a
measurement that says it does.

## Contents

1. Measure first: the toolbox
2. Core Web Vitals: targets and what moves them
3. Bundle size and code splitting
4. Images
5. Fonts
6. Hydration cost and shipping less JS
7. Long tasks, INP and the main thread
8. Re-render discipline (framework-level)
9. Virtualization
10. Network: priorities, preloading, caching
11. Memory leaks in SPAs
12. Budgets and CI
13. Triage table: symptom → likely cause → fix

## 1. Measure first: the toolbox

| Tool | Answers | How |
|---|---|---|
| Lighthouse (DevTools, `npx lighthouse URL --preset=desktop`, and mobile default) | Lab CWV, opportunities list, unused JS/CSS, image sizing | Run on production build, throttled mobile. Twice; take the second |
| WebPageTest | Filmstrip, waterfall with priorities, TTFB breakdown, real devices | Use when Lighthouse says "slow" and you need to see *what* loaded when |
| Chrome DevTools Performance panel | Long tasks, layout thrash, scripting vs rendering, INP attribution | Record an interaction; look at the flame chart for >50 ms blocks |
| Chrome User Experience Report / PageSpeed Insights field data | Real users' CWV (what Google ranks on) | Lab numbers are not field numbers; check both |
| `web-vitals` library | Field CWV in your own analytics | `onLCP`, `onINP`, `onCLS` with attribution build |
| React DevTools Profiler / Vue Devtools / Angular DevTools profiler | Which components rendered, why, how long | Record an interaction; "why did this render" |
| Bundle analyzers (`@next/bundle-analyzer`, `rollup-plugin-visualizer`, `vite-bundle-visualizer`, `source-map-explorer`, `webpack-bundle-analyzer`) | What is in each chunk, duplicate deps, the 400 KB surprise | Run on every dependency addition |
| `bundlephobia.com` / `pkg-size.dev` | Cost of a dependency before adding it | Check tree-shakeability and ESM |
| Coverage tab (DevTools) | Unused JS/CSS on this page | Red bars are code splitting candidates |
| Network panel with throttling (Fast 3G, 4x CPU) | Waterfalls, priorities, duplicate requests, large payloads | Sort by start time and by size |
| Memory panel: heap snapshots, allocation timeline | Leaks | Snapshot, act, snapshot, compare retained objects |

Rule: before changing code, write down the metric, the current number, and
the target. After changing, re-measure the same way. Performance work
without numbers is superstition.

## 2. Core Web Vitals: targets and what moves them

Google's thresholds at the 75th percentile of page loads:

| Metric | Good | Needs improvement | Poor | Measures |
|---|---|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.5 s | 2.5-4 s | > 4 s | When the biggest visible element rendered |
| INP (Interaction to Next Paint) | ≤ 200 ms | 200-500 ms | > 500 ms | Worst interaction latency (replaced FID in 2024) |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | 0.1-0.25 | > 0.25 | Unexpected movement |

Supporting metrics: TTFB ≤ 800 ms (server/CDN; everything else waits on
it), FCP ≤ 1.8 s, TBT (lab proxy for INP) ≤ 200 ms, Speed Index.

**LCP** decomposes into TTFB + resource load delay + resource load time +
render delay. The LCP element is usually a hero image or a heading.
Fixes: faster TTFB (cache, CDN, streaming); the LCP image discoverable in
the HTML (`<img>` not CSS background, no lazy-loading on it,
`fetchpriority="high"`, `<link rel="preload">` if injected by JS); image
sized and compressed (section 4); fonts not blocking text (section 5); no
render-blocking scripts in `<head>`; critical CSS inline when the
stylesheet is large.

**INP** is driven by long tasks on the main thread when the user
interacts: a click that triggers a 300 ms render, a keypress that filters
10k rows synchronously, a hydration that is still running. Fixes in
section 7.

**CLS** comes from content without reserved space: images without
dimensions, ads/embeds, fonts swapping with different metrics, content
injected above the fold (banners, "cookie" bars), skeletons sized
differently from the content. Fixes: `width`/`height` or `aspect-ratio` on
media, `min-height` on dynamic regions, `font-display` with size-adjusted
fallbacks, insert new content below the viewport or in response to user
action, `transform` animations instead of layout properties.

## 3. Bundle size and code splitting

Rough budgets for a content or commerce page on mobile: ≤ 200 KB of
compressed JS on the critical path, ≤ 100 KB CSS, total page weight under
1.5 MB. Apps behind login can spend more but INP still suffers from
parse/compile time (about 1 ms per KB of JS on a mid-range Android).

Find the fat:

```bash
# Next
ANALYZE=true next build          # with @next/bundle-analyzer configured
# Vite
npx vite-bundle-visualizer
# Any build with source maps
npx source-map-explorer dist/assets/*.js
```

Usual suspects and fixes:

| Found | Fix |
|---|---|
| `moment` (300 KB with locales) | `date-fns`, `dayjs`, or `Intl.DateTimeFormat` |
| Whole `lodash` | `lodash-es` named imports, or write the 5 lines |
| Full icon library (`react-icons/*` barrel, `@mui/icons-material` default import) | Import individual icons; `lucide-react` tree-shakes well; an SVG sprite |
| Chart library on every page | Dynamic import on the page that charts |
| Markdown/syntax highlighter/editor | Dynamic import; or render on the server |
| Polyfills for browsers you don't support | Check `browserslist`; drop `core-js` full |
| Two versions of the same lib | `npm ls <pkg>`; dedupe or align versions |
| Locale data for 100 languages | Load the active locale only |
| Source maps shipped to production | Build config |

Code splitting levels:

1. **Route-level** (automatic in Next, Nuxt, SvelteKit, Remix; manual
   `lazy(() => import())` in React Router / Vue Router `() => import()` /
   Angular `loadComponent`). The baseline.
2. **Component-level** for heavy, below-the-fold or on-interaction UI:
   `next/dynamic`, `React.lazy` + `Suspense`, `defineAsyncComponent`,
   Angular `@defer`, Svelte `{#await import()}`.
3. **Library-level**: import the heavy dependency inside the event handler
   that needs it (`const { default: confetti } = await import('canvas-confetti')`).

Do not split so finely that a page makes 40 chunk requests; HTTP/2 helps
but each chunk has overhead and the waterfall of chunk → chunk kills
you. Preload the chunks a route will need (`modulepreload`, framework
`<Link prefetch>`).

Check `sideEffects: false` and ESM output for libraries you publish;
check `"module"`/`"exports"` fields for libraries you consume (CJS-only
libraries do not tree-shake).

## 4. Images

The largest bytes on most pages, and usually the LCP element.

- Format: AVIF > WebP > JPEG for photos; SVG for icons/logos; PNG only for
  screenshots needing lossless. Let the framework (`next/image`, Nuxt
  Image, Astro `<Image>`) or an image CDN (Cloudinary, imgix, Cloudflare)
  negotiate formats. For plain HTML, `<picture>` with `<source type="image/avif">`.
- Responsive: `srcset` with width descriptors and an accurate `sizes`
  attribute. A wrong `sizes` (defaulting to `100vw`) makes the browser
  download the largest candidate for a 300 px thumbnail.
- Dimensions: always `width` and `height` (or CSS `aspect-ratio`) to
  reserve space.
- Loading: `loading="lazy"` for below-the-fold; never on the LCP image;
  `fetchpriority="high"` on the LCP image; `decoding="async"` elsewhere.
- Compression: quality 70-80 for photos is visually lossless at typical
  display densities; a 1200 px wide hero should be well under 150 KB in
  WebP/AVIF.
- Placeholders: blur-up (LQIP) or a solid color from the image's dominant
  tone; sized identically to prevent CLS.
- `background-image` for the LCP element is a mistake: the browser cannot
  discover it until CSS parses. Use `<img>` and `object-fit`.

```html
<img src="/hero-1200.avif" srcset="/hero-600.avif 600w, /hero-1200.avif 1200w, /hero-1800.avif 1800w"
     sizes="(max-width: 768px) 100vw, 60vw" width="1200" height="675" alt="..." fetchpriority="high" decoding="async">
```

## 5. Fonts

Web fonts cause invisible text (FOIT), layout shift (FOUT), and delay LCP
if the LCP element is text.

- Self-host; third-party font CSS adds a connection and a redirect.
- WOFF2 only. Subset to the scripts you use (`pyftsubset`, `glyphhanger`,
  or the framework's `subsets` option). A Latin subset of a variable font
  is 30-100 KB; the full file can be 1 MB+.
- Variable fonts replace 4-6 static weights with one file.
- `font-display: swap` (text visible immediately in fallback, swaps when
  loaded) or `optional` (use the web font only if cached/fast; zero CLS,
  may show fallback on first visit). `block` is almost never right.
- Fallback metrics: `size-adjust`, `ascent-override`, `descent-override`,
  `line-gap-override` on a local fallback `@font-face` so the swap does
  not shift layout. `next/font` and Fontaine/Capsize generate these;
  do it by hand otherwise.
- `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the
  one or two fonts above the fold; preloading six fonts delays everything
  else.
- Keep the number of families and weights small; the design skill decides
  which, you make sure the choice costs under ~150 KB total.

```css
@font-face { font-family: 'Inter'; src: url('/fonts/inter-var-latin.woff2') format('woff2'); font-weight: 100 900; font-display: swap; }
@font-face { font-family: 'Inter Fallback'; src: local('Arial'); size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%; }
:root { --font-sans: 'Inter', 'Inter Fallback', system-ui, sans-serif; }
```

## 6. Hydration cost and shipping less JS

Hydration is the client re-running component code over server-rendered
HTML to attach listeners and state. It costs parse + compile + execute of
every component's JS, and the page is non-interactive (or inconsistent)
until it finishes. On a mid-range phone, hydrating a 300 KB React app
takes 1-3 s and shows up as poor INP for early clicks.

Reduce it:

- Ship fewer client components. In RSC frameworks, keep `'use client'` at
  leaves. In Astro, make things `.astro` components unless they need
  state. In Nuxt, server components / `<ClientOnly>` with lazy.
- Lazy hydration: Astro `client:visible`/`client:idle`, Nuxt `Lazy*` +
  `hydrate-on-visible` (3.16+), Angular `@defer (on viewport)`, React
  `lazy` + `Suspense` for below-fold islands. Hydrate above the fold now,
  the rest when it matters.
- Selective/streaming hydration (React 18+ with Suspense): boundaries
  hydrate independently and the one the user clicks gets priority.
- Avoid hydration mismatches: each mismatch forces a client re-render of
  the subtree (React 18 falls back to client render for the whole root in
  bad cases). Sources: `Date`/locale/random in render, `typeof window`
  branches, invalid HTML nesting, third-party scripts mutating the DOM
  before hydration, browser extensions.
- Measure: Performance panel, look for the long task(s) right after
  scripts load, often labeled with the framework's hydrate function.
- Resumability (Qwik) and islands (Astro, Fresh) exist precisely because
  hydration does not scale with page size; if a content-heavy site has
  hydration as its bottleneck, that is an architecture conversation, not a
  memo() one.

## 7. Long tasks, INP and the main thread

A long task is > 50 ms on the main thread. INP is bad when an interaction
queues behind one or causes one.

Find them: Performance panel, record, look for red-flagged tasks; the
"Interactions" track shows input delay, processing, and presentation
delay. `web-vitals` attribution tells you the script responsible in the
field.

Fixes by cause:

| Cause | Fix |
|---|---|
| Expensive synchronous work in an event handler (filtering, sorting, formatting thousands of items) | Move to a Web Worker (Comlink helps); or chunk with `scheduler.yield()` / `setTimeout(0)`; or make the result lazy/virtualized |
| Rendering a huge subtree on a click | `startTransition` (React) so the input stays responsive; virtualization; split the update |
| Typing lag in a filtered list | `useDeferredValue` on the filter; debounce the expensive part, not the input |
| Layout thrash (read `offsetHeight`, write style, repeat) | Batch reads then writes; `requestAnimationFrame`; CSS instead of JS measurement |
| Third-party scripts (analytics, tag managers, chat) | Load after interaction/idle; Partytown; audit what the tag manager injects |
| Hydration blocking an early click | Section 6 |
| Giant JSON parse of initial data | Smaller payload; stream; `pick` fields |
| Animations on `top`/`left`/`width` | `transform`/`opacity`; `will-change` sparingly; `content-visibility: auto` for off-screen sections |
| Many `IntersectionObserver`/`ResizeObserver` callbacks doing work | Debounce; do the minimum in the callback |

Presentation delay (the time after your handler before the frame paints)
is often large DOM: thousands of nodes or expensive CSS (deep selectors,
large box shadows, filters). `content-visibility: auto` and `contain:
content` let the browser skip off-screen rendering.

## 8. Re-render discipline (framework-level)

Only after the profiler says a component renders too often *and* the
render is expensive. Then, in order:

1. Move state down to the component that uses it.
2. Pass children/slots so the expensive subtree is not re-created.
3. Subscribe narrowly (store selectors, `select` in queries, split
   contexts).
4. Virtualize the list (section 9).
5. Memoize the specific expensive component or computation (`memo`,
   `useMemo`, `v-memo`, `$derived`, `computed`), with a comment saying
   what the profiler showed.

The React Compiler removes most of step 5 in React 19 codebases that
follow the rules of React. Vue, Svelte, Solid and Angular signals already
update at fine granularity; "too many re-renders" in those usually means a
`deep` watcher, a store that is one giant object, or template functions
doing heavy work.

## 9. Virtualization

Rendering 5,000 DOM rows costs memory, layout, and INP on every
interaction regardless of framework. Render only what is visible plus an
overscan.

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
function Table({ rows }: { rows: Row[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 8 })
  return (
    <div ref={parentRef} style={{ height: 600, overflow: 'auto' }} role="grid" aria-rowcount={rows.length}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map(item => (
          <div key={rows[item.index].id} role="row" aria-rowindex={item.index + 1}
               style={{ position: 'absolute', top: 0, transform: `translateY(${item.start}px)`, height: item.size, width: '100%' }}>
            <RowView row={rows[item.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

Equivalents: `@tanstack/vue-virtual`, `@tanstack/svelte-virtual`, Angular
CDK `cdk-virtual-scroll-viewport`, `vue-virtual-scroller`, React Native
`FlatList`/FlashList (see `mobile-frontend.md`). Costs: find-in-page
breaks for off-screen rows, screen readers lose the row count unless you
set `aria-rowcount`/`aria-rowindex`, dynamic row heights need `measureElement`.
Below ~200 rows, don't bother; use pagination or `content-visibility: auto`.

## 10. Network: priorities, preloading, caching

- `<link rel="preconnect">` to the 1-2 origins you will definitely use
  (API, image CDN); `dns-prefetch` for the rest.
- `<link rel="preload">` only for late-discovered critical resources
  (fonts, LCP image injected by JS, critical CSS chunk). Preloading
  everything deprioritizes everything.
- `<link rel="modulepreload">` for the JS chunks the route needs
  (frameworks emit these).
- `fetchpriority="high"` on the LCP image; `low` on below-fold images and
  non-critical fetches.
- Prefetch the next likely route on hover/viewport (framework `<Link>`).
- Static assets: content-hashed filenames + `Cache-Control: public,
  max-age=31536000, immutable`. HTML: `no-cache` (revalidate) or short
  `s-maxage` at the CDN.
- Compression: Brotli for text (CDN usually does it); check the response
  headers show `content-encoding: br`.
- HTTP/2 or 3; avoid domain sharding; inline tiny critical CSS rather than
  a separate request.
- API payloads: paginate, select fields, avoid sending what the UI does
  not render. A 2 MB JSON response is a performance bug on both ends.

## 11. Memory leaks in SPAs

A SPA that runs for hours accumulates whatever you forgot to clean up.
Symptoms: tab gets slower over a session, heap grows across navigations,
"detached DOM nodes" in heap snapshots.

Causes and fixes:

| Leak | Fix |
|---|---|
| Event listeners on `window`/`document` added in mount and never removed | Return cleanup; `AbortController` signal on `addEventListener` |
| `setInterval`/`setTimeout` not cleared | Clear in cleanup; `useEffect` return |
| Subscriptions (store, websocket, RxJS, EventSource) not unsubscribed | Cleanup / `takeUntilDestroyed` / `onScopeDispose` |
| Observers (`IntersectionObserver`, `ResizeObserver`, `MutationObserver`) not disconnected | `disconnect()` in cleanup |
| Third-party widget instances (maps, charts, editors) not destroyed | Call its `destroy()` in cleanup |
| Caches that only grow (a `Map` keyed by id, an unbounded query cache with `gcTime: Infinity`) | Bound them (LRU), set `gcTime` |
| Closures capturing large objects in long-lived callbacks | Store ids, not objects; null out refs on unmount |
| Detached DOM kept by a ref or a global | Null refs in cleanup; avoid module-level element references |
| Infinite scroll keeping every page in memory | `maxPages`; virtualization |

Verify: Memory panel, take heap snapshot, navigate away and back three
times, snapshot again, compare; "Objects allocated between snapshot 1 and
2" filtered by your component names or `Detached`.

## 12. Budgets and CI

Make performance a test, not an opinion.

- `size-limit` or `bundlesize` in CI with per-chunk budgets; fail the PR
  when the main chunk grows more than N KB.
- Lighthouse CI (`@lhci/cli`) with assertions on LCP/TBT/CLS for key
  routes against a preview deploy. Budgets in `budget.json`
  (`resourceSizes`, `resourceCounts`).
- `web-vitals` reporting to analytics, segmented by route and device, so
  regressions show up in field data within a day.
- Next: `experimental.bundlePagesRouterDependencies`, `optimizePackageImports`
  for barrel-heavy libs. Vite: `build.rollupOptions.output.manualChunks`
  only when the analyzer shows a reason.

## 13. Triage table

| Symptom | Likely cause | First check | Fix |
|---|---|---|---|
| LCP > 2.5 s, TTFB fine | LCP image lazy-loaded, unsized, or CSS background; render-blocking resources | Lighthouse LCP element + request chain | `<img fetchpriority="high">`, preload, defer scripts |
| LCP bad, TTFB > 800 ms | Server/DB slow, no CDN, cold serverless | WebPageTest first byte | Cache/stream (with `backend`) |
| INP > 200 ms on clicks | Long task in handler or hydration | Performance panel interactions track | Section 7 |
| Typing lags | Synchronous filtering/re-render of large list | React Profiler on keypress | `useDeferredValue`/debounce + virtualization |
| CLS > 0.1 | Unsized images, font swap, injected banners | Layout Shift Regions overlay in DevTools | Dimensions, fallback metrics, reserve space |
| Bundle grew 300 KB | New dependency not tree-shaken; barrel import | Bundle analyzer diff | Named imports, dynamic import, lighter lib |
| Slow after navigating around for a while | Leak | Heap snapshots | Section 11 |
| Spinner on every back navigation | `staleTime: 0`, no cache | Network panel | Set `staleTime`; `keepPreviousData` |
| Page janky while scrolling | Scroll handlers, expensive CSS, images decoding | Performance panel during scroll | `IntersectionObserver`, `content-visibility`, `decoding="async"` |
| "Too many re-renders" | Parent state change re-renders heavy children | Profiler "why did this render" | Move state down, children pattern, selectors |
| Dev is fast, prod is slow | Different data volume; CDN misconfig | Test prod build with prod-like data | Budgets in CI |
