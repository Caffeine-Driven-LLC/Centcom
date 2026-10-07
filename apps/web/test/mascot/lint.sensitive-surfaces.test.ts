import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(process.cwd(), 'apps/web/shell/src'); const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
describe('no mascot on payment or destructive surfaces (acceptance 7; DESIGN.md 11.5)', () => {
  it('billing and the typed-confirmation dialogs never import the mascot', () => { const files = [...walk(join(src, 'billing')), join(src, 'workspace/components.tsx'), ...walk(join(src, 'integrations')), ...walk(join(src, 'auth'))].filter((f) => /\.tsx?$/.test(f)); for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '\.\.\/mascot|<Mascot\b|@centcom\/mascot/); });
  it('the Mascot component always renders aria-hidden and no text', () => { const s = readFileSync(join(src, 'mascot/Mascot.tsx'), 'utf8'); expect(s).toMatch(/<canvas[^>]*aria-hidden="true"/); expect(s).not.toMatch(/aria-label|<span|<p>|alt=/); });
  it('no unconditional animation: every autoplay path checks reduced motion', () => { const s = readFileSync(join(src, 'mascot/Mascot.tsx'), 'utf8'); expect(s).toContain('reduced'); expect(s).toMatch(/isStartling/); });
});
