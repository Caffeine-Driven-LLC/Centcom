# Testing UI

The pyramid for UI code (and why it is more of a trophy), what belongs at
each level, Testing Library philosophy and query priority, component test
setup with providers, mocking the network with MSW, Playwright patterns
that survive, visual regression, accessibility assertions, and how to
diagnose a flaky test instead of adding a retry.

## Contents

1. What to test at which level
2. Testing Library philosophy and query priority
3. Component tests: setup, providers, user events
4. Mocking the network with MSW
5. Testing hooks, stores and composables
6. Playwright: patterns that survive
7. Visual regression
8. Accessibility assertions
9. Flaky tests: diagnosis before retries
10. Coverage, speed, and CI
11. Framework specifics
12. Anti-patterns with fixes

## 1. What to test at which level

| Level | Tool | Test | Do not test |
|---|---|---|---|
| Unit (pure functions) | Vitest/Jest | Formatters, validators, reducers, selectors, URL builders, date math | Anything that renders |
| Component / integration | Vitest/Jest + Testing Library (+ MSW) | A component or a page with its children, real state, mocked network: renders states, responds to user events, calls the right requests, shows errors, is accessible by role/name | Implementation details: internal state, hook call counts, CSS classes, child component props |
| End-to-end | Playwright (or Cypress if present) | The 3-10 flows that make money or lose users: sign up, log in, checkout, the core create/edit/delete, search. Against a real build with a real or seeded backend | Every permutation; exhaustive validation rules (component tests do that cheaper) |
| Visual | Playwright screenshots, Storybook + Chromatic/Percy/Loki | Design-system primitives, complex layouts, dark mode, states that are easy to break and hard to assert in DOM | Everything; visual tests are brittle and slow |
| Static | TypeScript, ESLint (incl. a11y plugins), `svelte-check`, `vue-tsc` | Types, lint rules, template type errors | |

Most UI confidence per minute comes from component tests that render a
meaningful slice (a page or a feature), with the network mocked at the
HTTP boundary. They run in milliseconds, are deterministic, and test what
the user experiences without a browser. E2E covers the integration seams
component tests cannot (real routing, real auth, real backend contract).

Deciding for a new component: does it have branches the user can see
(loading/empty/error/success, permission variants, validation)? Component
test each branch. Is it on a critical path? One e2e for the happy path and
one for the main failure. Is it a pure formatting function? Unit test.
Is it a thin wrapper around a library primitive with no logic? Possibly no
test beyond the story and type-check.

## 2. Testing Library philosophy and query priority

"The more your tests resemble the way your software is used, the more
confidence they can give you." Query the DOM the way a user (including an
AT user) finds things, and interact the way a user does.

Query priority (use the first that applies):

1. `getByRole('button', { name: /save/i })` : role + accessible name. Works
   for nearly everything interactive and for headings, regions, tables.
2. `getByLabelText('Email')` : form fields.
3. `getByPlaceholderText` : only if there is truly no label (which is an
   a11y bug; fix the component).
4. `getByText('No orders yet')` : non-interactive content.
5. `getByDisplayValue` : current value of an input.
6. `getByAltText` : images.
7. `getByTitle` : rare.
8. `getByTestId` : escape hatch for things with no semantic handle (a
   chart canvas, a drag handle). Each one is a small admission of
   inaccessibility or a legitimately non-semantic element.

Variants: `getBy` (throws if missing; use for things that must be there),
`queryBy` (null if missing; use to assert absence), `findBy` (async,
waits; use for things that appear after fetch/interaction). `getAllBy`
etc. for multiples.

If `getByRole` cannot find your control, a screen reader user probably
cannot either. Fix the markup, not the test.

## 3. Component tests: setup, providers, user events

A custom `render` that wraps with the providers the app has (query client,
router, i18n, theme) so every test does not repeat it:

```tsx
// test/utils.tsx
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'

export function render(ui: React.ReactElement, { route = '/', ...options }: RenderOptions & { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })  // no retries: errors surface immediately
  const user = userEvent.setup()
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[route]}>{children}</MemoryRouter></QueryClientProvider>
  )
  return { user, queryClient, ...rtlRender(ui, { wrapper: Wrapper, ...options }) }
}
export * from '@testing-library/react'
```

A representative test:

