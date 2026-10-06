import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertWritableFrame, parseFrame } from '../src/index.js';

const PKG = join(__dirname, '..'); const run = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(PKG, 'scripts/gen.ts'), ...a], { cwd: PKG, encoding: 'utf8' });

describe('the generator', () => {
  it('is up to date with contracts/ (gen --check)', () => { const r = run('--check'); expect(r.status, r.stderr).toBe(0); }, 60_000);
  it('is deterministic: two runs produce identical bytes', () => {
    const a = mkdtempSync(join(tmpdir(), 'g1-')), b = mkdtempSync(join(tmpdir(), 'g2-')); expect(run('--out', a).status).toBe(0); expect(run('--out', b).status).toBe(0);
    for (const f of readdirSync(a)) expect(readFileSync(join(a, f), 'utf8') === readFileSync(join(b, f), 'utf8'), f).toBe(true);
  }, 120_000);
  it('fails --check when one byte differs', () => {
    const d = mkdtempSync(join(tmpdir(), 'g3-')); expect(run('--out', d).status).toBe(0); const f = join(d, 'contract-version.ts'); writeFileSync(f, readFileSync(f, 'utf8') + ' '); const r = run('--check', '--out', d); expect(r.status).toBe(1); expect(r.stderr).toContain('contract-version.ts');
  }, 120_000);
});

describe('runtime stays fast and eval-free', () => {
  it('never builds an Ajv instance or calls new Function in src/', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
    for (const f of walk(join(PKG, 'src'))) { const t = readFileSync(f, 'utf8'); expect(/new\s+Ajv/.test(t), f).toBe(false); expect(/new\s+Function/.test(t), f).toBe(false); expect(/\beval\(/.test(t), f).toBe(false); }
  });
  it('parses 100,000 frames in under 1.5 seconds', () => {
    const dir = join(__dirname, '../../../contracts/fixtures/events'); const frames = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).frame);
    parseFrame(frames[0]); const t = performance.now(); let ok = 0; for (let i = 0; i < 100_000; i++) if (parseFrame(frames[i % frames.length]).ok) ok++; const ms = performance.now() - t;
    expect(ok).toBe(100_000); expect(ms).toBeLessThan(1500); void assertWritableFrame;
  });
});
