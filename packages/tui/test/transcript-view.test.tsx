import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { Transcript } from '../src/components/Transcript.js';
import { TranscriptLayout, emptyTranscript, itemLinesForTest, reduceTranscript, sanitizeForTerminal, type Item } from '../src/index.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const blocks = (n: number): Item[] => Array.from({ length: n }, (_, i) => (i % 3 === 0 ? { kind: 'user', id: `u${i}`, text: `question ${i}`, ts: 0 } : i % 3 === 1 ? { kind: 'assistant', id: `a${i}`, messageId: `m${i}`, agentId: 'x', text: `answer ${i} with a few words\n- one\n- two`, done: true } : { kind: 'tool', id: `t${i}`, toolId: `t${i}`, agentId: 'x', name: 'Read', summary: 'src/a.ts', risk: 'low', status: 'ok', path: 'src/a.ts', result: '120 lines' }) as Item);
describe('virtualised layout (acceptance 1, 2)', () => {
  it('10,000 blocks: one page is fast and builds only the rows on screen', () => {
    const items = blocks(10_000); const l = new TranscriptLayout().update(items, 78); const times: number[] = []; let max = 0;
    for (let p = 0; p < 40; p++) { const t0 = performance.now(); const end = l.total - p * 22; const rows = l.slice(Math.max(0, end - 22), end); times.push(performance.now() - t0); max = Math.max(max, rows.length); }
    times.sort((a, b) => a - b); expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(16); expect(max).toBeLessThanOrEqual(22 + 40);
  });
  it('a streaming delta re-measures only that block', () => {
    const items = blocks(500); const l = new TranscriptLayout().update(items, 78); const before = l.measures; const last = items.at(-1)!; const next = [...items.slice(0, -1), { ...(last as Extract<Item, { kind: 'tool' }>), result: '121 lines' } as Item];
    const t0 = performance.now(); l.update(next, 78); const ms = performance.now() - t0; expect(l.measures - before).toBe(1); expect(ms).toBeLessThan(20);
  });
  it('more than 5,000 blocks: the oldest collapse into one row', () => { const l = new TranscriptLayout().update(blocks(6_240), 78); expect(strip(l.slice(0, 1).map((r) => r.map((s) => s.t).join('')).join(''))).toBe('⋯ 1,240 earlier messages'); });
  it('a resize keeps the anchored block in place', () => { const items = blocks(300); const l = new TranscriptLayout().update(items, 100); const a = l.anchorAt(400)!; l.update(items, 60); const row = l.rowOf(a)!; expect(l.anchorAt(row)!.id).toBe(a.id); });
});
describe('reducer (acceptance 3, 6, 7)', () => {
  const ev = (kind: string, data: unknown, seq?: number, from?: string) => ({ kind, at: '2026-10-06T12:00:00Z', data, ...(seq !== undefined ? { seq } : {}), ...(from ? { from } : {}) });
  it('deltas out of order are put in order; a duplicate is ignored; done finishes it', () => { let st = emptyTranscript(); const t = 1000; st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 1, delta: 'B' }), t); expect(st.items).toEqual([]); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 0, delta: 'A' }), t); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 0, delta: 'A' }), t); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 2, delta: 'C' }), t); expect((st.items[0] as { text: string }).text).toBe('ABC'); st = reduceTranscript(st, ev('message.assistant.done', { message_id: 'm' }), t); expect((st.items[0] as { done: boolean }).done).toBe(true); });
  it('a gap older than 2 s is shown as-is with … and later deltas still add on', () => { let st = emptyTranscript(); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 0, delta: 'A' }), 0); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 2, delta: 'C' }), 100); st = reduceTranscript(st, ev('message.assistant.delta', { message_id: 'm', index: 3, delta: 'D' }), 2300); expect((st.items[0] as { text: string }).text).toBe('A…CD'); });
  it('sequenced by seq: an older seq is ignored', () => { let st = emptyTranscript(); st = reduceTranscript(st, ev('message.system', { text: 'one' }, 5)); st = reduceTranscript(st, ev('message.system', { text: 'old' }, 4)); expect(st.items).toHaveLength(1); });
  it('unknown kinds and odd statuses never throw', () => { let st = emptyTranscript(); st = reduceTranscript(st, ev('future.thing', { x: 1 })); st = reduceTranscript(st, ev('tool.request', { tool_id: 't', name: 'Read', summary: 'a' })); st = reduceTranscript(st, ev('tool.result', { tool_id: 't', status: 'weird' })); expect(st.items).toHaveLength(1); expect((st.items[0] as { result: string }).result).toBe('done'); expect(reduceTranscript(st, null as never)).toBe(st); });
  it('a member message carries their name; it shows ▎, initial and name', () => { let st = emptyTranscript([{ id: 'mem_m', name: 'Maya', slot: 2 }]); st = reduceTranscript(st, ev('message.user', { text: 'hello' }, 1, 'mem_m')); const lines = itemLinesForTest(st.items[0]!, 60).map((l) => l.map((s) => s.t).join('')); expect(lines[0]).toBe('▎ M · Maya'); expect(lines[1]).toBe('▎ hello'); });
  it('the contract fixtures replay without errors', () => { const dir = join(import.meta.dirname, '../../../contracts/fixtures/events'); let st = emptyTranscript(); let seq = 0; for (const f of readdirSync(dir)) { const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); st = reduceTranscript(st, { kind: j.kind, at: j.frame?.ts ?? '2026-10-06T00:00:00Z', seq: ++seq, from: j.frame?.from, data: { ...(j.clear_payload ?? j.frame?.p ?? {}), ...(j.secret_payload ?? {}) } }); } expect(st.items.length).toBeGreaterThan(3); });
});
describe('hostile text (acceptance 8)', () => {
  it('escape codes, OSC and control characters are removed', () => { for (const bad of ['\x1b[2J', '\x1b]0;pwned\x07', '\x1b]8;;http://evil\x1b\\link\x1b]8;;\x1b\\', '\x9b2J', 'a\x07b\x08c', '\x1bP+q\x1b\\']) expect(sanitizeForTerminal(`x${bad}y`)).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/); expect(sanitizeForTerminal('line1\r\nline2\ttab')).toBe('line1\nline2\ttab'); expect(sanitizeForTerminal('\x1b]8;;http://evil\x1b\\link\x1b]8;;\x1b\\')).toBe('link'); });
  it('a tool result with a clear-screen code renders inert', () => { const it: Item = { kind: 'tool', id: 't', toolId: 't', agentId: 'x', name: 'Bash', summary: 'cat x', risk: 'low', status: 'ok', command: 'cat x', result: 'before\x1b[2J\x1b[Hafter', startedAt: 0 }; const out = itemLinesForTest(it, 60).map((l) => l.map((s) => s.t).join('')).join('\n'); expect(out).not.toContain('\x1b'); expect(out).toContain('beforeafter'); });
});
describe('render (acceptance 4, 5)', () => {
  const sample: Item[] = [{ kind: 'user', id: 'u', text: 'fix the bug', ts: 0 }, { kind: 'assistant', id: 'a', messageId: 'm', agentId: 'x', text: 'Here is the plan:\n\n- read\n- fix\n- test', done: true }, { kind: 'tool', id: 't', toolId: 't', agentId: 'x', name: 'Read', summary: 'src/a.ts', risk: 'low', status: 'ok', path: 'src/a.ts', result: '120 lines', startedAt: 0 }, { kind: 'thinking', id: 'th', messageId: 'm2', agentId: 'x', text: 'hmm', ms: 1500, done: true }, { kind: 'notice', id: 'n', level: 'info', text: 'Compacted the context.' }];
  it('glyphs and spacing at 80x24', () => { const l = new TranscriptLayout().update(sample, 78); const out = strip(renderToString(<Transcript layout={l} width={78} height={22} scroll={0} />, { columns: 80 })); for (const g of ['❯ you', '◆ ', '• read', '● Read(src/a.ts)', '└ 120 lines', '∴ thought for', 'i Compacted the context.']) expect(out).toContain(g); });
  it('scrolled up with new messages: the indicator counts them', () => { const l = new TranscriptLayout().update(blocks(100), 78); const out = strip(renderToString(<Transcript layout={l} width={78} height={10} scroll={30} unseen={12} />, { columns: 80 })); expect(out).toContain('↓ 12 new · ctrl+end'); });
});
