/** The LAN host server: the relay's job on a local network (CT-LAN). It accepts guests with local reconnect tokens, numbers the frames, fans them out, replays what a guest missed and enforces the hosted relay's limits and close codes. */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseFrame, type Frame } from '@centcom/protocol';
import type { LanClock } from '../clock.js';
import type { BanList } from '../pairing/ban-list.js';
import type { PairConn, PairingHandler } from '../pairing/messages.js';
import type { TokenValidator } from '../pairing/reconnect-token.js';
import { LoopbackLink, type LoopbackHost } from './loopback.js';
import { Bucket, DEAD_MS, HOST_DEFAULT_PORT, DEDUPE_MS, HELLO_TIMEOUT_MS, INVALID_PER_MINUTE, MAX_FRAME_BYTES, MAX_MEMBERS, OUTBOUND_LIMIT_BYTES, PING_MS, PRESENCE_RATE, REPLAY_MIN_FRAMES, REPLAY_MIN_MS, SEQ_BURST, SEQ_RATE, SLOW_DOWN_MS } from './limits.js';
import { PresenceCoalescer } from './presence-coalescer.js';
import { ReplayBuffer } from './replay-buffer.js';
import { Sequencer } from './sequencer.js';
import { TranscriptFile } from './transcript-file.js';
void DEDUPE_MS;

export interface HostMember { id: string; name: string; slot: number; role: 'host' | 'editor' | 'viewer' }
export interface ProblemBody { code: string; status?: number; title?: string; detail?: string; [k: string]: unknown }
export type ServerFrame = Omit<Frame, 'v' | 'from' | 'ts' | 'seq' | 'sid'> & { v?: 1 };
export interface FrameInterceptor { onInbound(ctx: { from: HostMember; frame: Frame }): 'accept' | { reject: ProblemBody } | { replace: Frame[] }; /** after the frame was numbered and sent to everyone (the engine updates its state and sends what follows from it) */ onSequenced?(frame: Frame): void }
export interface ServerHooks { connected?(m: ConnectedMember, first: boolean): void; disconnected?(m: ConnectedMember): void; left?(memberId: string): void }
export interface SnapshotProvider { get(sid: string): Promise<{ seq: number; bytes: Uint8Array } | null> }
export interface ConnectedMember { memberId: string; deviceId: string; name: string; role: HostMember['role']; slot: number; remoteIp: string }
export type LanTokenValidator = TokenValidator;
export interface LanHostOptions {
  sessionId: string; sessionName: string; hostMember: HostMember; port?: number; bind?: string; allowWan?: boolean; maxMembers?: number; tokens: LanTokenValidator; pairing?: PairingHandler; bans?: BanList; interceptor?: FrameInterceptor; snapshots?: SnapshotProvider;
  transcriptPath: string; clock: LanClock; ids: { next(prefix: 'msg' | 'req'): string }; rng?: () => number; logger?: { warn(m: string, c?: Record<string, unknown>): void; info?(m: string, c?: Record<string, unknown>): void };
  /** how long the replay buffer keeps frames beyond its minimum count (tests shrink these) */ replayMinFrames?: number; replayMinMs?: number; outboundLimitBytes?: number; memberGraceMs?: number;
}
export class PublicBindRefusedError extends Error { constructor(readonly address: string) { super(`Refusing to listen on ${address}: it is a public address. Use --allow-wan to do this on purpose.`); this.name = 'PublicBindRefusedError'; } }

interface Conn { id: string; ws: WebSocket; remoteIp: string; authed: boolean; member?: ConnectedMember; helloTimer?: unknown; pingTimer?: unknown; lastActive: number; seqBucket: Bucket; presBucket: Bucket; invalid: number[]; slowAt: number; ackSeq: number; closing: boolean; pair?: PairConn; pairing?: boolean }
const SERVER_ONLY = new Set(['queue.state', 'control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']);
const SEQUENCED = new Set(['event', 'queue', 'control']);
/** 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, fc00::/7, fe80::/10, ::1 and the wildcard addresses are not "public". */
export function isPublicAddress(ip: string): boolean {
  const a = ip.replace(/^\[|\]$/g, '').toLowerCase().replace(/^::ffff:/, ''); if (a === '0.0.0.0' || a === '::' || a === '' || a === 'localhost' || a === '::1') return false;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a); if (m) { const [x, y] = [Number(m[1]), Number(m[2])]; return !(x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127)); }
  return !(/^f[cd]/.test(a) || /^fe[89ab]/.test(a));
}

