/** The session client: REST, the relay socket, reliable delivery and end-to-end crypto in one handle. See README.md. */
import { isEventKind, payloadMode, type Frame } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import type { DeviceKeyStore } from '../crypto/device-keys.js';
import { inviteSecretFromFragment, openInviteBundle } from '../crypto/bundle.js';
import type { Keychain } from '../crypto/keychain.js';
import { KeyRing, epochOf, type KeyRingStore } from '../crypto/keyring.js';
import { pathHmac } from '../crypto/path-mac.js';
import type { TrustStore } from '../crypto/trust-store.js';
import { b64, sodium, unb64 } from '../crypto/sodium.js';
import { ReliableChannel } from '../delivery/channel.js';
import type { SeqStore } from '../delivery/seq-store.js';
import { createMsgIdGenerator, type IdGenerator } from '../delivery/ulid.js';
import type { SequencedFrame } from '../delivery/inbox.js';
import type { HttpClient } from '../http/types.js';
import type { Logger } from '../log/index.js';
import { RelayClient, type WsFactory } from '../relay/client.js';
import type { ClientIdent } from '../relay/handshake.js';
import { TypedEmitter } from '../relay/emitter.js';
import type { RelayClock } from '../relay/heartbeat.js';
import { FrameCodec, SERVER_ONLY } from './codec.js';
import { GuestKeys } from './guest.js';
import { HostDuties } from './host.js';
import { SessionRest, memberOf, type SessionCreated } from './rest.js';
import { Roster } from './roster.js';
import { SNAPSHOT_EVERY_FRAMES, SNAPSHOT_EVERY_MS, fetchSnapshot, uploadSnapshot } from './snapshots.js';
import { SessionError, type DecodedEvent, type EventP, type EventSecret, type MemberInfo, type Role, type SessionPolicy, type SessionState, type SessionSummary, type SnapshotDoc } from './types.js';

export interface CryptoDeps { device: DeviceKeyStore; trust: TrustStore; /** where a session's keys are kept (encrypted under a keychain key) */ keyringStore?: (sid: string) => KeyRingStore; keychain?: Keychain }
export interface SessionClientDeps {
  http: HttpClient; crypto: CryptoDeps; /** this device's id from login */ deviceId: string; clientInfo: ClientIdent;
  /** time for the session's own timers (key rotation, snapshots, key waits) and message ids */ clock?: RelayClock; /** time for the socket and delivery timers (heartbeat, reconnect, acks); the real clock unless a test needs to drive them */ relayClock?: RelayClock; ids?: IdGenerator; logger?: Logger; relayUrl?: string; allowPlainWs?: boolean; wsFactory?: WsFactory; fetch?: typeof fetch; seqStore?: SeqStore;
}
export interface SessionOptions { /** listeners attached before the connection starts, so early states are not missed */ on?: { [K in LifecycleName]?: (...a: LifecycleEvents[K]) => void }; /** host: builds the checkpoint at this position; without it no snapshots are uploaded */ buildSnapshot?(ctx: { seq: number }): Promise<Omit<SnapshotDoc, 'fmt' | 'v' | 'seq'> | undefined>; }
export type LifecycleEvents = {
  state: [SessionState]; roster: [MemberInfo[], number]; 'key-changed': [{ device: string; member: string; old?: string; new?: string }]; 'waiting-for-key': []; 'protocol-warning': [{ reason: string }]; ended: [{ code: number | string }]; snapshot: [{ doc: SnapshotDoc; seq: number }]; notice: [Record<string, unknown>]; removed: [{ code: string }]; error: [{ code: string; status?: number; retryAfterS?: number }];
};
export type LifecycleName = keyof LifecycleEvents;
class Lifecycle extends TypedEmitter<LifecycleEvents> { fire<K extends LifecycleName>(ev: K, ...a: LifecycleEvents[K]): void { this.emit(ev, ...a); } }
const LIFECYCLE = new Set<string>(['state', 'roster', 'key-changed', 'waiting-for-key', 'protocol-warning', 'ended', 'snapshot', 'notice', 'error', 'removed']);
export interface SessionHandle {
  readonly id: string; readonly me: MemberInfo; readonly state: SessionState; readonly policy: SessionPolicy;
  roster(): MemberInfo[];
  /** presence frames dropped because they did not verify (best effort, never an error) */
  presenceDropped(): number;
  /** whether the host has silenced us, and until when (it ends by itself at that time) */
  muted(): { muted: boolean; until?: string };
  /** the epochs (key ids) this device can read, oldest first */
  heldEpochs(): string[];
  sendEvent(kind: string, body: { p?: EventP | ((info: { ctBytes: number }) => EventP); secret?: EventSecret; /** the frame id (a `msg_` id); a retry with the same id is the same frame */ id?: string }): Promise<{ id: string; seq: number }>;
  on<K extends LifecycleName>(name: K, fn: (...a: LifecycleEvents[K]) => void): () => void;
  on(kind: string, fn: (e: DecodedEvent) => void): () => void;
  /** every decoded event; with `replay` the most recent ones (up to 500) are delivered first, so a feature that starts after the join does not miss what arrived while connecting */
  onAny(fn: (e: DecodedEvent) => void, o?: { replay?: boolean }): () => void;
  leave(): Promise<void>; end(): Promise<void>;
  snapshot: { fetch(): Promise<{ doc: SnapshotDoc; seq: number } | null>; upload(): Promise<{ snp: string; seq: number } | null> };
  history: { fetch(afterSeq: number): Promise<number> };
  /** accept the new keys of a device whose keys changed (after the person compared fingerprints) */
  trustDevice(device: string): Promise<void>;
  /** the keyed hash of a path under the current session key (what other members see instead of the path) */
  pathMac(path: string): string;
  /** give up on a frame that was sent but will never be echoed (the relay answered it another way); its promise fails with `reason` */
  abandon(frameId: string, reason: Error): void;
  /** a link to give to a view-only guest: the web address plus `#k=<key>` */
  createShareLink(): Promise<{ token: string; url: string; expires_at: string; fragment: string }>;
}
const realClock: RelayClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
/** sys.error codes that mean the relay refused the frame we just sent (it does not say which, so the oldest unechoed one). */
const FRAME_REFUSALS = new Set<string>(['queue_full', 'queue_item_gone', 'queue_not_allowed', 'forbidden', 'role_insufficient', 'muted', 'session_locked', 'host_required', 'frame_too_large', 'invalid_frame', 'lock_denied', 'quota_exceeded', 'entitlement_required']);
const RECENT_EVENTS = 500; const KEY_WAIT_MS = 10_000; const MAX_PENDING = 1000;

