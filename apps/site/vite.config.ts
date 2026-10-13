/** Builds the marketing site into apps/site/dist: one HTML file per page in pages/, expanded by src/render.ts (shared header and footer, plans from config/pricing.json, downloads from config/releases.json). */
import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { renderPage } from './src/render.js';

const pagesDir = resolve(__dirname, 'pages');
const names = readdirSync(pagesDir).filter((f) => f.endsWith('.html'));

/** Expands the includes and generated blocks before Vite looks at the page, so Vite hashes the CSS and copies the public files. */
const expand = (): Plugin => ({
  name: 'centcom-site-expand',
  transformIndexHtml: { order: 'pre', handler: (_html, ctx) => renderPage(basename(ctx.filename)) },
});

export default defineConfig({
  root: pagesDir, base: './', publicDir: resolve(__dirname, 'public'),
  plugins: [expand()],
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0, rollupOptions: { input: Object.fromEntries(names.map((n) => [n.replace(/\.html$/, ''), resolve(pagesDir, n)])) } },
});
