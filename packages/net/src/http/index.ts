/** Public surface of the HTTP API client (lane C051). Other lanes import from here, never from the files behind it. */
export { createHttpClient, defaultUserAgent, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, MAX_ETAGS } from './client.js';
export { ApiError, AuthExpiredError, ContractViolationError, RequestTooLargeError, TransportError, type TransportKind } from './errors.js';
export { HTTP_OPERATIONS, type HttpOperationId, type HttpOperationTypes, type PaginatedOperationId } from './generated/operations.js';
export { httpRetryDecision, jitterDelayMs, retrySafe, MAX_TOTAL_SLEEP_MS, MAX_RETRY_AFTER_S, type HttpRetryDecision, type HttpRetryInput, type HttpRetryReason } from './retry.js';
export { checkPageLimit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.js';
export { isValidIdempotencyKey, newIdempotencyKey, wantsIdempotencyKey } from './idempotency.js';
export { parseRateLimit, type RateLimitInfo } from './rate-limit.js';
export { checkShape } from './validate.js';
export type { HttpOperationSpec, Shape } from './spec.js';
export type { AuthProvider, CallOptions, HttpClient, HttpClientOptions, HttpClock, HttpResult, IdGenerator, OperationArgs, OperationResponse, Page, PageItem, Revalidated } from './types.js';
