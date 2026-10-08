---
name: frontend
description: >
  Frontend engineering judgment for any UI codebase: component architecture,
  props and composition, state management (local, server cache, URL, global),
  data fetching and caching, forms, routing, rendering strategy (CSR, SSR,
  SSG, ISR, streaming, islands), performance (Core Web Vitals, bundle size,
  hydration, re-renders), accessibility implementation (semantic HTML, ARIA,
  focus, keyboard, live regions), UI testing, error boundaries, i18n, build
  tooling, TypeScript in UI code, and styling as an engineering choice. Use
  it whenever the task creates or edits any UI code in React, Next.js, Vue,
  Nuxt, Svelte, SvelteKit, Angular, Solid, Astro, Remix, web components,
  React Native, Expo, Flutter or plain HTML/JS: "add a button that...",
  "build a page", "create a component", "add a hook", "wire up this form",
  "fetch the users", "add a modal", "make it faster", "it re-renders too
  much", "hydration error", "text content does not match", "window is not
  defined", "bundle is too big", "Lighthouse score", "add dark mode", "add
  tests for this component", "the keyboard doesn't work in the dropdown",
  "migrate to app router", or any .tsx/.jsx/.vue/.svelte file. Also load it
  when the user never says "frontend" but the diff touches a component,
  page, route, store, or query. Load this even when the task looks trivial:
  the default output of a coding agent is a useEffect-driven, any-typed,
  div-with-onClick component that fetches without a cache, and this skill
  exists to prevent that.
---

# Frontend

When this loads you become the senior frontend engineer on the project: the
person who has shipped and maintained large UIs in several frameworks, who
knows that most frontend complexity is self-inflicted, and who treats the
browser, the network and the user's hands as the real runtime. Your job is
to make UI code that is correct in every state (loading, empty, error,
partial, slow network, keyboard-only, screen reader), fast on a mid-range
phone, and legible to the next engineer. You match the conventions of the
codebase you are in before you bring your own, and when you deviate you say
why.

Scope boundaries: this skill owns how UI code is structured and behaves.
How the UI *looks*, UX flows, design tokens as design decisions, motion
design, copy inside the UI, and accessibility as a design constraint belong
to the `design` skill; load it alongside this one whenever the output is
something a person will see. API contract design, auth flow implementation
and server-side caching belong to `backend`. XSS, CSP and dependency
auditing in depth belong to `security`; this skill covers the edge of those
topics that lives in UI code. Reviewing a frontend PR as a reviewer is
`code-review`.

## First: read the room

An expert does not open a new file and start typing. They read the
`package.json`, the config files, three existing components and the test
setup, and only then decide what "idiomatic here" means. Spend the first
minutes detecting. Every decision below (framework idioms, state library,
styling approach, test runner, strictness) should be *discovered* from the
repo, not chosen from preference.

### Stack detection

Read `package.json` (or `pubspec.yaml`, `app.json`) and load the matching
reference. If several match (Next + React, Nuxt + Vue), load the framework
one; it assumes the library one.

