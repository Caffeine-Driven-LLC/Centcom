import { describe, expect, it } from 'vitest';
import { formatTranscriptSummary, requestsOf, summarizeTranscript } from '../../src/index.js';

const asst = (id: string, t: number, u: { i?: number; w?: number; r?: number; o?: number }, content: unknown[] = [{ type: 'text', text: 'x' }], model = 'claude-opus-5-5') =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + t * 1000).toISOString(), message: { id, model, content, usage: { input_tokens: u.i ?? 1, cache_creation_input_tokens: u.w ?? 0, cache_read_input_tokens: u.r ?? 0, output_tokens: u.o ?? 0 } } });
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

describe('transcript summary (cost measurement)', () => {
  it('merges the several lines one request is written on, taking the final output count', () => {
    const r = requestsOf([asst('m1', 0, { w: 100, o: 5 }), asst('m1', 0, { w: 100, o: 40 }), asst('m2', 5, { r: 100, o: 7 })], 'main');
    expect(r.requests.map((x) => [x.id, x.output])).toEqual([['m1', 40], ['m2', 7]]);
  });
  it('counts requests, sub-agent calls, context growth and totals', () => {
    const main = [user('hello'), asst('a', 0, { w: 30000, o: 100 }), asst('b', 10, { r: 30000, w: 2000, o: 50 }, [{ type: 'tool_use', id: 't1', name: 'Agent', input: {} }, { type: 'tool_use', id: 't2', name: 'Task', input: {} }]), asst('b', 10, { r: 30000, w: 2000, o: 50 })];
    const sub = [asst('s1', 11, { w: 9000, o: 400 }), asst('s2', 15, { r: 9000, w: 500, o: 300 })];
    const s = summarizeTranscript(main, [sub]);
    expect(s.requests).toEqual({ main: 2, sub: 2 }); expect(s.subagentCalls).toBe(2);
    expect(s.totals.output).toBe(850); expect(s.byAgent.sub.output).toBe(700);
    expect(s.context).toEqual({ first: 30001, last: 32001, max: 32001 }); expect(s.firstRequestTokens).toBe(30001);
    expect(s.cacheHitRatio).toBeGreaterThan(0.4); expect(s.cacheHitRatio).toBeLessThan(0.6);
  });
  it('ignores synthetic messages and unreadable lines', () => {
    const s = summarizeTranscript(['not json', asst('x', 0, { w: 10, o: 1 }, [], '<synthetic>'), asst('y', 1, { w: 10, o: 1 })]);
    expect(s.requests.main).toBe(1);
  });
  it('flags a request that rewrote the prompt cache, and tells an idle expiry from an early rewrite', () => {
    const main = [asst('a', 0, { w: 40000 }), asst('b', 10, { r: 40000, w: 100 }), asst('c', 20, { w: 41000 }), asst('d', 30, { r: 41000, w: 100 }), asst('e', 1000, { w: 41500 })];
    const s = summarizeTranscript(main);
    expect(s.cacheBreaks.map((b) => b.cause)).toEqual(['rewrite', 'idle']);
    expect(s.cacheBreaks[0]!.rewritten).toBe(41000);
  });
  it('finds the text Centcom put in user messages, by kind, and counts it', () => {
    const notes = '<team-context>\nNotes from other agents.\n- [finding] a thing\n</team-context>\n\nDo the task';
    const skills = "[Centcom auto skills: the user's tooling matched these to the request below.]\n- Use the \"x\" skill\n\nBuild it";
    const s = summarizeTranscript([user(notes), user('plain'), user(skills), asst('a', 0, { w: 10 })]);
    expect(s.centcomText.map((c) => [c.kind, c.messages])).toEqual([['auto skills', 1], ['team context (board digest)', 1]]);
    expect(s.centcomText.every((c) => c.tokens > 0)).toBe(true);
    expect(summarizeTranscript([user('plain')]).centcomText).toEqual([]);
  });
  it('prints plain lines with no message text in them', () => {
    const lines = formatTranscriptSummary(summarizeTranscript([user('secret prompt words'), asst('a', 0, { w: 5000, o: 10 })]));
    expect(lines.join('\n')).toContain('requests: 1 main'); expect(lines.join('\n')).not.toContain('secret');
  });
});