class Connection implements SessionHandle {
  readonly roster_ = new Roster(); me: MemberInfo; private st: SessionState = 'connecting'; policy: SessionPolicy;
  private readonly life = new Lifecycle(); private readonly handlers = new Map<string, Set<(e: DecodedEvent) => void>>(); private readonly any = new Set<(e: DecodedEvent) => void>();
  private relay!: RelayClient; private channel!: ReliableChannel; private codec!: FrameCodec; private host?: HostDuties; private guest!: GuestKeys;
  private chain: Promise<void> = Promise.resolve(); private pending: SequencedFrame[] = []; private pendingKid?: string; private keyWaiters: { kid: string; res: () => void; rej: (e: unknown) => void; timer: unknown }[] = [];
  private recent: DecodedEvent[] = []; private presenceDrops = 0; private mutedUntil?: number; private mutedIso?: string; private removedFired = false; private catchUps: number[] = []; private catchUpWanted = false; private catchingUp = false; private catchUpHead?: number; private unreadable = new Set<string>(); private rotationRequested = false; private lastSeq = 0; private framesSinceSnapshot = 0; private snapTimer?: unknown; private rotateTimer?: unknown; private snapshotting = false; private closed = false; 
  private readonly clock: RelayClock; private readonly ids: IdGenerator; private readonly fetchFn: typeof fetch;

  constructor(private readonly d: SessionClientDeps, private readonly rest: SessionRest, readonly id: string, role: Role, memberId: string, private readonly ring: KeyRing, private readonly viewOnly: boolean, policy: SessionPolicy, private readonly opts: SessionOptions, private readonly relayUrl: string) {
    this.clock = d.clock ?? realClock; this.ids = d.ids ?? createMsgIdGenerator({ now: () => this.clock.now() }); this.fetchFn = d.fetch ?? fetch; this.policy = policy;
    for (const [k, fn] of Object.entries(opts.on ?? {})) this.life.on(k as LifecycleName, fn as never);
    this.me = { id: memberId, role, slot: 0, device: d.deviceId }; this.guest = new GuestKeys(ring, viewOnly ? undefined : d.crypto.device);
  }
  get state(): SessionState { return this.st; }
  roster(): MemberInfo[] { return this.roster_.list(); }
  muted(): { muted: boolean; until?: string } { if (this.mutedUntil !== undefined && this.mutedUntil !== Infinity && this.clock.now() >= this.mutedUntil) { this.mutedUntil = undefined; this.mutedIso = undefined; } return this.mutedUntil === undefined ? { muted: false } : { muted: true, ...(this.mutedIso ? { until: this.mutedIso } : {}) }; }
  heldEpochs(): string[] { return this.ring.kids(); }
  private setState(s: SessionState): void { if (this.st === s || this.st === 'ended') return; this.st = s; this.life.fire('state', s); if (s === 'waiting_for_key') this.life.fire('waiting-for-key'); }
  private warn(reason: string): void { this.d.logger?.warn('session.protocol_warning', { reason }); this.life.fire('protocol-warning', { reason }); }

