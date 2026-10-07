import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const dist = join(process.cwd(), 'apps/web/dist-shell'); const built = existsSync(join(dist, 'index.html'));
const gz = (f: string): number => gzipSync(readFileSync(join(dist, 'assets', f))).length;
describe.skipIf(!built)('bundle budgets (acceptance 1), checked on the built shell (run `pnpm web:shell:build` first)', () => {
  it('entry JS <= 150 KB gzip, any other chunk <= 100 KB gzip, CSS <= 30 KB gzip', () => {
    const files = readdirSync(join(dist, 'assets')); const entry = (readFileSync(join(dist, 'index.html'), 'utf8').match(/src="\/assets\/([^"]+\.js)"/) ?? [])[1]; expect(entry).toBeTruthy();
    expect(gz(entry!)).toBeLessThanOrEqual(150 * 1024); for (const f of files.filter((x) => x.endsWith('.js') && x !== entry)) expect(gz(f), f).toBeLessThanOrEqual(100 * 1024); const css = files.filter((x) => x.endsWith('.css')).reduce((n, f) => n + gz(f), 0); expect(css).toBeLessThanOrEqual(30 * 1024);
  });
  it('the built page has no inline script or style attribute', () => { const h = readFileSync(join(dist, 'index.html'), 'utf8'); expect(h).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i); expect(h).not.toMatch(/\sstyle=/i); expect(h).toContain("script-src 'self' 'wasm-unsafe-eval'"); });
});
