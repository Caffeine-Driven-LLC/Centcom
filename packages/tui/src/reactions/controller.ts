import type { ToastInput } from '../toast/controller.js';
import { COMMENT_UI_CAP, canAdd, emptyComments, emptyReactions, mineOn, reduceComments, reduceReactions, type CommentState, type DecodedFrame, type MemberId, type MsgId, type ReactionState } from './model.js';

export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface OutFrame { t: 'event'; k: 'reaction' | 'comment.add'; id: string; p?: Record<string, unknown>; secret?: Record<string, unknown> }
export interface ReactionControllerOptions { self: MemberId; clock: Clock; /** sends the frame; the echo comes back through `onFrame` */ send(f: OutFrame): Promise<unknown>; newId(): string; toast?(t: ToastInput): void; canReact?(): boolean; revertAfterMs?: number }
export const REVERT_MS = 5000; export const BUCKET_CAP = 20; export const REFILL_PER_S = 30;
export type ToggleResult = 'sent' | 'blocked' | 'limit' | 'rate' | 'disabled';
export type CommentResult = { ok: true } | { ok: false; reason: 'empty' | 'too_long' | 'disabled' | 'rate' | 'failed' };

/** Optimistic reactions: the toggle shows at once and is taken back if no echo arrives within 5 s. A token bucket (20, refilling 30 a second) drops UI spam instead of queueing it. */
export class ReactionController {
  private rs: ReactionState = emptyReactions(); private cs: CommentState = emptyComments(); private pending = new Map<string, { target: MsgId; code: string; op: 'add' | 'remove'; timer: unknown }>(); private fns = new Set<() => void>();
  private tokens = BUCKET_CAP; private lastRefill: number;
  constructor(private readonly o: ReactionControllerOptions) { this.lastRefill = o.clock.now(); }
  get reactions(): ReactionState { return this.rs; } get comments(): CommentState { return this.cs; }
  subscribe(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }
  private bump(): void { for (const f of [...this.fns]) { try { f(); } catch { /* a listener must not break us */ } } }
  private take(): boolean { const now = this.o.clock.now(); this.tokens = Math.min(BUCKET_CAP, this.tokens + ((now - this.lastRefill) / 1000) * REFILL_PER_S); this.lastRefill = now; if (this.tokens < 1) return false; this.tokens -= 1; return true; }
  /** Every frame from the session goes through here (echoes of ours too). */
  onFrame(f: DecodedFrame): void { const p = f.id ? this.pending.get(f.id) : undefined; if (p && f.id) { this.o.clock.clearTimeout(p.timer as never); this.pending.delete(f.id); const k = `${this.o.self}\u0000${p.target}\u0000${p.code}`; const entries = { ...this.rs.entries }; delete entries[k]; this.rs = { entries, seen: this.rs.seen }; /* the real frame replaces the guess */ } const a = reduceReactions(this.rs, f); const b = reduceComments(this.cs, f); if (a !== this.rs || b !== this.cs) { this.rs = a; this.cs = b; this.bump(); } }
  toggle(target: MsgId, code: string): ToggleResult {
    if (this.o.canReact && !this.o.canReact()) return 'disabled'; const on = mineOn(this.rs, target, this.o.self).includes(code); const op = on ? 'remove' : 'add';
    if (op === 'add' && canAdd(this.rs, target, this.o.self, code) === 'limit') { this.o.toast?.({ level: 'warn', key: 'reaction:limit', text: 'You can use up to 3 reactions on one message.' }); return 'limit'; }
    if (!this.take()) return 'rate'; const id = this.o.newId(); const seq = Number.MAX_SAFE_INTEGER; /* optimistic: wins until the real frame (a lower seq, same member) replaces it */
    const before = this.rs; this.rs = { entries: { ...this.rs.entries, [`${this.o.self}\u0000${target}\u0000${code}`]: { member: this.o.self, target, code, on: op === 'add', seq } }, seen: this.rs.seen }; this.bump();
    const timer = this.o.clock.setTimeout(() => { if (!this.pending.delete(id)) return; this.rs = this.revert(before, target, code); this.bump(); }, this.o.revertAfterMs ?? REVERT_MS); this.pending.set(id, { target, code, op, timer });
    void this.o.send({ t: 'event', k: 'reaction', id, p: { target, code, op } }).catch(() => { const p = this.pending.get(id); if (!p) return; this.o.clock.clearTimeout(p.timer as never); this.pending.delete(id); this.rs = this.revert(before, target, code); this.bump(); }); return 'sent';
  }
  private revert(before: ReactionState, target: MsgId, code: string): ReactionState { const k = `${this.o.self}\u0000${target}\u0000${code}`; const entries = { ...this.rs.entries }; const prev = before.entries[k]; if (prev) entries[k] = prev; else delete entries[k]; return { entries, seen: this.rs.seen }; }
  /** The text goes only into `secret` (the encrypted part); `p` stays absent. */
  async comment(target: MsgId, text: string): Promise<CommentResult> {
    if (this.o.canReact && !this.o.canReact()) return { ok: false, reason: 'disabled' }; const t = text.trim(); if (!t) return { ok: false, reason: 'empty' }; if (text.length > COMMENT_UI_CAP) return { ok: false, reason: 'too_long' }; if (!this.take()) return { ok: false, reason: 'rate' };
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