  async start(): Promise<void> {
    const { device } = this.d.crypto; const keys = this.viewOnly ? undefined : await device.getOrCreatePublicKeys();
    this.codec = new FrameCodec({ sid: this.id, deviceId: this.d.deviceId, device: this.viewOnly ? undefined : device, ring: this.ring, roster: this.roster_ });
    if (this.me.role === 'host') this.host = new HostDuties({ ring: this.ring, deviceId: this.d.deviceId, policy: () => this.policy, now: () => new Date(this.clock.now()), recipients: () => this.roster_.recipients(this.d.deviceId), persist: () => this.persistKeys(), log: (m, c) => this.d.logger?.info(m, c),
      sendGrant: async (p, secret) => { await this.sendRaw('key.grant', { p, secret }); } });
    this.relay = new RelayClient({ url: this.relayUrl, sessionId: this.id, clientInfo: this.d.clientInfo, allowPlainWs: this.d.allowPlainWs, wsFactory: this.d.wsFactory, clock: this.d.relayClock, logger: this.d.logger, getLastSeq: () => this.channel?.lastSeq() ?? null,
      getTicket: async () => { const t = await this.rest.joinToken(this.id, ['resume']); return { ticket: t.ticket, url: t.relay_url }; } });
    this.channel = new ReliableChannel({ link: this.relay, sessionId: this.id, seqStore: this.d.seqStore, clock: this.d.relayClock, ids: this.ids, logger: this.d.logger, memberId: () => this.me.id });
    await this.channel.init();
    this.relay.on('link', (l) => { if (this.st === 'ended') return; if (l === 'reconnecting' || l === 'offline') this.setState('reconnecting'); else this.setState(this.guest.hasKey() ? 'live' : 'waiting_for_key'); });
    this.relay.on('closed', (c) => { if (!c.willReconnect && !this.closed) { if (c.code === 4403) void this.removed('forbidden'); else if (c.code === 1000 || c.code === 4410 || c.code === 4409) this.finish(c.code); } });
    this.relay.on('protocol_warning', (w) => this.warn(w.reason)); this.relay.on('frame', (f) => { if (f.t === 'presence') this.onPresence(f); }); this.relay.on('notice', (n) => this.life.fire('notice', n));
    this.relay.on('error', (e) => { if (FRAME_REFUSALS.has(e.code)) this.channel.refuseOldest(e); this.life.fire('error', { code: e.code, ...(e.status !== undefined ? { status: e.status } : {}), ...(e.retryAfterS !== undefined ? { retryAfterS: e.retryAfterS } : {}) }); });
    this.channel.on('frame', (f) => { this.chain = this.chain.then(() => this.onFrame(f)).catch(() => this.warn('frame_handler_failed')); });
    this.channel.on('snapshot-required', (e) => this.needCatchUp(e.snapshotSeq)); this.relay.on('welcome', (w) => { if (w.resume?.snapshot_required === true) this.needCatchUp(); });
    const w = await this.relay.connect(); this.me = { ...this.me, id: w.member.id, role: w.role as Role, slot: w.slot, ...(w.member.name ? { name: w.member.name } : {}) }; this.roster_.upsert({ ...this.me, ...(keys ? { keys: { device: this.d.deviceId, ...keys } } : {}) });
    await this.refreshMembers(); this.setState(this.guest.hasKey() ? 'live' : 'waiting_for_key');
    if (this.me.role === 'host') { if (!this.host) this.becomeHost(); else this.scheduleHostTimers(); await this.persistKeys(); if (this.guest.hasKey()) for (const m of this.roster_.recipients(this.d.deviceId)) await this.host!.grantTo(m).catch(() => undefined); }
  }

