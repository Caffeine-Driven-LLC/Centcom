/** RelayClient: one WebSocket to a Centcom endpoint (hosted relay or LAN host). Owns the socket, the handshake, the heartbeat,
 *  the reconnect state machine, inbound validation and send shaping (CT-WS-ENVELOPE, CT-VER).
 *  Must not: know what a frame means beyond sys.*, track seq or resend (lane C055), decrypt (C056), mint tickets (C057);
 *  put the ticket anywhere but hello.p; log p, ct, sig, tickets or names; open a second socket while one is up. */
import { WebSocket } from 'ws';
import { assertWritableFrame, parseFrame, type Frame } from '@centcom/protocol';
import { CentcomError, fromWsError } from '../errors/index.js';
import type { Logger } from '../log/index.js';
import { defaultUserAgent } from '../http/client.js';
import { CLOSE_POLICY, closePolicy } from './close-codes.js';
import { TypedEmitter } from './emitter.js';
import { FrameTooLargeError, RelayError } from './errors.js';
import { DEFAULT_CAPS, DEFAULT_PROTOCOLS, HELLO_TIMEOUT_MS, SUBPROTOCOL, buildHello, checkProtocol, checkRelayUrl, negotiateCaps, readWelcome, type ClientIdent, type Welcome } from './handshake.js';
import { DeadDetector, deadMsFrom, pongFor, type RelayClock } from './heartbeat.js';
import { ReconnectPlanner, STABLE_RESET_MS, type ReconnectDecision } from './reconnect.js';
import { MAX_FRAME_BYTES, MAX_SLOW_DOWN_MS, SendLimiter, limitsFromWelcome, sendClassOf, type SendLimits } from './send-limiter.js';

/** Bound on a socket's close handshake before it is cut. */
export const CLOSE_GRACE_MS = 3_000;
/** Bound on getTicket() and onAuthFailure(). */
export const TICKET_TIMEOUT_MS = 10_000;

/** Frame types this build knows. Anything else is valid by CT-VER but ignored. */
const KNOWN_TYPES = new Set(['sys.hello', 'sys.welcome', 'sys.ping', 'sys.pong', 'sys.error', 'sys.slow_down', 'sys.notice', 'sys.resume', 'sys.resumed', 'sys.bye', 'event', 'queue', 'control', 'presence', 'ack']);

/** A frame to send. `v` defaults to 1; `from`, `ts` and `seq` are server-stamped and stripped if present. */
export type OutboundFrame = Omit<Frame, 'v'> & { v?: 1 };
export type RelayState = 'idle' | 'connecting' | 'handshaking' | 'ready' | 'backoff' | 'closed';
export type LinkState = 'online' | 'reconnecting' | 'offline';
export interface ClosedInfo { code: number; reason: string; willReconnect: boolean; /** C006 message key for what to tell the person, when the code has one */ userFacing?: string }
export interface RelayEvents {
  welcome: [Welcome]; frame: [Frame]; notice: [Record<string, unknown>]; error: [CentcomError]; slow_down: [number];
  link: [LinkState]; closed: [ClosedInfo]; protocol_warning: [{ reason: string }];
}

/** The socket surface the client uses; `ws`'s WebSocket fits, and tests pass an in-memory one. */
export interface RelaySocket {
  readonly readyState: number; readonly protocol: string; readonly bufferedAmount: number;
  send(data: string, cb: (err?: Error) => void): void;
  close(code?: number, reason?: string): void; terminate(): void;
  on(ev: 'open', fn: () => void): unknown;
  on(ev: 'message', fn: (data: unknown, isBinary: boolean) => void): unknown;
  on(ev: 'close', fn: (code: number, reason: unknown) => void): unknown;
  on(ev: 'error', fn: (e: Error) => void): unknown;
}
export interface WsFactoryOptions { headers: Record<string, string>; maxPayload: number; perMessageDeflate: false; handshakeTimeout: number }
export type WsFactory = (url: string, protocols: string[], o: WsFactoryOptions) => RelaySocket;
const defaultWsFactory: WsFactory = (url, protocols, o) => new WebSocket(url, protocols, o) as unknown as RelaySocket;

