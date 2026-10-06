import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SID, type MockBackend } from '../src/index.js';
import { Peer, sealed, start } from './helpers.js';
import { ulid } from './ulid.js';

let m: MockBackend | undefined; afterEach(async () => { await m?.stop(); m = undefined; });
const GOLDEN = fileURLToPath(new URL('./golden/happy-frames.json', import.meta.url));

/** The fixed client script: join, send three sealed messages (each waits for its echo), then let the scenario play out. */
async function run(): Promise<string> {
  m = await start({ seed: 7, clock: 'virtual', scenario: 'happy' });
  const a = await Peer.open(m, { sid: DEFAULT_SID, name: 'Client' }); await a.until((p) => p.has('sys.welcome'));
  for (let i = 1; i <= 3; i++) { const id = `msg_${ulid(100 + i)}`; a.send(sealed(id)); await a.until((p) => p.frames.some((f) => f.id === id && typeof f.seq === 'number')); }
  await m.advance(5000); await a.until((p) => p.has('event', 'reaction'));
  const log = JSON.stringify(m.frames(DEFAULT_SID)); a.close(); await m.stop(); m = undefined; return log;
}

describe('determinism (AC1)', () => {
  it('two runs of scenario happy with seed 7 on the virtual clock give byte-identical frame logs, equal to the golden file', async () => {
    const first = await run(); const second = await run();
    expect(second).toBe(first);
    const entries = JSON.parse(first) as { seq?: number; ts: string; t: string; k?: string; id?: string; from: string }[];
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_e, i) => i + 1)); /* every entry sequenced, from 1, no gaps */
    expect(entries.every((e) => typeof e.ts === 'string' && typeof e.id === 'string' && typeof e.from === 'string')).toBe(true);
    expect(new Set(entries.map((e) => e.ts)).size).toBeGreaterThan(3); /* scenario steps landed at distinct virtual times */
    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(entries, null, 1) + '\n');
    expect(JSON.stringify(JSON.parse(readFileSync(GOLDEN, 'utf8')))).toBe(first);
  });
});
