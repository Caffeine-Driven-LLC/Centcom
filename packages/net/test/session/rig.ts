/** Two or more session clients against the mock backend's relay. The mock serves generated member lists, so a small REST overlay answers the members and snapshot calls from what the test registered. */
import { createHash } from 'node:crypto';
import { newIdGenerator } from '@centcom/protocol';
import { startMockBackend, type MockBackend } from '@centcom/testkit';
import { DeviceKeyStore, FrameCodec, KeyRing, Roster, TrustStore, sealGrants, createHttpClient, createSessionClient, defaultUserAgent, initCrypto, memoryKeychain, type HttpClient, type SessionClient, type SessionHandle } from '../../src/index.js';

export const WS = 'wsp_01JA3Z8K2M5N7P9Q0R1S2T3V4W';
const ids = newIdGenerator({ now: () => 1_790_000_000_000, random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255) });
let counter = 0; const devId = () => { const a = ids.next('dev'); return `dev_${a.slice(4, 29)}${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[counter++ % 32]}`; };

export interface Registry { policy: Record<string, unknown>; members: Map<string, { id: string; role: 'host' | 'editor' | 'viewer'; slot: number; display_name: string; device: string; device_keys: Record<string, unknown> }>; blobs: Map<string, Uint8Array>; snapshots: { snp: string; seq: number; size: number; sha256: string; kid: string }[]; history: unknown[] }
export const newRegistry = (): Registry => ({ policy: {}, members: new Map(), blobs: new Map(), snapshots: [], history: [] });