```tsx
import { render, screen, within } from '@/test/utils'
import { server } from '@/test/server'
import { http, HttpResponse } from 'msw'
import { OrdersPage } from './OrdersPage'

describe('OrdersPage', () => {
  it('lists orders and lets the user archive one', async () => {
    const { user } = render(<OrdersPage />)
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()       // loading state is real UI; assert it
    const table = await screen.findByRole('table', { name: /orders/i })
    const rows = within(table).getAllByRole('row').slice(1)                              // skip header
    expect(rows).toHaveLength(3)

    await user.click(within(rows[0]).getByRole('button', { name: /archive order 1001/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'))
    expect(await screen.findByRole('status')).toHaveTextContent(/archived/i)
    expect(within(table).getAllByRole('row')).toHaveLength(3)                            // header + 2
  })

  it('shows an empty state', async () => {
    server.use(http.get('/api/orders', () => HttpResponse.json({ items: [], nextCursor: null })))
    render(<OrdersPage />)
    expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create your first order/i })).toHaveAttribute('href', '/orders/new')
  })

  it('shows an error with retry', async () => {
    server.use(http.get('/api/orders', () => HttpResponse.json({ message: 'boom' }, { status: 500 })))
    const { user } = render(<OrdersPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i)
    server.use(http.get('/api/orders', () => HttpResponse.json({ items: [{ id: '1', status: 'open', total: 10 }], nextCursor: null })))
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
```

Rules: `userEvent` over `fireEvent` (it dispatches the full sequence:
pointerdown, focus, keydown, input, etc.); `await` every user action;
`findBy` for anything after async work; no `act()` by hand (Testing
Library wraps it; a warning means a state update happened after the test
finished, usually a missing `await`); assert what the user sees
(`toBeVisible`, `toHaveAccessibleName`, `toBeDisabled`), not `state`.
Fake timers (`vi.useFakeTimers()`) for debounce/timeouts, with
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

Snapshot tests of whole component trees are low value: they fail on every
change and nobody reads the diff. Inline snapshots of small, stable
outputs (a formatted string, a generated class list) are fine.

## 4. Mocking the network with MSW

Mock at the HTTP layer, not the module layer. Mocking `useOrders` tests
nothing about the data flow; mocking `/api/orders` tests the hook, the
cache config, the parsing, and the component.

```ts
// test/handlers.ts: the default happy-path world
import { http, HttpResponse, delay } from 'msw'
export const handlers = [
  http.get('/api/orders', async ({ request }) => {
    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    await delay(20)                                        // small delay so loading states are observable
    return HttpResponse.json({ items: fixtures.orders.filter(o => !status || o.status === status), nextCursor: null })
  }),
  http.post('/api/orders/:id/archive', ({ params }) => HttpResponse.json({ id: params.id, status: 'archived' })),
]

// test/server.ts
import { setupServer } from 'msw/node'
export const server = setupServer(...handlers)

// vitest.setup.ts
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))   // unknown requests fail the test: catches typos and missing mocks
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Override per test with `server.use(...)` (prepended, resets after each
test). Same handlers run in the browser (`setupWorker`) for Storybook and
local dev without a backend, and in Playwright via `page.route` or MSW's
Playwright integration when you want e2e against mocked APIs.

Assert on requests when the contract matters: capture the body in the
handler and `expect` it, or use `server.events.on('request:start')`.

## 5. Testing hooks, stores and composables

Prefer testing them through a component. When logic is substantial and
reused, test directly:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
const { result } = renderHook(() => useOrders({ status: 'open' }), { wrapper: Providers })
await waitFor(() => expect(result.current.status).toBe('success'))
expect(result.current.data?.items).toHaveLength(2)
```

Zustand: reset the store between tests (`useStore.setState(initial, true)`
in `afterEach`); test actions as functions. Pinia: `setActivePinia(createPinia())`
in `beforeEach`; `createTestingPinia` with stubbed actions for component
tests. Angular services: `TestBed.inject`. Vue composables: wrap in a
throwaway component (`withSetup` helper) or `@vue/test-utils`
`mount`. Svelte runes modules: call `$effect.root` or test via a
component.

## 6. Playwright: patterns that survive

