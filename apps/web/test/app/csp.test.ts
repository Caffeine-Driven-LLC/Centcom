import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const shell = new URL('../../', import.meta.url).pathname; const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.centcom.dev wss://relay.centcom.dev wss://relay-eu.centcom.dev wss://relay-us.centcom.dev; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'";
const html = readFileSync(join(shell, 'index.html'), 'utf8'); const headers = readFileSync(join(shell, 'public/_headers'), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
describe('security headers and the page (acceptance 6)', () => {
  it('the meta CSP and the _headers CSP are the card\'s string, with no unsafe-inline or unsafe-eval', () => {
    expect(html).toContain(`content="${CSP}"`); expect(headers).toContain(`Content-Security-Policy: ${CSP}`); expect(CSP).not.toMatch(/'unsafe-(inline|eval)'/); expect(headers).toContain('Referrer-Policy: no-referrer'); expect(headers).toContain('Permissions-Policy:');
  });
  it('index.html has no inline script, no inline style and no style= attribute', () => { expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i); expect(html).not.toMatch(/<style/i); expect(html).not.toMatch(/\sstyle=/i); expect(html).not.toMatch(/\son[a-z]+=/i); });
  it('the built page, when it exists, has none either', () => { let built: string | undefined; try { built = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8'); } catch { return; } expect(built).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i); expect(built).not.toMatch(/\sstyle=/i); });
  it('no dangerouslySetInnerHTML, no raw hex colour in components or css, no inline style props outside the frame spacer', () => {
    const files = walk(join(shell, 'src')).filter((f) => /\.(tsx?|css)$/.test(f)); for (const f of files) { const s = readFileSync(f, 'utf8'); expect(s, f).not.toContain('dangerouslySetInnerHTML'); expect(s, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); }
    const style = files.filter((f) => f.endsWith('.tsx') && /\sstyle=\{\{/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(shell, '')); expect(style).toEqual(['src/app/Frame.tsx']);
  });
  it('localStorage is used only for the theme choice and always inside try/catch', () => { const users = walk(join(shell, 'src')).filter((f) => readFileSync(f, 'utf8').includes('localStorage')); expect(users.map((f) => f.replace(shell, ''))).toEqual(['src/theme/theme.ts']); expect(readFileSync(join(shell, 'src/theme/theme.ts'), 'utf8')).toMatch(/try \{ const v = localStorage/); });
});