  /* ------------------------------------------------------------- members and trust */
  private async refreshMembers(): Promise<void> {
    let list: MemberInfo[]; try { list = await this.rest.members(this.id); } catch { return; }
    for (const m of list) await this.trustAndStore(m); this.life.fire('roster', this.roster_.list(), this.roster_.version);
  }
  private async trustAndStore(m: MemberInfo): Promise<void> {
    if (m.id === this.me.id && this.roster_.get(m.id)?.keys) { this.roster_.upsert({ ...m, keys: this.roster_.get(m.id)!.keys }); return; }
    if (m.keys && m.device) { const r = await this.d.crypto.trust.check(m.device, { x25519: m.keys.x25519, ed25519: m.keys.ed25519 }); if (r === 'changed') { this.roster_.upsert({ ...m, keyChanged: true }); this.life.fire('key-changed', { device: m.device, member: m.id, new: m.keys.ed25519 }); return; } }
    this.roster_.upsert({ ...m, keyChanged: false });
  }
  async trustDevice(device: string): Promise<void> { const m = this.roster_.byDevice(device); if (!m?.keys) throw new SessionError('untrusted_device', 'That device is not in this session.'); await this.d.crypto.trust.accept(device, { x25519: m.keys.x25519, ed25519: m.keys.ed25519 }); this.roster_.upsert({ ...m, keyChanged: false }); this.life.fire('roster', this.roster_.list(), this.roster_.version); if (this.host) await this.host.grantTo(this.roster_.get(m.id)!).catch(() => undefined); this.replayPending(); }