export interface RelayClientOptions {
  /** Where to dial; the `url` from getTicket() wins when present (the join-token's relay_url). */
  url: string;
  sessionId: string;
  /** A fresh single-use ticket for every attempt (lane C057). A CentcomError with status 403 stops the client. */
  getTicket(): Promise<{ ticket: string; url?: string }>;
  /** `last_seq` for hello (lane C055: highest contiguous seq processed, or null). */
  getLastSeq(): number | null;
  clientInfo: ClientIdent;
  /** default ['resume'] */
  caps?: string[];
  /** default [1] */
  protocols?: number[];
  /** plain ws:// to a loopback, link-local or private address (LAN only) */
  allowPlainWs?: boolean;
  /** After a 4401: refresh the access token. True means try once more. Missing means true (the next attempt fetches a new ticket anyway). */
  onAuthFailure?(): Promise<boolean>;
  /** default 10000 */
  helloTimeoutMs?: number;
  clock?: RelayClock; rng?: () => number; wsFactory?: WsFactory; logger?: Logger;
  /** default: the CT-VER User-Agent for clientInfo.version */
  userAgent?: string;
}

/** What lanes C055, C072 and C074 build on: a frame pipe with a welcome and link events. */
export interface FrameLink {
  send(f: OutboundFrame): Promise<void>;
  on<K extends 'welcome' | 'frame' | 'link' | 'closed'>(ev: K, fn: (...a: RelayEvents[K]) => void): () => void;
  readonly welcome: Welcome | null; readonly state: string;
  /** Drop the current connection and reconnect (gap recovery). Not on the C054 card; optional so other links may omit it. */
  reconnect?(): void;
}

const realClock: RelayClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const cryptoRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');
type TimerName = 'open' | 'welcome' | 'reconnect' | 'stable' | 'kill';
type LocalReason = 'open_timeout' | 'welcome_timeout' | 'dead' | 'requested' | 'protocol_mismatch' | 'subprotocol';

/** One connection per session. See README.md for the state machine. */
export class RelayClient extends TypedEmitter<RelayEvents> implements FrameLink {
  private readonly clock: RelayClock; private readonly rng: () => number; private readonly log?: Logger;
  private readonly protocols: readonly number[]; private readonly caps: readonly string[]; private readonly helloTimeoutMs: number; private readonly ua: string;
  private readonly planner: ReconnectPlanner; private readonly limiter: SendLimiter;
  private _state: RelayState = 'idle'; private _welcome: Welcome | null = null; private _caps: ReadonlySet<string> = new Set(); private _limits: SendLimits = limitsFromWelcome({});
  private sock: RelaySocket | null = null; private gen = 0; private link: LinkState | null = null;
  private timers: Partial<Record<TimerName, unknown>> = {};
  private dead?: DeadDetector; private localReason?: LocalReason; private fatal?: RelayError; private userClosing = false; private socketError?: Error;
  private retryAfterS?: number; private waiters: { resolve: (w: Welcome) => void; reject: (e: unknown) => void }[] = []; private closeWaiters: (() => void)[] = [];
  /** inbound frames dropped as invalid since construction (for status and tests) */
  invalidFrames = 0;

  constructor(private readonly opts: RelayClientOptions) {
    super(() => this.log?.warn('relay.listener_failed'));
    this.clock = opts.clock ?? realClock; this.rng = opts.rng ?? cryptoRandom; this.log = opts.logger?.child({ component: 'relay', session_id: opts.sessionId });
    this.protocols = opts.protocols ?? DEFAULT_PROTOCOLS; this.caps = opts.caps ?? DEFAULT_CAPS; this.helloTimeoutMs = opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.ua = opts.userAgent ?? defaultUserAgent(opts.clientInfo.version, opts.clientInfo.name === 'centcom-tui' || opts.clientInfo.name === 'centcom-web' ? opts.clientInfo.name : 'centcom-cli');
    this.planner = new ReconnectPlanner(this.rng, () => this.clock.now());
    this.limiter = new SendLimiter({ clock: this.clock, write: (t) => this.writeRaw(t), bufferedAmount: () => this.sock?.bufferedAmount ?? 0 });
  }

