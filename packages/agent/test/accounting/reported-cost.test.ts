import { describe, expect, it } from 'vitest';
import { ClaudeStreamParser, usageTable } from '../../src/index.js';
import { AGENT, SESSION, report, rig } from './rig.js';

/** A Claude Code result line, as the CLI prints it. */
const RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's', total_cost_usd: 0.0421, usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 9000, output_tokens: 410 }, modelUsage: { 'claude-x': { inputTokens: 1500, outputTokens: 410, costUSD: 0.0421, contextWindow: 200000 } } };

describe('reported cost', () => {
  it('a Claude Code result with total_cost_usd 0.0421 is that cost, labelled an estimate, and /usage shows est. next to it', () => {
    const { ledger } = rig(); const p = new ClaudeStreamParser(); const evs = p.push(JSON.stringify(RESULT)); const u = evs.find((e) => e.type === 'usage.report')!;
    if (u.type !== 'usage.report') throw new Error('no usage');
    ledger.onUsageReport(report({ cumulative: false, costCumulative: true, tokensIn: u.input_tokens, tokensOut: u.output_tokens, cacheRead: u.cache_read_tokens, costUsd: u.cost_usd }));
    const s = ledger.snapshot({ sessionId: SESSION }); expect(s.costUsdReported).toBe(0.0421); expect(s.costLabel).toBe('estimate'); expect(s.tokensIn).toBe(1500); expect(s.tokensOut).toBe(410); expect(s.cacheRead).toBe(9000);
    const table = usageTable([{ label: 'session', t: s }]).join('\n'); expect(table).toContain('$0.0421 est.');
    for (const m of table.matchAll(/\$[0-9.]+/g)) expect(table.slice(m.index! + m[0].length, m.index! + m[0].length + 5)).toBe(' est.');
    for (const num of table.match(/\d[\d,]*(\.\d+)?/g) ?? []) { const v = Number(num.replace(/,/g, '')); expect([1500, 410, 9000, 0.0421, 0, 0, 0].includes(v) || /^0+$/.test(num)).toBe(true); }
  });
  it('no cost field: not reported, never computed', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ engine: 'codex', tokensIn: 100, tokensOut: 20 })); const s = ledger.snapshot({});
    expect(s.costUsdReported).toBeNull(); expect(s.costLabel).toBe('not-reported'); expect(usageTable([{ label: 'all', t: s }]).join('\n')).toContain('not reported');
  });
  it('per agent, session and day views add up; Claude Code cost is a running total for its session', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ costCumulative: true, tokensIn: 10, costUsd: 0.01 })); ledger.onUsageReport(report({ costCumulative: true, tokensIn: 5, costUsd: 0.03 }));
    expect(ledger.snapshot({ agentId: AGENT }).costUsdReported).toBeCloseTo(0.03); expect(ledger.snapshot({ sessionId: SESSION }).tokensIn).toBe(15); expect(ledger.byDay(7)).toHaveLength(7); expect(ledger.byDay(1)[0]!.tokensIn).toBe(15); expect(ledger.byDay(7)[1]!.tokensIn).toBe(0);
  });
  it('the accounting code has no prices', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const dir = new URL('../../src/accounting/', import.meta.url);
    for (const f of readdirSync(dir)) { const src = readFileSync(new URL(f, dir), 'utf8'); expect(src, f).not.toMatch(/per[_ -]?million|price\w*\s*[:=]|\/\s*1_?000_?000\b|\$\d+(\.\d+)?\s*\/\s*M/i); }
  });
  it('an engine limit message only counts, nothing else changes', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ tokensIn: 7 })); const before = ledger.snapshot({}); ledger.onLimitEvent(AGENT); const after = ledger.snapshot({});
    expect(after).toEqual({ ...before, limitEvents: 1 }); expect(ledger.pending()).toBe(1);
  });
});
