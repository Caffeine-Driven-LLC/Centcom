# The Centcom app screens (apps/web)

The screens of the desktop app (`apps/desktop` runs them in Electron; `pnpm web:dev` shows them in a browser tab): React 19, TanStack Router, the Cento theme in dark and light, shared accessible primitives and the app frame. `pnpm web:dev` runs it (set `VITE_API_BASE` to the mock backend) and `pnpm web:build` builds it into `apps/web/dist/`.

- **Areas plug in by file:** `src/<area>/routes.tsx` exports `routeModule: RouteModule` (`{routes, nav?}`) with routes hung on `rootRoute` from `src/app/root.tsx`. Nothing in `src/app/` names an area (`import.meta.glob`).
- **Primitives** (`src/ui`): Button, Input, Card, Chip, Tabs, Banner, Toast (`useToast`), Modal, Table, Avatar, PresenceDot, Skeleton, Tooltip, EmptyState, PixelIcon, VisuallyHidden, LiveRegion. Semantic tokens only; raw hex fails `csp.test.ts`.
- **Theme:** `useTheme()` switches `data-theme` at once; the choice is the only thing kept in localStorage (try/catch).
- **Security:** the CSP is the same string in `index.html` and `public/_headers` (`csp.test.ts`); no inline script or style.
- **Settings:** `VITE_API_BASE` (default https://api.centcom.dev), `VITE_RELAY_BASE` (default wss://relay.centcom.dev), checked with zod; a bad value falls back and is reported.

Not done: Silkscreen (the pixel font) is not bundled, no Tailwind (plain CSS over the generated variables), no axe run (no browser here; the primitives are tested for roles, labels and keyboard in jsdom), no Lighthouse run, no size-limit in CI (the budget is a test over the built files), the status poll uses the generated HTTP client's `getStatus`.

## Accessibility and language (C092)

- **Words** come from `src/i18n/en.json` through `t('key')`; a key used in code but missing from it fails `pnpm --filter @centcom/web i18n:check`. `bootLocale()` picks the language at start (saved choice, then the browser, then English). `en-XA` is the pseudo-language that makes every string about 30 % longer.
- **Raw words in markup:** `apps/web/scripts/jsx-text.ts` counts text written straight into JSX (and `aria-label`, `title`, `placeholder`, `alt`). `i18n.jsx-text.test.ts` lets no file get more than `test/a11y-i18n/jsx-text.baseline.json` says, and a new file none. After moving text into `en.json`, run `pnpm exec tsx apps/web/scripts/jsx-text.ts --write` to lower the baseline. (ESLint is not part of this repository, so the rule is a test.)
- **Helpers:** `src/a11y` has the live region, focus trap and focus return, skip link, reduced-motion hook, the shortcut registry with the `?` list and remapping, and the structural check used by tests.
- **Manual pass before a release** (DESIGN.md 16.4): keyboard only from the address bar to the end of each screen; 200 % zoom with no clipped text; forced-colours mode (Windows High Contrast, or `forced-colors: active` emulation in the browser tools); a screen reader pass (NVDA and VoiceOver) of the session page, the roster and the approval card; reduced motion on, with nothing moving; colour-blind simulation (all three kinds) on the fleet board and the roster colours.
- **Not done:** axe-core is not used (its licence, MPL-2.0, is not one this repository accepts), so tests use the structural check; no eslint-plugin-jsx-a11y; no browser run of forced colours.