const safeJson = (b: BodyInit): unknown => { try { return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b as Uint8Array)); } catch { return undefined; } };
export class Peer {
  deviceId = devId(); keychain = memoryKeychain(); device = new DeviceKeyStore(this.keychain, this.deviceId); trust = new TrustStore();
  private stores = new Map<string, string>(); keyringStore(sid: string) { return { read: async () => this.stores.get(sid), write: async (t: string) => { this.stores.set(sid, t); } }; }
  seen: { method: string; path: string; headers: Record<string, string>; body?: unknown }[] = []; http!: HttpClient; client!: SessionClient; handle?: SessionHandle; warnings: string[] = []; fetched: string[] = [];
  constructor(readonly name: string, readonly sub: string | undefined, private m: MockBackend, private reg: Registry, private role: 'host' | 'editor', private register = true) {}
  async init(extra: { seqStore?: import('../../src/index.js').SeqStore; keyrings?: boolean; fetch?: typeof fetch; clock?: import('../../src/index.js').RelayClock; logger?: import('../../src/index.js').Logger } = {}): Promise<this> {
    await initCrypto(); const keys = await this.device.getOrCreatePublicKeys(); const token = this.m.mintToken({ ...(this.sub ? { sub: this.sub } : {}), expSeconds: 86_400 });
    const rec = (async (input: string | URL, init?: RequestInit) => { const u = new URL(String(input)); this.seen.push({ method: init?.method ?? 'GET', path: u.pathname, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? safeJson(init.body) : undefined }); return globalThis.fetch(input, init); }) as typeof fetch;
    const base = createHttpClient({ baseUrl: this.m.url, getAccessToken: async () => token, userAgent: defaultUserAgent('0.1.0'), timeoutMs: 3_600_000, fetch: rec });
    const reg = this.reg; const self = this;
    const overlay: HttpClient = {
      call: async (op: string, args: never, o?: never) => {
        const r = await (base.call as (...a: unknown[]) => Promise<{ data: Record<string, unknown> }>)(op, args, o);
        if (op === 'createJoinToken' && self.register) { const mem = String(r.data.member); reg.members.set(mem, { id: mem, role: self.role, slot: reg.members.size, display_name: self.name, device: self.deviceId, device_keys: { device: self.deviceId, x25519: keys.x25519, ed25519: keys.ed25519, fingerprint: self.device.fingerprint() } }); }
        if (op === 'createSession') { const b = (args as { body?: { policy?: Record<string, unknown> } }).body; reg.policy = { ...(b?.policy ?? {}) }; return { ...r, data: { ...r.data, policy: reg.policy } } as never; }
        if (op === 'getSession') return { ...r, data: { ...r.data, policy: reg.policy } } as never;
        if (op === 'getSnapshot') { const s = reg.snapshots.at(-1); if (!s) throw Object.assign(new Error('none'), { status: 404 }); return { ...r, data: { ...s, download_url: `https://blobs.example/${s.snp}`, expires_in: 60 } } as never; }
        if (op === 'beginSnapshotUpload') { const snp = `snp_${String(reg.snapshots.length + 1).padStart(26, '0')}`; return { ...r, data: { snp, upload_url: `https://blobs.example/${snp}`, expires_in: 60 } } as never; }
        if (op === 'commitSnapshot') { const a = args as { path: { snp: string }; body: { seq: number; size: number; sha256: string; kid: string } }; reg.snapshots.push({ snp: a.path.snp, ...a.body }); return { ...r, data: { snp: a.path.snp, ...a.body } } as never; }
        if (op === 'getSessionHistory') { const after = Number((args as { query?: { after_seq?: number } }).query?.after_seq ?? 0); const rows = (reg.history as { seq: number }[]).filter((f) => f.seq > after); return { ...r, data: { data: rows, next_cursor: null, has_more: false, ...(rows.length ? { earliest_seq: rows[0]!.seq } : {}) } } as never; }
        return r as never;
      },
      paginate: (op: string, args: never, o?: never) => {
        if (op === 'listSessionMembers') return (async function* () { for (const m of reg.members.values()) yield m; })() as never;
        return (base.paginate as (...a: unknown[]) => never)(op, args, o);
      },
      revalidate: base.revalidate.bind(base),
    } as unknown as HttpClient;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      this.fetched.push(`${init?.method ?? 'GET'} ${url}`); const id = String(url).split('/').pop()!;
      if (init?.method === 'PUT') { reg.blobs.set(id, new Uint8Array(init.body as Uint8Array)); return new Response(null, { status: 200 }); }
      const b = reg.blobs.get(id); return b ? new Response(b as BodyInit, { status: 200 }) : new Response('nope', { status: 404 });
    }) as typeof fetch;
    this.http = overlay;
    this.client = createSessionClient({ http: overlay, crypto: { device: this.device, trust: this.trust, ...(extra.keyrings ? { keyringStore: (sid: string) => this.keyringStore(sid), keychain: this.keychain } : {}) }, ...(extra.seqStore ? { seqStore: extra.seqStore } : {}), deviceId: this.deviceId, clientInfo: { name: 'centcom-cli', version: '0.1.0', contract: '1.2.0' }, relayUrl: this.m.wsUrl, allowPlainWs: true, fetch: extra.fetch ?? fakeFetch, ...(extra.clock ? { clock: extra.clock } : {}), ...(extra.logger ? { logger: extra.logger } : {}) });
    return this;
  }
}
export async function rig(o: { relay?: { replayFrames?: number } } = {}) {
  const m = await startMockBackend({ clock: 'virtual', seed: 7, ...(o.relay ? { relay: o.relay } : {}) }); const reg = newRegistry();
  const mk = (name: string, role: 'host' | 'editor', sub?: string, register = true) => new Peer(name, sub, m, reg, role, register);
  return { m, reg, host: await mk('Host', 'host').init(), guest: await mk('Guest', 'editor', 'usr_01JA3Z8K2M5N7P9Q0R1S2T3V4X').init(), mk, async stop() { await m.stop(); } };
}
export const until = async (f: () => boolean, ms = 4000): Promise<void> => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); } };
export const sha = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** A member with no socket whose frames the test writes by hand: for forged, unsigned, odd or replayed traffic. */
export async function virtualPeer(r: { m: MockBackend; reg: Registry }, sid: string, name: string, ring = KeyRing.create(), role: 'editor' | 'host' = 'editor', register = true) {
  await initCrypto(); const keychain = memoryKeychain(); const deviceId = devId(); const device = new DeviceKeyStore(keychain, deviceId); const keys = await device.getOrCreatePublicKeys();
  const first = r.m.relay.peerSend(sid, { name, role, frame: { t: 'event', k: 'reaction', id: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', p: { target: 'msg_AAAAAAAAAAAAAAAAAAAAAAAAAA', code: 'ok', op: 'add' } } as never }); const memberId = String(first.from);
  if (register) r.reg.members.set(memberId, { id: memberId, role, slot: 9, display_name: name, device: deviceId, device_keys: { device: deviceId, x25519: keys.x25519, ed25519: keys.ed25519, fingerprint: device.fingerprint() } });
  let codec = new FrameCodec({ sid, deviceId, device, ring, roster: new Roster() }); let n = 0; const id = () => `msg_${String(++n).padStart(26, '0').replace(/0/g, 'A')}`.slice(0, 30);
  const self = { memberId, deviceId, device, ring, keys,
    encode(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }, o: { kid?: string } = {}) { return codec.encode(kind, id(), body, o); },
    /** the same device id with new keys (a re-installed or re-keyed device) */
    async rekey() { const d2 = new DeviceKeyStore(memoryKeychain(), deviceId); const k2 = await d2.getOrCreatePublicKeys(); codec = new FrameCodec({ sid, deviceId, device: d2, ring, roster: new Roster() }); const e = r.reg.members.get(memberId)!; r.reg.members.set(memberId, { ...e, device_keys: { device: deviceId, x25519: k2.x25519, ed25519: k2.ed25519, fingerprint: d2.fingerprint() } }); return k2; },
    /** give a real peer this peer's keys (the peer is an editor, so its grants are accepted) */
    async grantTo(peer: Peer, kids = ring.kids()) { const k = await peer.device.getOrCreatePublicKeys(); const g = sealGrants(ring, kids, k.x25519, peer.deviceId); return self.send('key.grant', { p: g.p, secret: g.secret as never }, { kid: kids.at(-1) }); },
    send(kind: string, body: { p?: Record<string, unknown>; secret?: Record<string, unknown> }, o: { kid?: string } = {}) { const f = codec.encode(kind, id(), body, o); return r.m.relay.peerSend(sid, { name, role, frame: f as never }); },
    raw(frame: Record<string, unknown>) { return r.m.relay.peerSend(sid, { name, role, frame: frame as never }); }, nextId: id };
  return self;
}

/** Time that only moves when the test says so; timers fire in due order. */
export class ManualClock {
  t = Date.UTC(2026, 9, 7, 12); private seq = 0; private timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.set(id, { at: this.t + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.timers.delete(h as number); }
  async advance(ms: number) { const end = this.t + ms; for (;;) { let next: [number, { at: number; fn: () => void }] | undefined; for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e; if (!next) break; this.timers.delete(next[0]); this.t = Math.max(this.t, next[1].at); next[1].fn(); await new Promise((r) => setImmediate(r)); } this.t = end; await new Promise((r) => setImmediate(r)); }
}
/** A logger that keeps what it is told, so tests can prove nothing secret is written. */
export function spyLogger() {
  const lines: string[] = []; const mk = (): import('../../src/index.js').Logger => { const l = (level: string) => (msg: string, ctx?: Record<string, unknown>) => { lines.push(`${level} ${msg} ${JSON.stringify(ctx ?? {})}`); }; return { trace: l('trace'), debug: l('debug'), info: l('info'), warn: l('warn'), error: l('error'), child: () => mk(), flush: async () => undefined }; };
  return { logger: mk(), lines };
}
