# Contributing to the docs

- The user docs are Markdown in `docs/site/`. Write plainly; use the words of the product (command post, host, fleet, relay, queue).
- **Read the code before you document a behaviour, and never document something that does not exist.** A planned feature goes under a heading "Planned" or "Not built yet", as on the install page.
- **Never edit generated files.** `docs/site/reference/` (the command pages, `config.md`, `env.md`, `exit-codes.md`), `docs/site/guide/privacy-relay.md`, `docs/configuration.md` and `docs/man/*.1` are made by `pnpm docs:gen` from `apps/cli/src/help/` (commands, flags, topics) and the settings schema. Change a flag or a setting there, run `pnpm docs:gen`, commit both.
- A new guide page must be added to the sidebar in `docs/site/.vitepress/config.ts` (the check finds orphans).
- `pnpm docs:check` fails when a generated file is out of date, a flag is missing from the top-level help, an internal link or anchor is broken, an environment variable is documented but not in the code, the privacy page drifts from CT-CRYPTO section 6, a page is not in the sidebar, or the spell check finds something.
- **Spell check.** `tools/docs/spell-list.txt` is a list of known misspellings (`wrong->right`); add a line when a typo gets through. The same check refuses phrases the contracts do not support ("zero-knowledge", "military-grade", "100% secure") and strings that look like real keys or ids. Code, inline code and link targets are not checked.
- `pnpm docs:dev` and `pnpm docs:build` run VitePress.
- Man pages: `man ./docs/man/centcom.1`. `mandoc -Tlint` runs over them in the tests where `mandoc` is installed; elsewhere a structure test runs.
