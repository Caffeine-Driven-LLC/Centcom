/** Presence is best effort: the newest update per member goes out at most every 500 ms, the newest cursor every 100 ms, and a typing indicator that is not refreshed ends after 5 s. */
import type { Frame } from '@centcom/protocol';
import type { LanClock } from '../clock.js';
import { CURSOR_FLUSH_MS, PRESENCE_FLUSH_MS, TYPING_CLEAR_MS } from './limits.js';
export class PresenceCoalescer {
  private latestUpdate = new Map<string, Frame>(); private pendingUpdate = new Map<string, Frame>(); private pendingCursor = new Map<string, Frame>(); private updateTimer: unknown; private cursorTimer: unknown; private typing = new Map<string, unknown>(); private lastCursor = new Map<string, Frame>();
  constructor(private readonly clock: LanClock, private readonly emit: (f: Frame) => void, private readonly stamp: (member: string, f: Frame) => Frame) {}
  /** `frame` already carries `from` and `ts`. */
  submit(member: string, frame: Frame): void {
    if (frame.k === 'presence.cursor') { this.lastCursor.set(member, frame); this.pendingCursor.set(member, frame); if (this.cursorTimer === undefined) this.cursorTimer = this.clock.setTimeout(() => { this.cursorTimer = undefined; const out = [...this.pendingCursor.values()]; this.pendingCursor.clear(); for (const f of out) this.emit(f); }, CURSOR_FLUSH_MS); return; }
    if (frame.k !== 'presence.update') { this.emit(frame); return; } /* nudges and unknown kinds go straight out */
    this.latestUpdate.set(member, frame); this.pendingUpdate.set(member, frame); this.watchTyping(member, frame);
    if (this.updateTimer === undefined) this.updateTimer = this.clock.setTimeout(() => { this.updateTimer = undefined; const out = [...this.pendingUpdate.values()]; this.pendingUpdate.clear(); for (const f of out) this.emit(f); }, PRESENCE_FLUSH_MS);
  }
  private watchTyping(member: string, f: Frame): void {
    const t = this.typing.get(member); if (t !== undefined) this.clock.clearTimeout(t as never); this.typing.delete(member);
    if ((f.p as { activity?: string } | undefined)?.activity !== 'typing') return;
    this.typing.set(member, this.clock.setTimeout(() => { this.typing.delete(member); const cur = this.latestUpdate.get(member); if (!cur) return; const idle = this.stamp(member, { ...cur, p: { ...(cur.p ?? {}), activity: 'idle' } }); this.latestUpdate.set(member, idle); this.pendingUpdate.set(member, idle); if (this.updateTimer === undefined) this.updateTimer = this.clock.setTimeout(() => { this.updateTimer = undefined; const out = [...this.pendingUpdate.values()]; this.pendingUpdate.clear(); for (const x of out) this.emit(x); }, PRESENCE_FLUSH_MS); }, TYPING_CLEAR_MS));
  }
  /** What a member who just joined is told: everyone's latest update. */
  burst(): Frame[] { return [...this.latestUpdate.values()]; }
  forget(member: string): void { this.latestUpdate.delete(member); this.pendingUpdate.delete(member); this.pendingCursor.delete(member); this.lastCursor.delete(member); const t = this.typing.get(member); if (t !== undefined) this.clock.clearTimeout(t as never); this.typing.delete(member); }
  stop(): void { for (const t of [this.updateTimer, this.cursorTimer, ...this.typing.values()]) if (t !== undefined) this.clock.clearTimeout(t as never); this.typing.clear(); this.updateTimer = this.cursorTimer = undefined; }
}
