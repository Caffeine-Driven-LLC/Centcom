/** What happens when the network is down at refresh time: stay signed in, retry with backoff (500 ms x 2^n, at most 30 s), and let at most 20 requests wait for up to 10 s before they fail with a typed error. */
import { AuthError } from './errors.js';
import { getAccessToken, refreshAccessToken, type AuthDeps } from './refresh.js';

export const BACKOFF_BASE_MS = 500; export const BACKOFF_CAP_MS = 30_000; export const QUEUE_MAX = 20; export const QUEUE_WAIT_MS = 10_000;
export const backoffMs = (attempt: number): number => Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
export class RefreshOutage {
  private waiters: { res(t: string): void; rej(e: unknown): void; timer: unknown }[] = []; attempt = 0; private retry: unknown; private readonly st: (fn: () => void, ms: number) => unknown; private readonly ct: (h: unknown) => void;
  constructor(private readonly d: AuthDeps & { clearTimeout?: (h: unknown) => void }) { this.st = d.setTimeout ?? ((f, ms) => setTimeout(f, ms)); this.ct = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)); }
  get waiting(): number { return this.waiters.length; }
  /** A valid token, or the typed `network` error after 10 s (or at once when 20 requests already wait). Any other refresh failure goes through unchanged. */
  async token(): Promise<string> { try { return await getAccessToken(this.d); } catch (e) { if (!(e instanceof AuthError) || e.code !== 'network') throw e; return this.wait(); } }
  private wait(): Promise<string> {
    if (this.waiters.length >= QUEUE_MAX) return Promise.reject(new AuthError('network'));
    return new Promise<string>((res, rej) => { const w = { res, rej, timer: this.st(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new AuthError('network')); }, QUEUE_WAIT_MS) }; this.waiters.push(w); this.arm(); });
  }
  private arm(): void {
    if (this.retry !== undefined) return;
    this.retry = this.st(() => { this.retry = undefined; void refreshAccessToken(this.d).then((t) => { this.attempt = 0; this.flush((w) => w.res(t)); }).catch((e: unknown) => { if (e instanceof AuthError && e.code === 'network') { this.attempt++; if (this.waiters.length) this.arm(); } else { this.attempt = 0; this.flush((w) => w.rej(e)); } }); }, backoffMs(this.attempt));
  }
  private flush(f: (w: { res(t: string): void; rej(e: unknown): void }) => void): void { const ws = this.waiters; this.waiters = []; for (const w of ws) { this.ct(w.timer); f(w); } }
  dispose(): void { if (this.retry !== undefined) this.ct(this.retry); this.retry = undefined; this.flush((w) => w.rej(new AuthError('network'))); }
}
