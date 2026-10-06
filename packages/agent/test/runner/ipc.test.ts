import { mkdtemp, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { AlreadyRunning, claimSocket, connectRunner, startIpcServer, type IpcServer } from '../../src/runner/index.js';
import { rig } from './helpers.js';

const open: { close(): unknown }[] = []; afterEach(async () => { for (const x of open.splice(0)) await x.close(); });
const realClock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
const log = { debug() {}, info() {}, warn() {}, error() {} };
async function boot(o: { idleExitMs?: number; onIdle?: () => void } = {}) {
  const r = rig(); const dir = await mkdtemp(join(tmpdir(), 'cc-ipc-')); const socketPath = join(dir, 'sub', 'runner.sock'); const secret = 's3cret-' + 'x'.repeat(20);
  const server = await startIpcServer({ runner: r.runner, socketPath, secret, clock: realClock, log, ...o }); open.push(server); return { r, server, socketPath, secret, dir };
}
const raw = (path: string) => new Promise<{ send(s: string): void; data(): string; closed: Promise<void> }>((res) => { const c = createConnection(path); let d = ''; c.setEncoding('utf8'); c.on('data', (x) => { d += x; }); const closed = new Promise<void>((r) => c.on('close', () => r())); c.on('error', () => undefined); c.once('connect', () => res({ send: (s) => c.write(s), data: () => d, closed })); });

describe('ipc', () => {
  it('socket is 0600, its folder 0700, and a good client can run an agent end to end', async () => {
    const { r, socketPath, secret } = await boot(); expect((await stat(socketPath)).mode & 0o777).toBe(0o600); expect((await stat(join(socketPath, '..'))).mode & 0o777).toBe(0o700);
    const c = await connectRunner(socketPath, secret); open.push({ close: () => c.close() }); const cwd = await r.dirs();
    const { agent_id } = (await c.call('start', { spec: { engine: 'fake', cwd, prompt: '' } })) as { agent_id: string }; expect(await c.call('list')).toHaveLength(1);
    const evts: any[] = []; c.onEvent((e) => evts.push(e)); await c.call('subscribe', { agent_id, replay: true }); await c.call('send', { agent_id, prompt: 'hi' });
    for (let i = 0; i < 100 && !evts.some((e) => e.event.type === 'turn.done'); i++) await new Promise((x) => setTimeout(x, 10)); expect(evts.map((e) => e.seq)).toEqual(evts.map((_e, i) => i + 1));
    await c.call('stop', { agent_id }); expect(((await c.call('list')) as any[])[0].status).toBe('exited');
    await expect(c.call('send', { agent_id: 'agt_nope', prompt: 'x' })).rejects.toMatchObject({ code: 'agent_gone' }); await expect(c.call('send', { agent_id })).rejects.toMatchObject({ code: 'invalid_args' });
  });
  it('a wrong secret, a missing hello, and garbage all get unauthorized or bad_frame and are disconnected', async () => {
    const { socketPath } = await boot(); const a = await raw(socketPath); a.send(JSON.stringify({ v: 1, id: '1', cmd: 'hello', args: { secret: 'nope' } }) + '\n'); await a.closed; expect(a.data()).toContain('unauthorized');
    const b = await raw(socketPath); b.send(JSON.stringify({ v: 1, id: '2', cmd: 'list' }) + '\n'); await b.closed; expect(b.data()).toContain('unauthorized'); expect(b.data()).not.toContain('"ok":true');
    const c = await raw(socketPath); c.send('not json\n'); await c.closed; expect(c.data()).toContain('bad_frame');
  });
  it('a frame over 1 MiB is rejected and the connection dropped', async () => {
    const { socketPath, secret } = await boot(); const c = await raw(socketPath); c.send(JSON.stringify({ v: 1, id: '1', cmd: 'hello', args: { secret } }) + '\n'); c.send(JSON.stringify({ v: 1, id: '2', cmd: 'list', args: { pad: 'x'.repeat(1024 * 1024) } }) + '\n'); await c.closed; expect(c.data()).toContain('frame_too_large');
  });
  it('approve resolves a waiting approval through the socket', async () => {
    const { r, socketPath, secret } = await boot(); const c = await connectRunner(socketPath, secret); open.push({ close: () => c.close() }); const { agent_id } = (await c.call('start', { spec: { engine: 'fake', cwd: await r.dirs(), prompt: '' } })) as { agent_id: string };
    const d = r.engine.sessions[0]!.o.approvalGate!.decide({ approval_id: 'apr_1', agent_id, tool_id: 't', tool: 'Bash', summary: 's', risk: 'high' }); expect(await c.call('approve', { agent_id, approval_id: 'apr_1', decision: 'approve' })).toEqual({ resolved: true }); await expect(d).resolves.toMatchObject({ decision: 'approve' });
  });
  it('a client that disconnects mid-turn leaves the agent running and a new client can replay its events', async () => {
    const { r, socketPath, secret } = await boot(); const c = await connectRunner(socketPath, secret); const { agent_id } = (await c.call('start', { spec: { engine: 'fake', cwd: await r.dirs(), prompt: 'go' } })) as { agent_id: string }; c.close(); await c.closed;
    const c2 = await connectRunner(socketPath, secret); open.push({ close: () => c2.close() }); const evts: any[] = []; c2.onEvent((e) => evts.push(e)); await c2.call('subscribe', { agent_id }); for (let i = 0; i < 50 && evts.length < 3; i++) await new Promise((x) => setTimeout(x, 10)); expect(evts[0].seq).toBe(1);
  });
  it('shutdown command calls onShutdown; idle daemon exits after the idle time with no agents and no clients', async () => {
    let idle = 0; await boot({ idleExitMs: 80, onIdle: () => { idle++; } }); await new Promise((x) => setTimeout(x, 300)); expect(idle).toBeGreaterThan(0);
    let down = 0; const r = rig(); const dir = await mkdtemp(join(tmpdir(), 'cc-ipc-')); const p = join(dir, 'r.sock'); const s = await startIpcServer({ runner: r.runner, socketPath: p, secret: 'abc', clock: realClock, log, onShutdown: () => { down++; } }); open.push(s);
    const c = await connectRunner(p, 'abc'); open.push({ close: () => c.close() }); await c.call('shutdown'); await new Promise((x) => setTimeout(x, 30)); expect(down).toBe(1);
  });
});

describe('daemon lock', () => {
  it('a second server on a live socket is refused with "already running"', async () => {
    const { r, socketPath } = await boot(); await expect(startIpcServer({ runner: r.runner, socketPath, secret: 'x', clock: realClock, log })).rejects.toBeInstanceOf(AlreadyRunning);
  });
  it('a stale socket (nobody listening) is replaced quickly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-stale-')); const p = join(dir, 'runner.sock'); const dead = createServer(); await new Promise<void>((res) => dead.listen(p, res));
    (dead as any)._handle.close?.(); // leave the file behind without a listener, like a crashed daemon
    await new Promise((res) => dead.close(() => res(undefined))).catch(() => undefined); await writeFile(p, '').catch(() => undefined);
    const t = Date.now(); await claimSocket(p); expect(Date.now() - t).toBeLessThan(500); await mkdir(dir, { recursive: true });
    const r = rig(); const s: IpcServer = await startIpcServer({ runner: r.runner, socketPath: p, secret: 'x', clock: realClock, log }); open.push(s); expect(s.clients()).toBe(0);
  });
});
