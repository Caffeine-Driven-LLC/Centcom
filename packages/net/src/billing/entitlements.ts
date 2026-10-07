/** The entitlements client (lane C064): one source of truth for every feature gate in the client. Fetches
 *  `GET /v1/workspaces/{id}/entitlements`, validates it with the C003 schema, caches it in memory and on disk, refetches on the
 *  CT-ENTITLEMENTS §6 triggers, and answers gates synchronously.
 *  Must not: gate LAN or local use, trust its cache for hosted-action authorisation (the server enforces), throw at display callers,
 *  or log anything from the object beyond plan, rev and status. */
import { isId, validateAgainst, type Entitlements } from '@centcom/protocol';
import { CentcomError } from '../errors/index.js';
import { ApiError, ContractViolationError } from '../http/errors.js';
import type { HttpClient, HttpClock, IdGenerator } from '../http/types.js';
import type { Logger } from '../log/index.js';
import type { SessionNotice } from '../usage/quota-state.js';
import { BILLING_WEB_URL, InvalidUrlError, NotAMemberError, createBillingApi, isAllowedBillingUrl, type BillingApi } from './billing-api.js';
import { EntitlementsDiskCache, freshness, needsRefetch, pickEntitlements, type CachedEntitlements } from './cache.js';
import { banner, can, defaultEntitlements, limit, remaining, type Banner, type MeteredKey, type QuotaNotice } from './gates.js';

/** What `get()` and `onChange` hand out. `source: 'defaults'` means nothing usable was known (free limits, status none). */
export interface EntitlementsView { ent: Entitlements; fetchedAt: string; stale: boolean; source: 'network' | 'cache' | 'defaults'; /** why the network was not used, when it failed (typed: NotAMemberError, ContractViolationError, TransportError, ApiError) */ error?: CentcomError }
/** The part of the C052 TokenManager this client uses. */
export interface EntitlementsAuth { claims(): { ent?: number } | null; on(ev: 'ent-changed', fn: () => void): () => void }
export interface EntitlementsClientOptions {
  /** null: no network at all (gates still answer, from cache or defaults) */
  http: HttpClient | null;
  auth?: EntitlementsAuth;
  workspaceId: () => string | null;
  clock: HttpClock;
  /** the state directory; the cache lives in its `entitlements/` folder */
  cacheDir: string;
  opener?: (url: string) => Promise<boolean>;
  logger?: Logger;
  /** a non-https base the opener may still open (the loopback mock in development) */
  devBaseUrl?: string;
  ids?: IdGenerator;
}

/** After a failed fetch, a non-forced `get()` waits this long before trying the network again (it serves the cache meanwhile). */
export const FAILURE_BACKOFF_MS = 30_000;
/** One fetch, retries included, may take this long before the cache is served instead. */
export const FETCH_TIMEOUT_MS = 10_000;
const ENTITLEMENT_CODE = /^entitlement_/;

export class EntitlementsClient {
  /** Billing reads and actions; `setSeats` triggers a forced refetch. */
  readonly billing: BillingApi;
  private readonly mem = new Map<string, CachedEntitlements>();
  private readonly inflight = new Map<string, Promise<EntitlementsView>>();
  private readonly invalidated = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private readonly listeners = new Set<(v: EntitlementsView) => void>();
  private readonly disk: EntitlementsDiskCache;
  private readonly log?: Logger;
  private notice?: QuotaNotice & { until?: number };
  private lastEmitted?: string;
  private unsub?: () => void;

  constructor(private readonly o: EntitlementsClientOptions) {
    this.disk = new EntitlementsDiskCache(o.cacheDir); this.log = o.logger?.child({ component: 'entitlements' });
    const http = o.http;
    this.billing = http ? createBillingApi({ http, ids: o.ids, devBaseUrl: o.devBaseUrl, onSeatsChanged: () => this.get({ force: true }) }) : offlineBilling();
    this.unsub = o.auth?.on('ent-changed', () => { const w = this.wsp(); if (w) { this.invalidated.add(w); void this.get(); } });
  }

  /** Stop listening to the token manager. */
  close(): void { this.unsub?.(); this.unsub = undefined; this.listeners.clear(); }

  private wsp(): string | null { const w = this.o.workspaceId(); return w && isId('wsp', w) ? w : null; }
  private now(): number { return this.o.clock.now(); }

  /** The entitlements for the active workspace. Never throws: offline it serves the last known value (stale after 5 minutes, for up to 24 hours), then free defaults. */
  async get(o: { force?: boolean } = {}): Promise<EntitlementsView> {
    const wsp = this.wsp(); if (!wsp) return this.defaults('');
    if (!this.mem.has(wsp)) { const d = await this.disk.read(wsp); if (d && !this.mem.has(wsp)) this.mem.set(wsp, d); }
    const c = this.mem.get(wsp); const now = this.now(); const claim = this.o.auth?.claims()?.ent;
    const invalidated = this.invalidated.has(wsp);
    if (!needsRefetch(c, now, { force: o.force, invalidated, entClaim: typeof claim === 'number' ? claim : undefined })) return this.viewOf(c!, 'cache');
    if (!this.o.http) return this.fallback(wsp);
    const failed = this.failedAt.get(wsp);
    if (!o.force && !invalidated && failed !== undefined && now - failed < FAILURE_BACKOFF_MS) return this.fallback(wsp);
    let p = this.inflight.get(wsp);
    if (!p) { p = this.fetch(wsp, this.o.http).finally(() => this.inflight.delete(wsp)); this.inflight.set(wsp, p); }
    return p;
  }