  /* ------------------------------------------------------------- inbound */
  private async onFrame(f: SequencedFrame): Promise<void> {
    this.lastSeq = f.seq; this.host?.noteFrame(); this.framesSinceSnapshot++;
    if (f.k && SERVER_ONLY.has(f.k) && f.from !== 'srv') { this.warn('forged_server_frame'); return; }
    if (f.k?.startsWith('control.') && !SERVER_ONLY.has(f.k)) { /* client control frames are decoded like any other */ }
    let r = this.codec.decode(f);
    if (!r.ok && r.reason === 'unknown_sender') { await this.refreshMembers(); r = this.codec.decode(f); }
    if (!r.ok) {
      if (r.reason === 'unknown_kid') {
        const held = this.ring.kids(); if (held.length && r.kid && epochOf(r.kid) < epochOf(held[0]!)) { if (!this.unreadable.has(r.kid)) { this.unreadable.add(r.kid); this.warn('unreadable_earlier_history'); } return; } /* history from before the epoch we were given */
        if (this.pending.length < MAX_PENDING) this.pending.push(f); if (this.st === 'live' && !this.guest.hasKey()) this.setState('waiting_for_key');
      } else if (r.reason === 'untrusted_device') { if (this.pending.length < MAX_PENDING) this.pending.push(f); this.warn('untrusted_device'); } /* held until trustDevice() */
      else this.warn(r.reason); return;
    }
    if (!isEventKind(r.event.kind)) { this.d.logger?.debug('session.unknown_kind'); return; }
    await this.dispatch(r.event, f);
    if (this.host && this.framesSinceSnapshot >= SNAPSHOT_EVERY_FRAMES) void this.autoSnapshot();
  }
  private async dispatch(e: DecodedEvent, f: SequencedFrame): Promise<void> {
    const p = (e.p ?? {}) as Record<string, any>;
    switch (e.kind) {
      case 'control.member_joined': { const m = memberOf({ id: p.member, role: p.role, slot: p.slot, display_name: p.name, device: p.device }); this.roster_.upsert(m); await this.refreshMembers(); const full = this.roster_.get(m.id); if (this.host && full && full.id !== this.me.id) await this.host.grantTo(full).catch(() => this.warn('grant_failed')); break; }
      case 'control.member_left': { this.roster_.remove(String(p.member)); this.life.fire('roster', this.roster_.list(), this.roster_.version); if (p.member === this.me.id) { if (p.code === 'kicked' || p.code === 'revoked') await this.removed(String(p.code)); else this.finish(String(p.code ?? 'left')); } break; }
      case 'control.role': { const m = this.roster_.get(String(p.member)); if (m && (p.role === 'editor' || p.role === 'viewer')) { this.roster_.setRole(m.id, p.role); if (m.id === this.me.id) this.me = { ...this.me, role: p.role }; this.life.fire('roster', this.roster_.list(), this.roster_.version); } break; }
      case 'control.mute': { if (p.member === this.me.id) { const t = typeof p.until === 'string' ? Date.parse(p.until) : NaN; this.mutedUntil = Number.isFinite(t) ? t : Infinity; this.mutedIso = typeof p.until === 'string' ? p.until : undefined; } break; }
      case 'control.unmute': { if (p.member === this.me.id) { this.mutedUntil = undefined; this.mutedIso = undefined; } break; }
      case 'control.roster': { if (typeof p.version === 'number' && p.version <= this.roster_.version) { this.warn('stale_roster'); break; } this.roster_.replace((Array.isArray(p.members) ? p.members : []).map((x: Record<string, unknown>) => memberOf(x)), typeof p.version === 'number' ? p.version : undefined); await this.refreshMembers(); break; }
      case 'control.host_changed': { for (const m of this.roster_.list()) if (m.role === 'host' && m.id !== p.host) this.roster_.setRole(m.id, 'editor'); this.roster_.setRole(String(p.host), 'host'); if (p.host === this.me.id) { this.me.role = 'host'; if (!this.host) this.becomeHost(); } else if (this.me.role === 'host') this.me.role = 'editor'; this.life.fire('roster', this.roster_.list(), this.roster_.version); break; }
      case 'control.session_state': { const s = p.state; if (s === 'ended' || s === 'expired') this.finish('ended'); else if (s === 'paused') this.setState('paused'); else if (s === 'live') this.setState(this.guest.hasKey() ? 'live' : 'waiting_for_key'); break; }
      case 'control.policy': { this.policy = { ...this.policy, ...p }; break; }
      case 'control.rotate_key': { const kid = String(p.kid); this.pendingKid = kid; if (this.host) { await this.host.onRotateKey(kid, p.reason === 'member_removed' || p.reason === 'scheduled' ? p.reason : 'requested'); this.pendingKid = undefined; this.rotationRequested = false; this.releaseWaiters(); } break; }
      case 'control.rotate_request': { if (this.host) { /* the relay answers with control.rotate_key */ } break; }
      case 'key.grant': { if (p.to_device === this.d.deviceId) { const from = this.roster_.get(e.from); if (!from || (from.role !== 'host' && from.role !== 'editor')) { this.warn('grant_from_non_holder'); break; } const added = this.guest.open(e.secret as never); if (added.length) { this.onKeys(); } } break; }
      default: break;
    }
    this.emitEvent(e); void f;
  }
  /** Presence is never sequenced, so it does not come through the channel: decode it here, and drop what does not verify without a word (best effort, counted). */
  private onPresence(f: Frame): void {
    const r = this.codec.decode({ ...f, seq: 0 } as SequencedFrame); if (!r.ok) { this.presenceDrops++; return; } if (!isEventKind(r.event.kind)) return; this.emitEvent(r.event);
  }
  presenceDropped(): number { return this.presenceDrops; }
  private emitEvent(e: DecodedEvent): void { this.recent.push(e); if (this.recent.length > RECENT_EVENTS) this.recent.shift(); for (const fn of [...(this.handlers.get(e.kind) ?? [])]) { try { fn(e); } catch { /* a listener must not break delivery */ } } for (const fn of [...this.any]) { try { fn(e); } catch { /* same */ } } }
  private onKeys(): void { void this.persistKeys(); this.releaseWaiters(); if (this.st === 'waiting_for_key') this.setState('live'); this.replayPending(); if (this.catchUpWanted) this.needCatchUp(); }
  private replayPending(): void { const todo = this.pending.splice(0); this.chain = this.chain.then(async () => { for (const f of todo) await this.onFrame(f); }).catch(() => undefined); }
  private async persistKeys(): Promise<void> { const s = this.d.crypto.keyringStore?.(this.id); if (s && this.d.crypto.keychain) await this.ring.persist(s, this.d.crypto.keychain, `keyring-wrap`).catch(() => undefined); }