export class LanHostServer implements LoopbackHost {
  private http?: Server; private wss?: WebSocketServer; private readonly conns = new Set<Conn>(); private readonly seqr = new Sequencer(); private readonly buffer: ReplayBuffer; private readonly transcript: TranscriptFile; private readonly presence: PresenceCoalescer;
  private hooks: ServerHooks = {}; private readonly roleOverride = new Map<string, HostMember['role']>(); private readonly slotOf = new Map<string, number>(); private connSeq = 0; private rosterV = 1; private readonly joined = new Set<string>(); private readonly leaveTimers = new Map<string, unknown>(); private loopback?: LoopbackLink; private stopped = false; private snapshotReq = new Map<Conn, number>();
  constructor(private readonly o: LanHostOptions) {
    this.buffer = new ReplayBuffer(o.replayMinFrames ?? REPLAY_MIN_FRAMES, o.replayMinMs ?? REPLAY_MIN_MS); this.transcript = new TranscriptFile(o.transcriptPath, (m) => o.logger?.warn(m));
    this.presence = new PresenceCoalescer(o.clock, (f) => this.fanOut(f), (member, f) => ({ ...f, from: member, ts: this.iso() }));
  }
  private iso(): string { return new Date(this.o.clock.now()).toISOString(); }
  headSeq(): number { return this.seqr.head(); }
  setInterceptor(i: FrameInterceptor | undefined): void { (this.o as { interceptor?: FrameInterceptor }).interceptor = i; }
  setHooks(h: ServerHooks): void { this.hooks = h; }
  setSnapshots(p: SnapshotProvider | undefined): void { (this.o as { snapshots?: SnapshotProvider }).snapshots = p; }
  /** A member was removed for good (kick): close its connections without the usual leave timer, and forget that it joined. */
  dropMember(memberId: string, closeCode = 4403): void { const t = this.leaveTimers.get(memberId); if (t !== undefined) { this.o.clock.clearTimeout(t as never); this.leaveTimers.delete(memberId); } for (const c of this.liveOf(memberId)) { this.sysError(c, 'forbidden'); this.close(c, closeCode); } this.joined.delete(memberId); this.roleOverride.delete(memberId); this.presence.forget(memberId); this.removed.add(memberId); }
  private readonly removed = new Set<string>();
  /** A role changed (kick, role, transfer): live connections and later hellos use it from the next frame. */
  setRole(memberId: string, role: HostMember['role']): void { this.roleOverride.set(memberId, role); for (const c of this.conns) if (c.member?.memberId === memberId) c.member.role = role; if (memberId === this.o.hostMember.id) this.o.hostMember.role = role; }
  roleOf(memberId: string): HostMember['role'] | undefined { return this.roleOverride.get(memberId) ?? [...this.conns].find((c) => c.member?.memberId === memberId)?.member?.role ?? (memberId === this.o.hostMember.id ? this.o.hostMember.role : undefined); }
  members(): ConnectedMember[] { return [...this.conns].filter((c) => c.authed && c.member).map((c) => ({ ...c.member! })); }

