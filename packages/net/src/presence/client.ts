/** Presence, typing and cursors for a session: what we tell others, and what we hear. Always best effort: nothing in here is awaited by anything else. */
import { TypedEmitter } from '../relay/emitter.js';
import type { DecodedEvent } from '../session/types.js';
import type { SessionHandle } from '../session/client.js';
import { CURSOR_TTL_MS, PresenceModel, type CursorInfo, type MemberPresence, type PresenceActivity } from './model.js';
import { LatestWins, type Clock } from './throttle.js';

export interface ActivitySource { lastInputAt(): number; onInput(fn: () => void): () => void }
export interface PresenceOptions { clock: Clock; activity: ActivitySource; awayAfterMs?: number; warn?: (msg: string) => void }
export interface PresenceEvents { changed: [string, MemberPresence]; cursor: [string, CursorInfo | undefined] }
export const UPDATE_GAP_MS = 1000; export const CURSOR_GAP_MS = 100; export const TYPING_REFRESH_MS = 3000; export const TYPING_IDLE_MS = 5000; export const AWAY_AFTER_MS = 300_000;

export class PresenceClient extends TypedEmitter<PresenceEvents> {
  private readonly model = new PresenceModel(); private readonly clock: Clock; private readonly awayAfter: number; private readonly offs: (() => void)[] = [];
  private userStatus: 'online' | 'busy' = 'online'; private away = false; private activity: PresenceActivity = 'idle'; private agentCount: number | undefined;
  private typingUntil = 0; private refreshTimer: unknown; private idleTimer: unknown; private awayTimer: unknown; private expiryTimer: unknown; private sentKey = ''; private cursorKey = '';
  private readonly updates: LatestWins<Record<string, unknown>>; private readonly cursors: LatestWins<Record<string, unknown>>; private disposed = false;
  /** how many presence frames we handed to the session (for tests and status) */
  sent = { update: 0, cursor: 0 };
  constructor(private readonly session: SessionHandle, private readonly o: PresenceOptions) {
    super(); this.clock = o.clock; this.awayAfter = o.awayAfterMs ?? AWAY_AFTER_MS;
    this.updates = new LatestWins(this.clock, UPDATE_GAP_MS, (p) => this.emitUpdate(p)); this.cursors = new LatestWins(this.clock, CURSOR_GAP_MS, (s) => this.emitCursor(s));
    this.offs.push(session.onAny((e) => this.onEvent(e)), o.activity.onInput(() => this.onInput()));
    this.armAway();
  }
  dispose(): void { this.disposed = true; this.updates.cancel(); this.cursors.cancel(); for (const t of [this.refreshTimer, this.idleTimer, this.awayTimer, this.expiryTimer]) if (t !== undefined) this.clock.clearTimeout(t as never); for (const f of this.offs.splice(0)) f(); }
  members(): Map<string, MemberPresence> { return this.model.members(this.clock.now()); }

