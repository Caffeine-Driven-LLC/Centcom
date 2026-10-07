/** Billing reads and actions (CT-API-BILLING) over the C051 HTTP client. Returns hosted checkout and portal URLs for the caller to open.
 *  Must not: touch card or payment data, log a checkout or portal URL (they carry session tokens), accept a URL that is not https
 *  (or the configured dev base), or send a seat change without an Idempotency-Key. */
import { newIdGenerator } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import { ApiError } from '../http/errors.js';
import { newIdempotencyKey } from '../http/idempotency.js';
import type { HttpClient, IdGenerator, OperationArgs, OperationResponse, PageItem } from '../http/types.js';

/** The web fallback and the app deep link for billing (CT-DEEPLINK). */
export const BILLING_WEB_URL = 'https://centcom.dev/billing';
export const BILLING_DEEP_LINK = 'centcom://billing';

export type Plan = OperationResponse<'listPlans'> extends ReadonlyArray<infer P> ? P : never;
export type Subscription = OperationResponse<'getSubscription'>;
export type Invoice = PageItem<'listInvoices'>;
export type UsageSummary = OperationResponse<'getUsageSummary'>;
export type SeatChangeResult = OperationResponse<'changeSeats'>;
type CheckoutBody = NonNullable<OperationArgs<'createCheckout'>['body']>;
export interface CheckoutOptions { plan: CheckoutBody['plan']; seats?: number; currency?: 'USD' | 'EUR'; /** default 'month' (the contract requires one) */ interval?: CheckoutBody['interval']; /** reuse a key for a caller-level retry of the same checkout */ idempotencyKey?: string }

/** A checkout or portal URL that is not https (or the dev base). Carries no URL. */
export class InvalidUrlError extends CentcomError {
  constructor() { super({ kind: 'protocol' }); this.name = 'InvalidUrlError'; this.message = 'billing URL is not https'; }
}
/** 403 not_a_member on a workspace's billing or entitlements. */
export class NotAMemberError extends ApiError {
  constructor(e: ApiError) { super(e, e.rawCode, { operationId: e.operationId, attempts: e.attempts, requestId: e.requestId }); this.name = 'NotAMemberError'; }
}
/** A coupon the server refused (coupon_invalid). */
export class CouponInvalidError extends ApiError {
  constructor(e: ApiError) { super(e, e.rawCode, { operationId: e.operationId, attempts: e.attempts, requestId: e.requestId }); this.name = 'CouponInvalidError'; }
}

/** https only, plus the configured dev base (for example the loopback mock). No credentials in the URL. */
export function isAllowedBillingUrl(raw: string, devBaseUrl?: string): boolean {
  let u: URL; try { u = new URL(raw); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (!devBaseUrl) return false;
  try { const d = new URL(devBaseUrl); return u.protocol === d.protocol && u.host === d.host; } catch { return false; }
}

export interface BillingApi {
  /** GET /v1/plans (public) */
  plans(): Promise<Plan[]>;
  subscription(wsp: string): Promise<Subscription>;
  /** Every invoice, one page fetched at a time. */
  invoices(wsp: string): AsyncIterable<Invoice>;
  usageSummary(wsp: string): Promise<UsageSummary>;
  /** POST checkout (Idempotency-Key required; the client keeps it across retries) -> a hosted checkout URL. Never opened here. */
  checkout(wsp: string, o: CheckoutOptions): Promise<{ url: string }>;
  /** POST portal -> a billing portal URL. Never opened here. */
  portal(wsp: string, o?: { returnUrl?: string }): Promise<{ url: string }>;
  /** PATCH seats?preview=true: the proration preview; changes nothing. */
  previewSeats(wsp: string, seats: number): Promise<SeatChangeResult>;
  /** PATCH seats: commits the change, then calls `onSeatsChanged` (the entitlements client refetches). */
  setSeats(wsp: string, seats: number): Promise<SeatChangeResult>;
  /** POST coupons/redeem. A refused code throws CouponInvalidError. */
  redeemCoupon(wsp: string, code: string): Promise<Subscription>;
}

export interface BillingApiOptions { http: HttpClient; /** for Idempotency-Keys on PATCH seats (default: a CSPRNG-backed ULID generator) */ ids?: IdGenerator; devBaseUrl?: string; onSeatsChanged?: () => Promise<unknown> | void }

const cryptoIds = (): IdGenerator => newIdGenerator({ now: () => Date.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) });
const asNotMember = (e: unknown): unknown => (e instanceof ApiError && e.status === 403 && e.rawCode === 'not_a_member' ? new NotAMemberError(e) : e);

/** Build the billing API. Inert until a method is called. */
export function createBillingApi(o: BillingApiOptions): BillingApi {
  const { http } = o; const ids = o.ids ?? cryptoIds();
  const checkUrl = (r: { url: string }): { url: string } => { if (!isAllowedBillingUrl(r.url, o.devBaseUrl)) throw new InvalidUrlError(); return { url: r.url }; };
  const seats = async (wsp: string, n: number, preview: boolean) => {
    if (!Number.isInteger(n) || n < 1) throw new TypeError('seats must be a positive integer');
    const r = await http.call('changeSeats', { path: { id: wsp }, ...(preview ? { query: { preview: true } } : {}), body: { seats: n } }, { idempotencyKey: newIdempotencyKey(ids) }).catch((e: unknown) => { throw asNotMember(e); });
    return r.data;
  };
  return {
    async plans() { return [...(await http.call('listPlans', {})).data]; },
    async subscription(wsp) { return (await http.call('getSubscription', { path: { id: wsp } }).catch((e: unknown) => { throw asNotMember(e); })).data; },
    invoices: (wsp) => http.paginate('listInvoices', { path: { id: wsp } }),
    async usageSummary(wsp) { return (await http.call('getUsageSummary', { path: { id: wsp } }).catch((e: unknown) => { throw asNotMember(e); })).data; },
    async checkout(wsp, c) {
      const body: CheckoutBody = { plan: c.plan, interval: c.interval ?? 'month', ...(c.seats !== undefined ? { seats: c.seats } : {}), ...(c.currency ? { currency: c.currency } : {}) };
      const r = await http.call('createCheckout', { path: { id: wsp }, body }, c.idempotencyKey ? { idempotencyKey: c.idempotencyKey } : {}).catch((e: unknown) => { throw asNotMember(e); });
      return checkUrl(r.data);
    },
    async portal(wsp, p = {}) {
      const r = await http.call('createPortalSession', { path: { id: wsp }, body: p.returnUrl ? { return_url: p.returnUrl } : {} }).catch((e: unknown) => { throw asNotMember(e); });
      return checkUrl(r.data);
    },
    previewSeats: (wsp, n) => seats(wsp, n, true),
    async setSeats(wsp, n) { const r = await seats(wsp, n, false); try { await o.onSeatsChanged?.(); } catch { /* the refetch reports its own failure through the entitlements view */ } return r; },
    async redeemCoupon(wsp, code) {
      try { return (await http.call('redeemCoupon', { path: { id: wsp }, body: { code } })).data; } catch (e) {
        if (e instanceof ApiError && e.rawCode === 'coupon_invalid') throw new CouponInvalidError(e);
        throw asNotMember(e);
      }
    },
  };
}
