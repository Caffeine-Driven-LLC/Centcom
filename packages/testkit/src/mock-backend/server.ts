/** startMockBackend: one node:http server on 127.0.0.1 carrying the REST mock, the relay simulator (`/v1/ws`) and the
 *  loopback-only control plane (`/__mock/*`). Owns startup, seed data, scenario running and shutdown. It must never bind
 *  anything but 127.0.0.1, make outbound calls, or be imported by production code. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERROR_TABLE, EVENT_MODES, b64u, newIdGenerator, type ErrorCode } from '@centcom/protocol';
import { RealClock, VirtualClock, type Clock, type TimerHandle } from '../core/clock.js';
import { createRng } from '../core/prng.js';
import { keyFromSeed, signJwt } from '../core/jwt.js';
import { createRest } from './rest.js';
import { DEFAULT_RELAY_OPTIONS, createRelay, type DisconnectOptions, type FaultType, type FrameLogEntry, type RelayOptions } from './relay.js';
import type { MockState, SeedData } from './state.js';
import { DEFAULT_SID, MockInputError, NOTICE_CODES, loadScenario, validateScenario, type ScenarioFile, type ScenarioStep } from './scenarios.js';
import { loadSeedData } from './data.js';

/** Options for startMockBackend. Everything is optional; the defaults give a virtual-clock mock with seed 1 on a free port. */
export interface MockOptions {
  /** 0 (default) picks a free port. */
  port?: number;
  seed?: number;
  /** `virtual` (default) only moves when told; `real` follows the wall clock. */
  clock?: 'virtual' | 'real';
  /** Relay limits to override (tests use small values). */
  relay?: Partial<RelayOptions>;
  /** Heartbeat advertised in `sys.welcome` and enforced by the relay. */
  heartbeat?: { ping_ms: number; dead_ms: number };
  /** A bundled scenario name, a path to a scenario `.json`, or a parsed scenario. */
  scenario?: string | ScenarioFile;
  /** Directory of seed files (see data.ts). */
  dataDir?: string;
  /** false: do not serve `/__mock/*` at all. */
  control?: boolean;
  /** Structured events (one object per event, never content). The CLI prints them to stderr as JSON lines. */
  log?: (e: Record<string, unknown>) => void;
}
export interface PeerScript { name?: string; steps: { at_ms?: number; frame: { t: string; k?: string; p?: Record<string, unknown>; id?: string } }[] }
export interface MockBackend {
  url: string; httpUrl: string; wsUrl: string; clock: Clock; virtual: VirtualClock | undefined; state: MockState; seed: number;
  stop(): Promise<void>;
  /** Replace the running scenario (pending steps and triggers of the previous one are cancelled; state it already changed stays). */
  setScenario(s: string | ScenarioFile): void;
  advance(ms: number): Promise<void>;
  frames(sid: string): readonly FrameLogEntry[];
  disconnect(o: DisconnectOptions): void;
  notice(sid: string, code: string, level: 'info' | 'warn' | 'error', params: object): void;
  addVirtualPeer(sid: string, role: 'host' | 'editor' | 'viewer', script: PeerScript): { stop(): void };
  mintToken(o?: { sub?: string; scp?: string; expSeconds?: number }): string;
  mintTicket(o: { sid: string; role?: 'host' | 'editor' | 'viewer'; mid?: string; expSeconds?: number }): string;
  control(op: string, body?: Record<string, any>): Promise<unknown>;
  relay: ReturnType<typeof createRelay>;
  reset(): void;
}

const loadDoc = (): Record<string, any> => JSON.parse(readFileSync(fileURLToPath(new URL('../../../protocol/src/generated/openapi.json', import.meta.url)), 'utf8'));
/** The control plane answers only these peers: the addresses the mock itself listens on. */
export const isLoopback = (addr: string | undefined): boolean => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
/** The only interface the mock binds. */
export const MOCK_HOST = '127.0.0.1';

