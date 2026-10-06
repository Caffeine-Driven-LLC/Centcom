import { WebSocket } from 'ws';
import { startMockBackend, type MockBackend, type MockOptions } from '../src/index.js';

export const DEVICE_BODY = { client_id: 'centcom-cli', device_name: 'Test laptop', device_pubkeys: { x25519: 'A'.repeat(43), ed25519: 'B'.repeat(43) } };
export const start = (o: MockOptions = {}) => startMockBackend({ clock: 'virtual', seed: 7, ...o });
export async function api(m: MockBackend, method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string>; form?: boolean } = {}) {
  const r = await fetch(m.url + path, { method, headers: { ...(o.body !== undefined ? { 'content-type': o.form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers }, body: o.body === undefined ? undefined : o.form ? new URLSearchParams(o.body as Record<string, string>).toString() : JSON.stringify(o.body) });
  const text = await r.text(); let body: any; try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}
/** An encrypted-kind event as a client would send it: opaque `ct` and a signature, no `p`. `c` is distinctive so privacy tests can look for it. */
export const sealed = (id: string, k = 'message.user', c = 'SECRETCIPHERTEXT') => ({ v: 1, t: 'event', id, k, ct: { alg: 'xchacha20poly1305', kid: 'k1', n: 'N'.repeat(32), c }, sig: 'S'.repeat(86) });
/** Wait until `cond` holds, polling real time (sockets need real time to deliver even when the mock's clock is virtual). */
export async function eventually(cond: () => boolean, ms = 3000): Promise<void> { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('condition not met in time'); await new Promise((r) => setTimeout(r, 10)); } }
/** Run the whole device login against the mock and return real tokens. */
export async function login(m: MockBackend) {
  const dc = (await api(m, 'POST', '/v1/auth/device/code', { body: DEVICE_BODY })).body;
  await m.control('approve-device', { user_code: dc.user_code });
  const t = await api(m, 'POST', '/v1/auth/token', { body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'centcom-cli' } });
  return t.body as { access_token: string; refresh_token: string; device: string; user: string };
}

export class Peer {
  ws!: WebSocket; frames: any[] = []; closed?: { code: number }; private waiters: (() => void)[] = [];
  static async open(m: MockBackend, o: { sid?: string; name?: string; role?: 'host' | 'editor' | 'viewer'; ticket?: string; lastSeq?: number | null; hello?: boolean; paused?: boolean; device?: string; pong?: boolean } = {}): Promise<Peer> {
    const p = new Peer(); const sid = o.sid ?? 'ses_01JTEST0000000000000000001';
    const ticket = o.ticket ?? ((await m.control('ticket', { sid, name: o.name, role: o.role, device: o.device })) as { ticket: string }).ticket; p.sid = sid;
    p.ws = new WebSocket(m.wsUrl, 'centcom.v1'); await new Promise<void>((res, rej) => { p.ws.once('open', () => res()); p.ws.once('error', rej); });
    p.ws.on('message', (d) => { const f = JSON.parse(d.toString()); p.frames.push(f); if (f.t === 'sys.ping' && o.pong !== false) p.send({ v: 1, t: 'sys.pong', p: { t: f.p?.t } }); p.wake(); }); p.ws.on('close', (code) => { p.closed = { code }; p.wake(); });
    if (o.paused) (p.ws as any)._socket.pause();
    if (o.hello !== false) p.send({ v: 1, t: 'sys.hello', p: { protocols: [1], caps: [], ticket, client: { name: 'test', version: '1.0.0', contract: '1.2.0' }, last_seq: o.lastSeq ?? null } });
    return p;
  }
  sid = '';
  send(f: Record<string, unknown>) { this.ws.send(JSON.stringify({ sid: this.sid, ...f })); }
  private wake() { for (const w of this.waiters.splice(0)) w(); }
  async until(cond: (p: Peer) => boolean, ms = 3000): Promise<void> { const end = Date.now() + ms; while (!cond(this)) { if (Date.now() > end) throw new Error('timeout; frames: ' + JSON.stringify(this.frames.map((f) => f.k ?? f.t)) + ' closed=' + JSON.stringify(this.closed)); await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 25); }); } }
  has = (t: string, k?: string) => this.frames.some((f) => f.t === t && (k === undefined || f.k === k));
  of = (t: string, k?: string) => this.frames.filter((f) => f.t === t && (k === undefined || f.k === k));
  seqs = () => this.frames.filter((f) => typeof f.seq === 'number').map((f) => f.seq as number);
  close() { try { this.ws.close(); } catch { /* ok */ } }
}
