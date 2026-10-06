import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADER, type NormalisedEvent } from '../../src/index.js';
import { rig } from './rig.js';

const delta = (i: number) => ({ v: 1, seq: i, ts: 'x', agent_id: 'agt_01JTEST0000000000000000001', type: 'text.delta', message_id: 'm', text: `chunk ${i}` }) as unknown as NormalisedEvent;
const lines = (dir: string, f = 'log.jsonl') => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean);

describe('session log writer', () => {
  it('writes the header, flushes every 250 ms or 50 records, private files and folders', async () => {
    const { store, clock } = rig(); const h = store.sync.create({ cwd: '/w', branch: 'main' }); const dir = join(store.dir, h.id);
    expect(h.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/); h.append(delta(1)); expect(() => lines(dir)).toThrow(); // nothing yet
    await clock.advance(249); expect(() => lines(dir)).toThrow(); await clock.advance(1); expect(lines(dir)).toHaveLength(3); expect(JSON.parse(lines(dir)[0]!)).toEqual(HEADER);
    for (let i = 0; i < 49; i++) h.append(delta(i)); expect(lines(dir)).toHaveLength(3); h.append(delta(99)); expect(lines(dir)).toHaveLength(53); // the 50th record flushes at once
    if (process.platform !== 'win32') { expect(statSync(dir).mode & 0o777).toBe(0o700); expect(statSync(join(dir, 'log.jsonl')).mode & 0o777).toBe(0o600); }
    await h.close(); expect(readdirSync(dir)).not.toContain('lock');
  });
  it('rolls segments at the size limit and reads them back in order', async () => {
    const { store } = rig({ limits: { segmentBytes: 2000 } }); const h = store.sync.create({ cwd: '/w' }); for (let i = 0; i < 100; i++) { h.append(delta(i)); if (i % 10 === 9) await h.flush(); } await h.close();
    const files = readdirSync(join(store.dir, h.id)).filter((f) => f.startsWith('log')); expect(files).toContain('log.1.jsonl'); expect(files).toContain('log.2.jsonl');
    const s = store.sync.open(h.id); expect(s.records.filter((r) => r.type === 'text.delta').map((r) => (r.data as { text: string }).text)).toEqual(Array.from({ length: 100 }, (_, i) => `chunk ${i}`)); expect(s.records.map((r) => r.n)).toEqual(s.records.map((_, i) => i + 1));
  });
  it('a record over 1 MiB is stored cut, marked truncated; long fields are cut to 8 KiB', async () => {
    const { store } = rig(); const h = store.sync.create({ cwd: '/w' }); h.note('tool.result', { parts: Array.from({ length: 200 }, () => 'x'.repeat(8000)) }); h.note('tool.result', { summary: 'y'.repeat(20_000) }); await h.close();
    const r = store.sync.open(h.id).records; expect(r[1]!.data).toEqual({ truncated: true }); expect(Buffer.byteLength((r[2]!.data as { summary: string }).summary)).toBeLessThanOrEqual(8 * 1024 + 3);
  });
  it('a write that fails keeps the session going: one persist_failed event, records kept in a bounded buffer', async () => {
    const { store, failed } = rig({ limits: { bufferRecords: 10 } }); const h = store.sync.create({ cwd: '/w' }); await h.flush();
    const { chmodSync } = await import('node:fs'); const dir = join(store.dir, h.id); chmodSync(join(dir, 'log.jsonl'), 0o400);
    if (process.getuid?.() === 0) return; // root ignores file modes
    for (let i = 0; i < 120; i++) h.append(delta(i)); await h.flush(); await h.flush(); expect(failed).toHaveLength(1); expect(failed[0]).toMatchObject({ session_id: h.id });
    chmodSync(join(dir, 'log.jsonl'), 0o600); await h.close(); const kept = store.sync.open(h.id).records.filter((r) => r.type === 'text.delta'); expect(kept.length).toBeLessThanOrEqual(10); expect(kept.at(-1)!.data).toMatchObject({ text: 'chunk 119' });
  });
});
