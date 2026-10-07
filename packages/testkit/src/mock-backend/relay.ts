/** A simulator of the Centcom relay (CT-WS-ENVELOPE, CT-RESUME, CT-WS-QUEUE, CT-WS-CONTROL, CT-WS-PRESENCE).
 *  Deterministic: time comes from the injected clock, randomness from the seeded RNG. It never reads or logs `p` text or `ct`. */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { EVENT_MODES, compareVersions, isId, parseEventPayload, parseFrame, type ErrorCode, type EventKind, type Id } from '@centcom/protocol';
import { RealClock, type Clock, type TimerHandle } from '../core/clock.js';
import { signJwt, verifyJwt, type KeyPair } from '../core/jwt.js';
import { problem } from './problem.js';
import type { Frame, MemberRec, MockState, QueueItem, SessionRec } from './state.js';

export interface RelayOptions { helloTimeoutMs: number; ping_ms: number; dead_ms: number; outboundLimit: number; maxFrameBytes: number; replayFrames: number; queueLimit: number; memberQueueCap: number; invalidPerMinute: number; presenceMs: number; hostGraceMs: number; /** spawn limit per member (the plan's max_parallel_agents); unset means none */ maxParallelAgents?: number }
export const DEFAULT_RELAY_OPTIONS: RelayOptions = { helloTimeoutMs: 5000, ping_ms: 20_000, dead_ms: 50_000, outboundLimit: 2 * 1024 * 1024, maxFrameBytes: 256 * 1024, replayFrames: 5000, queueLimit: 20, memberQueueCap: 5, invalidPerMinute: 10, presenceMs: 500, hostGraceMs: 600_000 };

/** `observe` sees the kind (`k`, else `t`) of every frame the relay sequences, before delivery, plus `sys.hello` after each welcome: scenario triggers hang off it. */
export interface RelayDeps { clock: Clock; newId: <P extends 'mem' | 'usr' | 'dev' | 'ses' | 'msg' | 'req'>(p: P) => Id<P>; keys: KeyPair[]; state: MockState; opts: RelayOptions; onFrame?: (sess: SessionRec, f: Frame, from: string) => 'drop' | void; observe?: (sid: string, kind: string) => void; log?: (e: Record<string, unknown>) => void }
/** One line of the frame log: kind, ids, seq, time and size. Never `p` or `ct`. Presence entries have no seq. */
export interface FrameLogEntry { seq?: number; ts: string; t: string; k?: string; id?: string; from: string; bytes: number }
export type FaultType = 'drop' | 'duplicate' | 'reorder' | 'delay';
/** Who a forced disconnect hits and how: `reason: 'kicked'` runs the full kick (member_left, rotate_key, bye), 4409 sends `sys.bye superseded`. */
export interface DisconnectOptions { sid?: string; member?: string; role?: Role; code: number; retryAfterS?: number; reason?: 'kicked' | 'superseded' | 'server_restart'; error?: ErrorCode }
type Role = MemberRec['role'];

interface Conn { id: number; ws: WebSocket; sid?: string; member?: MemberRec; device?: string; authed: boolean; lastActive: number; helloTimer?: TimerHandle; pingTimer?: TimerHandle; ackSeq: number; slowWarned: boolean; invalid: number[]; presenceCount: number; presenceWindow: number }

const SERVER_ONLY = new Set(['queue.state', 'control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']);
const HOST_ONLY = new Set(['queue.approve', 'queue.reject', 'queue.reorder', 'queue.drop', 'queue.claim', 'queue.done', 'control.kick', 'control.mute', 'control.unmute', 'control.role', 'control.transfer_host', 'control.end', 'control.policy', 'approval.decision']);
const VIEWER_OK = new Set(['reaction', 'comment.add']);
const ULID_OK = (s: unknown) => typeof s === 'string' && /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/.test(s);

