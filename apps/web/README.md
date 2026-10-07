# The Centcom app screens (apps/web)

The screens of the desktop app (`apps/desktop` runs them in Electron; `pnpm web:dev` shows them in a browser tab): React 19, TanStack Router, the Cento theme in dark and light, shared accessible primitives and the app frame. `pnpm web:dev` runs it (set `VITE_API_BASE` to the mock backend) and `pnpm web:build` builds it into `apps/web/dist/`.

- **Areas plug in by file:** `src/<area>/routes.tsx` exports `routeModule: RouteModule` (`{routes, nav?}`) with routes hung on `rootRoute` from `src/app/root.tsx`. Nothing in `src/app/` names an area (`import.meta.glob`).
- **Primitives** (`src/ui`): Button, Input, Card, Chip, Tabs, Banner, Toast (`useToast`), Modal, Table, Avatar, PresenceDot, Skeleton, Tooltip, EmptyState, PixelIcon, VisuallyHidden, LiveRegion. Semantic tokens only; raw hex fails `csp.test.ts`.
- **Theme:** `useTheme()` switches `data-theme` at once; the choice is the only thing kept in localStorage (try/catch).
- **Security:** the CSP is the same string in `index.html` and `public/_headers` (`csp.test.ts`); no inline script or style.
- **Settings:** `VITE_API_BASE` (default https://api.centcom.dev), `VITE_RELAY_BASE` (default wss://relay.centcom.dev), checked with zod; a bad value falls back and is reported.

Not done: Silkscreen (the pixel font) is not bundled, no Tailwind (plain CSS over the generated variables), no axe run (no browser here; the primitives are tested for roles, labels and keyboard in jsdom), no Lighthouse run, no size-limit in CI (the budget is a test over the built files), the status poll uses the generated HTTP client's `getStatus`.
