# Testing

Every package is tested with Vitest. `@centcom/testkit` holds what the tests share.

## Rules

- **No real network.** The test setup (`packages/testkit/src/vitest/setup.ts`, used by the root `vitest.config.ts`) blocks `net`, `tls` and `dns` for anything but loopback. A blocked call fails with `network access blocked in tests` and names the test. Talk to the mock backend (`startMockBackend()`, see `docs/mock-backend.md`) or a local server on `127.0.0.1`.
- **No console output from library code.** `console.log/info/warn/error` throws during a test. If a test must print, wrap the call in `allowConsole(() => ...)`.
- **Inject time and randomness.** Code takes a `Clock` and an RNG; tests pass `fakeClock(start)` and `seededRng(seed)`. Never call `Date.now()` or `setTimeout` directly in code that tests need to control.
- **No real folders left behind.** Use `tmpDir()` (removed on `dispose()` and at exit) or `memFs()` for code that takes an `FsLike`.
- **60 seconds per lane.** A lane's own tests must finish in about a minute. Tests are not retried (`retry: 0`); a flaky test is a bug.
- **UTC and `en_US.UTF-8`** are set for every test.

## Helpers (`@centcom/testkit`)

| Helper | What it gives you |
|---|---|
| `fakeClock(startMs)` | A `Clock` that moves only on `advance(ms)`; timers fire in due order, ties in creation order |
| `seededRng(seed)` | xoshiro128** in [0, 1); same seed, same numbers |
| `fixedIds(seed)` | A CT-IDS id generator whose output depends only on the seed |
| `tmpDir()` | `{ path, dispose() }` |
| `memFs(seed?)` | An in-memory `FsLike` (read, write, append, mkdir, readdir, stat, rename, rm) |
| `loadContractFixture(path)` | A JSON file from `contracts/fixtures`, path relative to that folder |
| `startMockBackend()` | The mock REST and WebSocket backend (lane C007) |

## Terminal tests

**Ink components**: `renderInk(<Component />, { cols, rows, colorTier })` draws to a fake terminal and returns `frames`, `lastFrame()`, `screen()` (plain rows), `rerender()` and `stdin.write()`. `colorTier` is `'truecolor' | '256' | '16' | 'none'`. Note that a named colour such as `color="green"` is the basic ANSI colour at every tier; use a hex colour to see the tier in the output. `expectScreen(r.screen()).toMatchSnapshot()` compares plain text with a snapshot in `__snapshots__/` next to the test. CI sets `CI=true`, and Vitest then fails on a missing snapshot instead of writing it.

**Whole programs**: `PtyHarness.spawn(cmd, args, { cols, rows })` runs a program on a real pseudo terminal (100x30, `TERM=xterm-256color`, `COLORTERM=truecolor`) with fresh `HOME`, `CENTCOM_CONFIG_DIR` and `CENTCOM_STATE_DIR` folders that are removed when it ends. Then `send(text)`, `press('enter' | 'esc' | 'up' | 'down' | 'left' | 'right' | 'tab' | 'ctrl-c')`, `await waitForText(/regex/, 5000)`, `screen()` (plain rows), `cells()` (character, `fg`/`bg` as `#rrggbb`, bold, dim, italic, underline, inverse), `resize(cols, rows)`, `kill()`. A failed `waitForText` shows the screen with environment values replaced by `[env]`. The terminal comes from Python's standard `pty` module, so there is no native add-on; it works on Linux and macOS, not on Windows.

## Coverage

`defineCentcomConfig(overrides)` (from `@centcom/testkit/vitest`) is the shared preset: node environment, 10 s test and hook timeouts, `pool: 'forks'`, no retries, v8 coverage with an 80 % floor for lines, functions, branches and statements (target 90 %). `vitest run --coverage` exits 1 below the floor. The repository's root config does not enable coverage by default; packages opt in with this preset.

## Snapshots

Snapshots live next to the tests. Review every snapshot change in the pull request; do not update snapshots to make a failing test pass without reading the difference.
