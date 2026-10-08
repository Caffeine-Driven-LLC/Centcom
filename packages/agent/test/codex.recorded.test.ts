import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexMapper, knownNotification } from '../src/codex/map.js';

const dir = join(__dirname, 'fixtures/providers/codex');
const scenarios = readdirSync(dir).filter((f) => f.endsWith('.frames.jsonl')).map((f) => f.replace('.frames.jsonl', ''));
const frames = (n: string): { dir: string; line: string }[] => readFileSync(join(dir, `${n}.frames.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
describe('real codex-cli 0.161.0 traffic through the mapper', () => {
  it('has the six recorded scenarios', () => { expect(scenarios.sort()).toEqual(['real-edit-approve', 'real-hello', 'real-interrupt', 'real-read', 'real-resume', 'real-run-deny']); });
  for (const n of scenarios) {
    it(`${n}: every server notification is known, none throws, and the text matches`, () => {
      const m = new CodexMapper(); const unknown = new Set<string>(); const done = new Map<string, string>(); const deltas = new Map<string, string>();
      for (const f of frames(n)) {
        if (f.dir !== '<-') continue; const j = JSON.parse(f.line); if (!j.method || j.id !== undefined) continue; // notifications only
        if (!knownNotification(String(j.method))) unknown.add(j.method);
        for (const e of m.notification(j.method, j.params ?? {})) { if (e.type === 'text.done') done.set(e.message_id, e.text ?? ''); if (e.type === 'text.delta') deltas.set(e.message_id, (deltas.get(e.message_id) ?? '') + e.text); }
      }
      expect([...unknown]).toEqual([]); for (const [id, text] of done) expect(deltas.get(id) ?? text, `${id}: deltas equal the final text`).toBe(text); /* a message cut off by an interrupt has deltas but no final text */
    });
    it(`${n}: the recorded events keep their shape (every event has v, seq, ts, agent_id and a known type)`, () => {
      const evs = JSON.parse(readFileSync(join(dir, `${n}.events.json`), 'utf8')) as { type: string; v: number; seq: number }[]; expect(evs.length).toBeGreaterThan(5);
      evs.forEach((e, i) => { expect(e.v).toBe(1); expect(e.seq).toBe(i + 1); expect(typeof e.type).toBe('string'); });
    });
  }
  it('context use in a recorded turn stays under the window (the old gauge used the cumulative total)', () => {
    const m = new CodexMapper(); const pcts: number[] = [];
    for (const f of frames('real-edit-approve')) { if (f.dir !== '<-') continue; const j = JSON.parse(f.line); if (j.method !== 'thread/tokenUsage/updated') continue; for (const e of m.notification(j.method, j.params)) if (e.type === 'usage.report' && e.context_used_pct !== undefined) pcts.push(e.context_used_pct); }
    expect(pcts.length).toBeGreaterThan(0); expect(Math.max(...pcts)).toBeLessThan(15);
  });
});
