import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERROR_TABLE, newIdGenerator, type ErrorCode } from '@centcom/protocol';
import { RealClock, VirtualClock, type Clock } from '../core/clock.js';
import { createRng } from '../core/prng.js';
import { keyFromSeed, signJwt } from '../core/jwt.js';
import { createRest } from './rest.js';
import { DEFAULT_RELAY_OPTIONS, createRelay, type FrameLogEntry, type RelayOptions } from './relay.js';
import type { MockState } from './state.js';
import { SCENARIOS, type ScenarioStep } from './scenarios.js';

export interface MockOptions { port?: number; host?: string; seed?: number; clock?: 'virtual' | 'real'; relay?: Partial<RelayOptions>; scenario?: string; control?: boolean }
export interface PeerScript { name?: string; steps: { at_ms?: number; frame: { t: string; k?: string; p?: Record<string, unknown>; id?: string } }[] }
export interface MockBackend { url: string; httpUrl: string; wsUrl: string; clock: Clock; virtual: VirtualClock | undefined; state: MockState; stop(): Promise<void>; setScenario(s: string | ScenarioStep[]): Promise<void>; advance(ms: number): Promise<void>; frames(sid: string): readonly FrameLogEntry[]; disconnect(o: { sid?: string; member?: string; code: number; retryAfterS?: number }): void; notice(sid: string, code: string, level: 'info' | 'warn' | 'error', params: object): void;
  addVirtualPeer(sid: string, role: 'host' | 'editor' | 'viewer', script: PeerScript): { stop(): void }; mintToken(o?: { sub?: string; scp?: string; expSeconds?: number }): string; mintTicket(o: { sid: string; role?: 'host' | 'editor' | 'viewer'; mid?: string; expSeconds?: number }): string; control(op: string, body?: Record<string, any>): Promise<unknown>; relay: ReturnType<typeof createRelay>; reset(): void }

const loadDoc = (): Record<string, any> => JSON.parse(readFileSync(fileURLToPath(new URL('../../../protocol/src/generated/openapi.json', import.meta.url)), 'utf8'));

function freshState(newId: ReturnType<typeof newIdGenerator>['next']): MockState {
  const user = newId('usr'); return {
    user: { id: user, email: 'dev@example.test', name: 'Dev Tester' }, workspace: newId('wsp'), ownerMember: newId('mem'),
    devices: new Map(), revokedTokens: new Set(), families: new Map(), deviceCodes: new Map(), usedJti: new Set(), idem: new Map(), sessions: new Map(), entitlements: new Map(), etags: new Map(), datasets: new Map(),
    pendingErrors: [], maintenance: false, counters: new Map(),
  };
}

