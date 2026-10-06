/** Quota state from session notices and `quota_exceeded` errors (CT-ENTITLEMENTS §5, CT-WS-SESSION-EVENTS notices).
 *  It tells the UI what to show and hosted actions whether the server will refuse them.
 *  Must not: stop local or LAN work, stop usage reporting, or compare usage numbers with limits (the server decides). */
import { ApiError } from '../http/errors.js';
import type { HttpClock } from '../http/types.js';

/** A `sys.notice` body as C057 re-emits it: `{code, level, params}`. Read tolerantly: unknown codes and fields are ignored. */
export interface SessionNotice { code: string; level?: string; params?: Record<string, unknown> }
export interface QuotaState { level: 'ok' | 'warning' | 'reached'; pct?: number; resetsAt?: string }

const OK: QuotaState = { level: 'ok' };
const iso = (v: unknown): string | undefined => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : undefined);

/** Holds one QuotaState. A warning or a reached quota lasts until its `resets_at` (one timer), then it is `ok` again. */
export class QuotaTracker {
  private state: QuotaState = OK; private timer: unknown; private readonly listeners = new Set<(q: QuotaState) => void>();
  constructor(private readonly clock: HttpClock) {}

  /** The current state (a passed `resets_at` already counts as reset). */
  quota(): QuotaState {
    if (this.state.resetsAt && this.clock.now() >= Date.parse(this.state.resetsAt)) this.set(OK);
    return this.state;
  }
  /** Hosted actions only: false while the quota is reached. Local and LAN work never ask this. */
  allowsHostedActions(): boolean { return this.quota().level !== 'reached'; }
  onQuota(fn: (q: QuotaState) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** `usage_warning {pct, resets_at}` -> warning (unless the quota is already reached); `quota_reached {resets_at}` -> reached. Other codes are ignored. */
  handleNotice(n: SessionNotice): void {
    const p = (n?.params && typeof n.params === 'object' ? n.params : {}) as Record<string, unknown>; const resetsAt = iso(p.resets_at);
    if (n?.code === 'usage_warning') {
      if (this.quota().level === 'reached') return;
      const pct = typeof p.pct === 'number' && p.pct >= 0 && p.pct <= 100 ? Math.round(p.pct) : undefined;
      this.set({ level: 'warning', ...(pct !== undefined ? { pct } : {}), ...(resetsAt ? { resetsAt } : {}) });
    } else if (n?.code === 'quota_reached') this.set({ level: 'reached', pct: 100, ...(resetsAt ? { resetsAt } : {}) });
  }

  /** A `quota_exceeded` (429) from any call: reached until now + `retry_after_s` (the server sets it to the period end). True when it was one. */
  handleError(e: unknown): boolean {
    if (!(e instanceof ApiError) || e.rawCode !== 'quota_exceeded') return false;
    const s = e.retryAfterS; const resetsAt = typeof s === 'number' && s > 0 ? new Date(this.clock.now() + s * 1000).toISOString() : undefined;
    this.set({ level: 'reached', pct: 100, ...(resetsAt ? { resetsAt } : {}) }); return true;
  }

  /** Stop the reset timer. */
  dispose(): void { if (this.timer !== undefined) this.clock.clearTimeout(this.timer as never); this.timer = undefined; this.listeners.clear(); }

  private set(q: QuotaState): void {
    if (this.timer !== undefined) { this.clock.clearTimeout(this.timer as never); this.timer = undefined; }
    const same = q.level === this.state.level && q.pct === this.state.pct && q.resetsAt === this.state.resetsAt; this.state = q;
    if (q.resetsAt) { const wait = Date.parse(q.resetsAt) - this.clock.now(); if (wait > 0) this.timer = this.clock.setTimeout(() => { this.timer = undefined; if (this.quota() === q) this.set(q); /* a reset over 24.8 days away: arm again */ }, Math.min(wait, 2 ** 31 - 1)); }
    if (!same) for (const fn of [...this.listeners]) { try { fn(q); } catch { /* a listener's bug must not stop the others */ } }
  }
}
