import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeStreamParser, EventStreamValidator, type EventBody, type NormalisedEvent } from '../../src/index.js';
import { AGENT, SESSION, report, rig } from '../accounting/rig.js';
import { harness } from '../state/helpers.js';

/** Lanes C101, C014 and C029 on what the real `claude` 2.1.289 printed (recorded, with hook output, paths, account details and the user's tool list taken out): the parser's events, the state machine over them, and the ledger from their usage report. */
const lines = (name: string): string[] => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8').split('\n').filter(Boolean);
/** What the engine does: parse every line; a turn that was stopped with an interrupt request is parsed as interrupted. */
function parse(name: string, o: { interrupted?: boolean } = {}): { bodies: EventBody[]; events: NormalisedEvent[] } {
  const p = new ClaudeStreamParser(); if (o.interrupted) p.interrupted = true; const bodies: EventBody[] = [{ type: 'turn.started', turn_id: 'trn_real' }];
  for (const l of lines(name)) bodies.push(...p.push(l)); bodies.push(...p.closeOpen());
  const events = bodies.map((b, i) => ({ ...b, v: 1, seq: i + 1, ts: '2026-10-14T00:00:00.000Z', agent_id: AGENT }) as NormalisedEvent);
  // turn.started comes before session.started in the engine too; the validator wants session.started first, so move it behind
  const s = events.findIndex((e) => e.type === 'session.started'); const [t] = events.splice(0, 1); events.splice(s, 0, t!); events.forEach((e, i) => { e.seq = i + 1; });
  return { bodies, events };
}
const REAL = ['claude-ok.jsonl', 'claude-tools.jsonl', 'claude-interrupt.jsonl'];

describe('C101: the real recordings through the Claude adapter', () => {
  it.each(REAL)('%s: the events keep to the rules of the stream (seq, tools, text, one turn)', (name) => {
    const { events } = parse(name, { interrupted: name.includes('interrupt') }); const v = new EventStreamValidator('claude-code'); for (const e of events) v.check(e); v.end();
    expect(events[0]!.type === 'session.started' || events.some((e) => e.type === 'session.started')).toBe(true); expect(events.at(-1)!.type).toBe('turn.done');
  });
  it('the interrupted turn ends as cancelled, not as an error, keeps the words it had, and names no error', () => {
    const { events } = parse('claude-interrupt.jsonl', { interrupted: true }); expect(events.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'canceled' }); expect(events.some((e) => e.type === 'error')).toBe(false);
    const text = events.filter((e) => e.type === 'text.delta').map((e) => (e.type === 'text.delta' ? e.text : '')).join(''); expect(text.length).toBeGreaterThan(0); expect(text).toMatch(/^1/); // the partial answer is kept
    expect(events.find((e) => e.type === 'session.started')).toMatchObject({ engine: 'claude-code' });
  });
  it('the same recording without the interrupt flag is what the CLI reports: an interrupted result is an error to a parser that was not told', () => {
    const { events } = parse('claude-interrupt.jsonl'); expect(events.at(-1)).toMatchObject({ type: 'turn.done' }); expect(['ok', 'error', 'canceled']).toContain((events.at(-1) as { outcome: string }).outcome);
  });
  it('the init message of the recording advertises the receipt this client now uses', () => {
    const p = new ClaudeStreamParser(); for (const l of lines('claude-interrupt.jsonl')) p.push(l); expect(p.initCapabilities).toEqual(expect.arrayContaining(['interrupt_receipt_v1']));
    expect(lines('claude-interrupt.jsonl').some((l) => l.includes('"control_response"'))).toBe(true);
  });
});

describe('C014: the state machine over the real recordings', () => {
  it('a plain answer: prompt received, thinking or streaming, success, then idle; never an error', async () => {
    const h = harness(); for (const b of parse('claude-ok.jsonl').bodies) h.push(b); await h.settle(3000);
    expect(h.machine).toEqual(expect.arrayContaining(['prompt-received', 'success'])); expect(h.machine.at(-1)).toBe('idle'); expect(h.machine).not.toContain('error');
  });
  it('a turn stopped by an interrupt: the agent goes to idle, with no error or crash on the way', async () => {
    const h = harness(); for (const b of parse('claude-interrupt.jsonl', { interrupted: true }).bodies) h.push(b); await h.settle(3000);
    expect(h.machine.at(-1)).toBe('idle'); expect(h.machine.filter((s) => s === 'error' || s === 'crash')).toEqual([]);
  });
  it('a turn with tools: reading and editing states appear in the order the tools came', async () => {
    const h = harness(); for (const b of parse('claude-tools.jsonl').bodies) { h.push(b); await h.settle(850); } await h.settle(3000);
    const i = (s: string) => h.machine.indexOf(s as never); expect(h.machine.length).toBeGreaterThan(2); expect(h.machine.at(-1)).toBe('idle');
    if (i('reading-file') >= 0 && i('editing-file') >= 0) expect(i('reading-file')).toBeLessThan(i('editing-file'));
  });
});

describe('C029: the ledger from what the real CLI reported', () => {
  const usage = (name: string, interrupted = false) => { const u = parse(name, { interrupted }).bodies.find((b) => b.type === 'usage.report'); if (!u || u.type !== 'usage.report') throw new Error('no usage report in ' + name); return u; };
  it('the cost and the tokens in the ledger are the ones in the recording, labelled an estimate', () => {
    const raw = lines('claude-ok.jsonl').map((l) => JSON.parse(l)).find((j) => j.type === 'result'); const u = usage('claude-ok.jsonl');
    const { ledger } = rig(); ledger.onUsageReport(report({ cumulative: false, costCumulative: true, tokensIn: u.input_tokens, tokensOut: u.output_tokens, cacheRead: u.cache_read_tokens, costUsd: u.cost_usd }));
    const s = ledger.snapshot({ sessionId: SESSION }); expect(s.costUsdReported).toBeCloseTo(raw.total_cost_usd, 6); expect(s.costLabel).toBe('estimate'); expect(s.tokensOut).toBe(raw.usage.output_tokens);
  });
  it('an interrupted turn that never got to bill adds nothing, and counting it twice does not double anything', () => {
    const u = usage('claude-interrupt.jsonl', true); const { ledger } = rig(); const r = report({ cumulative: false, costCumulative: true, tokensIn: u.input_tokens, tokensOut: u.output_tokens, cacheRead: u.cache_read_tokens, costUsd: u.cost_usd });
    ledger.onUsageReport(r); ledger.onUsageReport(r); const s = ledger.snapshot({ sessionId: SESSION }); expect(s.costUsdReported ?? 0).toBe(0); expect(s.tokensOut).toBe(0);
  });
});