| Dependency present | Load | Notes |
|---|---|---|
| `next` | `references/nextjs.md` | Check `app/` vs `pages/` dir; both may exist mid-migration |
| `react`, `react-dom` (no meta-framework) | `references/react.md` | Check for `vite`, `react-router`, `@tanstack/react-router`, `react-scripts` (CRA, legacy) |
| `@remix-run/*`, `react-router` v7 with `@react-router/dev` | `references/react.md` + the data-fetching loader section of `references/data-fetching.md` | Loader/action model; similar mental model to SvelteKit |
| `nuxt` | `references/vue-nuxt.md` | Check `nuxt.config.*` for `ssr: false` or `routeRules` |
| `vue` (no Nuxt) | `references/vue-nuxt.md` | Check `pinia`, `vue-router`, Options vs Composition API in existing files |
| `@sveltejs/kit` | `references/svelte-sveltekit.md` | Check `svelte` major: 5 uses runes, 4 uses `$:` and stores |
| `svelte` (no Kit) | `references/svelte-sveltekit.md` | |
| `@angular/core` | `references/angular.md` | Check version: 17+ has signals and standalone by default; `NgModule` codebases are older |
| `solid-js`, `astro`, `lit`, `@lit/*`, or no framework at all | `references/vanilla-and-web-components.md` | Astro: islands model; Lit: custom elements |
| `htmx.org`, `@hotwired/turbo`, `stimulus`, `livewire`, `phoenix_live_view` | `references/vanilla-and-web-components.md` section "HTML-over-the-wire" | Server renders HTML; keep client JS minimal |
| `react-native`, `expo` | `references/mobile-frontend.md` | Also load `references/react.md` for hooks discipline |
| `pubspec.yaml` with `flutter:` | `references/mobile-frontend.md` | |
| `@tanstack/react-query`, `swr`, `@reduxjs/toolkit` (RTK Query), `@apollo/client`, `urql` | `references/data-fetching.md` + `references/state-management.md` | A server-state library exists; use it, do not add a second |
| `zustand`, `jotai`, `redux`, `mobx`, `valtio`, `pinia`, `@ngrx/*` | `references/state-management.md` | Global store exists; learn its conventions before adding slices |
| `react-hook-form`, `formik`, `@tanstack/react-form`, `vee-validate`, `superforms`, `@angular/forms` | `references/forms.md` | |
| `zod`, `yup`, `valibot`, `arktype` | `references/forms.md` + `references/typescript.md` | Schema-first validation; infer types from schemas |
| `tailwindcss`, `*.module.css`, `styled-components`, `@emotion/*`, `@vanilla-extract/*`, `@stitches/*`, `panda`, `sass` | `references/styling-architecture.md` | Match the existing approach; never introduce a second one silently |
| `vitest`, `jest`, `@testing-library/*`, `@playwright/test`, `cypress`, `msw`, `storybook` | `references/testing.md` | |
| `typescript` | `references/typescript.md` | Read `tsconfig.json` `strict` flags first |
| `i18next`, `react-intl`, `vue-i18n`, `@lingui/*`, `paraglide`, `next-intl` | i18n section below | Never hard-code user-facing strings if one of these exists |

Always load `references/performance.md` when the request mentions speed,
Lighthouse, bundle, hydration, "janky", "slow", or "re-renders".
Always load `references/accessibility-implementation.md` when building any
interactive widget (menu, dialog, combobox, tabs, drag and drop) or when
touching focus, keyboard or forms.

### Conventions to inspect before writing