function freshState(newId: ReturnType<typeof newIdGenerator>['next'], seed: SeedData): MockState {
  const user = newId('usr'); const s: MockState = {
    user: { id: user, email: 'dev@example.test', name: 'Dev Tester' }, workspace: newId('wsp'), ownerMember: newId('mem'),
    devices: new Map(), revokedTokens: new Set(), families: new Map(), deviceCodes: new Map(), usedJti: new Set(), idem: new Map(), sessions: new Map(), entitlements: new Map(), etags: new Map(), datasets: new Map(),
    pendingErrors: [], maintenance: false, counters: new Map(), seed, resources: new Map(),
  };
  const u = seed.users?.[0]; if (u) s.user = { id: u.id as MockState['user']['id'], email: String(u.email), name: String(u.display_name) };
  const w = seed.workspaces?.[0]; if (w) s.workspace = w.id as MockState['workspace'];
  for (const e of seed.entitlements ?? []) s.entitlements.set(String(e.workspace), e);
  return s;
}

/** Start a mock backend. Rejects with an `EADDRINUSE` error naming the port when it is taken, and with MockInputError for a bad scenario or seed directory. */
export async function startMockBackend(o: MockOptions = {}): Promise<MockBackend> {
  const initial = typeof o.scenario === 'string' ? loadScenario(o.scenario) : o.scenario ? checked(o.scenario, 'scenario') : undefined;
  const seed = o.seed ?? initial?.seed ?? 1; const virtual = (o.clock ?? 'virtual') === 'virtual' ? new VirtualClock() : undefined; const clock: Clock = virtual ?? new RealClock();
  const rng = createRng(seed); const ids = newIdGenerator({ now: () => clock.now(), random: (n) => rng.bytes(n) });
  const keys = [keyFromSeed(rng.bytes(32), 'mock-key-1')]; const doc = loadDoc();
  const opts: RelayOptions = { ...DEFAULT_RELAY_OPTIONS, ...o.relay, ...(o.heartbeat ? { ping_ms: o.heartbeat.ping_ms, dead_ms: o.heartbeat.dead_ms } : {}) };
  let seedData: SeedData = {}; let state = freshState(ids.next, seedData); let port = 0; const host = MOCK_HOST;
  const stateProxy = new Proxy({} as MockState, { get: (_t, k) => (state as any)[k], set: (_t, k, v) => { (state as any)[k] = v; return true; } });
  const relay = createRelay({ clock, newId: ids.next as any, keys, state: stateProxy, opts, observe: (sid, kind) => observe(sid, kind), log: o.log });
  const rest = createRest({ clock, rng, doc, state: stateProxy, keys, newId: ids.next as any, wsUrl: () => `ws://${host}:${port}/v1/ws`, issueTicket: relay.issueTicket, getOrCreateSession: relay.getOrCreateSession });
  if (o.dataDir) { seedData = loadSeedData(o.dataDir, rest.checkSchema); state = freshState(ids.next, seedData); }
  const applySessions = () => { for (const x of seedData.sessions ?? []) { const s = relay.getOrCreateSession(String(x.id)); s.workspace = x.workspace as typeof s.workspace; s.name = String(x.name); s.state = x.state as typeof s.state; } };
  applySessions();

  const server: Server = createServer(async (req, res: ServerResponse) => {
    if ((req.url ?? '').startsWith('/__mock/')) return controlPlane(req, res);
    if (o.log) res.once('finish', () => o.log!({ event: 'http', method: req.method, status: res.statusCode, request_id: res.getHeader('x-request-id') }));
    void rest.handle(req, res);
  });
  server.on('upgrade', (req, socket, head) => relay.onUpgrade(req, socket, head));

  /** `/__mock/<op>`: loopback peers only; anything else gets the same 404 as an unknown path. */
  async function controlPlane(req: IncomingMessage, res: ServerResponse) {
    const json = (s: number, b: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (o.control === false || !isLoopback(req.socket.remoteAddress)) return json(404, { error: 'not_found' });
    const chunks: Buffer[] = []; let size = 0; for await (const c of req) { size += (c as Buffer).length; if (size > 1 << 20) return json(413, { error: 'too_large' }); chunks.push(c as Buffer); }
    let body: Record<string, any> = {}; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { return json(400, { error: 'bad_json' }); }
    try { return json(200, (await control((req.url ?? '').slice(8).split('?')[0]!, body, new URL(req.url!, 'http://x').searchParams)) ?? {}); } catch (e) { return json(400, { error: (e as Error).message }); }
  }

  /* ------------------------------------------------------------ scenarios */
  let timers: TimerHandle[] = []; let triggers: { kind: string; nth: number; seen: number; sid?: string; step: ScenarioStep }[] = [];
  const FAULTS = new Set<string>(['delay', 'drop', 'duplicate', 'reorder']);
  function observe(sid: string, kind: string) {
    for (const t of triggers) {
      if (t.kind !== kind || (t.sid && t.sid !== sid) || ++t.seen !== t.nth) continue;
      /* a fault must hit the frame that fired it, so it runs now; anything else runs once that frame is on its way */
      if (FAULTS.has(t.step.do)) runAction(t.step); else queueMicrotask(() => runAction(t.step));
    }
  }
  function cancelScenario() { for (const t of timers) clock.clearTimeout(t); timers = []; triggers = []; }
  function runScenario(sc: ScenarioFile) {
    cancelScenario();
    for (const step of sc.steps) {
      if (step.on) triggers.push({ kind: step.on.kind, nth: step.on.nth ?? 1, seen: 0, sid: step.args.sid as string | undefined, step });
      else if (step.at_ms) timers.push(clock.setTimeout(() => runAction(step), step.at_ms));
      else runAction(step);
    }
  }
  const opaque = (bytes: number) => b64u.encode(rng.bytes(Math.ceil((bytes * 3) / 4))).slice(0, bytes);
  function runAction(step: ScenarioStep) {
    const a = step.args as Record<string, any>; const sid: string = a.sid ?? DEFAULT_SID;
    switch (step.do) {
      case 'disconnect': return relay.disconnect({ sid: a.sid, member: a.member, role: a.role, code: a.code, retryAfterS: a.retry_after_s, reason: a.reason, error: a.error });
      case 'notice': return relay.notice(sid, a.code, a.level ?? NOTICE_CODES[a.code]!.level, a.params);
      case 'error': {
        const code = a.code as ErrorCode;
        if (a.channel === 'ws') return relay.wsError({ sid: a.sid, code, count: a.count, retryAfterS: a.retry_after_s });
        if (a.min_version !== undefined) { state.minClient = a.min_version; return; }
        if (a.after !== undefined) { state.rateLimit = { remaining: a.after, retryAfterS: a.retry_after_s ?? 5 }; return; }
        if (a.sticky !== undefined) { state.sticky = a.sticky ? { code, retryAfterS: a.retry_after_s } : undefined; return; }
        for (let i = 0; i < (a.count ?? 1); i++) state.pendingErrors.push({ code, retryAfterS: a.retry_after_s });
        return;
      }
      case 'delay': case 'drop': case 'duplicate': case 'reorder': return relay.addFault({ sid: a.sid, type: step.do as FaultType, ms: a.ms, count: a.count });
      case 'peer_send': {
        const k = String(a.k); const t = a.t ?? (k.startsWith('queue.') ? 'queue' : k.startsWith('control.') ? 'control' : 'event');
        const sealed = a.ct_bytes !== undefined || (EVENT_MODES as Record<string, string>)[k] === 'encrypted';
        for (let i = 0; i < (a.count ?? 1); i++) {
          const frame = { t, k, ...(i === 0 && a.id ? { id: a.id } : {}), ...(a.p ? { p: a.p } : {}), ...(sealed ? { ct: { alg: 'xchacha20poly1305', kid: 'k1', n: opaque(32), c: opaque(a.ct_bytes ?? 64) }, sig: opaque(86) } : {}) };
          relay.peerSend(sid, { name: a.name ?? 'Peer', role: a.role ?? 'editor', frame: frame as never });
        }
        return;
      }
      case 'set_entitlement': {
        const w = String(a.workspace ?? state.workspace); const prev = state.entitlements.get(w) ?? {}; const next = a.entitlements as Record<string, any>;
        state.entitlements.set(w, { ...prev, ...next, limits: { ...((prev.limits as object | undefined) ?? {}), ...(next.limits ?? {}) }, rev: Number(prev.rev ?? 0) + 1 });
        return;
      }
    }
  }
  function checked(x: unknown, where: string): ScenarioFile { const r = validateScenario(x); if (!r.ok) throw new MockInputError(r.issues, where); return r.value; }
  const resolveScenario = (s: string | ScenarioFile) => (typeof s === 'string' ? loadScenario(s) : checked(s, 'scenario'));

  /* ------------------------------------------------------------ control operations (HTTP and programmatic) */
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
      case 'ticket': return relay.issueTicket(need(b.sid, 'sid'), { name: b.name, role: b.role, device: b.device, expSeconds: b.exp_seconds });
      case 'disconnect': relay.disconnect({ sid: b.sid, member: b.member, role: b.role, code: Number(need(b.code, 'code')), retryAfterS: b.retry_after_s, reason: b.reason }); return {};
      case 'notice': relay.notice(need(b.sid, 'sid'), need(b.code, 'code'), b.level ?? 'info', b.params ?? {}); return {};
      case 'fault': relay.addFault({ sid: b.sid, type: need(b.type, 'type'), ms: b.ms, count: b.count }); return {};
      case 'peer-send': return relay.peerSend(need(b.sid, 'sid'), { name: b.name, role: b.role, frame: need(b.frame, 'frame') });
      case 'frames': return relay.frames(need(q.get('sid') ?? b.sid, 'sid'));
      /* body is either {name} (bundled or a path) or a whole scenario {name, steps} */
      case 'scenario': { const sc = Array.isArray(b.steps) ? checked(b, 'scenario') : loadScenario(need(b.name, 'name')); runScenario(sc); return { name: sc.name, steps: sc.steps.length }; }
      default: throw new Error(`unknown control op ${op}`);
    }
  }
  function reset() { cancelScenario(); relay.reset(); state = freshState(ids.next, seedData); applySessions(); }

  await new Promise<void>((res, rej) => {
    server.once('error', (e: NodeJS.ErrnoException) => rej(e.code === 'EADDRINUSE' ? Object.assign(new Error(`EADDRINUSE: port ${o.port} on ${host} is already in use`), { code: 'EADDRINUSE' }) : e));
    server.listen(o.port ?? 0, host, () => res());
  });
  port = (server.address() as AddressInfo).port;
  if (initial) runScenario(initial);
  const url = `http://${host}:${port}`;
  let stopping: Promise<void> | undefined;
  return {
    url, httpUrl: url, wsUrl: `ws://${host}:${port}/v1/ws`, clock, virtual, seed, get state() { return state; }, relay, reset, control,
    setScenario: (sc) => runScenario(resolveScenario(sc)),
    advance: async (ms) => { if (!virtual) throw new Error('advance needs the virtual clock'); await virtual.advance(ms); },
    frames: (sid) => relay.frames(sid), disconnect: (x) => relay.disconnect(x), notice: (sid, code, level, params) => relay.notice(sid, code, level, params),
    addVirtualPeer(sid, role, script) { const ts = script.steps.map((st) => clock.setTimeout(() => { relay.peerSend(sid, { name: script.name ?? 'Peer', role, frame: { ...st.frame } as never }); }, st.at_ms ?? 0)); return { stop: () => ts.forEach((t) => clock.clearTimeout(t)) }; },
    mintToken(x = {}) { const now = Math.floor(clock.now() / 1000); const dev = ids.next('dev'); state.devices.set(dev, { id: dev, name: 'Minted', revoked: false }); return signJwt(keys[0]!, { iss: 'https://api.centcom.dev', aud: 'centcom-api', sub: x.sub ?? state.user.id, dev, scp: x.scp ?? 'sessions workspaces', iat: now, exp: now + (x.expSeconds ?? 900), jti: ids.next('req') }); },
    mintTicket: (x) => relay.issueTicket(x.sid, { role: x.role, member: x.mid, expSeconds: x.expSeconds }).ticket,
    /** Close every WebSocket with 1001, then the HTTP server. Safe to call twice. */
    stop: () => (stopping ??= (async () => {
      cancelScenario(); const closed = new Promise<void>((r) => server.close(() => r()));
      await relay.shutdown(); server.closeAllConnections(); await closed; o.log?.({ event: 'stopped' });
    })()),
  };
}