```ts
// e2e/checkout.spec.ts
import { test, expect } from '@playwright/test'
import { loginAs } from './fixtures/auth'

test.describe('checkout', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'buyer@example.com') })

  test('buys a product with a saved card', async ({ page }) => {
    await page.goto('/products/widget-pro')
    await page.getByRole('button', { name: 'Add to cart' }).click()
    await expect(page.getByRole('status')).toHaveText(/added to cart/i)

    await page.getByRole('link', { name: /cart/ }).click()
    await expect(page).toHaveURL(/\/cart/)
    await page.getByRole('button', { name: 'Checkout' }).click()

    await page.getByRole('radio', { name: /visa ending in 4242/i }).check()
    await page.getByRole('button', { name: 'Place order' }).click()

    await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible()
    await expect(page.getByText(/order #\d+/)).toBeVisible()
  })
})
```

Principles:

- Locators by role/label/text (`getByRole`, `getByLabel`, `getByText`),
  `getByTestId` only as a fallback. Playwright locators auto-wait and
  auto-retry; never `waitForTimeout`.
- Web-first assertions (`expect(locator).toBeVisible()`) retry until
  timeout; `expect(await locator.isVisible())` does not. Use the former.
- Isolate: each test creates its own data (API call or seeded fixture) and
  does not depend on another test. Parallel by default.
- Auth once: `storageState` saved in a setup project and reused; do not log
  in through the UI in every test.
- Fixtures (`test.extend`) for page objects or helpers; keep page objects
  thin (locators + a few actions), not a second framework.
- Network: `page.route` to stub third parties (payments, analytics, maps)
  so tests are deterministic; let your own API run for real in e2e.
- Trace on first retry (`trace: 'on-first-retry'`), screenshots and video
  on failure; read the trace viewer before touching the test.
- Run in CI against a production build (`next build && next start`, or a
  preview deploy URL), with `webServer` config in `playwright.config.ts`.
- Mobile viewport project (`devices['Pixel 7']`) for the critical flows.
- Keep e2e count small and fast (< 10 min total). Push breadth down to
  component tests.

## 7. Visual regression

Use for: design-system components (every variant and state in Storybook),
layouts that break silently (sticky headers, grid overflow), dark mode,
RTL. Tools: Playwright `toHaveScreenshot()` (per-OS baselines, threshold
options), Storybook test-runner + Chromatic/Percy/Loki, Argos.

```ts
test('pricing table matches', async ({ page }) => {
  await page.goto('/pricing')
  await page.evaluate(() => document.fonts.ready)             // fonts loaded
  await expect(page).toHaveScreenshot('pricing.png', { fullPage: true, maxDiffPixelRatio: 0.01, animations: 'disabled', mask: [page.getByTestId('live-price')] })
})
```

Stabilize: disable animations, wait for fonts and images, mask dynamic
content (dates, avatars, ads), freeze time (`page.clock`), fixed viewport,
same OS in CI as baselines (run baselines in Docker). Review diffs as a
human step; do not auto-approve.

## 8. Accessibility assertions

Every component test can include `expect(await axe(container)).toHaveNoViolations()`
(jest-axe / vitest-axe); every Playwright page test can run `AxeBuilder`.
Plus explicit assertions for the behaviors axe cannot see: focus
placement after actions (`expect(x).toHaveFocus()` / `toBeFocused()`),
keyboard operation (`user.keyboard('{ArrowDown}')`, `page.keyboard.press`),
`aria-expanded` toggles (`toHaveAttribute('aria-expanded', 'true')`),
live region content. See `accessibility-implementation.md` section 11.

## 9. Flaky tests: diagnosis before retries

A retry hides a bug in the test or the app. Diagnose:

| Symptom | Likely cause | Fix |
|---|---|---|
| Passes alone, fails in the suite | Shared state: store singleton, MSW handler leak, module cache, DB rows | Reset in `afterEach`; `server.resetHandlers()`; isolate data |
| Fails on CI only | Slower machine exposes a race; different timezone/locale; fonts | Use `findBy`/web-first assertions; pin `TZ=UTC` and `LANG`; Docker for visual |
| `Unable to find element` intermittently | Asserting before async render | `findBy`, `await expect(...)` |
| `act(...)` warning | State update after test ends; missing await; timer still running | Await the user action; clear timers; `waitFor` the final state |
| Element "not stable" / click misses | Animation or layout shift during click | `animations: 'disabled'`; wait for the specific state, not time |
| Test order matters | Leaked global (window property, localStorage) | Clear in `beforeEach`; `test.describe.configure({ mode: 'serial' })` only as a last resort |
| Random data | Faker without seed; `Date.now()` | Seed; `vi.setSystemTime` / `page.clock.setFixedTime` |
| Network flake | Real third-party in test | `page.route` stubs; MSW |
| Timeout on `waitForURL` | Redirect chain differs by environment | Assert on content, not URL; or loosen regex |

