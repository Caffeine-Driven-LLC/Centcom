/** Argument and result types for the HTTP client, derived from the types @centcom/protocol generates from openapi.yaml. Nothing here is hand-written wire data. */
import type { Id, IdPrefix } from '@centcom/protocol';
import type { Logger } from '../log/index.js';
import type { HttpOperationId, HttpOperationTypes, PaginatedOperationId } from './generated/operations.js';
import type { RateLimitInfo } from './rate-limit.js';

type IsNever<T> = [T] extends [never] ? true : false;
type Op<K extends HttpOperationId> = HttpOperationTypes[K];
type Params<K extends HttpOperationId> = Op<K> extends { parameters: infer P } ? P : Record<string, never>;
type Part<P, F extends string, As extends string = F> = F extends keyof P
  ? IsNever<NonNullable<P[F]>> extends true ? { [k in As]?: undefined } : Record<string, never> extends Pick<P, F> ? { [k in As]?: NonNullable<P[F]> } : { [k in As]: NonNullable<P[F]> }
  : { [k in As]?: undefined };
type RequestBodyOf<K extends HttpOperationId> = Op<K> extends { requestBody?: infer R } ? NonNullable<R> : never;
type JsonBody<R> = [R] extends [never] ? never : R extends { content: { 'application/json': infer B } } ? B : never;
type BodyPart<K extends HttpOperationId> = IsNever<JsonBody<RequestBodyOf<K>>> extends true ? { body?: undefined }
  : Record<string, never> extends Pick<Op<K>, Extract<'requestBody', keyof Op<K>>> ? { body?: JsonBody<RequestBodyOf<K>> } : { body: JsonBody<RequestBodyOf<K>> };

/** What a caller passes: `path` parameters, `query` parameters and the JSON `body`, each typed from the contract. Headers are the client's job. */
export type OperationArgs<K extends HttpOperationId> = Part<Params<K>, 'path'> & Part<Params<K>, 'query'> & BodyPart<K>;

type Responses<K extends HttpOperationId> = Op<K> extends { responses: infer R } ? R : never;
type ContentOf<R> = R extends { content: { 'application/json': infer B } } ? B : undefined;
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 206 | 301 | 302 | 303 | 307 | 308;
/** The success body of an operation (undefined for 204 and redirects). */
export type OperationResponse<K extends HttpOperationId> = { [S in keyof Responses<K>]: S extends SuccessStatus ? ContentOf<Responses<K>[S]> : never }[keyof Responses<K>];
/** One element of a list endpoint's `data`. */
export type PageItem<K extends PaginatedOperationId> = OperationResponse<K> extends { data: ReadonlyArray<infer I> } ? I : never;

export interface HttpResult<T> {
  data: T; status: number; headers: Headers; etag?: string;
  /** The server answered from its idempotency store (`Idempotency-Replayed: true`). */
  replayed: boolean;
  /** The X-Request-Id we sent (the server echoes it). */
  requestId: string;
  rateLimit?: RateLimitInfo;
}
export interface Page<T> { data: T[]; nextCursor: string | null; hasMore: boolean }

/** Time for the client. `@centcom/testkit`'s VirtualClock fits. */
export interface HttpClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: never): void }
export interface IdGenerator { next<P extends IdPrefix>(prefix: P): Id<P> }
/** Supplied by the auth lane (C052). The client only asks for the current token and, on a 401 token_expired, calls the hook once. */
export interface AuthProvider {
  getAccessToken(): Promise<string | undefined>;
  /** Refresh after a 401 token_expired. True means a new token is ready. Called at most once per request, and concurrent requests share one call. */
  onUnauthorized?(code: 'token_expired'): Promise<boolean>;
}
export interface HttpClientOptions extends AuthProvider {
  /** default https://api.centcom.dev; plain http only for loopback */
  baseUrl?: string;
  fetch?: typeof fetch; clock?: HttpClock; rng?: () => number; ids?: IdGenerator; logger?: Logger;
  /** CT-VER: `centcom-cli/<ver> (contract/<contract_version>; <platform>-<arch>; node/<ver>)`; see defaultUserAgent() */
  userAgent: string;
  /** per attempt, default 15000 */
  timeoutMs?: number;
  /** default and maximum 5 */
  maxAttempts?: number;
}
export interface CallOptions { signal?: AbortSignal; idempotencyKey?: string; ifMatch?: string }
export type Revalidated<T> = ({ notModified: true; etag: string; requestId: string; status: 304 }) | ({ notModified: false } & HttpResult<T>);

export interface HttpClient {
  /** One logical request: retried per CT-ERR, refreshed once on 401 token_expired, validated against the contract. */
  call<K extends HttpOperationId>(op: K, args: OperationArgs<K>, o?: CallOptions): Promise<HttpResult<OperationResponse<K>>>;
  /** A GET with `If-None-Match`; a 304 comes back as `notModified: true` (used by flags). */
  revalidate<K extends HttpOperationId>(op: K, args: OperationArgs<K>, etag: string, o?: { signal?: AbortSignal }): Promise<Revalidated<OperationResponse<K>>>;
  /** One page of a list endpoint. `limit` 1..200, default 50. */
  listPage<K extends PaginatedOperationId>(op: K, args: OperationArgs<K> & { cursor?: string; limit?: number }, o?: { signal?: AbortSignal }): Promise<Page<PageItem<K>>>;
  /** Every item of a list endpoint, fetching the next page only when the caller gets that far. */
  paginate<K extends PaginatedOperationId>(op: K, args: OperationArgs<K>, o?: { limit?: number; signal?: AbortSignal }): AsyncIterable<PageItem<K>>;
  /** GET /v1/status. `min_client_version` and `contract_version` are returned, not acted on. */
  getStatus(o?: { signal?: AbortSignal }): Promise<OperationResponse<'getStatus'>>;
  /** GET /.well-known/jwks.json */
  getJwks(o?: { signal?: AbortSignal }): Promise<OperationResponse<'getJwks'>>;
  /** The same client with another identity (its own ETag store and refresh state). */
  withAuthProvider(p: AuthProvider): HttpClient;
}