export async function startMockBackend(o: MockOptions = {}): Promise<MockBackend> {
  const seed = o.seed ?? 1; const virtual = (o.clock ?? 'virtual') === 'virtual' ? new VirtualClock() : undefined; const clock: Clock = virtual ?? new RealClock();
  const rng = createRng(seed); const ids = newIdGenerator({ now: () => clock.now(), random: (n) => rng.bytes(n) });
  const keys = [keyFromSeed(rng.bytes(32), 'mock-key-1')];
  let state = freshState(ids.next); const doc = loadDoc();
  const opts: RelayOptions = { ...DEFAULT_RELAY_OPTIONS, ...o.relay };
  let relay!: ReturnType<typeof createRelay>; let port = 0; const host = o.host ?? '127.0.0.1';
  const stateProxy = new Proxy({} as MockState, { get: (_t, k) => (state as any)[k], set: (_t, k, v) => { (state as any)[k] = v; return true; } });
  relay = createRelay({ clock, newId: ids.next as any, keys, state: stateProxy, opts });
  const rest = createRest({ clock, rng, doc, state: stateProxy, keys, newId: ids.next as any, wsUrl: () => `ws://${host}:${port}/v1/ws`, issueTicket: relay.issueTicket, getOrCreateSession: relay.getOrCreateSession });

  const loopback = (req: IncomingMessage) => { const a = req.socket.remoteAddress ?? ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
  const server: Server = createServer(async (req, res: ServerResponse) => {
    if ((req.url ?? '').startsWith('/__mock/')) {
      const json = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (o.control === false || !loopback(req)) return json(404, { error: 'not_found' });
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      let body: Record<string, any> = {}; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { return json(400, { error: 'bad_json' }); }
      try { return json(200, (await control((req.url ?? '').slice(8).split('?')[0]!, body, new URL(req.url!, 'http://x').searchParams)) ?? {}); } catch (e) { return json(400, { error: (e as Error).message }); }
    }
    void rest.handle(req, res);
  });
  server.on('upgrade', (req, socket, head) => relay.onUpgrade(req, socket, head));

  async function control(op: string, b: Record<string, any> = {}, q = new URLSearchParams()): Promise<unknown> {
    const need = <T>(v: T | undefined, name: string): T => { if (v === undefined || v === null) throw new Error(`${op} needs "${name}"`); return v; };
    switch (op) {
      case 'state': return { clock: clock.now(), virtual: !!virtual, user: state.user, workspace: state.workspace, sessions: [...state.sessions.keys()], devices: state.devices.size, pending_errors: state.pendingErrors.length, maintenance: state.maintenance, connections: relay.connections() };
      case 'reset': reset(); return {};
      case 'advance': if (!virtual) throw new Error('advance needs the virtual clock'); await virtual.advance(Number(need(b.ms, 'ms'))); return { now: clock.now() };
      case 'errors': { const code = need(b.code, 'code') as ErrorCode; if (!(code in ERROR_TABLE)) throw new Error(`unknown error code ${code}`); for (let i = 0; i < (b.count ?? 1); i++) state.pendingErrors.push({ code, retryAfterS: b.retry_after_s }); return {}; }
      case 'rate-limit': state.rateLimit = b.off ? undefined : { remaining: Number(b.remaining ?? 0), retryAfterS: Number(b.retry_after_s ?? 5) }; return {};
      case 'maintenance': state.maintenance = !!b.on; return {};
      case 'min-client': state.minClient = b.version; return {};
      case 'approve-device': { const dc = [...state.deviceCodes.values()].find((x) => !b.user_code || x.user_code === b.user_code); if (!dc) throw new Error('no such device code'); dc.state = 'approved'; return {}; }
      case 'deny-device': { const dc = [...state.deviceCodes.values()].find((x) => !b.user_code || x.user_code === b.user_code); if (!dc) throw new Error('no such device code'); dc.state = 'denied'; return {}; }
      case 'expire-device': { for (const dc of state.deviceCodes.values()) dc.expiresAt = 0; return {}; }
      case 'revoke-device': { const dev = state.devices.get(need(b.device, 'device')); if (dev) dev.revoked = true; return {}; }
      case 'session': { const s = relay.getOrCreateSession(b.id ?? ids.next('ses')); if (b.state) s.state = b.state; return { id: s.id }; }
      case 'ticket': return relay.issueTicket(need(b.sid, 'sid'), { name: b.name, role: b.role, device: b.device });
      case 'disconnect': relay.disconnect({ sid: b.sid, member: b.member, code: Number(need(b.code, 'code')), retryAfterS: b.retry_after_s }); return {};
      case 'notice': relay.notice(need(b.sid, 'sid'), need(b.code, 'code'), b.level ?? 'info', b.params ?? {}); return {};
      case 'fault': relay.addFault({ sid: b.sid, type: need(b.type, 'type'), ms: b.ms }); return {};
      case 'peer-send': return relay.peerSend(need(b.sid, 'sid'), { name: b.name, role: b.role, frame: need(b.frame, 'frame') });
      case 'frames': return relay.frames(need(q.get('sid') ?? b.sid, 'sid'));
      case 'scenario': { const sc = SCENARIOS[need(b.name, 'name')]; if (!sc) throw new Error(`unknown scenario ${b.name}`); for (const step of sc) await runStep(step); return { steps: sc.length }; }
      default: throw new Error(`unknown control op ${op}`);
    }
  }
  const runStep = async (s: ScenarioStep) => { await control(s.op, s.body); };
  function reset() { relay.reset(); state = freshState(ids.next); }

  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(o.port ?? 0, host, () => res()); });
  port = (server.address() as AddressInfo).port;
  if (o.scenario) { const sc = SCENARIOS[o.scenario]; if (!sc) throw new Error(`unknown scenario ${o.scenario}`); for (const s of sc) await runStep(s); }
  const url = `http://${host}:${port}`;
  return {
    url, httpUrl: url, wsUrl: `ws://${host}:${port}/v1/ws`, clock, virtual, get state() { return state; }, relay, reset, control,
    setScenario: async (sc) => { const steps = typeof sc === 'string' ? SCENARIOS[sc] : sc; if (!steps) throw new Error(`unknown scenario ${String(sc)}`); for (const st of steps) await runStep(st); },
    advance: async (ms) => { if (!virtual) throw new Error('advance needs the virtual clock'); await virtual.advance(ms); },
    frames: (sid) => relay.frames(sid), disconnect: (x) => relay.disconnect(x), notice: (sid, code, level, params) => relay.notice(sid, code, level, params),
    addVirtualPeer(sid, role, script) { const timers = script.steps.map((st) => clock.setTimeout(() => { relay.peerSend(sid, { name: script.name ?? 'Peer', role, frame: { ...st.frame } as never }); }, st.at_ms ?? 0)); return { stop: () => timers.forEach((t) => clock.clearTimeout(t)) }; },
    mintToken(o = {}) { const now = Math.floor(clock.now() / 1000); const dev = ids.next('dev'); state.devices.set(dev, { id: dev, name: 'Minted', revoked: false }); return signJwt(keys[0]!, { iss: 'https://api.centcom.dev', aud: 'centcom-api', sub: o.sub ?? state.user.id, dev, scp: o.scp ?? 'sessions workspaces', iat: now, exp: now + (o.expSeconds ?? 900), jti: ids.next('req') }); },
    mintTicket: (o) => relay.issueTicket(o.sid, { role: o.role, member: o.mid, expSeconds: o.expSeconds }).ticket,
    stop: () => new Promise<void>((res) => { relay.close(); server.closeAllConnections?.(); server.close(() => res()); }),
  };
}