  private async fetch(wsp: string, http: HttpClient): Promise<EntitlementsView> {
    this.invalidated.delete(wsp);
    const claim = this.o.auth?.claims()?.ent;
    const ac = new AbortController(); const timer = this.o.clock.setTimeout(() => ac.abort(new Error('timeout')), FETCH_TIMEOUT_MS);
    let data: unknown; let requestId: string | undefined; let status = 200;
    try {
      const r = await http.call('getEntitlements', { path: { id: wsp } }, { signal: ac.signal }); data = r.data; requestId = r.requestId; status = r.status;
    } catch (e) {
      this.failedAt.set(wsp, this.now());
      if (e instanceof ApiError && e.status === 403 && (e.rawCode === 'not_a_member' || e.rawCode === 'forbidden')) {
        this.mem.delete(wsp); await this.disk.clear(wsp); this.log?.info('entitlements.not_a_member', { request_id: e.requestId });
        const v = this.defaults(wsp, e.rawCode === 'not_a_member' ? new NotAMemberError(e) : e); if (this.wsp() === wsp) this.emit(v); return v;
      }
      if (e instanceof ContractViolationError) this.log?.warn('entitlements.contract_violation', { request_id: e.requestId });
      else this.log?.debug('entitlements.fetch_failed', { request_id: e instanceof CentcomError ? e.requestId : undefined, code: e instanceof CentcomError ? e.code : undefined });
      return this.fallback(wsp, e instanceof CentcomError ? e : new CentcomError({ kind: 'network', cause: e }));
    } finally { this.o.clock.clearTimeout(timer as never); }

    const v = validateAgainst('entitlements', data);
    const ent = v.ok ? (v.value as Entitlements) : undefined;
    if (!ent || ent.workspace !== wsp) {
      this.failedAt.set(wsp, this.now());
      const err = new ContractViolationError({ operationId: 'getEntitlements', status, requestId, pointer: v.ok ? '/workspace' : v.issues[0]?.pointer ?? '' });
      this.log?.warn('entitlements.contract_violation', { request_id: requestId });
      return this.fallback(wsp, err);
    }
    this.failedAt.delete(wsp);
    if (this.wsp() !== wsp) return this.viewOf({ ent: pickEntitlements(ent), fetchedAt: this.now() }, 'network'); /* the workspace changed while we waited: discard */
    const c: CachedEntitlements = { ent: pickEntitlements(ent), fetchedAt: this.now(), ...(typeof claim === 'number' ? { claimAtFetch: claim } : {}) };
    this.mem.set(wsp, c); void this.disk.write(wsp, c);
    this.log?.info('entitlements.fetched', { plan: ent.plan, rev: ent.rev, status: ent.status, request_id: requestId });
    const view = this.viewOf(c, 'network'); this.emit(view); return view;
  }

  /** The last known value while it is under 24 hours old, else free defaults. */
  private fallback(wsp: string, error?: CentcomError): EntitlementsView {
    const c = this.mem.get(wsp);
    if (c && freshness(c, this.now()) !== 'expired') return { ...this.viewOf(c, 'cache'), ...(error ? { error } : {}) };
    return this.defaults(wsp, error);
  }
  private viewOf(c: CachedEntitlements, source: 'network' | 'cache'): EntitlementsView {
    return { ent: c.ent, fetchedAt: new Date(c.fetchedAt).toISOString(), stale: source === 'cache' && freshness(c, this.now()) !== 'fresh', source };
  }
  private defaults(wsp: string, error?: CentcomError): EntitlementsView {
    return { ent: defaultEntitlements(wsp), fetchedAt: new Date(this.now()).toISOString(), stale: true, source: 'defaults', ...(error ? { error } : {}) };
  }

  /** What the gates read: the active workspace's cached value while it is under 24 hours old, else nothing (free defaults). Never touches the network. */
  private current(): Entitlements | null {
    const w = this.wsp(); const c = w ? this.mem.get(w) : undefined;
    return c && freshness(c, this.now()) !== 'expired' ? c.ent : null;
  }
  private quotaNotice(): QuotaNotice | undefined {
    const n = this.notice; if (!n) return undefined;
    if (n.until !== undefined && this.now() >= n.until) { this.notice = undefined; return undefined; }
    return n;
  }