export function createRelay(d: RelayDeps) {
  const { clock, state, opts } = d; const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has('centcom.v1') ? 'centcom.v1' : false), maxPayload: 8 * 1024 * 1024 });
  const conns = new Set<Conn>(); const logs = new Map<string, FrameLogEntry[]>(); const hostTimers = new Map<string, TimerHandle>(); const presenceLatest = new Map<string, Map<string, Frame>>(); const presenceTimers = new Map<string, TimerHandle>(); const held = new Map<string, { frame: Frame }>(); let connSeq = 0;
  /** Members created by peerSend (no socket of their own). */
  const virtualMembers = new Set<string>();
  const faults: { sid?: string; type: FaultType; ms?: number; left: number }[] = [];
  let paused = new Set<WebSocket>();
  const iso = () => new Date(clock.now()).toISOString();
  /** The frame log keeps the newest `replayFrames` entries per session (bounded like the replay buffer). */
  const log = (sid: string, e: FrameLogEntry) => { let l = logs.get(sid); if (!l) logs.set(sid, (l = [])); l.push(e); if (l.length > opts.replayFrames * 2) l.splice(0, l.length - opts.replayFrames * 2); d.log?.({ event: 'frame', sid, ...e }); };

  /* ------------------------------------------------------------ sessions and tickets */
  function getOrCreateSession(id: string): SessionRec {
    let s = state.sessions.get(id); if (s) return s;
    s = { id: id as Id<'ses'>, workspace: state.workspace, mode: 'command_post', state: 'live', name: 'Mock session', created: iso(), members: new Map(), nextSeq: 1, buffer: [], seen: new Map(), queue: [], queueVersion: 0, policy: { queue_limit: opts.queueLimit }, rosterV: 0, hostId: '' };
    state.sessions.set(id, s); return s;
  }
  /** A named peer is its own person (own user id); with no name the ticket is for the account that is logged in to the mock. */
  function issueTicket(sid: string, o: { name?: string; role?: Role; user?: string; device?: string; member?: string; expSeconds?: number } = {}) {
    const s = getOrCreateSession(sid); const device = (o.device ?? d.newId('dev')) as Id<'dev'>;
    let m = [...s.members.values()].find((x) => (o.member ? x.id === o.member : o.user ? x.user === o.user : o.name ? x.name === o.name : x.user === state.user.id));
    if (!m) { const user = (o.user ?? (o.name ? d.newId('usr') : state.user.id)) as Id<'usr'>; const role: Role = o.role ?? (s.members.size === 0 ? 'host' : 'editor'); m = { id: d.newId('mem'), user, name: o.name ?? (role === 'host' ? 'Host' : `Member ${s.members.size + 1}`), slot: s.members.size, role, device, joined: false }; s.members.set(m.id, m); s.rosterV++; if (role === 'host') s.hostId = m.id; }
    const now = Math.floor(clock.now() / 1000); const ticket = signJwt(d.keys[0]!, { iss: 'https://api.centcom.dev', aud: 'centcom-relay', sid, mem: m.id, usr: m.user, dev: device, iat: now, exp: now + (o.expSeconds ?? 60), jti: d.newId('req') });
    return { ticket, member: { id: m.id, name: m.name, slot: m.slot, role: m.role } };
  }

  /* ------------------------------------------------------------ sending */
  function send(c: Conn, f: Frame | Record<string, unknown>) {
    if (c.ws.readyState !== WebSocket.OPEN) return; const text = JSON.stringify(f);
    if (paused.has(c.ws)) return; c.ws.send(text);
    if (c.ws.bufferedAmount > opts.outboundLimit) { // a client that does not read: warn once, then cut it off
      if (!c.slowWarned) { c.slowWarned = true; c.ws.send(JSON.stringify({ v: 1, t: 'sys.slow_down', ts: iso(), p: { for_ms: 1000, reason: 'outbound' } })); }
      else { close(c, 4429); }
    }
  }
  const sysError = (c: Conn, code: Parameters<typeof problem>[0], o: Parameters<typeof problem>[2] = {}) => send(c, { v: 1, t: 'sys.error', ts: iso(), p: problem(code, d.newId('req'), o) });
  function close(c: Conn, code: number, reason = '') { clearTimers(c); try { c.ws.close(code, reason.slice(0, 100)); } catch { /* already closing */ } }
  function clearTimers(c: Conn) { clock.clearTimeout(c.helloTimer); clock.clearInterval(c.pingTimer); }
  const sessConns = (sid: string) => [...conns].filter((c) => c.sid === sid && c.authed);

  /** Give a frame the next seq, remember it, and deliver it. `from` is a member id or 'srv'. */
  function sequence(s: SessionRec, f: Frame, from: string): Frame {
    const out: Frame = { ...f, v: 1, sid: s.id, from, ts: iso(), seq: s.nextSeq++ }; if (!out.id) out.id = d.newId('msg');
    s.buffer.push(out); if (s.buffer.length > opts.replayFrames) s.buffer.shift(); if (from !== 'srv') s.seen.set(`${from}:${out.id}`, out.seq!);
    log(s.id, { seq: out.seq, ts: out.ts!, t: out.t, k: out.k, id: out.id, from, bytes: JSON.stringify(out).length });
    d.observe?.(s.id, out.k ?? out.t); /* a scenario trigger may queue a fault for this very frame */
    const fault = faults.findIndex((x) => !x.sid || x.sid === s.id); const fx = fault >= 0 ? faults[fault] : undefined; if (fx && --fx.left <= 0) faults.splice(fault, 1);
    const targets = sessConns(s.id);
    const deliver = (ff: Frame) => { for (const c of targets) send(c, ff); };
    const pending = held.get(s.id);
    if (fx?.type === 'drop') return out; // lost on the wire: the buffer still has it, so resume can recover it
    if (fx?.type === 'reorder') { held.set(s.id, { frame: out }); return out; }
    if (fx?.type === 'delay') clock.setTimeout(() => deliver(out), fx.ms ?? 1000); else deliver(out);
    if (fx?.type === 'duplicate') deliver(out);
    if (pending) { held.delete(s.id); deliver(pending.frame); } // the held frame now arrives AFTER the one that overtook it
    return out;
  }
  const server = (s: SessionRec, t: string, k: string, p: Record<string, unknown>) => sequence(s, { v: 1, t, sid: s.id, k, p }, 'srv');
  const queueState = (s: SessionRec) => { s.queueVersion++; return server(s, 'queue', 'queue.state', { version: s.queueVersion, items: s.queue.slice(-200).map((q, i) => ({ item: q.item, member: q.member, state: q.state, position: i, size: q.size, kind: q.kind, ...(q.agent_id ? { agent_id: q.agent_id } : {}) })) }); };
  const sessionState = (s: SessionRec, st: SessionRec['state']) => { if (s.state === st) return; s.state = st; server(s, 'control', 'control.session_state', { state: st }); };

  /* ------------------------------------------------------------ connection lifecycle */
  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/v1/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  }
  function onConnection(ws: WebSocket) {
    const c: Conn = { id: ++connSeq, ws, authed: false, lastActive: clock.now(), ackSeq: 0, slowWarned: false, invalid: [], presenceCount: 0, presenceWindow: 0 }; conns.add(c);
    c.helloTimer = clock.setTimeout(() => { if (!c.authed) close(c, 4408, 'hello timeout'); }, opts.helloTimeoutMs);
    ws.on('message', (data, isBinary) => { try { onMessage(c, isBinary ? null : data.toString()); } catch (e) { (d.log ?? ((x) => process.stderr.write(JSON.stringify(x) + '\n')))({ event: 'relay_error', message: (e as Error).message }); close(c, 1011); } });
    ws.on('close', (code) => { d.log?.({ event: 'ws_close', sid: c.sid, code }); onClose(c); }); ws.on('error', () => undefined);
  }
  function onClose(c: Conn) {
    clearTimers(c); conns.delete(c); paused.delete(c.ws); if (!c.sid || !c.member) return; const s = state.sessions.get(c.sid); if (!s) return;
    if (c.member.id === s.hostId && !sessConns(s.id).some((x) => x.member?.id === s.hostId)) hostAway(s);
  }
  /** The host is gone (socket closed, or a virtual host was "disconnected"): pause the session after the grace period. */
  function hostAway(s: SessionRec) {
    if (hostTimers.has(s.id)) return;
    hostTimers.set(s.id, clock.setTimeout(() => { hostTimers.delete(s.id); if (s.state === 'live') sessionState(s, 'paused'); }, opts.hostGraceMs));
  }
  /** The host is back: cancel a pending pause, or resume a paused session. */
  function hostBack(s: SessionRec) { clock.clearTimeout(hostTimers.get(s.id)); hostTimers.delete(s.id); if (s.state === 'paused') sessionState(s, 'live'); }

  function onMessage(c: Conn, text: string | null) {
    c.lastActive = clock.now();
    if (text === null) return badFrame(c, { detail: 'Binary frames are not used.' });
    if (Buffer.byteLength(text) > opts.maxFrameBytes) return sysError(c, 'frame_too_large');
    let raw: unknown; try { raw = JSON.parse(text); } catch { return badFrame(c, { detail: 'Not JSON.' }); }
    const r = parseFrame(raw); if (!r.ok) return badFrame(c, { errors: r.issues.slice(0, 5).map((i) => ({ pointer: i.pointer, code: i.code })) });
    const f = r.value as unknown as Frame;
    if (!c.authed) { if (f.t !== 'sys.hello') { sysError(c, 'protocol_violation', { detail: 'sys.hello must come first.' }); return close(c, 4400); } return onHello(c, f); }
    if (f.ack !== undefined && f.ack > c.ackSeq) c.ackSeq = f.ack;
    if (f.sid !== undefined && f.sid !== c.sid) return badFrame(c, { detail: 'Wrong session.' });
    switch (f.t) {
      case 'sys.ping': return send(c, { v: 1, t: 'sys.pong', ts: iso(), p: { t: f.p?.t } });
      case 'sys.pong': case 'ack': return;
      case 'sys.bye': return close(c, 1000);
      case 'sys.resume': return resume(c, state.sessions.get(c.sid!)!, typeof f.p?.last_seq === 'number' ? f.p.last_seq : null);
      case 'event': case 'queue': case 'control': case 'presence': return onSessionFrame(c, f);
      default: return badFrame(c, { detail: 'That frame type is not sent by clients.' });
    }
  }
  /** An invalid frame: `sys.error invalid_frame` for each of the first `invalidPerMinute` in a 60 s window; the next one closes 4400 with no error first. */
  function badFrame(c: Conn, o: Parameters<typeof problem>[2]) {
    const n = clock.now(); c.invalid = c.invalid.filter((t) => n - t < 60_000); c.invalid.push(n);
    if (c.invalid.length > opts.invalidPerMinute) return close(c, 4400, 'too many invalid frames');
    sysError(c, 'invalid_frame', o);
  }

  function onHello(c: Conn, f: Frame) {
    const p = (f.p ?? {}) as { protocols?: number[]; ticket?: string; client?: { version?: string }; last_seq?: number | null };
    if (!Array.isArray(p.protocols) || !p.protocols.includes(1)) { sysError(c, 'unsupported_protocol'); return close(c, 4400); }
    if (state.minClient && p.client?.version && compareVersions(p.client.version, state.minClient) < 0) { sysError(c, 'client_too_old'); return close(c, 4426); }
    if (state.maintenance || state.sticky?.code === 'service_unavailable') { sysError(c, 'service_unavailable', { retryAfterS: state.sticky?.retryAfterS ?? 30 }); return close(c, 4503); }
    const v = verifyJwt(d.keys, String(p.ticket ?? ''), { now: clock.now(), aud: 'centcom-relay' });
    if (!v.ok) { sysError(c, 'ticket_invalid', { detail: v.reason }); return close(c, 4401); }
    if (state.usedJti.has(v.claims.jti)) { sysError(c, 'ticket_replayed'); return close(c, 4401); }
    const s = state.sessions.get(v.claims.sid); if (!s || s.state === 'ended' || s.state === 'expired') { sysError(c, 'session_not_found'); return close(c, 4404); }
    const m = s.members.get(v.claims.mem); if (!m) { sysError(c, 'not_a_member'); return close(c, 4403); }
    state.usedJti.add(v.claims.jti);
    for (const o of sessConns(s.id)) if (o.member?.id === m.id && o.device === v.claims.dev) { send(o, { v: 1, t: 'sys.bye', ts: iso(), p: { reason: 'superseded' } }); close(o, 4409); conns.delete(o); }
    c.authed = true; c.sid = s.id; c.member = m; c.device = v.claims.dev; if (!m.joined) m.device = v.claims.dev; clock.clearTimeout(c.helloTimer);
    c.pingTimer = clock.setInterval(() => { if (clock.now() - c.lastActive > opts.dead_ms) return close(c, 1001); send(c, { v: 1, t: 'sys.ping', ts: iso(), p: { t: clock.now() } }); }, opts.ping_ms);
    const last = p.last_seq ?? null; const oldest = s.buffer[0]?.seq ?? s.nextSeq;
    const resumable = last !== null && last >= oldest - 1;
    send(c, { v: 1, t: 'sys.welcome', ts: iso(), p: { protocol: 1, caps: [], member: { id: m.id, name: m.name, slot: m.slot, role: m.role }, roster_v: s.rosterV, heartbeat: { ping_ms: opts.ping_ms, dead_ms: opts.dead_ms }, server_time: iso(), limits: { max_frame_bytes: opts.maxFrameBytes, seq_rate: 30, seq_burst: 100, presence_rate: 10, outbound_buffer_bytes: opts.outboundLimit, max_members: 50, queue_limit: s.policy.queue_limit }, resume: last === null ? null : resumable ? { from_seq: last + 1 } : { snapshot_required: true }, session: { mode: s.mode, state: s.state } } });
    if (last !== null) resume(c, s, last);
    if (!m.joined) { m.joined = true; server(s, 'control', 'control.member_joined', { member: m.id, name: m.name, slot: m.slot, role: m.role, device: m.device }); }
    if (m.id === s.hostId) hostBack(s);
    for (const pf of presenceLatest.get(s.id)?.values() ?? []) send(c, pf);
    d.observe?.(s.id, 'sys.hello');
  }

  function resume(c: Conn, s: SessionRec, last: number | null) {
    if (last === null) return; const oldest = s.buffer[0]?.seq ?? s.nextSeq;
    if (last < oldest - 1) return send(c, { v: 1, t: 'sys.resumed', ts: iso(), p: { snapshot_required: true, snapshot_seq: s.nextSeq - 1 } });
    const missing = s.buffer.filter((x) => (x.seq ?? 0) > last); for (const x of missing) send(c, x);
    send(c, { v: 1, t: 'sys.resumed', ts: iso(), p: { from_seq: last + 1, to_seq: s.nextSeq - 1, count: missing.length } });
  }

  /* ------------------------------------------------------------ session frames */
  function allowed(role: Role, k: string, t: string): 'ok' | 'forbidden' | 'role_insufficient' {
    if (HOST_ONLY.has(k)) return role === 'host' ? 'ok' : 'forbidden'; if (t === 'presence') return 'ok';
    if (role === 'viewer') return VIEWER_OK.has(k) ? 'ok' : 'role_insufficient'; return 'ok';
  }
  function onSessionFrame(c: Conn, f: Frame) {
    const s = state.sessions.get(c.sid!)!; const m = c.member!; const k = f.k ?? '';
    if (d.onFrame?.(s, f, m.id) === 'drop') return;
    if (s.state === 'ended') return sysError(c, 'session_ended');
    if (SERVER_ONLY.has(k)) return; // clients cannot forge server frames: ignored, not an error
    if (f.t === 'presence') return presence(c, s, f);
    const verdict = allowed(m.role, k, f.t); if (verdict !== 'ok') return sysError(c, verdict === 'forbidden' ? 'forbidden' : 'role_insufficient');
    if (m.muted && (f.t === 'event' || k === 'queue.submit')) return sysError(c, 'muted');
    if (k in EVENT_MODES && f.p !== undefined && EVENT_MODES[k as EventKind] !== 'encrypted') { const pr = parseEventPayload(k, f.p); if (!pr.ok) return badFrame(c, { errors: pr.issues.slice(0, 5).map((i) => ({ pointer: `/p${i.pointer}`, code: i.code })) }); }
    const dup = f.id ? s.seen.get(`${m.id}:${f.id}`) : undefined; if (dup !== undefined) { const orig = s.buffer.find((x) => x.seq === dup); if (orig) send(c, orig); return; } // a resend: same seq, no new frame
    if (k === 'file.lock' || k === 'agent.spawn' || k === 'agent.exit') return fleetOp(c, s, f);
    if (k.startsWith('queue.')) return queueOp(c, s, f);
    if (k.startsWith('control.')) return controlOp(c, s, f);
    sequence(s, f, m.id);
  }

  /** Locks are arbitrated on `path_hmac`: the first acquire is sequenced (that is the grant), a second agent gets a server `deny`, a lock ends on release or `expire` after its ttl. Agents count against `maxParallelAgents`. */
  const locks = new Map<string, Map<string, { agent: string; member: string; timer: TimerHandle | undefined }>>(); const agentsBySession = new Map<string, Map<string, string>>();
  function fleetOp(c: Conn, s: SessionRec, f: Frame) {
    const m = c.member!; const k = f.k!; const p = (f.p ?? {}) as Record<string, any>;
    if (k === 'agent.spawn') { const agents = agentsBySession.get(s.id) ?? new Map<string, string>(); agentsBySession.set(s.id, agents); const mine = [...agents.values()].filter((x) => x === m.id).length; if (opts.maxParallelAgents !== undefined && mine >= opts.maxParallelAgents && !agents.has(String(p.agent_id))) return sysError(c, 'quota_exceeded'); agents.set(String(p.agent_id), m.id); sequence(s, f, m.id); return; }
    if (k === 'agent.exit') { agentsBySession.get(s.id)?.delete(String(p.agent_id)); sequence(s, f, m.id); return; }
    const table = locks.get(s.id) ?? new Map(); locks.set(s.id, table); const hmac = String(p.path_hmac); const cur = table.get(hmac);
    if (p.action === 'acquire') {
      if (cur && cur.agent !== String(p.agent_id)) { server(s, 'event', 'file.lock', { action: 'deny', path_hmac: hmac, agent_id: String(p.agent_id) }); return; }
      if (cur?.timer !== undefined) clock.clearTimeout(cur.timer); const ttl = typeof p.ttl_ms === 'number' && p.ttl_ms > 0 ? p.ttl_ms : 30_000; sequence(s, f, m.id);
      const timer = clock.setTimeout(() => { const now = table.get(hmac); if (now && now.agent === String(p.agent_id)) { table.delete(hmac); server(s, 'event', 'file.lock', { action: 'expire', path_hmac: hmac, agent_id: now.agent }); } }, ttl); table.set(hmac, { agent: String(p.agent_id), member: m.id, timer }); return;
    }
    if (p.action === 'release') { if (cur && cur.agent === String(p.agent_id)) { if (cur.timer !== undefined) clock.clearTimeout(cur.timer); table.delete(hmac); sequence(s, f, m.id); } return; }
  }

  function queueOp(c: Conn, s: SessionRec, f: Frame) {
    const m = c.member!; const k = f.k!; const p = (f.p ?? {}) as Record<string, any>; const item = typeof p.item === 'string' ? p.item : f.id!; // contract gap: 04 says the que_ id is the frame id, but the envelope only allows msg_ ids, so the item id travels in p.item
    const find = () => s.queue.find((q) => q.item === item);
    if (k === 'queue.submit') {
      if (s.policy.locked) return sysError(c, 'session_locked');
      const live = s.queue.filter((q) => q.state !== 'done'); if (live.filter((q) => q.member === m.id).length >= opts.memberQueueCap || live.length >= s.policy.queue_limit) return sysError(c, 'queue_full');
      sequence(s, f, m.id); s.queue.push({ item: String(p.item ?? f.id), member: m.id, state: 'queued', size: Number(p.size ?? 0), kind: String(p.kind ?? 'message') }); queueState(s); return;
    }
    const q = find(); const gone = () => sysError(c, 'queue_item_gone');
    if (k === 'queue.reorder') { sequence(s, f, m.id); const order: string[] = Array.isArray(p.order) ? p.order : []; s.queue.sort((a, b) => (order.indexOf(a.item) === -1 ? 1e6 : order.indexOf(a.item)) - (order.indexOf(b.item) === -1 ? 1e6 : order.indexOf(b.item))); queueState(s); return; }
    if (!q || q.state === 'done') return gone();
    if (k === 'queue.cancel') { if (q.member !== m.id && m.role !== 'host') return sysError(c, 'forbidden'); if (q.state === 'running') return gone(); sequence(s, f, m.id); s.queue = s.queue.filter((x) => x !== q); queueState(s); return; }
    sequence(s, f, m.id);
    if (k === 'queue.approve') q.state = 'approved'; else if (k === 'queue.claim') { q.state = 'running'; q.agent_id = String(p.agent_id ?? ''); } else if (k === 'queue.done') { q.state = 'done'; q.outcome = String(p.outcome ?? 'ok'); } else if (k === 'queue.reject' || k === 'queue.drop') s.queue = s.queue.filter((x) => x !== q);
    queueState(s);
  }

  function controlOp(c: Conn, s: SessionRec, f: Frame) {
    const k = f.k!; const p = (f.p ?? {}) as Record<string, any>; const out = sequence(s, f, c.member!.id); void out;
    const target = typeof p.member === 'string' ? s.members.get(p.member) : undefined;
    switch (k) {
      case 'control.kick': {
        if (target && target.id !== s.hostId) kick(s, target);
        return;
      }
      case 'control.mute': if (target) target.muted = true; return; case 'control.unmute': if (target) target.muted = false; return;
      case 'control.role': if (target && (p.role === 'editor' || p.role === 'viewer')) { target.role = p.role; s.rosterV++; } return;
      case 'control.transfer_host': { const to = typeof p.to === 'string' ? s.members.get(p.to) : undefined; if (!to) return; const old = s.members.get(s.hostId); if (old) old.role = 'editor'; to.role = 'host'; s.hostId = to.id; s.rosterV++; server(s, 'control', 'control.host_changed', { host: to.id, code: 'transfer' }); return; }
      case 'control.end': sessionState(s, 'ended'); for (const x of sessConns(s.id)) close(x, 1000); return;
      case 'control.policy': { if (typeof p.queue_limit === 'number') s.policy.queue_limit = p.queue_limit; if (typeof p.locked === 'boolean') s.policy.locked = p.locked; if (typeof p.queue_paused === 'boolean') s.policy.queue_paused = p.queue_paused; return; }
      default: return;
    }
  }

  /** Remove a member: `member_left` and `rotate_key` get consecutive seqs, then the member's sockets get `sys.bye kicked` and close 4403. */
  function kick(s: SessionRec, target: MemberRec) {
    server(s, 'control', 'control.member_left', { member: target.id, code: 'kicked' }); server(s, 'control', 'control.rotate_key', { kid: `k${s.rosterV + 2}`, reason: 'member_removed' });
    s.members.delete(target.id); s.rosterV++; for (const x of sessConns(s.id)) if (x.member?.id === target.id) { send(x, { v: 1, t: 'sys.bye', ts: iso(), p: { reason: 'kicked' } }); close(x, 4403); }
  }

  /** Presence is ephemeral: at most one fan-out per member per `presenceMs`, never replayed, never echoed to the sender. */
  function presence(c: Conn, s: SessionRec, f: Frame) {
    const m = c.member!; const now = clock.now(); if (now - c.presenceWindow > 1000) { c.presenceWindow = now; c.presenceCount = 0; } if (++c.presenceCount > 10) return; // over 10 per second: dropped
    let map = presenceLatest.get(s.id); if (!map) presenceLatest.set(s.id, (map = new Map())); map.set(m.id, { ...f, sid: s.id, from: m.id, ts: iso() });
    log(s.id, { ts: iso(), t: f.t, k: f.k, id: f.id, from: m.id, bytes: JSON.stringify(f).length });
    const key = `${s.id}:${m.id}`; if (presenceTimers.has(key)) return;
    presenceTimers.set(key, clock.setTimeout(() => { presenceTimers.delete(key); const latest = presenceLatest.get(s.id)?.get(m.id); if (!latest) return; for (const o of sessConns(s.id)) if (o.member?.id !== m.id) send(o, latest); }, opts.presenceMs));
  }

  /* ------------------------------------------------------------ control surface (used by the control plane and scenarios) */
  /** The `sys.error` that precedes each forced close code (CT-WS-ENVELOPE close table). */
  const CLOSE_ERROR: Partial<Record<number, ErrorCode>> = { 4400: 'protocol_violation', 4401: 'ticket_invalid', 4403: 'forbidden', 4404: 'session_not_found', 4426: 'client_too_old', 4429: 'rate_limited', 4503: 'service_unavailable' };
  function disconnect(o: DisconnectOptions) {
    for (const c of [...conns]) {
      if (!c.authed || (o.sid && c.sid !== o.sid) || (o.member && c.member?.id !== o.member) || (o.role && c.member?.role !== o.role)) continue;
      const s = state.sessions.get(c.sid!);
      if (o.reason === 'kicked' && s && c.member && s.members.has(c.member.id) && c.member.id !== s.hostId) { kick(s, c.member); continue; }
      if (o.code === 4409 || o.reason === 'superseded') send(c, { v: 1, t: 'sys.bye', ts: iso(), p: { reason: 'superseded' } });
      else if (o.reason) send(c, { v: 1, t: 'sys.bye', ts: iso(), p: { reason: o.reason } });
      const code = o.error ?? CLOSE_ERROR[o.code];
      if (code) sysError(c, code, o.code === 4503 || o.code === 4429 ? { retryAfterS: o.retryAfterS ?? (o.code === 4503 ? 30 : 5) } : o.code === 4401 && !o.error ? { detail: 'expired' } : {});
      close(c, o.code);
    }
    /* a virtual host has no socket to close: "disconnecting" it starts host loss directly */
    if (o.role === 'host' || o.member) for (const s of state.sessions.values()) {
      if ((o.sid && s.id !== o.sid) || !s.hostId || (o.member && o.member !== s.hostId)) continue;
      if (virtualMembers.has(s.hostId)) hostAway(s);
    }
  }
  /** Push `sys.error` frames to every connection of a session (or of all sessions), as if the client had misbehaved. */
  function wsError(o: { sid?: string; code: ErrorCode; count?: number; retryAfterS?: number }) {
    for (const c of [...conns]) if (c.authed && (!o.sid || c.sid === o.sid)) for (let i = 0; i < (o.count ?? 1); i++) sysError(c, o.code, o.retryAfterS !== undefined ? { retryAfterS: o.retryAfterS } : {});
  }
  const notice = (sid: string, code: string, level: 'info' | 'warn' | 'error', params: object) => { for (const c of sessConns(sid)) send(c, { v: 1, t: 'sys.notice', ts: iso(), p: { code, level, params } }); };
  function closeAll(code = 1001) { for (const c of [...conns]) close(c, code); }
  /** Close every socket with 1001, wait up to `graceMs` of real time for the close handshakes, then cut whatever is left. */
  async function shutdown(graceMs = 250): Promise<void> {
    const open = [...conns].map((c) => c.ws); closeAll(1001);
    const timer = new RealClock();
    await Promise.race([
      Promise.all(open.map((ws) => (ws.readyState === WebSocket.CLOSED ? undefined : new Promise<void>((r) => ws.once('close', () => r()))))),
      new Promise<void>((r) => timer.setTimeout(r, graceMs)),
    ]);
    for (const ws of open) if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    wss.close();
  }
  function reset() { closeAll(1001); logs.clear(); presenceLatest.clear(); held.clear(); faults.length = 0; for (const t of [...hostTimers.values(), ...presenceTimers.values()]) clock.clearTimeout(t); hostTimers.clear(); presenceTimers.clear(); paused = new Set(); virtualMembers.clear(); for (const t of locks.values()) for (const l of t.values()) if (l.timer !== undefined) clock.clearTimeout(l.timer); locks.clear(); agentsBySession.clear(); }
  /** A scripted peer: a member without a socket that "sends" frames (kind and opaque bodies only). */
  function peerSend(sid: string, o: { name?: string; role?: Role; frame: Omit<Frame, 'v' | 'sid'> }) {
    const s = getOrCreateSession(sid); let m = [...s.members.values()].find((x) => x.name === (o.name ?? 'Peer')); if (!m) { m = { id: d.newId('mem'), user: d.newId('usr'), name: o.name ?? 'Peer', slot: s.members.size, role: o.role ?? 'editor', device: d.newId('dev'), joined: true }; s.members.set(m.id, m); virtualMembers.add(m.id); s.rosterV++; if (m.role === 'host' && !s.hostId) s.hostId = m.id; server(s, 'control', 'control.member_joined', { member: m.id, name: m.name, slot: m.slot, role: m.role, device: m.device }); }
    if (m.id === s.hostId && virtualMembers.has(m.id)) hostBack(s); /* a virtual host that speaks is present again */
    return sequence(s, { ...o.frame, v: 1, sid }, m.id);
  }
  return {
    onUpgrade, getOrCreateSession, issueTicket, disconnect, wsError, notice, closeAll, shutdown, reset, peerSend, frames: (sid: string) => (logs.get(sid) ?? []) as readonly FrameLogEntry[],
    /** Make the next `count` (default 1) sequenced frames of a session (or any session) drop, duplicate or arrive late; `reorder` swaps the next two. */
    addFault: (x: { sid?: string; type: FaultType; ms?: number; count?: number }) => { faults.push({ sid: x.sid, type: x.type, ms: x.ms, left: x.type === 'reorder' ? 1 : Math.max(1, x.count ?? 1) }); },
    /** Test helper: stop delivering to one socket as if its client stopped reading; its buffer fills up for real (see slowConsumer). */
    connections: () => [...conns].filter((c) => c.authed).map((c) => ({ sid: c.sid!, member: c.member!.id, ackSeq: c.ackSeq })),
    isOpen: () => conns.size, ids: { isId }, close: () => { closeAll(1001); wss.close(); },
  };
}
export type Relay = ReturnType<typeof createRelay>;
