/** The one HTTP client for the REST API (CT-PAGE, CT-ERR, CT-VER). Owns headers, retries, idempotency keys, ETags, the 401 refresh, size limits and response checking.
 *  Must not: touch the network at import time or in createHttpClient(); put a token anywhere but the Authorization header;
 *  log a header value or a body; retry a POST without an Idempotency-Key; wait without a bound. */
import { isId, newIdGenerator, userAgent as formatUserAgent, type ClientInfo } from '@centcom/protocol';
import { MAX_ATTEMPTS, fromNetworkError, parseProblem, parseRetryAfter } from '../errors/index.js';
import type { Logger } from '../log/index.js';
import { ApiError, AuthExpiredError, ContractViolationError, RequestTooLargeError, TransportError, type TransportKind } from './errors.js';
import { HTTP_OPERATIONS, type HttpOperationId, type PaginatedOperationId } from './generated/operations.js';
import { isValidIdempotencyKey, newIdempotencyKey, wantsIdempotencyKey } from './idempotency.js';
import { listPage as listPageOf, paginate as paginateOf } from './pagination.js';
import { parseRateLimit } from './rate-limit.js';
import { httpRetryDecision } from './retry.js';
import type { HttpOperationSpec } from './spec.js';
import type { AuthProvider, CallOptions, HttpClient, HttpClientOptions, HttpClock, HttpResult, IdGenerator, OperationArgs, OperationResponse, Revalidated } from './types.js';
import { checkShape } from './validate.js';

export const DEFAULT_BASE_URL = 'https://api.centcom.dev';
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Responses larger than this are refused (the biggest contract body is a 200-item page). */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** How many ETags one client remembers (oldest dropped first). */
export const MAX_ETAGS = 256;

const UA_RE = /^centcom-(?:cli|tui|web)\/[0-9A-Za-z.+-]+ \(contract\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?; [a-z0-9]+-[a-z0-9_]+; node\/[0-9A-Za-z.+-]+\)$/;
const TLS_CODES = /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH|ERR_OSSL_)/;
const CONDITIONAL = new Set(['PATCH', 'PUT', 'DELETE']);
const SPECS = HTTP_OPERATIONS as unknown as Record<HttpOperationId, HttpOperationSpec>;

/** The CT-VER User-Agent for this process. */
export function defaultUserAgent(version: string, name: ClientInfo['name'] = 'centcom-cli'): string {
  const p = (globalThis as { process?: { platform?: string; arch?: string; versions?: { node?: string } } }).process;
  return formatUserAgent({ name, version, platform: p?.platform ?? 'unknown', arch: p?.arch ?? 'unknown', node: p?.versions?.node ?? '0.0.0' });
}

const realClock: HttpClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
const cryptoRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

function checkBaseUrl(raw: string): string {
  let u: URL; try { u = new URL(raw); } catch { throw new TypeError('baseUrl is not a URL'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new TypeError('baseUrl must be https (plain http only for loopback)');
  if (u.username || u.password || u.search || u.hash) throw new TypeError('baseUrl must not carry credentials, a query or a fragment');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

interface Shared { baseUrl: string; fetch: typeof fetch; clock: HttpClock; rng: () => number; ids: IdGenerator; logger?: Logger; userAgent: string; timeoutMs: number; maxAttempts: number }
interface Raw { status: number; headers: Headers; text: string }
type Sent = { ok: true; raw: Raw } | { ok: false; transport: TransportKind; cause?: unknown };

/** Build a client. Inert until a method is called. */
export function createHttpClient(opts: HttpClientOptions): HttpClient {
  if (!UA_RE.test(opts.userAgent)) throw new TypeError('userAgent must follow CT-VER: centcom-cli/<ver> (contract/<x.y.z>; <platform>-<arch>; node/<ver>)');
  const clock = opts.clock ?? realClock;
  const shared: Shared = {
    baseUrl: checkBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL), fetch: opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)), clock, rng: opts.rng ?? cryptoRandom,
    ids: opts.ids ?? newIdGenerator({ now: () => clock.now(), random: (n) => crypto.getRandomValues(new Uint8Array(n)) }), logger: opts.logger?.child({ component: 'http' }), userAgent: opts.userAgent,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxAttempts: Math.max(1, Math.min(opts.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS)),
  };
  return build(shared, { getAccessToken: opts.getAccessToken, onUnauthorized: opts.onUnauthorized });
}