  /** Advisory gate. `lan_multiplayer` is always true; an unknown key is 'unknown' (never true). */
  can(key: string): boolean | 'unknown' { return can(this.current(), key, this.now()); }
  /** The value for display (unknown keys included, display only). */
  limit(key: string): number | boolean | null | undefined { return limit(this.current(), key, this.now()); }
  /** `limit - usage` of a monthly meter, or null when unlimited. */
  remaining(key: MeteredKey): number | null { return remaining(this.current(), key, this.now()); }
  /** The banner to show: past_due (with graceUntil), canceled (with periodEnd), quota_reached, quota_warning (with pct) or none. */
  banner(): Banner { return banner(this.current(), this.now(), this.quotaNotice()); }

  /** Called with a new view whenever the entitlements change or a quota notice arrives. Returns an unsubscribe. */
  onChange(fn: (e: EntitlementsView) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(v: EntitlementsView, always = false): void {
    const sig = JSON.stringify(v.ent); if (!always && sig === this.lastEmitted) return; this.lastEmitted = sig;
    for (const fn of [...this.listeners]) { try { fn(v); } catch { /* a listener's bug must not stop the others */ } }
  }
  private emitCurrent(): void {
    const w = this.wsp(); const c = w ? this.mem.get(w) : undefined;
    this.emit(c ? this.viewOf(c, 'cache') : this.defaults(w ?? ''), true);
  }

  /** Wire to session notices (C057 re-emits `sys.notice`): plan_changed refetches now; usage_warning and quota_reached become banner state until `resets_at`. */
  noticeHandler(n: SessionNotice): void {
    const params = (n.params && typeof n.params === 'object' ? n.params : {}) as Record<string, unknown>;
    const until = typeof params.resets_at === 'string' && Number.isFinite(Date.parse(params.resets_at)) ? Date.parse(params.resets_at) : undefined;
    if (n.code === 'plan_changed') { this.notice = undefined; const w = this.wsp(); if (w) { this.invalidated.add(w); void this.get(); } return; }
    if (n.code === 'usage_warning') {
      if (this.quotaNotice()?.level === 'reached') return;
      const pct = typeof params.pct === 'number' && params.pct >= 0 && params.pct <= 100 ? Math.round(params.pct) : undefined;
      this.notice = { level: 'warning', ...(pct !== undefined ? { pct } : {}), ...(until !== undefined ? { until } : {}) }; this.emitCurrent(); return;
    }
    if (n.code === 'quota_reached') { this.notice = { level: 'reached', pct: 100, ...(until !== undefined ? { until } : {}) }; this.emitCurrent(); }
  }

  /** Feed errors from any API call here: a 403 or 429 whose code starts with `entitlement_` means the cache is out of date, so it refetches once. */
  handleError(e: unknown): void {
    if (!(e instanceof ApiError) || (e.status !== 403 && e.status !== 429) || !ENTITLEMENT_CODE.test(e.rawCode)) return;
    const w = this.wsp(); if (!w) return; this.invalidated.add(w); void this.get();
  }

  /** Where to send the person to upgrade: a checkout for a free workspace, the billing portal for a paid one, the web billing page when
   *  the API cannot give one (offline, not an owner). Opened only with `{ open: true }` and an opener. */
  async upgradeUrl(reason: string, o: { open?: boolean } = {}): Promise<{ url: string; via: 'checkout' | 'portal' | 'fallback'; opened: boolean }> {
    const wsp = this.wsp(); let url = BILLING_WEB_URL; let via: 'checkout' | 'portal' | 'fallback' = 'fallback';
    if (wsp && this.o.http) {
      const ent = this.current(); const paid = !!ent && ent.plan !== 'free' && ent.status !== 'none';
      try {
        if (paid) { url = (await this.billing.portal(wsp)).url; via = 'portal'; }
        else { url = (await this.billing.checkout(wsp, { plan: reason === 'max_seats' ? 'team' : 'pro' })).url; via = 'checkout'; }
      } catch (e) { this.log?.debug('entitlements.upgrade_url_failed', { code: e instanceof CentcomError ? e.code : undefined }); url = BILLING_WEB_URL; via = 'fallback'; }
    }
    const opened = o.open ? await this.openUrl(url) : false;
    return { url, via, opened };
  }

  /** Open a billing URL through the injected opener. Throws InvalidUrlError for anything but https (or the dev base); false without an opener. */
  async openUrl(url: string): Promise<boolean> {
    if (!isAllowedBillingUrl(url, this.o.devBaseUrl)) throw new InvalidUrlError();
    if (!this.o.opener) return false;
    try { return await this.o.opener(url); } catch { return false; }
  }
}

/** With no HTTP client every billing call fails the same typed way. */
function offlineBilling(): BillingApi {
  const no = async (): Promise<never> => { throw new CentcomError({ kind: 'network' }); };
  return { plans: no, subscription: no, usageSummary: no, checkout: no, portal: no, previewSeats: no, setSeats: no, redeemCoupon: no, invoices: () => ({ [Symbol.asyncIterator]: () => ({ next: no }) }) };
}
