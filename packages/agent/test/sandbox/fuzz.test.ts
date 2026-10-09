import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../../src/sandbox/index.js';
import { ctx } from './ctx.js';

describe('acceptance 5: fails closed, never throws, stays fast', () => {
  it.each([["echo 'a", 'unterminated quote'], ['ls\0ls', 'NUL'], ['ls \ufffd', 'invalid UTF-8'], ['x'.repeat(100 * 1024), '100 KiB']])('%j (%s) is high with reason unparseable-ish', (cmd) => { const r = classifyCommand(cmd, ctx); expect(r.risk).toBe('high'); expect(r.autoAllowable).toBe(false); expect(r.reasons.length).toBeGreaterThan(0); });
  it('depth 5 is high', () => { let s = 'ls'; for (let i = 0; i < 5; i++) s = `bash -c ${JSON.stringify(s)}`; expect(classifyCommand(s, ctx).risk).toBe('high'); });
  it('10,000 random strings never throw', () => { fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 120 }), fc.string({ unit: 'binary', maxLength: 120 }), fc.array(fc.constantFrom('a', ' ', '"', "'", '$(', ')', '`', ';', '|', '&&', '<<', 'EOF', '\n', '\\', '>', 'rm', '-rf', '/', '~', 'sudo', 'bash -c', '$X')).map((a) => a.join(''))), (s) => { const r = classifyCommand(s, ctx); expect(['low', 'medium', 'high']).toContain(r.risk); if (r.facts.destructive) expect(r.autoAllowable).toBe(false); }), { numRuns: 10_000 }); });
  it('a non-string argument does not throw', () => { expect(classifyCommand(undefined as unknown as string, ctx).risk).toBe('high'); });
  // the best of 15 runs: a busy machine can slow one run, not all. It takes about 1 ms on a quiet machine; the limit is wide enough for a loaded CI runner and still far below what a quadratic or backtracking blow-up would cost (hundreds of ms).
  it('a 10 KiB command takes under 25 ms', () => { const cmd = ('ls -la src/ && echo "x y" | grep z; ').repeat(280).slice(0, 10 * 1024); classifyCommand(cmd, ctx); let best = Infinity; for (let i = 0; i < 15; i++) { const t = performance.now(); classifyCommand(cmd, ctx); best = Math.min(best, performance.now() - t); } expect(best).toBeLessThan(25); });
});