  /* ------------------------------------------------------------- start and stop */
  async start(): Promise<{ port: number; addresses: string[] }> {
    const bind = this.o.bind ?? '0.0.0.0'; if (isPublicAddress(bind) && !this.o.allowWan) throw new PublicBindRefusedError(bind); if (isPublicAddress(bind)) this.o.logger?.warn('lan.public_bind', { address: bind });
    const http = createServer((_req, res) => { res.writeHead(426, { 'content-type': 'text/plain' }); res.end('Centcom LAN host: use a WebSocket.'); }); this.http = http;
    this.wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has('centcom.v1') ? 'centcom.v1' : false), maxPayload: 2 * MAX_FRAME_BYTES, perMessageDeflate: false });
    http.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    const port = await this.listen(http, bind, this.o.port ?? HOST_DEFAULT_PORT); return { port, addresses: this.addressesOf(bind) };
  }
  private listen(http: Server, bind: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => { const attempt = (p: number): void => { const onErr = (e: NodeJS.ErrnoException): void => { http.off('listening', onOk); if (e.code === 'EADDRINUSE' && p !== 0) attempt(0); else reject(e); }; const onOk = (): void => { http.off('error', onErr); resolve((http.address() as { port: number }).port); }; http.once('error', onErr); http.once('listening', onOk); http.listen(p, bind); }; attempt(port); });
  }
  private addressesOf(bind: string): string[] { if (bind !== '0.0.0.0' && bind !== '::') return [bind]; const out: string[] = []; for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address); return out.length ? out : ['127.0.0.1']; }
  async stop(code = 1001): Promise<void> {
    this.stopped = true; this.presence.stop(); for (const c of [...this.conns]) { this.clearTimers(c); try { c.ws.close(code); } catch { /* already closing */ } } for (const t of this.leaveTimers.values()) this.o.clock.clearTimeout(t as never); this.leaveTimers.clear(); this.loopback?.closed(code);
    await new Promise<void>((r) => { if (!this.wss) return r(); this.wss.close(() => r()); }); await new Promise<void>((r) => { if (!this.http) return r(); this.http.closeAllConnections?.(); this.http.close(() => r()); }); await this.transcript.close();
  }

  /* ------------------------------------------------------------- connections */
  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''); if (this.o.bans?.isBanned(ip)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    this.wss!.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip));
  }
  private onConnection(ws: WebSocket, ip: string): void {
    const now = this.o.clock.now(); const c: Conn = { id: `c${++this.connSeq}`, ws, remoteIp: ip, authed: false, lastActive: now, seqBucket: new Bucket(SEQ_RATE, SEQ_BURST, now), presBucket: new Bucket(PRESENCE_RATE, PRESENCE_RATE, now), invalid: [], slowAt: -Infinity, ackSeq: 0, closing: false }; this.conns.add(c);
    c.helloTimer = this.o.clock.setTimeout(() => { if (!c.authed && !c.pairing) this.close(c, 4408); }, HELLO_TIMEOUT_MS);
    ws.on('message', (data, isBinary) => { void this.onMessage(c, isBinary ? null : data.toString()).catch(() => this.close(c, 1011)); }); ws.on('close', () => this.onClose(c)); ws.on('error', () => undefined);
  }
  private send(c: Conn, f: Record<string, unknown>): void {
    if (c.ws.readyState !== 1) return; const text = JSON.stringify({ v: 1, ...f }); if (c.ws.bufferedAmount + text.length > (this.o.outboundLimitBytes ?? OUTBOUND_LIMIT_BYTES)) { this.close(c, 4429); return; } try { c.ws.send(text); } catch { /* the socket went away */ }
  }
  private sysError(c: Conn, code: string, extra: Record<string, unknown> = {}): void { this.send(c, { t: 'sys.error', ts: this.iso(), p: { type: `https://centcom.dev/errors/${code}`, title: code, status: 400, code, ...extra } }); }
  private close(c: Conn, code: number): void { if (c.closing) return; c.closing = true; this.clearTimers(c); try { c.ws.close(code); } catch { /* already closing */ } setTimeout(() => { try { c.ws.terminate(); } catch { /* gone */ } }, 3000).unref?.(); }
  private clearTimers(c: Conn): void { if (c.helloTimer !== undefined) this.o.clock.clearTimeout(c.helloTimer as never); if (c.pingTimer !== undefined) this.o.clock.clearTimeout(c.pingTimer as never); c.helloTimer = c.pingTimer = undefined; }
  private onClose(c: Conn): void {
    this.clearTimers(c); this.conns.delete(c); this.snapshotReq.delete(c); if (c.pair) { try { this.o.pairing?.onClose(c.pair); } catch { /* handler bug */ } } if (!c.authed || !c.member || this.stopped) return;
    const m = c.member; try { this.hooks.disconnected?.({ ...m }); } catch { /* ignore */ } if (this.removed.has(m.memberId)) return; if (this.liveOf(m.memberId).length > 0) return; /* another connection of the same member is up */
    const t = this.o.clock.setTimeout(() => { this.leaveTimers.delete(m.memberId); if (this.liveOf(m.memberId).length === 0) { this.joined.delete(m.memberId); this.presence.forget(m.memberId); this.rosterV++; this.broadcast({ t: 'control', k: 'control.member_left', p: { member: m.memberId, code: 'timeout' } }); try { this.hooks.left?.(m.memberId); } catch { /* ignore */ } } }, this.o.memberGraceMs ?? 10_000); this.leaveTimers.set(m.memberId, t);
  }
  private liveOf(member: string): Conn[] { return [...this.conns].filter((x) => x.authed && !x.closing && x.member?.memberId === member); }
  private startPings(c: Conn): void {
    const tick = (): void => { if (c.closing) return; if (this.o.clock.now() - c.lastActive > DEAD_MS) return this.close(c, 1001); this.send(c, { t: 'sys.ping', ts: this.iso(), p: { t: this.o.clock.now() } }); c.pingTimer = this.o.clock.setTimeout(tick, PING_MS); };
    c.pingTimer = this.o.clock.setTimeout(tick, PING_MS);
  }

  /* ------------------------------------------------------------- inbound */
  private async onMessage(c: Conn, text: string | null): Promise<void> {
    c.lastActive = this.o.clock.now();
    if (text === null) return this.bad(c, { detail: 'Binary frames are not used.' });
    if (Buffer.byteLength(text) > MAX_FRAME_BYTES) return this.sysError(c, 'frame_too_large');
    let raw: unknown; try { raw = JSON.parse(text); } catch { return this.bad(c, { detail: 'Not JSON.' }); }
    if (!c.authed && raw && typeof raw === 'object' && typeof (raw as { t?: unknown }).t === 'string' && (raw as { t: string }).t.startsWith('lan.pair.')) return this.onPairFrame(c, text);
    if (c.authed && raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'lan.snapshot.get') return this.serveSnapshot(c);
    const r = parseFrame(raw); if (!r.ok) return this.bad(c, { errors: r.issues.slice(0, 5).map((i) => ({ pointer: i.pointer, code: i.code })) });
    const f = r.value as Frame;
    if (!c.authed) { if (f.t !== 'sys.hello') { this.sysError(c, 'protocol_violation', { detail: 'sys.hello must come first.' }); return this.close(c, 4400); } return this.onHello(c, f); }
    if (f.ack !== undefined && f.ack > c.ackSeq) c.ackSeq = f.ack; if (f.sid !== undefined && f.sid !== this.o.sessionId) return this.bad(c, { detail: 'Wrong session.' });
    switch (f.t) {
      case 'sys.ping': return this.send(c, { t: 'sys.pong', ts: this.iso(), p: { t: f.p?.t } });
      case 'sys.pong': case 'ack': return;
      case 'sys.bye': return this.close(c, 1000);
      case 'sys.resume': return this.resume(c, typeof f.p?.last_seq === 'number' ? f.p.last_seq : null);
      case 'event': case 'queue': case 'control': case 'presence': return this.onSessionFrame(c, f);
      default: return this.bad(c, { detail: 'That frame type is not sent by clients.' });
    }
  }
  /** The newest snapshot, in pieces small enough for a frame: `lan.snapshot.begin`, `lan.snapshot.chunk` (base64, 128 KiB of data each) and `lan.snapshot.end`. */
  private async serveSnapshot(c: Conn): Promise<void> {
    const snap = await this.o.snapshots?.get(this.o.sessionId).catch(() => null); if (!snap) return void this.send(c, { t: 'lan.snapshot.none' }); const CH = 128 * 1024; const n = Math.max(1, Math.ceil(snap.bytes.length / CH));
    this.send(c, { t: 'lan.snapshot.begin', seq: snap.seq, size: snap.bytes.length, chunks: n }); for (let i = 0; i < n; i++) this.send(c, { t: 'lan.snapshot.chunk', i, b64: Buffer.from(snap.bytes.subarray(i * CH, (i + 1) * CH)).toString('base64') }); this.send(c, { t: 'lan.snapshot.end' });
  }
  private bad(c: Conn, extra: Record<string, unknown>): void { const n = this.o.clock.now(); c.invalid = c.invalid.filter((t) => n - t < 60_000); c.invalid.push(n); if (c.invalid.length > INVALID_PER_MINUTE) return this.close(c, 4400); this.sysError(c, 'invalid_frame', extra); }
  private async onPairFrame(c: Conn, text: string): Promise<void> {
    if (!this.o.pairing) { this.sysError(c, 'protocol_violation', { detail: 'Pairing is not on.' }); return this.close(c, 4400); } c.pairing = true;
    const conn: PairConn = c.pair ?? { id: c.id, remoteIp: c.remoteIp, send: (t) => { if (c.ws.readyState === 1) c.ws.send(t); }, close: (code) => this.close(c, code) }; c.pair = conn;
    const res = await this.o.pairing.onPairFrame(conn, text).catch(() => 'fail' as const); if (res === 'done') this.close(c, 1000); else if (res === 'fail') this.close(c, 4403);
  }
  private async onHello(c: Conn, f: Frame): Promise<void> {
    const p = (f.p ?? {}) as { protocols?: number[]; ticket?: string; last_seq?: number | null };
    if (!Array.isArray(p.protocols) || !p.protocols.includes(1)) { this.sysError(c, 'unsupported_protocol'); return this.close(c, 4400); }
    const who = typeof p.ticket === 'string' ? await this.o.tokens.validate(p.ticket, { remoteIp: c.remoteIp }).catch(() => null) : null;
    if (c.closing) return; if (!who) { this.sysError(c, 'ticket_invalid'); return this.close(c, 4401); } if ((who as { revoked?: boolean }).revoked) { this.sysError(c, 'forbidden'); return this.close(c, 4403); }
    for (const o of this.liveOf(who.memberId)) if (o.member!.deviceId === who.deviceId) { this.send(o, { t: 'sys.bye', ts: this.iso(), p: { reason: 'superseded' } }); this.close(o, 4409); }
    const live = [...this.conns].filter((x) => x.authed && !x.closing).length + (this.loopback ? 1 : 0); if (live >= (this.o.maxMembers ?? MAX_MEMBERS) && !this.liveOf(who.memberId).length) { this.sysError(c, 'session_full'); return this.close(c, 4403); }
    const t = this.leaveTimers.get(who.memberId); if (t !== undefined) { this.o.clock.clearTimeout(t as never); this.leaveTimers.delete(who.memberId); }
    const slot = who.slot ?? this.slotOf.get(who.memberId) ?? this.lowestFreeSlot(); this.slotOf.set(who.memberId, slot); const role = this.roleOverride.get(who.memberId) ?? who.role; c.authed = true; c.member = { memberId: who.memberId, deviceId: who.deviceId, name: who.name, role, slot, remoteIp: c.remoteIp }; if (c.helloTimer !== undefined) this.o.clock.clearTimeout(c.helloTimer as never); c.helloTimer = undefined; this.startPings(c);
    const last = typeof p.last_seq === 'number' ? p.last_seq : null; const oldest = this.buffer.oldest() ?? this.seqr.head() + 1; const resumable = last !== null && last >= oldest - 1;
    this.send(c, { t: 'sys.welcome', ts: this.iso(), p: { protocol: 1, caps: ['resume'], member: { id: who.memberId, name: who.name, slot, role }, slot, role, roster_v: this.rosterV, heartbeat: { ping_ms: PING_MS, dead_ms: DEAD_MS }, server_time: this.iso(), limits: { max_frame_bytes: MAX_FRAME_BYTES, max_frame: MAX_FRAME_BYTES, seq_rate: SEQ_RATE, seq_burst: SEQ_BURST, presence_rate: PRESENCE_RATE, outbound_buffer_bytes: this.o.outboundLimitBytes ?? OUTBOUND_LIMIT_BYTES, max_members: this.o.maxMembers ?? MAX_MEMBERS }, resume: last === null ? null : resumable ? { from_seq: last + 1 } : { snapshot_required: true, snapshot_seq: this.seqr.head() }, session: { mode: 'branch', state: 'live' } } });
    if (last !== null) this.resume(c, last);
    const first = !this.joined.has(who.memberId);
    if (first) { this.joined.add(who.memberId); this.rosterV++; this.broadcast({ t: 'control', k: 'control.member_joined', p: { member: who.memberId, name: who.name, slot, role: who.role, device: who.deviceId } }); }
    for (const pf of this.presence.burst()) this.send(c, pf as unknown as Record<string, unknown>);
    try { this.hooks.connected?.({ ...c.member! }, first); } catch { /* engine bug must not drop the guest */ }
  }
  private lowestFreeSlot(): number { const used = new Set<number>([this.o.hostMember.slot, ...[...this.conns].filter((x) => x.member).map((x) => x.member!.slot)]); let s = 0; while (used.has(s)) s++; return s; }
  private resume(c: Conn, last: number | null): void {
    if (last === null) return; const oldest = this.buffer.oldest() ?? this.seqr.head() + 1;
    if (last < oldest - 1) return this.send(c, { t: 'sys.resumed', ts: this.iso(), p: { snapshot_required: true, snapshot_seq: this.seqr.head() } });
    const missing = this.buffer.after(last); for (const x of missing) this.send(c, x as unknown as Record<string, unknown>); this.send(c, { t: 'sys.resumed', ts: this.iso(), p: { from_seq: last + 1, to_seq: this.seqr.head(), count: missing.length } });
  }

  /* ------------------------------------------------------------- session frames */
  private onSessionFrame(c: Conn, f: Frame): void {
    const m = c.member!; const now = this.o.clock.now(); const k = f.k ?? '';
    if (SERVER_ONLY.has(k)) return; /* clients cannot forge server frames: ignored, not an error */
    if (f.t === 'presence') { if (!c.presBucket.take(now)) return; return this.presence.submit(m.memberId, this.stampFrame(m.memberId, f)); }
    if (!c.seqBucket.take(now) && now - c.slowAt >= SLOW_DOWN_MS) { c.slowAt = now; this.send(c, { t: 'sys.slow_down', ts: this.iso(), p: { retry_after_ms: SLOW_DOWN_MS } }); }
    const hm: HostMember = { id: m.memberId, name: m.name, slot: m.slot, role: m.role };
    if (this.o.interceptor) { const v = this.o.interceptor.onInbound({ from: hm, frame: f }); if (v !== 'accept') { if ('reject' in v) return this.sysError(c, v.reject.code, v.reject); for (const g of v.replace) this.sequence(hm.id, g, c); return; } }
    this.sequence(hm.id, f, c);
  }
  private stampFrame(from: string, f: Frame): Frame { const { seq: _s, from: _f, ts: _t, ...rest } = f; void _s; void _f; void _t; return { ...rest, v: 1, sid: this.o.sessionId, from, ts: this.iso() } as Frame; }
  /** Number a frame, keep it, write it down and send it to everyone. A frame id seen before gets its old number and no new one. */
  private sequence(from: string, f: Frame, origin?: Conn): number {
    const now = this.o.clock.now(); if (f.id) { const dup = this.seqr.known(from, f.id, now); if (dup !== undefined) { const orig = this.buffer.bySeq(dup); if (orig && origin) this.send(origin, orig as unknown as Record<string, unknown>); return dup; } }
    const out = { ...this.stampFrame(from, f), seq: this.seqr.next() } as Frame; if (f.id) this.seqr.remember(from, f.id, out.seq!, now); this.buffer.push(out, now); this.transcript.append(out); this.fanOut(out); try { this.o.interceptor?.onSequenced?.(out); } catch { this.o.logger?.warn('lan.interceptor_failed'); } return out.seq!;
  }
  private fanOut(f: Frame): void { for (const c of [...this.conns]) if (c.authed && !c.closing) this.send(c, f as unknown as Record<string, unknown>); this.loopback?.deliver(f); }

  /* ------------------------------------------------------------- the host's own side */
  /** A frame the host itself originates (server frames carry `from: "srv"`): numbered like any other when it is a sequenced type. */
  broadcast(frame: ServerFrame): number {
    const base = { id: this.o.ids.next('msg'), ...frame, v: 1 as const, sid: this.o.sessionId, from: 'srv', ts: this.iso() } as Frame; if (!SEQUENCED.has(String(frame.t))) { this.fanOut(base); return 0; }
    const now = this.o.clock.now(); const out = { ...base, seq: this.seqr.next() } as Frame; this.buffer.push(out, now); this.transcript.append(out); this.fanOut(out); try { this.o.interceptor?.onSequenced?.(out); } catch { this.o.logger?.warn('lan.interceptor_failed'); } return out.seq!;
  }
  sendTo(memberId: string, frame: ServerFrame): void { for (const c of this.liveOf(memberId)) this.send(c, { ...frame, sid: this.o.sessionId, from: 'srv', ts: this.iso() } as Record<string, unknown>); }
  kickConnection(memberId: string, closeCode = 4403): void { for (const c of this.liveOf(memberId)) { this.sysError(c, 'forbidden'); this.close(c, closeCode); } }
  /** The host's own member talks to the server through memory, using the same path as a guest's socket. */
  createLoopbackLink(): LoopbackLink {
    if (!this.loopback) this.loopback = new LoopbackLink(this, this.o.hostMember, this.o.clock); return this.loopback;
  }
  /* LoopbackHost */
  loopbackSubmit(from: string, f: Frame): void { const hm = this.o.hostMember; if (f.t === 'presence') return this.presence.submit(from, this.stampFrame(from, f)); if (SERVER_ONLY.has(f.k ?? '')) return; if (this.o.interceptor) { const v = this.o.interceptor.onInbound({ from: hm, frame: f }); if (v !== 'accept') { if ('replace' in v) for (const g of v.replace) this.sequence(from, g); return; } } this.sequence(from, f); }
  loopbackWelcome(last: number | null): { welcome: Frame; replay: Frame[] } {
    const resumable = last !== null && (this.buffer.oldest() === undefined ? true : last >= this.buffer.oldest()! - 1); this.joined.add(this.o.hostMember.id);
    return { welcome: { v: 1, t: 'sys.welcome', ts: this.iso(), p: { protocol: 1, caps: ['resume'], member: { id: this.o.hostMember.id, name: this.o.hostMember.name, slot: this.o.hostMember.slot, role: this.o.hostMember.role }, slot: this.o.hostMember.slot, role: this.o.hostMember.role, roster_v: this.rosterV, heartbeat: { ping_ms: PING_MS, dead_ms: DEAD_MS }, server_time: this.iso(), limits: { max_frame_bytes: MAX_FRAME_BYTES }, resume: last === null ? null : resumable ? { from_seq: last + 1 } : { snapshot_required: true, snapshot_seq: this.seqr.head() } } } as Frame, replay: last !== null && resumable ? this.buffer.after(last) : [] };
  }
}
void MAX_MEMBERS; void REPLAY_MIN_MS;
