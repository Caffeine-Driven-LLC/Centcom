/** Builds the docs site with VitePress and checks the budgets of lane C096: output size, first-load JavaScript of the home page, nothing loaded from another host. */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'docs/site/.vitepress/dist');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe('the built docs site', () => {
  it('builds, stays within 5 MB, loads at most 120 KB of gzipped JavaScript on the home page, and loads nothing from another host', () => {
    const r = spawnSync('pnpm', ['exec', 'vitepress', 'build', 'docs/site'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
    const files = walk(DIST); expect(files.reduce((n, f) => n + statSync(f).size, 0)).toBeLessThanOrEqual(5 * 1024 * 1024);
    const home = readFileSync(join(DIST, 'index.html'), 'utf8');
    const scripts = [...new Set([...home.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]!))];
    expect(scripts.length).toBeGreaterThan(0);
    const gz = scripts.reduce((n, s) => n + gzipSync(readFileSync(join(DIST, s))).length, 0); expect(gz, `${gz} bytes gzip`).toBeLessThanOrEqual(120 * 1024);
    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const html = readFileSync(f, 'utf8');
      expect([...html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]), f).toEqual([]);
      expect(html, f).not.toMatch(/googletagmanager|google-analytics|plausible|fonts\.googleapis|gstatic/);
    }
    const css = files.filter((x) => x.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n'); expect(css).not.toMatch(/url\(["']?https?:/);
  }, 180_000);
});