function build(s: Shared, auth: AuthProvider): HttpClient {
  const etags = new Map<string, string>();
  const remember = (key: string, etag: string | undefined) => { if (!etag) return; etags.delete(key); etags.set(key, etag); if (etags.size > MAX_ETAGS) etags.delete(etags.keys().next().value!); };

  /* single flight: concurrent 401 token_expired answers share one refresh */
  let refreshing: Promise<boolean> | undefined;
  async function refresh(staleToken: string): Promise<boolean> {
    if (refreshing) return refreshing;
    let current: string | undefined; try { current = await auth.getAccessToken(); } catch { return false; }
    if (current && current !== staleToken) return true; /* someone already refreshed: just replay */
    if (refreshing) return refreshing;
    if (!auth.onUnauthorized) return false;
    const hook = auth.onUnauthorized.bind(auth);
    refreshing = (async () => { try { return (await hook('token_expired')) === true; } catch { return false; } finally { refreshing = undefined; } })();
    return refreshing;
  }

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));
      const onAbort = () => { s.clock.clearTimeout(h as never); reject(new Error('aborted')); };
      const h = s.clock.setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function readCapped(res: Response, signal: AbortSignal): Promise<string | null> {
    if (!res.body) return '';
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      if (signal.aborted) { void reader.cancel().catch(() => undefined); throw signal.reason ?? new Error('aborted'); }
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => undefined); return null; } /* not awaited: a cancel can wait on the other side of a tee */
      chunks.push(value);
    }
    const all = new Uint8Array(size); let off = 0; for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(all);
  }

  /** One attempt, bounded by the per-request timeout and the caller's signal. */
  async function sendOnce(url: string, init: RequestInit, caller?: AbortSignal): Promise<Sent> {
    const tc = new AbortController(); const timer = s.clock.setTimeout(() => tc.abort(new Error('timeout')), s.timeoutMs);
    const signal = caller ? AbortSignal.any([caller, tc.signal]) : tc.signal;
    try {
      const res = await s.fetch(url, { ...init, signal, redirect: 'manual' });
      const text = await readCapped(res, signal);
      if (text === null) return { ok: false, transport: 'bad_response' };
      return { ok: true, raw: { status: res.status, headers: res.headers, text } };
    } catch (e) {
      if (caller?.aborted) return { ok: false, transport: 'aborted', cause: e };
      if (tc.signal.aborted) return { ok: false, transport: 'timeout', cause: e };
      const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
      if (typeof code === 'string' && TLS_CODES.test(code)) return { ok: false, transport: 'tls', cause: e };
      const k = fromNetworkError(e).kind;
      return { ok: false, transport: k === 'aborted' ? 'aborted' : k === 'timeout' ? 'timeout' : 'offline', cause: e };
    } finally { s.clock.clearTimeout(timer as never); }
  }

  function buildUrl(op: HttpOperationId, spec: HttpOperationSpec, args: { path?: Record<string, unknown>; query?: Record<string, unknown> }): { url: string; pathKey: string } {
    const pathKey = spec.path.replace(/\{(\w+)\}/g, (_m, k: string) => {
      const v = args.path?.[k]; if ((typeof v !== 'string' && typeof v !== 'number') || v === '') throw new TypeError(`${op}: path parameter "${k}" is missing`);
      return encodeURIComponent(String(v));
    });
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args.query ?? {})) {
      if (!spec.queryParams.includes(k)) throw new TypeError(`${op}: "${k}" is not a query parameter of this operation`);
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new TypeError(`${op}: query parameter "${k}" must be a string, number or boolean`);
      q.set(k, String(v));
    }
    for (const k of spec.requiredQuery) if (!q.has(k)) throw new TypeError(`${op}: query parameter "${k}" is required`);
    const qs = q.toString();
    return { url: s.baseUrl + pathKey + (qs ? `?${qs}` : ''), pathKey };
  }

  /** The heart of the client: one logical request, possibly several attempts. */
  async function execute<K extends HttpOperationId>(op: K, args: OperationArgs<K>, o: CallOptions & { ifNoneMatch?: string }): Promise<HttpResult<unknown> & { notModified?: boolean }> {
    const spec = SPECS[op]; if (!spec) throw new TypeError(`unknown operation ${String(op)}`);
    const a = (args ?? {}) as { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown };
    /* local checks first: nothing below may touch the network if these fail */
    if (spec.body === 'none' && a.body !== undefined) throw new TypeError(`${op} takes no body`);
    if (spec.body === 'required' && a.body === undefined) throw new TypeError(`${op} needs a body`);
    const bodyText = a.body === undefined ? undefined : JSON.stringify(a.body);
    const bytes = bodyText === undefined ? undefined : new TextEncoder().encode(bodyText);
    if (bytes && bytes.byteLength > spec.maxBodyBytes) throw new RequestTooLargeError({ operationId: op, size: bytes.byteLength, limit: spec.maxBodyBytes });
    const { url, pathKey } = buildUrl(op, spec, a);
    if (o.idempotencyKey !== undefined && !isValidIdempotencyKey(o.idempotencyKey)) throw new TypeError('idempotencyKey must be 1 to 64 characters of [A-Za-z0-9_-]');
    if (o.ifMatch !== undefined && /[\r\n]/.test(o.ifMatch)) throw new TypeError('ifMatch must be one line');

    const requestId = s.ids.next('req');
    const idemKey = o.idempotencyKey ?? (wantsIdempotencyKey(spec) ? newIdempotencyKey(s.ids) : undefined);
    const ifMatch = o.ifMatch ?? (CONDITIONAL.has(spec.method) ? etags.get(pathKey) : undefined);
    const log = s.logger?.child({ request_id: requestId });
    let attempt = 0; let slept = 0; let refreshed = false;

    for (;;) {
      if (o.signal?.aborted) throw new TransportError({ transport: 'aborted', requestId, operationId: op, attempts: attempt });
      attempt++;
      let token: string | undefined;
      if (spec.auth !== 'none') { try { token = await auth.getAccessToken(); } catch { token = undefined; } }
      if (token !== undefined && (token === '' || /[\s]/.test(token))) token = undefined;
      const headers: Record<string, string> = { accept: 'application/json, application/problem+json', 'user-agent': s.userAgent, 'x-request-id': requestId };
      if (token) headers.authorization = `Bearer ${token}`;
      if (bytes) headers['content-type'] = 'application/json';
      if (idemKey) headers['idempotency-key'] = idemKey;
      if (ifMatch) headers['if-match'] = ifMatch;
      if (o.ifNoneMatch) headers['if-none-match'] = o.ifNoneMatch;

      const started = s.clock.now();
      const sent = await sendOnce(url, { method: spec.method, headers, ...(bytes ? { body: bytes } : {}) }, o.signal);
      const ms = Math.max(0, s.clock.now() - started);

      if (!sent.ok) {
        log?.debug('http.failed', { method: spec.method, route: spec.path, attempt, duration_ms: ms, transport: sent.transport });
        const d = httpRetryDecision({ method: spec.method, hasIdempotencyKey: !!idemKey, attempt, maxAttempts: s.maxAttempts, transport: sent.transport, sleptMs: slept }, s.rng);
        if (d.retry && d.delayMs !== undefined) { await pause(d.delayMs, op, requestId, attempt); slept += d.delayMs; continue; }
        throw new TransportError({ transport: sent.transport, requestId, operationId: op, attempts: attempt, cause: sent.transport === 'bad_response' ? undefined : sent.cause });
      }

      const { raw } = sent;
      log?.debug('http.response', { method: spec.method, route: spec.path, status: raw.status, attempt, duration_ms: ms });
      const etag = raw.headers.get('etag') ?? undefined; const rateLimit = parseRateLimit(raw.headers);
      if (raw.status === 304 && o.ifNoneMatch) return { data: undefined, status: 304, headers: raw.headers, etag: etag ?? o.ifNoneMatch, replayed: false, requestId, rateLimit, notModified: true };

      if ((raw.status >= 200 && raw.status < 300) || spec.success.includes(raw.status)) {
        let data: unknown;
        if (raw.status !== 204 && spec.response && raw.text.trim() !== '') {
          try { data = JSON.parse(raw.text.replace(/^﻿/, '')); } catch { throw new TransportError({ transport: 'bad_response', status: raw.status, requestId, operationId: op, attempts: attempt }); }
          const ptr = checkShape(spec.response, data); if (ptr !== null) throw new ContractViolationError({ operationId: op, status: raw.status, requestId, pointer: ptr });
        } else if (raw.status !== 204 && spec.response && raw.status < 300) throw new ContractViolationError({ operationId: op, status: raw.status, requestId, pointer: '' });
        if (spec.method === 'GET' || spec.method === 'PATCH' || spec.method === 'PUT') remember(pathKey, etag);
        if (spec.method === 'DELETE') etags.delete(pathKey);
        return { data, status: raw.status, headers: raw.headers, ...(etag ? { etag } : {}), replayed: raw.headers.get('idempotency-replayed') === 'true', requestId, ...(rateLimit ? { rateLimit } : {}) };
      }

      const err = toError(raw, op, requestId, attempt);
      if (raw.status === 401 && err instanceof ApiError && err.rawCode === 'token_expired') {
        if (refreshed || !token) throw new AuthExpiredError(err, err.rawCode, { operationId: op, attempts: attempt, requestId });
        refreshed = true;
        if (await refresh(token)) { attempt--; continue; } /* the replay after a refresh is not a retry */
        throw new AuthExpiredError(err, err.rawCode, { operationId: op, attempts: attempt, requestId });
      }
      const d = httpRetryDecision({ method: spec.method, hasIdempotencyKey: !!idemKey, attempt, maxAttempts: s.maxAttempts, status: raw.status, retryAfterS: err.retryAfterS, sleptMs: slept }, s.rng);
      if (d.retry && d.delayMs !== undefined) { await pause(d.delayMs, op, requestId, attempt); slept += d.delayMs; continue; }
      throw err;
    }

    async function pause(ms: number, op: HttpOperationId, requestId: string, attempt: number) {
      try { await sleep(ms, o.signal); } catch { throw new TransportError({ transport: 'aborted', requestId, operationId: op, attempts: attempt }); }
    }
  }

  /** problem+json becomes ApiError; anything else (a proxy's HTML, broken JSON) becomes TransportError with the status. Bodies never reach the message. */
  function toError(raw: Raw, op: HttpOperationId, requestId: string, attempts: number): ApiError | TransportError {
    let rawCode: string | undefined;
    try { const b = JSON.parse(raw.text.replace(/^﻿/, '')) as unknown; if (b && typeof b === 'object' && !Array.isArray(b) && typeof (b as { code?: unknown }).code === 'string') rawCode = (b as { code: string }).code.slice(0, 64); } catch { rawCode = undefined; }
    if (rawCode === undefined) {
      const hid = raw.headers.get('x-request-id');
      return new TransportError({ transport: 'bad_response', status: raw.status, requestId: hid && isId('req', hid) ? hid : requestId, retryAfterS: parseRetryAfter(raw.headers.get('retry-after'), s.clock.now()), operationId: op, attempts });
    }
    const base = parseProblem({ status: raw.status, headers: raw.headers, bodyText: raw.text }, s.clock.now());
    return new ApiError(base, rawCode, { operationId: op, attempts, requestId });
  }

  const call = <K extends HttpOperationId>(op: K, args: OperationArgs<K>, o: CallOptions = {}) => execute(op, args, o) as Promise<HttpResult<OperationResponse<K>>>;
  const client: HttpClient = {
    call,
    async revalidate(op, args, etag, o = {}) {
      if (SPECS[op]?.method !== 'GET') throw new TypeError('revalidate is for GET operations');
      if (!etag || /[\r\n]/.test(etag)) throw new TypeError('etag must be one non-empty line');
      const r = await execute(op, args, { signal: o.signal, ifNoneMatch: etag });
      return (r.notModified ? { notModified: true, etag: r.etag ?? etag, requestId: r.requestId, status: 304 } : { notModified: false, ...r }) as Revalidated<OperationResponse<typeof op>>;
    },
    listPage: (op, args, o = {}) => listPageOf(call as never, op, args, o),
    paginate: <K extends PaginatedOperationId>(op: K, args: OperationArgs<K>, o: { limit?: number; signal?: AbortSignal } = {}) => paginateOf(call as never, op, args, o),
    async getStatus(o = {}) { return (await call('getStatus', {}, o)).data; },
    async getJwks(o = {}) { return (await call('getJwks', {}, o)).data; },
    withAuthProvider: (p) => build(s, p),
  };
  return client;
}
