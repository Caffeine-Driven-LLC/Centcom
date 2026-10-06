import { describe, expect, it } from 'vitest';
import corpus from '../fixtures/commands.json' with { type: 'json' };
import { classifyCommand } from '../../src/sandbox/index.js';

export const ctx = { root: '/work/proj', cwd: '/work/proj', home: '/home/me', platform: 'posix' as const };
const RANK = { low: 0, medium: 1, high: 2 } as const;
const items = corpus as { label: 'low' | 'medium' | 'high'; cmd: string }[];

describe('labelled corpus', () => {
  const results = items.map((i) => ({ ...i, got: classifyCommand(i.cmd, ctx).risk }));
  it('has 300+ commands of every label', () => { expect(items.length).toBeGreaterThanOrEqual(300); for (const l of ['low', 'medium', 'high']) expect(items.filter((i) => i.label === l).length).toBeGreaterThan(50); });
  it('every high command is classified high', () => { const miss = results.filter((r) => r.label === 'high' && r.got !== 'high'); expect(miss.map((m) => `${m.got}: ${m.cmd}`)).toEqual([]); });
  it('no high command is ever lower than medium', () => { expect(results.filter((r) => r.label === 'high' && RANK[r.got] < 1)).toEqual([]); });
  it('at least 98% of low commands are low', () => { const lows = results.filter((r) => r.label === 'low'); const miss = lows.filter((r) => r.got !== 'low'); process.stdout.write(`low accuracy ${(100 - (100 * miss.length) / lows.length).toFixed(1)}% ${miss.map((m) => `${m.got}: ${m.cmd}`).join('; ')}\n`); expect(miss.length / lows.length).toBeLessThanOrEqual(0.02); });
  it('medium commands are never classified low (and only rarely high)', () => { const m = results.filter((r) => r.label === 'medium'); expect(m.filter((r) => r.got === 'low').map((r) => r.cmd)).toEqual([]); const over = m.filter((r) => r.got === 'high'); process.stdout.write(`medium over-classified as high: ${over.map((r) => r.cmd).join('; ')}\n`); expect(over.length / m.length).toBeLessThanOrEqual(0.1); });
});
