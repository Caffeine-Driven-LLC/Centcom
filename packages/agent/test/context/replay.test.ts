import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGT, ev, rig } from './helpers.js';
import type { EventBody } from '../../src/index.js';

const dir = join(import.meta.dirname, '../fixtures/transcripts'); const mine = join(import.meta.dirname, '../fixtures/context');
const load = (f: string, d = dir): EventBody[] => readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { event: EventBody }).event);
describe('recorded transcripts', () => {
  it('a transcript with usage and compaction shows the engine numbers and the alerts in order', () => {
    const r = rig(); load('context-compaction.transcript.jsonl', mine).forEach((b, i) => r.view.onEvent(ev(b, i + 1)));
    expect(r.alerts.map((a) => a.level)).toEqual(['warn', 'full', 'ok']); expect(r.view.snapshot(AGT)).toEqual({ used: 41_000, window: 200_000, pct: 20.5, reported: true, totals: { tokens_in: 2500, tokens_out: 540 } });
    expect(r.compaction).toEqual([{ agent_id: AGT, phase: 'start' }, { agent_id: AGT, phase: 'end', before: 194_000, after: 40_000 }]);
  });
  it('replaying it again after a resume does not double count', () => { const r = rig(); const evs = load('context-compaction.transcript.jsonl', mine); for (let pass = 0; pass < 2; pass++) evs.forEach((b, i) => r.view.onEvent(ev(b, i + 1))); expect(r.view.snapshot(AGT).totals).toEqual({ tokens_in: 2500, tokens_out: 540 }); });
  it.each(readdirSync(dir).filter((f) => f.endsWith('.transcript.jsonl')))('%s never makes the view throw or invent a percent', (f) => { const r = rig(); const evs = load(f); evs.forEach((b, i) => r.view.onEvent(ev(b, i + 1))); const s = r.view.snapshot(AGT); if (s.window === undefined) { expect(s.pct).toBeUndefined(); expect(r.alerts).toEqual([]); } });
});
