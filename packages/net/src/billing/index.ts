/** Public surface of the billing and entitlement client (lane C064). Other lanes import from here, never from the files behind it. */
export { EntitlementsClient, FAILURE_BACKOFF_MS, FETCH_TIMEOUT_MS, type EntitlementsAuth, type EntitlementsClientOptions, type EntitlementsView } from './entitlements.js';
export { ENTITLEMENTS_TTL_MS, OFFLINE_MAX_AGE_MS, freshness, needsRefetch, type CachedEntitlements, type Freshness } from './cache.js';
export { FREE_DEFAULT_LIMITS, KNOWN_LIMIT_KEYS, banner, can, defaultEntitlements, effectiveLimits, expired, limit, remaining, type Banner, type BannerKind, type KnownLimitKey, type MeteredKey, type QuotaNotice } from './gates.js';
export { BILLING_DEEP_LINK, BILLING_WEB_URL, CouponInvalidError, InvalidUrlError, NotAMemberError, createBillingApi, isAllowedBillingUrl, type BillingApi, type BillingApiOptions, type CheckoutOptions, type Invoice, type Plan, type SeatChangeResult, type Subscription, type UsageSummary } from './billing-api.js';