  /* ------------------------------------------------------------- outbound */
  /** Wait (briefly) for the key of an epoch the relay announced. */
  private waitForKey(kid: string): Promise<void> { if (this.ring.get(kid)) return Promise.resolve(); return new Promise((res, rej) => { const timer = this.clock.setTimeout(() => { this.keyWaiters = this.keyWaiters.filter((w) => w.res !== res); rej(new SessionError('timeout', 'The new session key has not arrived yet.')); }, KEY_WAIT_MS); this.keyWaiters.push({ kid, res, rej, timer }); }); }
  private releaseWaiters(): void { for (const w of [...this.keyWaiters]) if (this.ring.get(w.kid)) { this.clock.clearTimeout(w.timer as never); w.res(); this.keyWaiters = this.keyWaiters.filter((x) => x !== w); } }
  private async sendRaw(kind: string, body: { p?: Record<string, unknown> | ((info: { ctBytes: number }) => Record<string, unknown>); secret?: Record<string, unknown>; id?: string }, kid?: string): Promise<{ id: string; seq: number }> {
    const id = body.id ?? this.ids.next('msg'); const o = this.codec.encode(kind, id, body, kid ? { kid } : {});
    if (o.t === 'presence') { this.channel.sendEphemeral({ t: 'presence', k: o.k, ...(o.ct ? { id } : {}), ...(o.p ? { p: o.p } : {}), ...(o.ct ? { ct: o.ct } : {}), ...(o.sig ? { sig: o.sig } : {}) }); return { id, seq: 0 }; }
    return this.channel.send({ t: o.t as 'event', k: o.k, id, ...(o.p ? { p: o.p } : {}), ...(o.ct ? { ct: o.ct } : {}), ...(o.sig ? { sig: o.sig } : {}) });
  }
  async sendEvent(kind: string, body: { p?: EventP | ((info: { ctBytes: number }) => EventP); secret?: EventSecret; id?: string }): Promise<{ id: string; seq: number }> {
    if (this.st === 'ended') throw new SessionError('ended', 'This session has ended.'); if (!kind.startsWith('presence.') && this.muted().muted) throw new SessionError('muted', 'The host has muted you, so you cannot send this right now.'); const mode = payloadMode(kind); if (mode === 'unknown') throw new TypeError(`unknown event kind ${kind}`);
    if (mode !== 'clear') {
      if (this.viewOnly) throw new SessionError('view_only', 'You joined with a view-only link, so you cannot send this.'); if (!this.guest.hasKey()) throw new SessionError('waiting_for_key', 'Waiting for the host to let you in.');
      if (this.pendingKid && !this.ring.get(this.pendingKid)) await this.waitForKey(this.pendingKid);
    }
    return this.sendRaw(kind, body, this.pendingKid && this.ring.get(this.pendingKid) ? this.pendingKid : undefined);
  }
  on(name: string, fn: (...a: never[]) => void): () => void {
    if (LIFECYCLE.has(name)) return this.life.on(name as LifecycleName, fn as never);
    let s = this.handlers.get(name); if (!s) this.handlers.set(name, (s = new Set())); s.add(fn as never); return () => { s!.delete(fn as never); };
  }
  onAny(fn: (e: DecodedEvent) => void, o: { replay?: boolean } = {}): () => void { if (o.replay) for (const e of [...this.recent]) { try { fn(e); } catch { /* a listener must not break the others */ } } this.any.add(fn); return () => { this.any.delete(fn); }; }

