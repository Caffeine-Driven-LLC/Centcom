import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SID } from '../src/index.js';

const bin = fileURLToPath(new URL('../bin/mock-backend.ts', import.meta.url));
const children: ChildProcess[] = []; const dirs: string[] = [];
afterEach(() => { children.splice(0).forEach((c) => c.kill('SIGKILL')); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); });

/** Spawn the CLI; stdout and stderr are collected (and drained, so a chatty child never blocks on a full pipe). */
function run(args: string[]) {
  const child = spawn(process.execPath, ['--import', 'tsx', bin, ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  const io = { out: '', err: '', started: Date.now() }; child.stdout!.on('data', (d) => { io.out += d; }); child.stderr!.on('data', (d) => { io.err += d; });
  const exit = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
  const ready = new Promise<{ http: string; ws: string; ms: number }>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ready line: ${io.out} ${io.err}`)), 20_000);
    const check = () => { if (!io.out.includes('\n')) return; clearTimeout(t); try { res({ ...JSON.parse(io.out.split('\n')[0]!), ms: Date.now() - io.started }); } catch (e) { rej(e as Error); } };
    child.stdout!.on('data', check); void exit.then(() => { clearTimeout(t); rej(new Error(`exited early: ${io.err}`)); });
  });
  ready.catch(() => undefined); /* tests that expect an early exit never await it */
  return { child, io, exit, ready };
}
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'mock-cli-')); dirs.push(d); return d; };
const hello = (ticket: string) => JSON.stringify({ v: 1, t: 'sys.hello', p: { protocols: [1], caps: [], ticket, client: { name: 'test', version: '1.0.0', contract: '1.2.0' }, last_seq: null } });
async function joinWs(http: string, ws: string) {
  const { ticket } = (await (await fetch(`${http}/__mock/ticket`, { method: 'POST', body: JSON.stringify({ sid: DEFAULT_SID, name: 'Cli' }) })).json()) as { ticket: string };
  const sock = new WebSocket(ws, 'centcom.v1'); const frames: any[] = []; let closed: number | undefined;
  sock.on('message', (d) => frames.push(JSON.parse(d.toString()))); sock.on('close', (c) => { closed = c; });
  await new Promise<void>((r, j) => { sock.once('open', () => r()); sock.once('error', j); }); sock.send(hello(ticket));
  for (let i = 0; i < 200 && !frames.some((f) => f.t === 'sys.welcome'); i++) await new Promise((r) => setTimeout(r, 10));
  return { sock, frames, closed: () => closed };
}

describe('centcom-mock-backend CLI (AC11)', () => {
  it('--port 0 prints exactly one JSON line {http, ws} within 2 s, serves the scenario, and exits 0 within 1 s of SIGINT after closing sockets with 1001', { timeout: 30_000 }, async () => {
    const c = run(['--port', '0', '--seed', '3', '--scenario', 'flaky-start']); const info = await c.ready;
    expect(info.ms).toBeLessThan(2000);
    expect(Object.keys(JSON.parse(c.io.out.split('\n')[0]!))).toEqual(['http', 'ws']);
    const port = new URL(info.http).port; expect(info.http).toBe(`http://127.0.0.1:${port}`); expect(info.ws).toBe(`ws://127.0.0.1:${port}/v1/ws`);
    expect((await fetch(info.http + '/healthz')).status).toBe(503); /* flaky-start: the first two calls fail */
    expect((await fetch(info.http + '/healthz')).status).toBe(503); expect((await fetch(info.http + '/healthz')).status).toBe(200);
    const ws = await joinWs(info.http, info.ws); expect(ws.frames.some((f) => f.t === 'sys.welcome')).toBe(true);
    const t0 = Date.now(); c.child.kill('SIGINT'); const code = await c.exit; const took = Date.now() - t0;
    if (process.platform === 'win32') expect([0, null]).toContain(code); else expect(code).toBe(0);
    expect(took).toBeLessThan(1000);
    for (let i = 0; i < 50 && ws.closed() === undefined; i++) await new Promise((r) => setTimeout(r, 10));
    expect(ws.closed()).toBe(1001);
    expect(c.io.out.trim().split('\n')).toHaveLength(1); /* stdout carries the ready line and nothing else */
    expect(c.io.err).toContain('"event":"ready"');
  });
  it('SIGTERM also exits 0', { timeout: 30_000 }, async () => {
    const c = run(['--port', '0']); await c.ready; c.child.kill('SIGTERM'); const code = await c.exit;
    if (process.platform !== 'win32') expect(code).toBe(0);
  });
  it('--ping-ms, --dead-ms, --clock virtual and --data are honoured', { timeout: 30_000 }, async () => {
    const dir = tmp(); const wsp = 'wsp_01JTEST0000000000000000001';
    writeFileSync(join(dir, 'workspaces.json'), JSON.stringify([{ id: wsp, name: 'Seeded', slug: 'seeded', created_at: '2026-01-01T00:00:00Z' }]));
    const c = run(['--port', '0', '--clock', 'virtual', '--ping-ms', '1000', '--dead-ms', '3000', '--data', dir, '--quiet']); const info = await c.ready;
    const ws = await joinWs(info.http, info.ws); const welcome = ws.frames.find((f) => f.t === 'sys.welcome');
    expect(welcome.p.heartbeat).toEqual({ ping_ms: 1000, dead_ms: 3000 });
    const state = (await (await fetch(`${info.http}/__mock/state`)).json()) as { virtual: boolean; workspace: string }; expect(state.virtual).toBe(true); expect(state.workspace).toBe(wsp);
    const dc = (await (await fetch(`${info.http}/v1/auth/device/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'centcom-cli', device_name: 'T', device_pubkeys: { x25519: 'A'.repeat(43), ed25519: 'B'.repeat(43) } }) })).json()) as { device_code: string; user_code: string };
    await fetch(`${info.http}/__mock/approve-device`, { method: 'POST', body: JSON.stringify({ user_code: dc.user_code }) });
    const tok = (await (await fetch(`${info.http}/v1/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'c' }) })).json()) as { access_token: string };
    const list = (await (await fetch(`${info.http}/v1/workspaces`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json()) as { data: { id: string }[] };
    expect(list.data.map((w) => w.id)).toEqual([wsp]);
    ws.sock.close(); c.child.kill('SIGINT'); expect(await c.exit).toBe(0); expect(c.io.err).not.toContain('"event":"ready"'); /* --quiet */
  });
  it('a port that is already taken exits 1 naming the port', { timeout: 30_000 }, async () => {
    const blocker = createServer(); await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r())); const port = (blocker.address() as { port: number }).port;
    try { const c = run(['--port', String(port)]); expect(await c.exit).toBe(1); expect(c.io.err).toContain('EADDRINUSE'); expect(c.io.err).toContain(String(port)); expect(c.io.out).toBe(''); } finally { blocker.close(); }
  });
  it('a malformed scenario file exits 2 listing the JSON pointer of every violation, and nothing starts', { timeout: 30_000 }, async () => {
    const f = join(tmp(), 'bad.json'); writeFileSync(f, JSON.stringify({ name: 'bad', steps: [{ do: 'explode', args: {} }, { at_ms: 5, do: 'disconnect', args: { code: 1234 } }] }));
    const c = run(['--port', '0', '--scenario', f]); expect(await c.exit).toBe(2); expect(c.io.out).toBe('');
    expect(c.io.err).toContain('/steps/0/do'); expect(c.io.err).toContain('/steps/1/args/code');
  });
  it('bad arguments, an unknown scenario and bad seed data exit 2; --help exits 0', { timeout: 30_000 }, async () => {
    for (const args of [['--bogus'], ['--port', 'abc'], ['--clock', 'sundial'], ['--ping-ms', '5000', '--dead-ms', '1000'], ['--scenario', 'no-such-scenario']]) { const c = run(args); expect(await c.exit, args.join(' ')).toBe(2); }
    const dir = tmp(); writeFileSync(join(dir, 'users.json'), JSON.stringify([{ id: 'nope' }]));
    const d = run(['--port', '0', '--data', dir]); expect(await d.exit).toBe(2); expect(d.io.err).toContain('users.json#/0');
    const h = run(['--help']); expect(await h.exit).toBe(0); expect(h.io.out).toContain('--port'); expect(h.io.out).toContain('--data');
  });
});