  get state(): RelayState { return this._state; }
  get welcome(): Welcome | null { return this._welcome; }
  get negotiatedCaps(): ReadonlySet<string> { return this._caps; }
  get limits(): SendLimits { return this._limits; }
  /** n in the next backoff delay (for status and tests) */
  get attempt(): number { return this.planner.attempt; }

  /** Start connecting; resolves on the first welcome, rejects if the client stops for good first. Calling it again while connecting or connected is a no-op. */
  connect(): Promise<Welcome> {
    if (this._state === 'ready' && this._welcome) return Promise.resolve(this._welcome);
    const p = new Promise<Welcome>((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (this._state === 'idle' || this._state === 'closed') { this.userClosing = false; this.fatal = undefined; this.planner.reset(); void this.attempt_(); }
    return p;
  }

  /** Write one frame. Resolves once it is on the socket. Rejects with FrameTooLargeError, OutboundBufferFullError, a ProtocolError for a frame the schema does not allow, or RelayError (not_connected, capability_not_negotiated). */
  send(frame: OutboundFrame): Promise<void> {
    const f: Record<string, unknown> = { ...frame, v: 1 }; delete f.from; delete f.ts; delete f.seq;
    let text: string; try { text = JSON.stringify(f); } catch (e) { return Promise.reject(e); }
    const bytes = byteLength(text); const limit = Math.min(MAX_FRAME_BYTES, this._limits.maxFrameBytes);
    if (bytes > limit) return Promise.reject(new FrameTooLargeError(bytes, limit));
    const t = f.t as string;
    if (t === 'sys.hello' || t === 'sys.welcome') return Promise.reject(new RelayError('not_connected', { message: 'the handshake is the client\'s job' }));
    try { assertWritableFrame(f); } catch (e) { return Promise.reject(e); }
    if (t === 'sys.resume' && !this._caps.has('resume')) return Promise.reject(new RelayError('capability_not_negotiated', { message: 'server did not advertise resume' }));
    if (this._state !== 'ready') return Promise.reject(new RelayError('not_connected', { kind: 'network' }));
    return this.limiter.submit(sendClassOf(t), text, bytes);
  }

  /** Close for good (no reconnect). Resolves when the socket is closed, at most CLOSE_GRACE_MS later on the injected clock. */
  close(code = 1000, reason = ''): Promise<void> {
    this.userClosing = true; this.clearTimer('reconnect'); this.clearTimer('stable');
    const err = new RelayError('closed', { kind: 'aborted', message: 'closed by the caller' });
    if (!this.sock) {
      this.gen++; if (this._state !== 'closed' && this._state !== 'idle') { this.setState('closed'); this.emitClosed({ code, reason, willReconnect: false }); this.setLink('offline'); } else this.setState('closed');
      this.rejectWaiters(err); return Promise.resolve();
    }
    const done = new Promise<void>((r) => this.closeWaiters.push(r));
    this.closeSocket(code, reason); this.rejectWaiters(err); return done;
  }

  /** Drop this connection and reconnect after a short jitter (lane C055 uses it when a gap does not heal). */
  reconnect(): void {
    if (this.userClosing || this._state === 'closed' || this._state === 'idle') return;
    if (this.sock) { this.localReason = 'requested'; this.closeSocket(1000, 'reconnect'); return; }
    if (this._state === 'backoff') { this.clearTimer('reconnect'); this.schedule(this.planner.requested()); }
  }

  /* ------------------------------------------------------------ attempts */

  private async attempt_(): Promise<void> {
    const gen = ++this.gen; this.setState('connecting'); this.localReason = undefined; this.socketError = undefined; this.retryAfterS = undefined;
    let t: { ticket: string; url?: string };
    try { t = await this.bounded(this.opts.getTicket(), 'ticket'); } catch (e) {
      if (gen !== this.gen) return;
      const status = (e as { status?: number }).status; const code = (e as { code?: string }).code;
      this.log?.warn('relay.ticket_failed', { status, code });
      if (status === 403 || code === 'forbidden' || code === 'not_a_member') return this.stop({ code: 4403, reason: 'ticket_forbidden', willReconnect: false, userFacing: 'forbidden' }, new RelayError('ticket_failed', { kind: 'api', code: 'forbidden', closeCode: 4403, cause: e }));
      return this.afterFailure(this.planner.local(), false);
    }
    if (gen !== this.gen) return;
    if (typeof t?.ticket !== 'string' || !t.ticket) return this.afterFailure(this.planner.local(), false);
    const checked = checkRelayUrl(t.url ?? this.opts.url, { allowPlainWs: this.opts.allowPlainWs });
    if (!checked.ok) { this.log?.error('relay.url_refused', { reason: checked.reason }); return this.stop({ code: 1000, reason: 'url_refused', willReconnect: false }, new RelayError('url_refused', { message: checked.reason })); }

    let sock: RelaySocket;
    try { sock = (this.opts.wsFactory ?? defaultWsFactory)(checked.url, [SUBPROTOCOL], { headers: { 'User-Agent': this.ua }, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, handshakeTimeout: this.helloTimeoutMs }); } catch (e) {
      this.log?.warn('relay.socket_failed', { error: (e as Error)?.name }); return this.afterFailure(this.planner.local(), false);
    }
    this.sock = sock; const ticket = t.ticket;
    this.timers.open = this.clock.setTimeout(() => { if (gen === this.gen && this.sock === sock && this._state === 'connecting') { this.localReason = 'open_timeout'; this.closeSocket(4408, 'open timeout'); } }, this.helloTimeoutMs);
    sock.on('open', () => { if (gen === this.gen) this.onOpen(sock, ticket); });
    sock.on('message', (data, isBinary) => { if (gen === this.gen && this.sock === sock) this.onMessage(data, isBinary); });
    sock.on('error', (e) => { if (gen !== this.gen) return; this.socketError = e; if (/subprotocol/i.test(String(e?.message))) this.fatal ??= new RelayError('subprotocol', { message: 'server did not select centcom.v1' }); });
    sock.on('close', (code, reason) => { if (gen === this.gen && this.sock === sock) void this.onClose(code, reason); });
  }

  private onOpen(sock: RelaySocket, ticket: string): void {
    this.clearTimer('open');
    if (sock.protocol !== SUBPROTOCOL) { this.fatal = new RelayError('subprotocol', { message: 'server did not select centcom.v1' }); this.localReason = 'subprotocol'; this.closeSocket(4400, 'subprotocol'); return; }
    this.setState('handshaking'); this.limiter.resume();
    let last: number | null = null; try { const v = this.opts.getLastSeq(); last = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null; } catch { last = null; }
    const hello = buildHello({ protocols: this.protocols, caps: this.caps, ticket, client: this.opts.clientInfo, lastSeq: last });
    this.writeRaw(JSON.stringify(hello)).catch(() => undefined);
    this.log?.info('relay.hello', { last_seq: last, caps: this.caps.length });
    this.timers.welcome = this.clock.setTimeout(() => { if (this.sock === sock && this._state === 'handshaking') { this.log?.warn('relay.welcome_timeout'); this.localReason = 'welcome_timeout'; this.closeSocket(4408, 'welcome timeout'); } }, this.helloTimeoutMs);
  }

  private onMessage(data: unknown, isBinary: boolean): void {
    this.dead?.touch();
    if (isBinary) return this.warn('binary_frame');
    const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data as Buffer[]).toString('utf8') : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : null;
    if (text === null) return this.warn('binary_frame');
    const bytes = byteLength(text); if (bytes > MAX_FRAME_BYTES) return this.warn('oversize', bytes);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return this.warn('not_json', bytes); }
    if (this._state === 'handshaking' && (raw as { t?: unknown } | null)?.t === 'sys.welcome' && !checkProtocol(raw, this.protocols)) return this.protocolMismatch();
    const r = parseFrame(raw); if (!r.ok) return this.warn('invalid_frame', bytes);
    const f = r.value;
    if (!KNOWN_TYPES.has(f.t)) { this.log?.debug('relay.unknown_type', { bytes }); return; }
    this.log?.trace('relay.frame', { t: f.t, k: f.k, seq: f.seq, bytes });
    switch (f.t) {
      case 'sys.welcome':
        if (this._state !== 'handshaking') { this.log?.debug('relay.extra_welcome'); return; }
        if (!this.onWelcome(f)) return;
        break;
      case 'sys.ping': this.writeRaw(JSON.stringify(pongFor(f))).catch(() => undefined); break;
      case 'sys.error': { const e = fromWsError(f.p); if (e.retryAfterS !== undefined) this.retryAfterS = e.retryAfterS; this.log?.warn('relay.sys_error', { code: e.code, status: e.status }); this.emit('error', e); break; }
      case 'sys.slow_down': { const ms = typeof f.p?.for_ms === 'number' && f.p.for_ms > 0 ? Math.min(f.p.for_ms, MAX_SLOW_DOWN_MS) : 1000; this.limiter.pauseFor(ms); this.log?.info('relay.slow_down', { for_ms: ms }); this.emit('slow_down', ms); break; }
      case 'sys.notice': this.emit('notice', (f.p ?? {}) as Record<string, unknown>); break;
      case 'sys.bye': this.log?.info('relay.bye', { reason: typeof f.p?.reason === 'string' && /^[a-z_]{1,32}$/.test(f.p.reason) ? f.p.reason : 'other' }); break;
    }
    this.emit('frame', f);
  }