  /* ------------------------------------------------------------- host duties */
  private becomeHost(): void { if (this.host) return; this.host = new HostDuties({ ring: this.ring, deviceId: this.d.deviceId, policy: () => this.policy, now: () => new Date(this.clock.now()), recipients: () => this.roster_.recipients(this.d.deviceId), persist: () => this.persistKeys(), log: (m, c) => this.d.logger?.info(m, c), sendGrant: async (p, secret) => { await this.sendRaw('key.grant', { p, secret }); } }); this.scheduleHostTimers(); }
  private scheduleHostTimers(): void {
    const tick = (): void => { if (this.closed || !this.host) return; if (this.host.rotationDue() && !this.rotationRequested) { this.rotationRequested = true; void this.sendRaw('control.rotate_request', { p: { reason: 'scheduled' } }).catch(() => { this.rotationRequested = false; }); } this.rotateTimer = this.clock.setTimeout(tick, 3_600_000); }; this.rotateTimer = this.clock.setTimeout(tick, 3_600_000);
    if (this.opts.buildSnapshot) { const snap = (): void => { if (this.closed) return; if (this.framesSinceSnapshot > 0) void this.autoSnapshot(); this.snapTimer = this.clock.setTimeout(snap, SNAPSHOT_EVERY_MS); }; this.snapTimer = this.clock.setTimeout(snap, SNAPSHOT_EVERY_MS); }
  }
  private async autoSnapshot(): Promise<void> { if (this.snapshotting || !this.opts.buildSnapshot) return; this.snapshotting = true; try { await this.uploadSnap(); } catch { this.warn('snapshot_upload_failed'); } finally { this.snapshotting = false; } }
  private async uploadSnap(): Promise<{ snp: string; seq: number } | null> {
    if (!this.host) throw new SessionError('not_host', 'Only the host can save a snapshot.'); if (!this.opts.buildSnapshot) return null; const seq = this.lastSeq; const body = await this.opts.buildSnapshot({ seq }); if (!body) return null;
    const r = await uploadSnapshot(this.rest, this.id, this.ring, { ...body, fmt: 'centcom.snapshot', v: 1, seq } as SnapshotDoc, { fetch: this.fetchFn }); this.framesSinceSnapshot = 0; return { snp: r.snp, seq: r.seq };
  }
  snapshot = {
    fetch: async (): Promise<{ doc: SnapshotDoc; seq: number } | null> => { const r = await fetchSnapshot(this.rest, this.id, this.ring, { fetch: this.fetchFn }); return r ? { doc: r.doc, seq: r.seq } : null; },
    upload: () => this.uploadSnap(),
  };
  history = {
    /** REST history after a position, fed through the same ordering and de-duplication as live frames. Returns how many frames were delivered. */
    fetch: async (afterSeq: number): Promise<number> => { let n = 0; let cursor: string | undefined; for (;;) { const page = await this.rest.historyPage(this.id, { afterSeq, cursor }); if (!cursor && typeof page.earliest_seq === 'number' && page.earliest_seq > afterSeq + 1) { await this.channel.resumeFrom(page.earliest_seq - 1, { ask: false }); this.warn('earlier_history_unavailable'); } n += this.channel.applyHistory(page.data); if (!page.has_more || !page.next_cursor) break; cursor = page.next_cursor; } return n; },
  };
  /** The relay says our position is too old to replay: take the newest snapshot, then fill the gap from REST history, then ask the relay for what came after. */
  private needCatchUp(snapshotSeq?: number): void { this.catchUpWanted = true; this.catchUpHead = snapshotSeq ?? this.catchUpHead; if (this.guest.hasKey()) this.chain = this.chain.then(() => this.catchUp()).catch(() => this.warn('catch_up_failed')); }
  private async catchUp(): Promise<void> {
    if (!this.catchUpWanted || this.catchingUp || !this.guest.hasKey()) return; const now = this.clock.now(); this.catchUps = this.catchUps.filter((t) => now - t < 60_000); if (this.catchUps.length >= 3) { this.catchUpWanted = false; this.warn('catch_up_loop'); return; } this.catchUps.push(now); this.catchingUp = true; this.catchUpWanted = false;
    try {
      let from = 0; let s: { doc: SnapshotDoc; seq: number } | null = null;
      try { s = await this.snapshot.fetch(); } catch (e) { this.warn(e instanceof SessionError ? e.code : 'snapshot_failed'); }
      if (s) { from = s.seq; this.life.fire('snapshot', { doc: s.doc, seq: s.seq }); } else this.warn('earlier_history_unavailable');
      await this.channel.resumeFrom(from, { ask: false }); await this.history.fetch(from); await this.channel.resumeFrom(this.channel.lastSeq() ?? from);
    } finally { this.catchingUp = false; }
  }

  abandon(frameId: string, reason: Error): void { this.channel.refuse(frameId, reason); }
  pathMac(path: string): string { const { kid } = this.ring.current(); return pathHmac(this.ring, kid, path); }
  async createShareLink(): Promise<{ token: string; url: string; expires_at: string; fragment: string }> {
    if (this.me.role !== 'host') throw new SessionError('not_host', 'Only the host can make a share link.'); const l = await this.rest.createShareLink(this.id); const { kid, key } = this.ring.current();
    return { ...l, fragment: `#k=${b64(key)}&kid=${kid}` };
  }
  /** The host removed us: stop for good, forget the keys of this session and say so once. */
  private async removed(code: string): Promise<void> { if (this.removedFired) return; this.removedFired = true; this.cleanup(); this.ring.clear(); void this.d.crypto.keyringStore?.(this.id)?.write('').catch?.(() => undefined); this.setState('ended'); this.life.fire('removed', { code }); this.life.fire('ended', { code }); await this.relay.close(1000, 'removed').catch(() => undefined); }
  private finish(code: number | string): void { if (this.st === 'ended') return; this.setState('ended'); this.cleanup(); this.life.fire('ended', { code }); }
  private cleanup(): void { this.closed = true; if (this.snapTimer) this.clock.clearTimeout(this.snapTimer as never); if (this.rotateTimer) this.clock.clearTimeout(this.rotateTimer as never); for (const w of this.keyWaiters) { this.clock.clearTimeout(w.timer as never); w.rej(new SessionError('ended', 'This session has ended.')); } this.keyWaiters = []; }
  async leave(): Promise<void> { if (this.closed) return; await this.channel.flush().catch(() => undefined); this.cleanup(); this.setState('ended'); await this.relay.close(1000, 'leave'); }
  async end(): Promise<void> { if (this.me.role !== 'host') throw new SessionError('not_host', 'Only the host can end the session.'); if (this.host && this.opts.buildSnapshot) await this.uploadSnap().catch(() => undefined); await Promise.race([this.sendRaw('control.end', { p: { code: 'done' } }).catch(() => undefined), new Promise((r) => this.clock.setTimeout(() => r(undefined), 2000))]); await this.rest.end(this.id); this.finish('ended'); await this.relay.close(1000, 'ended'); }
}

