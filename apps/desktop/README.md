# Centcom desktop app

An Electron window around the app in `apps/web`. The screens are served from the app's own `app://centcom` address with the same Content-Security-Policy as the hosted pages, the window has no Node in the page (sandbox, context isolation), new windows and outside links go to the system browser (https only), and the only permission the page can get is notifications.

- `pnpm app:smoke` loads the page without showing a window and prints what it found (address, title, that the bridge is there, that the screen drew, that the page has no Node); it needs Electron's binary.
- `pnpm app` builds the screens (`apps/web/dist`) and the main process (`apps/desktop/dist`), then starts Electron. `pnpm app:dev` skips the screens build.
- Links: the app registers `centcom://`. A join, invite, share, session or billing link opens its screen; the sign-in callback finishes sign-in (the system browser handles the sign-in page itself). Only one copy of the app runs; a second launch passes its link to the first.
- Electron's binary is downloaded by its install script, which the repository's install policy does not run. Once: `pnpm approve-builds` (choose electron) and `pnpm install`, or `node node_modules/electron/install.js`.
- Not here yet: packaged installers, signing and auto-update (lanes C094 and C095), and running agents in the app's main process (the terminal app does that today).

Development aids (environment variables, ignored otherwise): `CENTCOM_SHOT=<file.png>` loads the app, waits `CENTCOM_SHOT_MS` (default 2500), saves a screenshot of the window and quits; `CENTCOM_SHOT_ROUTE=/path` opens a route first; `CENTCOM_SHOT_SCRIPT=<js>` runs a script in the page first; the page console and the local-session messages are printed. `pnpm app:mock` runs the app with the mock Codex (`tools/codex`).