  /** False when the welcome was refused (the socket is closing). */
  private onWelcome(f: Frame): boolean {
    const r = readWelcome(f, this.protocols);
    if (!r.ok) { if (r.reason === 'protocol_mismatch') this.protocolMismatch(); else this.warn('invalid_welcome'); return false; }
    const w = r.welcome; this.clearTimer('welcome');
    this._welcome = w; this._caps = negotiateCaps(this.caps, w.caps); this._limits = limitsFromWelcome(w.limits); this.limiter.setLimits(this._limits);
    this.planner.onWelcome(); this.setState('ready');
    const sock = this.sock; this.dead = new DeadDetector(this.clock, deadMsFrom(w.heartbeat), () => { if (this.sock === sock) { this.log?.warn('relay.dead'); this.localReason = 'dead'; this.closeSocket(1001, 'dead'); } }); this.dead.start();
    this.timers.stable = this.clock.setTimeout(() => { this.timers.stable = undefined; if (this.sock === sock && this._state === 'ready') this.planner.resetAttempts(); }, STABLE_RESET_MS);
    this.log?.info('relay.welcome', { protocol: w.protocol, caps: this._caps.size, role: w.role });
    this.setLink('online'); this.emit('welcome', w);
    for (const x of this.waiters.splice(0)) x.resolve(w);
    return true;
  }

