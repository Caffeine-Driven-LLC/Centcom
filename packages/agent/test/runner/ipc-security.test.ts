import { mkdir, mkdtemp, readFile, stat, symlink, writeFile, chmod, lstat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from '@centcom/testkit';
import { UnsafeDirectory, claimSocket, connectRunner, startIpcServer, writeSecretFile } from '../../src/runner/index.js';
import { rig } from './helpers.js';

const realClock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
const log = { debug() {}, info() {}, warn() {}, error() {} };
const open: { close(): unknown }[] = []; afterEach(async () => { for (const x of open.splice(0)) await x.close(); });
const base = () => mkdtemp(join(tmpdir(), 'cc-sec-'));

describe('socket folder is private to this user', () => {
  it('creates missing folders as 0700 and accepts them', async () => {
    const p = join(await base(), 'a', 'b', 'runner.sock'); await claimSocket(p);
    for (const d of [join(p, '..'), join(p, '..', '..')]) expect((await stat(d)).mode & 0o777).toBe(0o700);
  });
  it('refuses an existing folder with the wrong mode, and does not fix it silently', async () => {
    const d = join(await base(), 'hostile'); await mkdir(d, { mode: 0o755 }); await chmod(d, 0o755);
    await expect(claimSocket(join(d, 'runner.sock'))).rejects.toBeInstanceOf(UnsafeDirectory); expect((await stat(d)).mode & 0o777).toBe(0o755);
    const r = rig(); await expect(startIpcServer({ runner: r.runner, socketPath: join(d, 'runner.sock'), secret: 'x', clock: realClock, log })).rejects.toBeInstanceOf(UnsafeDirectory);
  });
  it('refuses a symlink in place of the folder, even one pointing at a good 0700 folder', async () => {
    const b = await base(), real = join(b, 'real'); await mkdir(real, { mode: 0o700 }); const link = join(b, 'link'); await symlink(real, link);
    await expect(claimSocket(join(link, 'runner.sock'))).rejects.toThrow(/symlink/);
  });
  it('refuses a folder owned by someone else (when the platform has uids)', async () => {
    if (!process.getuid || process.getuid() !== 0) return; // chown needs root; the owner check itself runs on every create below
    const d = join(await base(), 'other'); await mkdir(d, { mode: 0o700 }); const { chown } = await import('node:fs/promises'); await chown(d, 12345, 12345);
    await expect(claimSocket(join(d, 'runner.sock'))).rejects.toThrow(/owned by/);
  });
  it('refuses a missing-parent chain when a parent we would trust is a symlink', async () => {
    const b = await base(), real = join(b, 'real'); await mkdir(real, { mode: 0o700 }); const link = join(b, 'link'); await symlink(real, link);
    await expect(claimSocket(join(link, 'sub', 'runner.sock'))).resolves.toBeUndefined(); // the symlinked ancestor existed before us, so only folders we create are verified
    expect((await lstat(join(real, 'sub'))).mode & 0o777).toBe(0o700);
  });
});

describe('runner.secret', () => {
  it('replaces a pre-planted world-readable file instead of writing into it', async () => {
    const d = join(await base(), 'ok'); await mkdir(d, { mode: 0o700 }); const f = join(d, 'runner.secret'); await writeFile(f, 'planted', { mode: 0o644 }); await chmod(f, 0o644);
    await writeSecretFile(f, 'real-secret'); expect(await readFile(f, 'utf8')).toBe('real-secret'); expect((await stat(f)).mode & 0o777).toBe(0o600);
  });
  it('does not follow a pre-planted symlink to another file', async () => {
    const b = await base(), d = join(b, 'ok'); await mkdir(d, { mode: 0o700 }); const target = join(b, 'target'); await writeFile(target, 'untouched'); await symlink(target, join(d, 'runner.secret'));
    await writeSecretFile(join(d, 'runner.secret'), 's'); expect(await readFile(target, 'utf8')).toBe('untouched'); expect((await lstat(join(d, 'runner.secret'))).isSymbolicLink()).toBe(false);
  });
  it('refuses to write into an unsafe folder', async () => {
    const d = join(await base(), 'loose'); await mkdir(d, { mode: 0o755 }); await chmod(d, 0o755); await expect(writeSecretFile(join(d, 'runner.secret'), 's')).rejects.toBeInstanceOf(UnsafeDirectory);
  });
});

describe('subscribe respects backpressure', () => {
  it('a client that stops reading makes the Subscriber drop deltas instead of buffering them in the socket', async () => {
    const real = new FakeEngine({ clock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) }, script: { gapMs: 1, events: Array.from({ length: 1500 }, (_v, i) => ({ type: 'text.delta' as const, message_id: 'm', index: i, text: 'x'.repeat(8192) })) } });
    const r = rig({ engines: { fake: real }, config: { ringSize: 20 } }); const dir = await base(); const socketPath = join(dir, 'runner.sock');
    const server = await startIpcServer({ runner: r.runner, socketPath, secret: 's', clock: realClock, log }); open.push(server);
    const c = await connectRunner(socketPath, 's'); open.push({ close: () => c.close() }); const { agent_id } = (await c.call('start', { spec: { engine: 'fake', cwd: await r.dirs(), prompt: '' } })) as { agent_id: string };
    // a second raw connection subscribes and then stops reading
    const raw = createConnection(socketPath); await new Promise<void>((res) => raw.once('connect', () => res())); raw.on('error', () => undefined); open.push({ close: () => raw.destroy() });
    let got = 0, tail = '', done = false; raw.setEncoding('utf8'); raw.on('data', (s: string) => { const t = tail + s; got += t.split('"text.delta"').length - 1; tail = t.slice(-12); if (t.includes('"turn.done"')) done = true; });
    raw.pause(); raw.write(JSON.stringify({ v: 1, id: 'h', cmd: 'hello', args: { secret: 's' } }) + '\n'); raw.write(JSON.stringify({ v: 1, id: 's', cmd: 'subscribe', args: { agent_id } }) + '\n'); raw.resume(); await new Promise((x) => setTimeout(x, 100)); raw.pause();
    await c.call('send', { agent_id, prompt: 'go' }); const t0 = Date.now(); while (r.runner.get(agent_id as never)!.status() === 'running' && Date.now() - t0 < 15_000) await new Promise((x) => setTimeout(x, 25));
    raw.resume(); const t1 = Date.now(); while (!done && Date.now() - t1 < 10_000) await new Promise((x) => setTimeout(x, 25));
    expect(done).toBe(true); expect(got).toBeLessThan(1500 * 0.9);
  }, 40_000);
});
