# Contributing to the docs

- The user docs are Markdown in `docs/site/`. Write plainly; use the words of the product (command post, host, fleet, relay, queue).
- **Never edit generated files.** `docs/site/reference/`, `docs/site/guide/privacy-relay.md` and `docs/man/*.1` are made by `pnpm docs:gen` from `apps/cli/src/help/` (commands, flags, topics). Change a flag there, run `pnpm docs:gen`, commit both.
- `pnpm docs:check` fails when a generated file is out of date, a flag is missing from the top-level help, an internal link or anchor is broken, an environment variable is documented but not in the code, or the privacy page drifts from CT-CRYPTO section 6.
- `pnpm docs:dev` and `pnpm docs:build` run VitePress (install it first: it is not a dependency of the client).
- Man pages: `man ./docs/man/centcom.1`.