  private protocolMismatch(): void {
    const e = new RelayError('protocol_mismatch', { code: 'unsupported_protocol', closeCode: 4400, message: 'welcome chose a protocol we did not offer' });
    this.fatal = e; this.localReason = 'protocol_mismatch'; this.log?.error('relay.protocol_mismatch'); this.emit('error', e); this.closeSocket(4400, 'protocol mismatch');
  }

  private async onClose(code: number, reasonRaw: unknown): Promise<void> {
    const reason = (Buffer.isBuffer(reasonRaw) ? reasonRaw.toString('utf8') : typeof reasonRaw === 'string' ? reasonRaw : '').slice(0, 123);
    const wasReady = this._state === 'ready'; const local = this.localReason; const retryAfterS = this.retryAfterS;
    this.sock = null; this.dead?.stop(); this.dead = undefined; for (const k of ['open', 'welcome', 'stable', 'kill'] as const) this.clearTimer(k);
    this.limiter.failAll(new RelayError('not_connected', { kind: 'network', message: 'connection closed before the frame was written' }));
    this._welcome = null; this._caps = new Set(); this.localReason = undefined; this.retryAfterS = undefined;
    this.log?.info('relay.closed', { code, local, was_ready: wasReady });
    if (this.userClosing) {
      this.setState('closed'); this.emitClosed({ code, reason, willReconnect: false }); this.setLink('offline'); for (const r of this.closeWaiters.splice(0)) r(); return;
    }
    if (this.fatal) { const e = this.fatal; return this.stop({ code: e.localCode === 'protocol_mismatch' ? 4400 : code, reason: e.localCode, willReconnect: false }, e); }
    let d: ReconnectDecision = local === 'requested' ? this.planner.requested() : local ? this.planner.local() : this.planner.decide(code, retryAfterS);
    const userFacing = local ? undefined : CLOSE_POLICY[code]?.userFacing;
    if (d.reconnect && d.refreshAuth) {
      const gen = this.gen; this.setState('backoff');
      let ok = true; if (this.opts.onAuthFailure) { try { ok = (await this.bounded(this.opts.onAuthFailure(), 'auth')) === true; } catch { ok = false; } }
      if (gen !== this.gen || this.userClosing) return;
      if (!ok) d = { reconnect: false, delayMs: 0, reason: 'auth_failed' };
    }
    if (!d.reconnect) return this.stop({ code, reason, willReconnect: false, ...(userFacing ? { userFacing } : {}) }, new RelayError('closed', { kind: 'api', code: closePolicy(code).userFacing, closeCode: code, message: d.reason }));
    this.emitClosed({ code, reason, willReconnect: true, ...(userFacing ? { userFacing } : {}) });
    this.afterFailure(d, wasReady);
  }