export interface SessionClient {
  createSession(o: { name: string; workspace: string; policy?: Partial<SessionPolicy> } & SessionOptions): Promise<SessionHandle>;
  joinSession(o: { sessionId: string; /** `#k=...` fragment of an invite */ inviteSecret?: string; inviteToken?: string } & SessionOptions): Promise<SessionHandle>;
  claimHost(sessionId: string): Promise<SessionSummary>;
  listSessions(filter?: { workspace?: string; state?: string; mine?: boolean }): AsyncIterable<SessionSummary>;
  createShareLink(sessionId: string): Promise<{ token: string; url: string; expires_at: string }>;
  joinViaShareLink(o: { token: string; displayName: string; /** `#k=<key>&kid=<kid>` from the link */ fragment: string }): Promise<SessionHandle>;
}
const RELAY_DEFAULT = 'wss://relay.centcom.dev/v1/ws';
export function createSessionClient(d: SessionClientDeps): SessionClient {
  const rest = new SessionRest(d.http);
  const ringFor = async (sid: string): Promise<KeyRing> => { const s = d.crypto.keyringStore?.(sid); if (s && d.crypto.keychain) { const r = await KeyRing.restore(s, d.crypto.keychain).catch(() => undefined); if (r) return r; } return new KeyRing(); };
  const relayUrl = (v?: string) => d.relayUrl ?? v ?? RELAY_DEFAULT;
  return {
    async createSession(o) {
      let s: SessionCreated; try { s = await rest.create({ workspace: o.workspace, name: o.name, ...(o.policy ? { policy: o.policy as SessionPolicy } : {}) }); } catch (e) { if (e instanceof CentcomError && (e.code === 'entitlement_required' || e.code === 'payment_required')) throw Object.assign(new SessionError('relay_not_included', 'Your plan does not include hosted sessions. Upgrade to create one.'), { cause: e }); throw e; }
      const h = new Connection(d, rest, s.id, 'host', s.host_member?.id ?? '', KeyRing.create(new Date((d.clock ?? realClock).now())), false, s.policy ?? {}, o, relayUrl(s.relay_url)); await h.start(); return h;
    },
    async joinSession(o) {
      const sess = await rest.get(o.sessionId); const ring = await ringFor(o.sessionId);
      if (o.inviteSecret && o.inviteToken) { const bundle = await rest.getKeyBundle(o.inviteToken); for (const k of openInviteBundle(bundle, inviteSecretFromFragment(o.inviteSecret))) if (!ring.get(k.kid)) ring.addEpoch(k.kid, k.key); }
      const c = new Connection(d, rest, o.sessionId, 'editor', '', ring, false, sess.policy ?? {}, o, relayUrl()); await c.start(); return c;
    },
    claimHost: (id) => rest.claimHost(id),
    listSessions: (f) => rest.list(f),
    createShareLink: (id) => rest.createShareLink(id),
    async joinViaShareLink(o) {
      const m = /(?:^|#|&)k=([A-Za-z0-9_-]{43})/.exec(o.fragment); if (!m) throw new SessionError('bad_link', 'That link has no key, so it cannot be opened.'); const kid = /(?:&|#)kid=(k[1-9]\d{0,8})(?:&|$)/.exec(o.fragment)?.[1] ?? 'k1'; epochOf(kid);
      const t = await rest.joinViaShareLink(o.token, o.displayName); const ring = new KeyRing(); ring.addEpoch(kid, unb64(m[1]!)); void sodium;
      const c = new Connection(d, rest, (t as unknown as { session?: string }).session ?? '', 'viewer', t.member, ring, true, {}, {}, relayUrl(t.relay_url)); await c.start(); return c;
    },
  };
}
