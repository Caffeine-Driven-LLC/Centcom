import { failure, errCode, ulid, type Http } from '../workspace/data.js';
import type { Entitlements, Money } from './model.js';
export type Res<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string; retryAfterS?: number };
const fail = (e: unknown): { ok: false; reason: string; retryAfterS?: number } => { if (errCode(e) === 'idempotency_conflict') return { ok: false, reason: 'conflict' }; return { ok: false, ...failure(e) }; };
export interface CheckoutInput { plan: 'pro' | 'team'; interval: 'month' | 'year'; seats?: number; currency?: 'USD' | 'EUR' }
/** A hosted checkout: the browser is sent to the returned address; nothing from the payment page is embedded here. */
export async function startCheckout(http: Http, ws: string, input: CheckoutInput, successUrl: string, cancelUrl: string, key: string = ulid()): Promise<Res<{ url: string }>> {
  try { const r = await http.call('createCheckout', { id: ws, body: { ...input, success_url: successUrl, cancel_url: cancelUrl } }, { idempotencyKey: key }); const url = (r.data as { url?: string }).url; return url && /^https:\/\//.test(url) ? { ok: true, url } : { ok: false, reason: 'error' }; } catch (e) { return fail(e); }
}
export async function openPortal(http: Http, ws: string, returnUrl: string): Promise<Res<{ url: string }>> { try { const r = await http.call('createPortalSession', { id: ws, body: { return_url: returnUrl } }); const url = (r.data as { url?: string }).url; return url && /^https:\/\//.test(url) ? { ok: true, url } : { ok: false, reason: 'error' }; } catch (e) { return fail(e); } }
export const loadEntitlements = async (http: Http, ws: string): Promise<Entitlements> => (await http.call('getEntitlements', { id: ws })).data as Entitlements;
/** After the return from checkout: ask every 2 s, for at most 30 s, until `rev` goes up. */
export async function pollEntitlements(http: Http, ws: string, baseRev: number, o: { sleep(ms: number): Promise<void>; now(): number; everyMs?: number; maxMs?: number }): Promise<{ state: 'updated'; ent: Entitlements } | { state: 'timeout' }> {
  const t0 = o.now(); for (;;) { try { const e = await loadEntitlements(http, ws); if (e.rev > baseRev) return { state: 'updated', ent: e }; } catch { /* ask again */ } if (o.now() - t0 >= (o.maxMs ?? 30_000)) return { state: 'timeout' }; await o.sleep(o.everyMs ?? 2000); }
}
export interface SeatPreview { seats: number; proration: { amount: Money; effective_at?: string } | null }
export async function previewSeats(http: Http, ws: string, seats: number): Promise<Res<{ preview: SeatPreview }>> { try { const r = await http.call('changeSeats', { id: ws, preview: true, body: { seats } }); return { ok: true, preview: r.data as SeatPreview }; } catch (e) { return fail(e); } }
export async function confirmSeats(http: Http, ws: string, seats: number, key: string = ulid()): Promise<Res<{ seats: number }>> { try { const r = await http.call('changeSeats', { id: ws, body: { seats } }, { idempotencyKey: key }); return { ok: true, seats: (r.data as { seats: number }).seats }; } catch (e) { return fail(e); } }
export async function redeemCoupon(http: Http, ws: string, code: string): Promise<Res> { try { await http.call('redeemCoupon', { id: ws, body: { code: code.trim() } }); return { ok: true }; } catch (e) { return fail(e); } }
/** The last entitlements, kept in memory for 5 minutes; after a failed fetch the last good ones are shown for up to 24 h, marked "as of". */
export class EntCache {
  private v?: { ent: Entitlements; at: number }; constructor(private readonly now: () => number = Date.now) {}
  fresh(claimRev?: number): Entitlements | undefined { if (!this.v) return undefined; if (this.now() - this.v.at > 5 * 60_000) return undefined; if (claimRev !== undefined && claimRev !== this.v.ent.rev) return undefined; return this.v.ent; }
  put(ent: Entitlements): void { this.v = { ent, at: this.now() }; }
  stale(): { ent: Entitlements; asOf: number } | undefined { return this.v && this.now() - this.v.at <= 24 * 3_600_000 ? { ent: this.v.ent, asOf: this.v.at } : undefined; }
  invalidate(): void { this.v = undefined; }
}
export { ulid };