  /** Schedule the next attempt; the link reads `reconnecting` after a drop from ready, `offline` after a failed attempt. */
  private afterFailure(d: ReconnectDecision, wasReady: boolean): void {
    this.setLink(wasReady ? 'reconnecting' : 'offline'); this.schedule(d);
  }
  private schedule(d: ReconnectDecision): void {
    this.setState('backoff'); this.log?.info('relay.reconnect', { attempt: this.planner.attempt, delay_ms: d.delayMs, why: d.reason });
    const gen = this.gen; this.timers.reconnect = this.clock.setTimeout(() => { this.timers.reconnect = undefined; if (gen === this.gen && !this.userClosing) void this.attempt_(); }, d.delayMs);
  }

  /** Stop for good: one closed event, link offline, connect() rejected. */
  private stop(info: ClosedInfo, err: RelayError): void {
    this.gen++; this.setState('closed'); this.log?.warn('relay.stopped', { code: info.code, why: err.localCode });
    this.emitClosed(info); this.setLink('offline'); this.rejectWaiters(err);
  }

  /* ------------------------------------------------------------ helpers */

  private writeRaw(text: string): Promise<void> {
    const s = this.sock; if (!s || s.readyState !== 1) return Promise.reject(new RelayError('not_connected', { kind: 'network' }));
    return new Promise<void>((resolve, reject) => { try { s.send(text, (err) => (err ? reject(new RelayError('not_connected', { kind: 'network', cause: err })) : resolve())); } catch (e) { reject(new RelayError('not_connected', { kind: 'network', cause: e })); } });
  }
  /** Close the socket with a bound: if the close handshake has not finished after CLOSE_GRACE_MS, cut it. */
  private closeSocket(code: number, reason: string): void {
    const s = this.sock; if (!s) return;
    try { s.close(code, reason); } catch { try { s.terminate(); } catch { /* already gone */ } }
    this.clearTimer('kill'); this.timers.kill = this.clock.setTimeout(() => { this.timers.kill = undefined; if (this.sock === s) { try { s.terminate(); } catch { /* already gone */ } } }, CLOSE_GRACE_MS);
  }
  private bounded<T>(p: Promise<T>, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const h = this.clock.setTimeout(() => reject(new RelayError('ticket_failed', { kind: 'timeout', message: `${what} timed out` })), TICKET_TIMEOUT_MS);
      Promise.resolve(p).then((v) => { this.clock.clearTimeout(h as never); resolve(v); }, (e) => { this.clock.clearTimeout(h as never); reject(e); });
    });
  }
  private clearTimer(k: TimerName): void { const h = this.timers[k]; if (h !== undefined) this.clock.clearTimeout(h as never); this.timers[k] = undefined; }
  private setState(s: RelayState): void { if (this._state !== s) { this._state = s; this.log?.debug('relay.state', { state: s }); } }
  private setLink(l: LinkState): void { if (this.link !== l) { this.link = l; this.emit('link', l); } }
  private emitClosed(info: ClosedInfo): void { this.emit('closed', info); }
  private rejectWaiters(e: unknown): void { for (const x of this.waiters.splice(0)) x.reject(e); }
  private warn(reason: string, bytes?: number): void { this.invalidFrames++; this.log?.warn('relay.frame_dropped', { reason, bytes }); this.emit('protocol_warning', { reason }); }
}
