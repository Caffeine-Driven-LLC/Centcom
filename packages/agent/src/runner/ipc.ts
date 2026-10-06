/** Local-only control channel for the runner: newline-delimited JSON over a Unix socket (or Windows named pipe). Never TCP. */
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import type { AgentId } from '../events/index.js';
import type { AgentRunner, AgentSpec, RunnerClock, RunnerLog } from './types.js';

export const MAX_FRAME = 1024 * 1024;
export interface Request { v: 1; id: string; cmd: 'hello' | 'start' | 'send' | 'interrupt' | 'stop' | 'list' | 'subscribe' | 'approve' | 'shutdown'; args?: Record<string, any> }
export type Response = { v: 1; id: string; ok: true; result?: unknown } | { v: 1; id: string; ok: false; error: { code: string } };
export class AlreadyRunning extends Error { constructor() { super('already running'); this.name = 'AlreadyRunning'; } }

/** Refuses to start over a live daemon; replaces a socket nobody answers on. */
export async function claimSocket(path: string, probeMs = 500): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await chmod(dirname(path), 0o700).catch(() => undefined);
  const alive = await new Promise<boolean>((res) => { const c = createConnection(path); const t = setTimeout(() => { c.destroy(); res(false); }, probeMs); c.once('connect', () => { clearTimeout(t); c.destroy(); res(true); }); c.once('error', () => { clearTimeout(t); res(false); }); });
  if (alive) throw new AlreadyRunning();
  await unlink(path).catch(() => undefined);
}

export interface IpcOptions { runner: AgentRunner; socketPath: string; secret: string; clock: RunnerClock; log: RunnerLog; idleExitMs?: number; onIdle?: () => void; onShutdown?: () => void; subscribeBus?: (cb: (e: unknown) => void) => () => void }
export interface IpcServer { close(): Promise<void>; clients(): number }

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function startIpcServer(o: IpcOptions): Promise<IpcServer> {
  await claimSocket(o.socketPath);
  const conns = new Set<Socket>(); let idle: unknown;
  const armIdle = () => { if (idle !== undefined) o.clock.clearTimeout(idle as never); idle = undefined; if (o.idleExitMs === undefined) return; idle = o.clock.setTimeout(() => { if (conns.size === 0 && !o.runner.list().some((a) => ['starting', 'running', 'waiting', 'stopping'].includes(a.status))) o.onIdle?.(); else armIdle(); }, o.idleExitMs); };
  const server: Server = createServer((sock) => {
    conns.add(sock); armIdle(); let buf = ''; let authed = false; const subs = new Set<() => void>(); sock.setEncoding('utf8');
    const send = (r: object) => { if (!sock.destroyed) sock.write(JSON.stringify(r) + '\n'); };
    const fail = (id: string, code: string, drop = false) => { send({ v: 1, id, ok: false, error: { code } }); if (drop) sock.end(); };
    sock.on('data', (chunk: string) => {
      buf += chunk;
      if (Buffer.byteLength(buf) > MAX_FRAME + 1) { fail('', 'frame_too_large', true); buf = ''; return; }
      let i: number; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (Buffer.byteLength(line) > MAX_FRAME) { fail('', 'frame_too_large', true); return; } void handle(line); }
    });
    async function handle(line: string) {
      let req: Request; try { req = JSON.parse(line); } catch { return fail('', 'bad_frame', true); }
      if (req?.v !== 1 || typeof req.id !== 'string' || typeof req.cmd !== 'string') return fail(String(req?.id ?? ''), 'bad_frame', true);
      if (!authed) { if (req.cmd === 'hello' && typeof req.args?.secret === 'string' && eq(req.args.secret, o.secret)) { authed = true; return send({ v: 1, id: req.id, ok: true }); } return fail(req.id, 'unauthorized', true); }
      try { send({ v: 1, id: req.id, ok: true, result: await run(req) }); } catch (e) { fail(req.id, (e as { code?: string }).code ?? 'internal_error'); }
    }
    async function run(req: Request): Promise<unknown> {
      const a = req.args ?? {}; const need = (k: string) => { if (typeof a[k] !== 'string') throw Object.assign(new Error(k), { code: 'invalid_args' }); return a[k] as string; };
      const agent = () => { const h = o.runner.get(need('agent_id') as AgentId); if (!h) throw Object.assign(new Error('gone'), { code: 'agent_gone' }); return h; };
      switch (req.cmd) {
        case 'start': { const h = await o.runner.start(a.spec as AgentSpec); return { agent_id: h.id }; }
        case 'send': await agent().send(need('prompt')); return {};
        case 'interrupt': await agent().interrupt(); return {};
        case 'stop': await agent().stop(); return {};
        case 'list': return o.runner.list();
        case 'approve': return { resolved: o.runner.resolveApproval(need('agent_id') as AgentId, need('approval_id'), { decision: a.decision === 'approve' ? 'approve' : 'deny', scope: a.scope }) };
        case 'subscribe': { const h = agent(); const it = h.events({ replay: a.replay !== false })[Symbol.asyncIterator](); let open = true; subs.add(() => { open = false; void it.return?.(); });
          void (async () => { while (open) { const n = await it.next(); if (n.done) break; send({ v: 1, evt: n.value }); } })(); return {}; }
        case 'shutdown': setImmediate(() => o.onShutdown?.()); return {};
        default: throw Object.assign(new Error('cmd'), { code: 'unknown_command' });
      }
    }
    sock.on('close', () => { conns.delete(sock); for (const s of subs) s(); armIdle(); }); sock.on('error', () => undefined);
  });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.socketPath, () => res()); });
  await chmod(o.socketPath, 0o600).catch(() => undefined); armIdle();
  return { clients: () => conns.size, close: () => new Promise<void>((res) => { if (idle !== undefined) o.clock.clearTimeout(idle as never); for (const c of conns) c.destroy(); server.close(() => res()); }) };
}

export interface RunnerClient { call(cmd: Request['cmd'], args?: Record<string, unknown>): Promise<unknown>; onEvent(cb: (e: unknown) => void): void; close(): void; closed: Promise<void> }
export async function connectRunner(path: string, secret: string): Promise<RunnerClient> {
  const sock = createConnection(path); await new Promise<void>((res, rej) => { sock.once('connect', () => res()); sock.once('error', rej); });
  const waits = new Map<string, { res: (v: unknown) => void; rej: (e: Error) => void }>(); const listeners: ((e: unknown) => void)[] = []; let buf = ''; let n = 0; sock.setEncoding('utf8');
  const closed = new Promise<void>((res) => sock.once('close', () => { for (const w of waits.values()) w.rej(new Error('closed')); waits.clear(); res(); })); sock.on('error', () => undefined);
  sock.on('data', (c: string) => { buf += c; let i: number; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.evt) listeners.forEach((l) => l(m.evt)); else { const w = waits.get(m.id); if (w) { waits.delete(m.id); m.ok ? w.res(m.result) : w.rej(Object.assign(new Error(m.error.code), { code: m.error.code })); } } } });
  const call: RunnerClient['call'] = (cmd, args) => new Promise((res, rej) => { const id = `c${++n}`; waits.set(id, { res, rej }); sock.write(JSON.stringify({ v: 1, id, cmd, args }) + '\n'); });
  await call('hello', { secret });
  return { call, onEvent: (cb) => { listeners.push(cb); }, close: () => sock.destroy(), closed };
}
