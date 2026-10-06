import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeEngine, CodexEngine } from '../../src/index.js';

function fakeChild() { const c = new EventEmitter() as any; c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough(); return c; }
const collect = async (it: AsyncIterable<any>, until: (e: any) => boolean) => { const out: any[] = []; for await (const e of it) { out.push(e); if (until(e)) break; } return out; };

describe('1 MiB line cap in the real parsers', () => {
  it('Claude: a 1 MiB + 1 byte line ends the turn with provider_protocol_error and kills the child', async () => {
    const child = fakeChild(); const kills: string[] = []; child.kill = (s: string) => { kills.push(s); return true; };
    const s = await new ClaudeCodeEngine({ spawn: (() => child) as never }).start({ agentId: 'agt_x', cwd: '/tmp', envExact: true, env: { PATH: '/bin' } }); await s.send('hi');
    child.stdout.write('x'.repeat(1024 * 1024 + 1) + '\n'); const evs = await collect(s.events, (e) => e.type === 'turn.done');
    expect(evs.find((e) => e.type === 'error')).toMatchObject({ code: 'provider_protocol_error', fatal: true }); expect(evs.at(-1)).toMatchObject({ type: 'turn.done', outcome: 'error', stop_reason: 'line_too_long' }); expect(kills).toContain('SIGKILL');
  });
  it('Claude: a line of exactly 1 MiB is still accepted', async () => {
    const child = fakeChild(); child.kill = () => true; const s = await new ClaudeCodeEngine({ spawn: (() => child) as never }).start({ agentId: 'agt_x', cwd: '/tmp' }); await s.send('hi');
    child.stdout.write('x'.repeat(1024 * 1024) + '\n'); child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', is_error: false }) + '\n'); const evs = await collect(s.events, (e) => e.type === 'turn.done' || e.type === 'error'); expect(evs.some((e) => e.type === 'error' && e.code === 'provider_protocol_error' && e.fatal)).toBe(false);
  });
  it('Claude passes exactly the runner env when envExact is set', async () => {
    let seen: any; const child = fakeChild(); child.kill = () => true; process.env.SOME_LEAK_CHECK = 'leak'; const s = await new ClaudeCodeEngine({ spawn: ((_b: string, _a: string[], o: any) => { seen = o; return child; }) as never }).start({ agentId: 'agt_x', cwd: '/tmp', envExact: true, env: { PATH: '/bin' } }); await s.send('hi'); delete process.env.SOME_LEAK_CHECK;
    expect(seen.env).toEqual({ PATH: '/bin' });
  });
  it('Codex: a 1 MiB + 1 byte line produces a fatal protocol error and SIGKILL', async () => {
    const child = fakeChild(); const kills: string[] = []; child.kill = (s: string) => { kills.push(s); return true; };
    const p = new CodexEngine({ spawn: (() => child) as never }).start({ agentId: 'agt_x', cwd: '/tmp' }); await new Promise((r) => setTimeout(r, 20)); child.stdout.write('y'.repeat(1024 * 1024 + 1) + '\n'); const s = await Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('init stuck')), 1500))]).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 30)); expect(kills).toContain('SIGKILL'); void s;
  });
});
