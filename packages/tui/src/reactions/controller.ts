import type { ToastInput } from '../toast/controller.js';
import { COMMENT_UI_CAP, canAdd, emptyComments, emptyReactions, mineOn, reduceComments, reduceReactions, type CommentState, type DecodedFrame, type MemberId, type MsgId, type ReactionState } from './model.js';

export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface OutFrame { t: 'event'; k: 'reaction' | 'comment.add'; id: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }
export interface ReactionControllerOptions { self: MemberId; clock: Clock; /** sends the frame; the echo comes back through `onFrame` */ send(f: OutFrame): Promise<unknown>; newId(): string; toast?(t: ToastInput): void; canReact?(): boolean; /** false while the target message is not loaded yet */ hasTarget?(t: MsgId): boolean; revertAfterMs?: number }
export const REVERT_MS = 5000; export const HOLD_MS = 60_000; export const BUCKET_CAP = 20; export const REFILL_PER_S = 30;
export type ToggleResult = 'sent' | 'blocked' | 'limit' | 'rate' | 'disabled' | 'held' | 'paused';
export type CommentResult = { ok: true } | { ok: false; reason: 'empty' | 'too_long' | 'disabled' | 'rate' | 'failed' };

/** Optimistic reactions: the toggle shows at once and is taken back if no echo arrives within 5 s. A token bucket (20, refilling 30 a second) drops UI spam instead of queueing it. */
export class ReactionController {
  private real: ReactionState = emptyReactions(); private rs: ReactionState = emptyReactions(); private cs: CommentState = emptyComments(); private pending = new Map<string, { target: MsgId; code: string; op: 'add' | 'remove'; timer: unknown }>(); private held = new Map<string, unknown>(); private latest?: { target: MsgId; code: string; op: 'add' | 'remove' }; private pausedUntil = 0; private errored = false; private fns = new Set<() => void>();
  private tokens = BUCKET_CAP; private lastRefill: number;
  constructor(private readonly o: ReactionControllerOptions) { this.lastRefill = o.clock.now(); }
  get reactions(): ReactionState { return this.rs; } get comments(): CommentState { return this.cs; }
  subscribe(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private bump(): void { for (const f of [...this.fns]) { try { f(); } catch { /* a listener must not break us */ } } }
  private take(): boolean { const now = this.o.clock.now(); this.tokens = Math.min(BUCKET_CAP, this.tokens + ((now - this.lastRefill) / 1000) * REFILL_PER_S); this.lastRefill = now; if (this.tokens < 1) return false; this.tokens -= 1; return true; }
  /** Every frame from the session goes through here (echoes of ours too). */
  onFrame(f: DecodedFrame): void { const p = f.id ? this.pending.get(f.id) : undefined; if (p && f.id) { this.o.clock.clearTimeout(p.timer as never); this.pending.delete(f.id); /* the real frame replaces the guess */ } const a = reduceReactions(this.real, f); const b = reduceComments(this.cs, f); if (p || a !== this.real || b !== this.cs) { this.real = a; this.cs = b; this.recompute(); this.bump(); } }
  /** What is shown: the confirmed reactions with every unconfirmed toggle of ours laid over them, oldest first. */
  private recompute(): void { const entries = { ...this.real.entries }; for (const p of this.pending.values()) entries[`${this.o.self}\u0000${p.target}\u0000${p.code}`] = { member: this.o.self, target: p.target, code: p.code, on: p.op === 'add', seq: Number.MAX_SAFE_INTEGER }; this.rs = { entries, seen: this.real.seen }; }
  toggle(target: MsgId, code: string): ToggleResult {
    if (this.errored || (this.o.canReact && !this.o.canReact())) return 'disabled'; if (this.o.hasTarget && !this.o.hasTarget(target)) { this.hold(target, code); return 'held'; } const on = mineOn(this.rs, target, this.o.self).includes(code); const op = on ? 'remove' : 'add';
    if (op === 'add' && canAdd(this.rs, target, this.o.self, code) === 'limit') { this.o.toast?.({ level: 'warn', key: 'reaction:limit', text: 'You can use up to 3 reactions on one message.' }); return 'limit'; }
    if (this.paused()) { this.latest = { target, code, op }; return 'paused'; }
    if (!this.take()) return 'rate'; const id = this.o.newId();
    this.dispatch(target, code, op, id); return 'sent';
  }
  private paused(): boolean { return this.o.clock.now() < this.pausedUntil; }
  /** Optimistic apply plus send; the 5 s take-back starts now. */
  private dispatch(target: MsgId, code: string, op: 'add' | 'remove', id = this.o.newId()): void {
    const drop = (): boolean => { const p = this.pending.get(id); if (!p) return false; this.o.clock.clearTimeout(p.timer as never); this.pending.delete(id); this.recompute(); this.bump(); return true; };
    const timer = this.o.clock.setTimeout(() => { drop(); }, this.o.revertAfterMs ?? REVERT_MS); this.pending.set(id, { target, code, op, timer }); this.recompute(); this.bump();
    void this.o.send({ t: 'event', k: 'reaction', id, p: { target, code, op } }).catch(() => { drop(); });
  }
  /** The target is not loaded yet: keep the latest toggle for up to 60 s, then drop it. */
  private hold(target: MsgId, code: string): void { const k = `${target}\u0000${code}`; const h = this.held.get(k); if (h) this.o.clock.clearTimeout(h as never); this.held.set(k, this.o.clock.setTimeout(() => { this.held.delete(k); }, HOLD_MS)); }
  /** Call when a target message has loaded: reactions held for it are sent. */
  targetLoaded(target: MsgId): void { for (const [k, h] of [...this.held]) { const [t, code] = k.split('\u0000') as [string, string]; if (t !== target) continue; this.o.clock.clearTimeout(h as never); this.held.delete(k); this.toggle(t, code); } }
  /** `sys.error` for a send of ours: `forbidden` takes every guess back and turns the controls off; `slow_down` pauses sending for `for_ms`, then sends only the latest toggle made meanwhile. */
  onSysError(e: { code: string; for_ms?: number }): void {
    if (e.code === 'forbidden') { this.errored = true; this.latest = undefined; for (const [id, p] of [...this.pending]) { this.o.clock.clearTimeout(p.timer as never); this.pending.delete(id); } this.recompute(); this.bump(); return; }
    if (e.code === 'slow_down') { const ms = Math.max(0, e.for_ms ?? 1000); this.pausedUntil = this.o.clock.now() + ms; this.o.clock.setTimeout(() => { const l = this.latest; this.latest = undefined; if (l && !this.errored && this.take()) this.dispatch(l.target, l.code, l.op); }, ms); }
  }
  get disabled(): boolean { return this.errored; }
  /** The text goes only into `secret` (the encrypted part); `p` stays absent. */
  async comment(target: MsgId, text: string): Promise<CommentResult> {
    if (this.errored || (this.o.canReact && !this.o.canReact())) return { ok: false, reason: 'disabled' }; if (this.paused()) return { ok: false, reason: 'rate' }; const t = text.trim(); if (!t) return { ok: false, reason: 'empty' }; if (text.length > COMMENT_UI_CAP) return { ok: false, reason: 'too_long' }; if (!this.take()) return { ok: false, reason: 'rate' };
    try { await this.o.send({ t: 'event', k: 'comment.add', id: this.o.newId(), secret: { target, text: t } }); return { ok: true }; } catch { return { ok: false, reason: 'failed' }; }
  }
}
/** Plays a reaction animation once per received reaction, at most 3 at a time; with reduced motion it is a static glyph. */
export class ReactionAnimator {
  private played = new Set<string>(); private active: number[] = [];
  constructor(private readonly clock: { now(): number }, private readonly o: { reducedMotion?: () => boolean; durationMs?: number } = {}) {}
  request(frameId: string, animation: string | undefined): { kind: 'animation'; name: string } | { kind: 'glyph' } | null {
    if (this.played.has(frameId)) return null; this.played.add(frameId); if (this.played.size > 2000) this.played.delete(this.played.values().next().value as string); if (!animation) return { kind: 'glyph' }; if (this.o.reducedMotion?.()) return { kind: 'glyph' };
    const now = this.clock.now(); this.active = this.active.filter((t) => t > now); if (this.active.length >= 3) return { kind: 'glyph' }; this.active.push(now + (this.o.durationMs ?? 1500)); return { kind: 'animation', name: animation };
  }
}