Only after the cause is found and fixed, consider `retries: 1` in CI as a
safety net for infrastructure blips, and alert on retry counts.

## 10. Coverage, speed, and CI

- Coverage thresholds are a smell detector, not a goal. 100% line coverage
  with no assertions on behavior is worth nothing; 60% with every user
  path covered is fine. Look at *which* files are uncovered.
- Vitest: `pool: 'threads'` or `'forks'`, `isolate: true` by default;
  `test.concurrent` for independent tests; `--changed` locally.
  `environment: 'jsdom'` or `'happy-dom'` (faster, less complete).
  Browser mode (`@vitest/browser`) for tests that need real layout.
- Jest: `--maxWorkers`, `testEnvironment: jsdom`; `transformIgnorePatterns`
  tweaks for ESM deps are the usual setup pain; consider Vitest if the
  repo is on Vite.
- CI: type-check → lint → unit/component (parallel) → build → e2e against
  the build (sharded). Upload Playwright traces as artifacts. Run visual
  only on PRs that touch UI packages if slow.
- Storybook stories double as test fixtures (`composeStories`, the
  `portable stories` API) so one definition serves docs, visual tests and
  interaction tests (`play` functions).

## 11. Framework specifics

- **React**: `@testing-library/react`, `@testing-library/user-event`,
  `@testing-library/jest-dom` matchers. Server components: test via e2e or
  by rendering the async component's output with `await Page({ params })`
  then `render(result)` for pure cases; do not try to unit-test the RSC
  runtime. Next App Router components that use `next/navigation` need
  mocks (`vi.mock('next/navigation')`) or `next-router-mock`.
- **Vue**: `@testing-library/vue` or `@vue/test-utils` (`mount`,
  `wrapper.find`); prefer the former's queries. `flushPromises()` after
  async. Nuxt: `@nuxt/test-utils` with `mountSuspended` and
  `registerEndpoint` for `useFetch`.
- **Svelte**: `@testing-library/svelte` (`render(Component, { props })`);
  Svelte 5 needs `vitest` with `environment: 'jsdom'` and the Svelte
  plugin's test condition. SvelteKit `load` functions and actions are
  plain functions: unit test them with a mocked `event`.
- **Angular**: `TestBed`; `@testing-library/angular` for queries;
  `HttpTestingController` for HTTP (`expectOne`, `flush`); `provideRouter`
  with `RouterTestingHarness` for routed components; Jest via
  `jest-preset-angular` or the new Vitest builder (v20+).
- **Web components**: `@open-wc/testing` (`fixture`, `html`) with Web Test
  Runner, or Vitest browser mode; shadow DOM queries via
  `shadowRoot.querySelector` or Testing Library with `screen` configured
  for shadow (use `@testing-library/dom` + `shadow-dom-testing-library`).

## 12. Anti-patterns with fixes

| Anti-pattern | Fix |
|---|---|
| `getByTestId` everywhere | Role/label queries; fix inaccessible markup |
| `fireEvent.click` | `userEvent.click` |
| `wrapper.instance().state.open` / `component.vm.open` | Assert on rendered output |
| Mocking the hook/module under test | Mock the network (MSW) |
| `jest.mock('@tanstack/react-query')` | Real QueryClient with `retry: false` |
| Snapshot of the whole page | Targeted assertions; inline snapshots for small outputs |
| `await new Promise(r => setTimeout(r, 500))` | `findBy`/`waitFor`/web-first assertions |
| Tests that depend on execution order | Isolate state and data |
| One giant e2e that does everything | Several focused flows; breadth in component tests |
| Logging in through the UI in every e2e | `storageState` |
| `retries: 3` to make it green | Diagnose (section 9) |
| Testing that `useEffect` was called twice | Test behavior, not implementation |
| Skipping loading/empty/error tests | They are states users see; test them |
| No a11y assertion anywhere | `axe` in component and page tests |
| Shared mutable fixtures | Factory functions returning fresh objects |