  /* ------------------------------------------------------------- what we say */
  private body(): Record<string, unknown> { return { status: this.away && this.userStatus !== 'busy' ? 'away' : this.userStatus, activity: this.activity, ...(this.agentCount !== undefined ? { agent_count: this.agentCount } : {}) }; }
  private emitUpdate(p: Record<string, unknown>): void { this.sentKey = JSON.stringify(p); this.sent.update++; void this.session.sendEvent('presence.update', { p }).catch(() => undefined); }
  private emitCursor(s: Record<string, unknown>): void { this.sent.cursor++; void this.session.sendEvent('presence.cursor', { secret: s }).catch(() => undefined); }
  /** Send the current state if it differs from what was last sent (or `force`, for the typing refresh). */
  private publish(force = false): void { if (this.disposed) return; const p = this.body(); if (!force && JSON.stringify(p) === this.sentKey) return; this.updates.push(p); }
  setStatus(s: 'online' | 'busy'): void { this.userStatus = s; this.publish(); }
  setActivity(a: PresenceActivity, agentCount?: number): void {
    this.agentCount = agentCount ?? this.agentCount; this.activity = a;
    if (a === 'typing') { this.typingUntil = this.clock.now() + TYPING_IDLE_MS; this.armTyping(); } else { this.clearTyping(); }
    this.publish();
  }
  private armTyping(): void {
    if (this.idleTimer !== undefined) this.clock.clearTimeout(this.idleTimer as never); this.idleTimer = this.clock.setTimeout(() => { this.idleTimer = undefined; if (this.activity === 'typing') this.setActivity('idle'); }, TYPING_IDLE_MS);
    if (this.refreshTimer === undefined) { const tick = (): void => { this.refreshTimer = undefined; if (this.disposed || this.activity !== 'typing') return; this.publish(true); this.refreshTimer = this.clock.setTimeout(tick, TYPING_REFRESH_MS); }; this.refreshTimer = this.clock.setTimeout(tick, TYPING_REFRESH_MS); }
  }
  private clearTyping(): void { for (const k of ['refreshTimer', 'idleTimer'] as const) if (this[k] !== undefined) { this.clock.clearTimeout(this[k] as never); this[k] = undefined; } }
  /** Anything the person does counts as input: back from away, and the away timer starts over. */
  private onInput(): void { if (this.away) { this.away = false; this.publish(); } this.armAway(); }
  private armAway(): void {
    if (this.awayTimer !== undefined) this.clock.clearTimeout(this.awayTimer as never); const due = this.o.activity.lastInputAt() + this.awayAfter - this.clock.now();
    this.awayTimer = this.clock.setTimeout(() => { this.awayTimer = undefined; if (this.disposed) return; if (this.clock.now() - this.o.activity.lastInputAt() >= this.awayAfter) { if (!this.away) { this.away = true; if (this.userStatus !== 'busy') this.publish(); } } else this.armAway(); }, Math.max(0, due));
  }
  /** `null` clears it. Identical positions send nothing; at most 10 a second go out, the latest one. */
  setCursor(c: { path?: string; line?: number; col?: number; selEndLine?: number; selEndCol?: number } | null): void {
    const s: Record<string, unknown> = c ? { ...(c.path !== undefined ? { path: c.path } : {}), ...(c.line !== undefined ? { line: c.line } : {}), ...(c.col !== undefined ? { col: c.col } : {}), ...(c.selEndLine !== undefined ? { sel_end_line: c.selEndLine } : {}), ...(c.selEndCol !== undefined ? { sel_end_col: c.selEndCol } : {}) } : {};
    const key = JSON.stringify(s); if (key === this.cursorKey || this.disposed) return; this.cursorKey = key; this.cursors.push(s);
  }

  /* ------------------------------------------------------------- what we hear */
  private onEvent(e: DecodedEvent): void {
    if (e.kind === 'control.member_left' && typeof e.p?.member === 'string') { const m = this.model.offline(e.p.member, this.clock.now()); this.emit('changed', e.p.member, m); return; }
    if (e.kind !== 'presence.update' && e.kind !== 'presence.cursor') return;
    if (e.from === this.session.me.id) return; if (!this.session.roster().some((m) => m.id === e.from)) { this.o.warn?.('presence.unknown_sender'); return; }
    const now = this.clock.now();
    if (e.kind === 'presence.update') { const m = this.model.update(e.from, e.p ?? {}, now); this.emit('changed', e.from, m); return; }
    const m = this.model.cursor(e.from, e.secret ?? {}, now); this.emit('cursor', e.from, m.cursor); this.emit('changed', e.from, m); this.armExpiry();
  }
  private armExpiry(): void {
    const at = this.model.nextExpiry(); if (at === undefined) return; if (this.expiryTimer !== undefined) this.clock.clearTimeout(this.expiryTimer as never);
    this.expiryTimer = this.clock.setTimeout(() => { this.expiryTimer = undefined; for (const id of this.model.expire(this.clock.now())) { this.emit('cursor', id, undefined); const m = this.model.members(this.clock.now()).get(id); if (m) this.emit('changed', id, m); } this.armExpiry(); }, Math.max(0, at - this.clock.now()) + 1);
  }
}
export { CURSOR_TTL_MS };
