import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeStreamParser, createSessionStore, type NormalisedEvent, type StoreDeps } from '../../src/index.js';
import { manualClock } from '../interrupt/rig.js';

export const tmp = () => mkdtempSync(join(tmpdir(), 'centcom-persist-'));
export function rig(o: Partial<StoreDeps> = {}) {
  const clock = manualClock(); const dataDir = o.dataDir ?? tmp(); const failed: unknown[] = [];
  const store = createSessionStore({ dataDir, clock: { ...clock, now: () => Date.UTC(2026, 9, 6) + clock.now() }, bus: { emit: (_k, p) => failed.push(p) }, ...o });
  return { store, clock, dataDir, failed };
}
/** The recorded Claude Code stream, turned into normalised events by the real parser. */
export function claudeGolden(): NormalisedEvent[] {
  const p = new ClaudeStreamParser(); let seq = 0;
  return readFileSync(new URL('../fixtures/claude-tools.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).flatMap((l) => p.push(l)).map((b) => ({ ...b, v: 1, seq: ++seq, ts: '2026-10-06T00:00:00.000Z', agent_id: 'agt_01JTEST0000000000000000001' }) as NormalisedEvent);
}
