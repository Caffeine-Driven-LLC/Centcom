# The marketing website (`apps/site`)

Centcom's public site: landing, how it works, pricing, download, docs links, privacy and terms (drafts), 404. Plain HTML and CSS built by Vite into static files. No scripts in the pages, no cookies, no analytics, no fonts or anything else from other sites (a test fails if that changes). It is separate from the user documentation in `docs/site` (VitePress) and from the app screens in `apps/web`.

## Layout

| Path | What it is |
| --- | --- |
| `apps/site/pages/*.html` | One template per page, plus `style.css`. `<!--@include nav-->` and `footer` pull in `partials/`; `<!--@pricing-->`, `<!--@downloads-->`, `<!--@cli-->` are generated; `{{site.name}}` style values come from `config/site.json`. |
| `apps/site/config/pricing.json` | Plans, prices and limits: the only place they are written. |
| `apps/site/config/releases.json` | Download platforms and URLs: the only place they are written. |
| `apps/site/config/site.json` | Operator, repo and docs URLs, domain, contact email, hosted web app address. `null` means to be decided, and the pages say so. |
| `apps/site/src/` | `config.ts` validates the three files; `render.ts` expands a page (used by both Vite and the tests). |
| `apps/site/test/site.test.ts` | Titles, descriptions, one h1, internal links and anchors, no external requests, accessibility basics, config validation. |

Colours are the Graphite/Paper tokens of `packages/theme` (dark by default, light under `prefers-color-scheme: light`), with the design system's hard edges and offset shadows.

## Commands

```sh
pnpm site:dev      # Vite dev server
pnpm site:build    # writes apps/site/dist (git-ignored)
pnpm exec vitest run apps/site
```

## What is real and what is a placeholder

- **Limits** are copied from the backend seed (`Centcom-backend`, `packages/db/migrations/20260102001500_plans_entitlements.sql`, table `plan_limits`). The server is the source of truth: re-check them before launch.
- **Prices are TBD.** No price exists in the plan, the contracts or the backend code, so Pro and Team show "Price to be announced". When one is decided, edit `pricing.json`: `{ "status": "known", "amountMinor": 1900, "currency": "USD" }` (integer minor units, USD or EUR, as in CT-IDS). The page and the validator handle it.
- **Downloads:** every desktop build is "planned" and `version` is `null`. To publish, set `version`, then per platform `status: "available"`, an `https` `url` and a 64-character `sha256`. The validator refuses an available build without them.
- **Privacy and terms** are drafts for a human (ideally a lawyer) to write. Marked DRAFT in the page and title.
- **Domain, contact email and the hosted web app address** are `null` in `site.json`.

## Deploying: static files behind Caddy on the Hetzner box

The backend repository has no Caddyfile yet (its `infra/` holds compose files, observability and runbooks), so this is the pattern to add where the box is configured, not a copy of an existing one.

1. Build and copy the output (on CI or the box): `pnpm site:build`, then `rsync -a --delete apps/site/dist/ deploy@box:/srv/centcom-site/`.
2. Caddy serves that folder and the 404 page:

```caddy
{$SITE_DOMAIN} {
	root * /srv/centcom-site
	encode zstd gzip
	file_server
	handle_errors {
		rewrite * /404.html
		file_server
	}
	header {
		Content-Security-Policy "default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@pages not path /assets/*
	header @pages Cache-Control "no-cache"
}
```

Set `SITE_DOMAIN` once the domain is decided; Caddy gets the certificate by itself. Put the API and relay on their own hostnames (for example `api.` and `relay.`) in the same Caddyfile, so the site's strict policy stays unchanged. Assets are content-hashed by Vite, so long caching is safe; pages revalidate on every visit. The 404 page uses `<base href="/">` so its links work at any depth.

Rolling back is copying the previous `dist/` back. There is no server-side state.

## Before launch (a human decides)

1. The domain, and the contact address in `site.json`.
2. Prices for Pro and Team, and whether the limits in `pricing.json` are final.
3. The privacy policy and terms (and the access-log retention the Caddy box really uses).
4. Real download URLs and checksums once installers are built and signed (lanes C094 and C095).
5. The hosted web app address, once it exists.
