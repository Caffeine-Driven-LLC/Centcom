import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexEngine, type NormalisedEvent } from '../../src/index.js';
import { alive, recording } from './rig.js';

const FAKE = fileURLToPath(new URL('../fixtures/fake-codex.mjs', import.meta.url));
async function session(ignore: boolean) {
  const { procs, sent } = recording(); const pids: number[] = [];
  const fakeSpawn = ((_b: string, _a: string[], o: any) => { const c = spawn(process.execPath, [FAKE], { ...o }); pids.push(c.pid!); return c; }) as any;
  const s = await new CodexEngine({ spawn: fakeSpawn, procs, env: { FAKE_CODEX_SIGNED_IN: '1', FAKE_CODEX_IGNORE_INTERRUPT: ignore ? '1' : '0' } }).start({ agentId: 'a1', cwd: '/tmp', limits: { interrupt_grace_ms: 300 } });
  const events: NormalisedEvent[] = []; void (async () => { for await (const e of s.events) events.push(e); })(); return { s, events, sent, pids };
}
const until = async (f: () => boolean, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)); } };

describe('codex interrupt', () => {
  it('acknowledged turn/interrupt: no signal, method protocol, the turn ends canceled', async () => {
    const { s, events, sent } = await session(false); await s.send('slow'); await until(() => events.some((e) => e.type === 'turn.started')); await new Promise((r) => setTimeout(r, 100)); // the fake starts its slow turn just after replying
    const r = await s.interrupt(); expect(r).toMatchObject({ stopped: true, method: 'protocol' }); expect(sent).toEqual([]);
    await until(() => events.some((e) => e.type === 'turn.done')); expect(events.filter((e) => e.type === 'turn.done')).toHaveLength(1); await s.stop();
  });
  it.skipIf(process.platform === 'win32')('no answer: the ladder stops the app-server (method sigint), and the next message starts it again on the same thread', async () => {
    const { s, events, sent, pids } = await session(true); await s.send('slow'); await until(() => events.some((e) => e.type === 'turn.started'));
    const r = await s.interrupt(); expect(r.method).toBe('sigint'); expect(sent.length).toBeGreaterThan(0); expect(sent.every((x) => x.pid === -pids[0]!)).toBe(true);
    await until(() => !alive(pids[0]!)); expect(events.filter((e) => e.type === 'turn.done').at(-1)).toMatchObject({ outcome: 'canceled' });
    const n = events.filter((e) => e.type === 'session.started').length; await s.send('hello'); await until(() => events.filter((e) => e.type === 'turn.done').length === 2);
    expect(pids).toHaveLength(2); expect(events.filter((e) => e.type === 'session.started')).toHaveLength(n + 1); expect(s.resumeToken()).toBe('t1'); expect(events.filter((e) => e.type === 'turn.done').at(-1)).toMatchObject({ outcome: 'ok' }); await s.stop();
  });
  it('hard skips turn/interrupt and kills at once', async () => {
    const { s, events, sent } = await session(false); await s.send('slow'); await until(() => events.some((e) => e.type === 'turn.started'));
    const r = await s.interrupt({ hard: true }); expect(r.method).toBe('sigint'); expect(sent.map((x) => x.sig)).toEqual(['SIGKILL']); await s.stop();
  });
});