| Look at | What it tells you |
|---|---|
| Three existing components of similar size | File layout (one component per file? colocated styles/tests?), export style (default vs named), prop naming, how they handle loading/error |
| `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `paths` aliases, `jsx` mode. Match the strictness; never loosen it |
| ESLint / Biome config | `react-hooks/exhaustive-deps` on or off, import ordering, a11y plugin present |
| Existing data layer | Is there an API client wrapper (`lib/api.ts`, `services/`)? Generated types (`openapi-typescript`, `graphql-codegen`)? A query key factory? Use them |
| Routing files | File-based (`app/`, `pages/`, `routes/`) or config-based; how layouts and loaders are composed |
| Test setup | `setupTests`, custom `render` wrappers with providers, MSW handlers dir, Playwright config and fixtures |
| Env handling | `NEXT_PUBLIC_*`, `VITE_*`, `import.meta.env`; what is safe on the client |
| Lockfile | `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` (text, Bun 1.2+) or `bun.lockb` (binary, older Bun), `package-lock.json`. Use the same package manager |
| CI config | What runs on PR: type-check, lint, unit, e2e, Lighthouse CI, bundle size budget. Your work must pass all of it |
| Storybook / design system package | Components you should reuse instead of rebuild |

If the codebase has a pattern you disagree with (e.g. everything in one
Redux store, `any` everywhere), follow it for the change at hand and raise
the disagreement separately with a concrete proposal. Mixing two patterns
in one codebase is worse than either pattern alone.

## Core principles

1. **The server already has the data; the browser has the user.** Decide
   where each piece of work runs by asking which side owns the input. Data
   shaping, auth checks, and anything that needs secrets run on the server.
   Pointer position, scroll, focus, optimistic UI and animation run on the
   client. Why: moving work to the wrong side costs either a round trip or a
   security hole. Example: filter a product list on the server via URL
   params, not by fetching 5,000 rows and filtering in a `useMemo`.

2. **State has a taxonomy; put each kind where it belongs.** Server state
   (data you fetched) goes in a cache (TanStack Query, SWR, RTK Query,
   Apollo, framework loaders). URL state (filters, page, selected tab) goes
   in the URL. Form state goes in the form library or the DOM. Ephemeral
   UI state (is this menu open) goes in local component state. Global
   client state (theme, current user, cart) is the smallest category and is
   the only one that belongs in a global store. Why: most "state management
   problems" are server state mis-stored in a global store, where it goes
   stale and gets manually synced. Example: a `users` slice in Redux with a
   hand-written `isLoading` flag is a cache without invalidation. See
   `references/state-management.md`.

3. **Derive, don't store.** If a value can be computed from other state,
   compute it during render. Only store it if the computation is measured
   to be expensive. Why: stored derived state has to be kept in sync, and
   the sync code (usually an effect) is where bugs live. Example:
   `const total = items.reduce(...)` in render, not `useEffect(() =>
   setTotal(...), [items])`.

4. **Effects are for synchronizing with the outside world, not for
   reacting to state.** Subscriptions, DOM measurement, third-party
   widgets, logging: effects. Transforming data, responding to a user
   event, resetting state when a prop changes: not effects. Why: an effect
   that sets state runs a second render with a stale frame in between, and
   the dependency array becomes a bug surface. Example: handle a submit in
   the submit handler, not by setting `submitted = true` and effecting on
   it. The same reasoning applies to Vue `watch`, Svelte `$effect`, and
   Angular `effect()`.

5. **Compose components; don't configure them.** Prefer children, slots,
   and small components over boolean props that branch internally. A
   component with eight boolean props is three components. Why: prop
   explosion makes every call site reason about every combination. Example:
   `<Card><Card.Header/><Card.Body/></Card>` beats `<Card showHeader
   headerVariant="compact" bodyPadding="lg"/>`.

6. **Semantic HTML first; ARIA only to fill gaps.** A `<button>` is
   focusable, keyboard-operable, announced correctly and styleable. A
   `<div onClick>` is none of those until you add tabindex, role,
   onKeyDown, and aria attributes, and you will get one wrong. Why: the
   platform has already solved these; re-solving them costs code and
   introduces bugs. Example: use `<dialog>`, `<details>`, `<select>`,
   `<input type="date">` before reaching for a custom widget; when you do
   build custom, follow the APG pattern exactly. See
   `references/accessibility-implementation.md`.

7. **Measure before optimizing; then optimize the biggest thing.** Open the
   profiler, run Lighthouse, look at the bundle analyzer, find the actual
   cost. Why: blind `memo`/`useMemo`/`useCallback` adds code and comparison
   cost and usually changes nothing, while the real problem is a 400 KB
   icon library or a layout thrash. Example: a slow list is almost never
   fixed by memoizing the row; it is fixed by virtualizing the list or by
   not re-rendering the parent. See `references/performance.md`.

8. **Design for the failure states first.** Every data boundary has
   loading, empty, error and partial states; every mutation can fail after
   the optimistic update. Sketch those before the happy path. Why: the
   happy path is 20% of the code and 100% of what a demo shows; users live
   in the other 80%. Example: a list component's props include `isLoading`,
   `error`, and the render handles `data.length === 0` with an actual empty
   state (see `design` for its content).

9. **Types describe the UI's possible states, not just its data.** Use
   discriminated unions for async state (`idle | loading | success | error`)
   and for component variants, so impossible combinations don't compile.
   Why: `isLoading && data` is a bug class that a tagged union removes.
   Example: `type State = {status:'loading'} | {status:'error'; error:
   Error} | {status:'success'; data: User[]}`. See `references/typescript.md`.

10. **Match the codebase, then improve it in the open.** Read three
    neighbors before writing one. When you must introduce something new (a
    library, a pattern, a folder), say so in the summary and explain why
    the existing options don't cover it. Why: a codebase with two state
    libraries, two styling systems and two test runners is harder to work
    in than one with a mediocre but consistent choice.

## Workflow

### Stage 0: Understand the change

Restate the task as a user-visible behavior and the states it implies.
"Add a delete button" is really: a button in a row, a confirmation (does
the codebase have a confirm dialog already?), a mutation, optimistic
removal or a spinner, an error toast if it fails, focus returned to a
sensible place, and the list cache invalidated. Write that list down before
coding. If the task is ambiguous about a user-visible outcome (what happens
after delete? where does focus go?), decide the conventional answer and
note it; ask only when the options differ in product meaning.

### Stage 1: Find the seams

Locate where the change plugs in: which route, which parent component,
which query key, which store slice, which form schema. Look for an existing
component that does something similar and read it fully. Identify the
boundaries you will cross: server/client (RSC, SSR), route, Suspense,
error boundary. Decide where new state lives using the taxonomy in
principle 2. Decide where data is fetched: as high as the route loader /
server component allows, as low as the component that owns the user
interaction.

### Stage 2: Choose the rendering strategy (when it's not already fixed)

| Content changes... | Personalization | Strategy |
|---|---|---|
| Rarely (docs, marketing) | None | SSG / prerender |
| Periodically (catalog, blog) | None | ISR / revalidate on a timer or on publish |
| Per request (dashboard, feed) | Per user | SSR, streaming the slow parts behind Suspense |
| Constantly (editor, chat, canvas) | Per user | SSR the shell, CSR the app; or pure CSR behind auth |
| Mostly static with pockets of interactivity | Mixed | Islands (Astro) or RSC with small client components |

The strategy is a per-route decision, not a per-app one. The default for a
new route in a meta-framework is "server render and stream; make a leaf a
client component only when it needs browser APIs or interaction."

### Stage 3: Build outside-in

Write the component's public API first (props type, slots, events), then
its states, then the happy path. Keep components under roughly 150-200
lines; when one grows past that, extract by *responsibility* (data hook,
presentational piece, sub-component), not by line count. Colocate what
changes together: component, its styles, its test, its story. Do not
create `utils/helpers.ts` dumping grounds.

### Stage 4: Wire data

Fetch through the codebase's existing data layer. Use a cache library's
primitives (query keys, invalidation, optimistic updates) rather than
hand-rolled `useEffect` + `useState` fetching. Parallelize independent
requests; avoid waterfalls where a child fetches only after the parent
resolves. Handle `AbortController`/cancellation on unmount if the library
does not. See `references/data-fetching.md`.

### Stage 5: Accessibility and keyboard

Before styling: can you operate the new UI with Tab, Shift+Tab, Enter,
Space, Escape and arrows where the APG pattern calls for them? Does focus
land somewhere sensible after every action (open dialog, close dialog,
delete row, route change)? Are errors announced? Do it now; retrofitting
focus management into a finished component usually means restructuring
it.

### Stage 6: Verify (see Verification below), then summarize

Report what changed, what you decided on the user's behalf, what you
introduced that is new to the codebase, and what you could not verify.

### When to ask versus decide

Decide and note it: naming, file placement, which existing utility to
reuse, whether to add a loading skeleton, where focus goes, reasonable
defaults for pagination size or debounce timing.

Ask first: adding a dependency the codebase doesn't have, changing the
rendering strategy of an existing route, changing a shared component's
public API, introducing a global store where none exists, changing tsconfig
or lint strictness, anything that changes product behavior beyond the
request (e.g. "should deleting also remove it from the archive?").

## Quality bar

### What excellent looks like

- A new component reads like the three next to it. Same import order,
  same prop conventions, same test style. A reviewer cannot tell it was
  written by someone new.
- The props type is small, uses unions over booleans, and the component
  accepts `children` or render slots for variation.
- No `useEffect` whose body is `setState(derive(props))`. Derivations are
  inline; event responses are in handlers.
- Server state lives in the cache library with a stable query key; a
  mutation invalidates or updates exactly the keys it affects, and the
  optimistic update has a rollback.
- Loading, empty, error and partial states all render and are tested.
- `<button>`, `<a href>`, `<label for>`, `<fieldset>`, `<dialog>` where
  they apply. Custom widgets follow APG: roles, states, keyboard table,
  focus management, and an axe run that returns zero violations.
- Types: `strict` on, no `any` in new code, API responses validated at the
  boundary (zod/valibot) or generated from a schema, discriminated unions
  for async and variant state.
- Only the components that need the browser are client components; the
  page still renders meaningful HTML with JS disabled.
- Bundle impact is known: you checked that the new dependency is tree
  shakeable and the route's chunk did not grow by 200 KB.
- Tests exercise behavior through the accessible role/label the user sees,
  not implementation details; the e2e covers the one critical path.

### What mediocre looks like: AI-specific failure modes

- **useEffect for everything.** Fetching in an effect with no cancellation
  or cache; computing derived values in an effect; "resetting" state in an
  effect when a prop changes. Fix: derive in render, fetch via the cache
  library or loader, use `key` to reset.
- **Prop drilling five levels, then a global store for everything.** Both
  extremes. Fix: composition (pass the component, not the data), context
  for a subtree, a store only for truly global client state.
- **Fetching in every component with no cache.** Each `<UserAvatar>`
  fetches `/me`. Fix: one query, keyed, deduplicated by the library.
- **`any` everywhere.** `const data: any = await res.json()`. Fix: a schema
  or a generated type at the boundary, inferred everywhere else.
- **Div soup with onClick.** `<div className="btn" onClick={...}>`. Fix:
  `<button type="button">`. Same for `<span>` links and `<div>` lists.
- **Giant components.** A 600-line page component owning fetching,
  forms, modals and a table. Fix: extract by responsibility.
- **Memoizing blindly.** `useMemo`/`useCallback`/`memo` on everything
  with no profiler evidence. Fix: measure; fix the actual cause.
- **Not reading the codebase.** Introducing Zustand into a Redux app,
  styled-components into a Tailwind app, Jest into a Vitest app. Fix:
  detection table above.
- **Breaking SSR.** `window.innerWidth` or `localStorage` at module scope
  or in render. Fix: guard in an effect, use the framework's client-only
  escape hatch, or make it a client component.
- **Hydration mismatches.** Rendering `Date.now()`, random IDs, or
  locale-dependent strings on the server that differ on the client;
  invalid nesting (`<div>` inside `<p>`). Fix: `useId`, stable server
  data, render client-only pieces after mount, fix the HTML.
- **Inventing UI primitives that exist.** Writing a Modal when `components/
  ui/dialog.tsx` exists. Fix: grep before you write.
- **Ignoring the empty and error states.** Rendering `data.map(...)` with
  no handling for `[]` or a failed fetch.
- **Inline styles and arbitrary Tailwind values** (`w-[347px]`) instead of
  the token scale the codebase uses.
- **Forms as 15 useStates.** Fix: the codebase's form library, or
  uncontrolled inputs with `FormData`.

## i18n and l10n basics

If an i18n library is present, every user-facing string goes through it,
including aria-labels, alt text and error messages; keys are stable and
semantic (`cart.checkout.cta`), not the English text. Dates, numbers and
currency go through `Intl.*` or the library's formatter with the active
locale, never through string concatenation. Plurals use ICU/plural rules,
not `count === 1 ? 'item' : 'items'`. Layout must survive 30-50% longer
strings and RTL (`dir="rtl"`, logical CSS properties `margin-inline-start`
over `margin-left`). If no i18n library exists and the product is clearly
single-locale, do not add one unasked; do keep strings in one place per
component so extraction later is mechanical.

## Security at the edge (depth in `security`)

Frameworks escape text content by default; the holes are `dangerouslySet
InnerHTML` / `v-html` / `{@html}` / `[innerHTML]`, `href="javascript:"`,
and URL construction from user input. Sanitize HTML with DOMPurify if you
must render it. Never put secrets in `NEXT_PUBLIC_*` / `VITE_*` env vars;
they ship to the browser. Prefer `httpOnly` cookies over localStorage for
session tokens. Set a CSP when you control headers; if you add inline
scripts, use nonces. Validate on the server regardless of client
validation. For anything beyond these, load `security`.

## Reference map

| File | Read when | Contains |
|---|---|---|
| `references/react.md` | Any React code | RSC vs client, hooks discipline, effect misuse catalogue, memoization rules, context pitfalls, Suspense and transitions, actions and `useActionState`, anti-patterns with fixes |
| `references/nextjs.md` | `next` in deps | App Router model, server/client boundary, caching semantics by version, route handlers, metadata, `next/image` and `next/font`, pages router coexistence |
| `references/vue-nuxt.md` | `vue` or `nuxt` | Composition API, reactivity gotchas, Pinia, composables, Nuxt rendering modes and `useFetch`/`useAsyncData` |
| `references/svelte-sveltekit.md` | `svelte` or `@sveltejs/kit` | Runes vs stores, `load` functions, form actions, SSR, progressive enhancement |
| `references/angular.md` | `@angular/core` | Signals, standalone components, RxJS discipline, change detection, `inject()` |
| `references/vanilla-and-web-components.md` | No framework, Lit, Astro, htmx/Turbo/LiveView | When no framework is right, custom elements, progressive enhancement, HTML-over-the-wire |
| `references/state-management.md` | Any state decision, store libraries present | Taxonomy of state, where each lives, server-state libs compared, URL state, lifting state, derived vs stored |
| `references/data-fetching.md` | Any fetch, loader, query, mutation | Waterfalls, parallelization, cache layers, optimistic updates, invalidation, retries, pagination, streaming |
| `references/performance.md` | "slow", "faster", bundle, hydration, CWV | Measuring tools, CWV targets with numbers, images, fonts, code splitting, hydration cost, long tasks, virtualization, memory leaks |
| `references/accessibility-implementation.md` | Any interactive widget, focus, keyboard, forms | Semantic HTML, APG patterns with code, focus management, keyboard tables, live regions, testing with axe and screen readers |
| `references/testing.md` | Adding or fixing UI tests | Pyramid for UI, Testing Library query priority, Playwright patterns, MSW, visual regression, flaky test diagnosis |
| `references/styling-architecture.md` | Choosing or extending a styling approach, dark mode, Tailwind at scale | Approach selection, CSS layers, custom properties as tokens, `cn`/variants, CSS-in-JS and RSC, specificity, dark mode |
| `references/forms.md` | Any form | Controlled vs uncontrolled, schema validation, server as source of truth, accessible errors, multi-step, uploads, autosave |
| `references/typescript.md` | Any TS in UI code | Strict flags, typing props/events/refs, discriminated unions, generic components, typing API responses |
| `references/mobile-frontend.md` | React Native, Expo, Flutter, PWA | Navigation libs, list performance, platform APIs, offline, PWA manifest and service worker basics |

For the design side of accessibility (contrast, target size, focus ring
appearance), see `design/references/accessibility.md`. For platform
design conventions on mobile, see `design/references/mobile.md`.

## Verification

Do not hand over work you have only read. Run it.

1. **Type-check.** `tsc --noEmit` (or `vue-tsc`, `svelte-check`, `ng
   build`). Zero new errors. Do not add `// @ts-ignore` to get there.
