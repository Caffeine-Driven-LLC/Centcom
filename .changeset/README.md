# Changesets

Centcom ships as one product with one version. Every `@centcom/*` package is in a single
`fixed` group in [`config.json`](config.json), so a bump to any of them bumps all of them to the
same version. Versioning policy, channels and the release procedure: [`docs/releasing.md`](../docs/releasing.md).

## When to add a changeset

Add one in the same PR when the change is something a user or another lane can notice:

- a feature, a fix, or a change in behaviour, output, flags, config or wire format;
- a dependency bump that changes what ships;
- anything that should appear in the changelog.

Skip it (or run `pnpm changeset add --empty`) for changes nobody outside the PR can notice:
tests only, CI only, plan cards, docs typos, refactors with no behaviour change.

## How

```sh
pnpm changeset            # pick any package, pick the bump, write one line for the changelog
pnpm changeset status --since=main   # what the next version will be
```

Pick the bump by what users see: `patch` for fixes, `minor` for new things, `major` for anything
that breaks a user, a config file or a stored format. While the product is `0.x`, breaking changes
are `minor`. Which package you pick does not matter for the version (the fixed group moves them
all together); pick the one the change is in so the changelog entry lands in the right place.

Never edit versions in `package.json` by hand; `changeset version` does it at release time.