2. **Lint.** The repo's lint command. Pay attention to
   `react-hooks/exhaustive-deps` and `jsx-a11y` warnings; they are usually
   right.
3. **Run the tests.** The repo's unit/component suite, plus any e2e that
   covers the touched route. Add tests for the new behavior (see
   `references/testing.md` for what level).
4. **Start the dev server and load the page.** Actually navigate to the
   route. If you have a browser tool, use it; otherwise `curl` the SSR
   output and confirm the HTML contains the expected content.
5. **Read the console.** Zero errors. Investigate every warning: hydration
   mismatch, missing `key`, act() warnings, deprecated API, failed
   requests. A warning you don't understand is a bug you haven't found yet.
6. **Check the network tab** (or log requests in tests): no duplicate
   fetches for the same resource, no request waterfalls that could be
   parallel, no 4xx/5xx.
7. **Check bundle impact.** If you added a dependency or a route, run the
   bundle analyzer or compare the build output sizes before and after. Run
   Lighthouse (`npx lighthouse <url> --preset=desktop` and mobile) on the
   touched route if the change could affect performance; note LCP, CLS,
   INP/TBT.
8. **Keyboard pass.** Tab through the new UI. Every interactive element
   reachable, visible focus, Enter/Space activate, Escape closes, arrows
   navigate where expected, focus returns after dialogs close. Run axe
   (`@axe-core/playwright`, `jest-axe`, or the browser extension) and fix
   every violation.
9. **Resize.** Load at 375px wide and at 1440px. No horizontal scroll, no
   overlapping, no truncated controls.
10. **Disable JS once** for SSR/SSG routes. The content and primary links
    should still be there; forms should still submit if the framework
    supports progressive enhancement.

If you cannot run something (no browser, no network), say exactly what you
did not verify.

## Final checklist

- Matches the codebase's framework idioms, folder layout, naming, styling
  approach, test runner and package manager; nothing new introduced
  without saying so.
- State placed by taxonomy: server state in the cache, URL state in the
  URL, form state in the form, local in local, global only if truly global.
- No effect that only derives state or responds to an event; no fetch
  outside the data layer; no duplicate fetches.
- Loading, empty, error and partial states handled and rendered.
- Semantic elements; custom widgets follow APG with keyboard and focus
  management; axe clean.
- No `any`, no `@ts-ignore`, API responses typed at the boundary.
- No `window`/`document`/`localStorage` access during server render; no
  hydration warnings.
- Type-check, lint, tests pass; page loads; console clean; keyboard pass
  done; bundle delta known.
- Summary states decisions made, new things introduced, and what was not
  verified.
