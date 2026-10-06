import { ERROR_TABLE, isId, redact, type ErrorCode } from '@centcom/protocol';
import { CentcomError, type FieldError } from './error.js';

export const MAX_BODY_BYTES = 64 * 1024; export const MAX_FIELD_ERRORS = 100; const MAX_DETAIL = 1000;
export interface HttpResponseLike { status: number; headers: { get(name: string): string | null }; bodyText: string }

/** Retry-After is seconds or an HTTP date; anything else is ignored. */
export function parseRetryAfter(v: string | null | undefined, now = Date.now()): number | undefined {
  if (!v) return undefined; const t = v.trim();
  if (/^\d+$/.test(t)) return Math.min(Number(t), 86_400);
  const d = Date.parse(t); return Number.isNaN(d) ? undefined : Math.min(86_400, Math.max(0, Math.ceil((d - now) / 1000)));
}
const isCode = (c: unknown): c is ErrorCode => typeof c === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TABLE, c);

/** Remove secrets, cap length, and drop URL query strings (they can carry tokens). */
export function sanitizeDetail(d: unknown): string | undefined {
  if (typeof d !== 'string' || !d.trim()) return undefined;
  return redact(d).replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);
}
function fieldErrors(v: unknown): FieldError[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_FIELD_ERRORS).flatMap((e): FieldError[] => (e && typeof e === 'object' && typeof (e as FieldError).pointer === 'string' && typeof (e as FieldError).code === 'string' ? [{ pointer: (e as FieldError).pointer.slice(0, 200), code: (e as FieldError).code.slice(0, 64), ...(sanitizeDetail((e as FieldError).detail) ? { detail: sanitizeDetail((e as FieldError).detail) } : {}) }] : []));
}

/** From a problem+json body, or whatever else a proxy sent. Never throws. */
export function parseProblem(res: HttpResponseLike, now = Date.now()): CentcomError {
  const headerReq = res.headers.get('x-request-id') ?? undefined; const headerRetry = parseRetryAfter(res.headers.get('retry-after'), now);
  const requestIdOf = (v: unknown) => (typeof v === 'string' && isId('req', v) ? v : headerReq && isId('req', headerReq) ? headerReq : undefined);
  let body: unknown;
  const text = res.bodyText.length > MAX_BODY_BYTES ? '' : res.bodyText.replace(/^﻿/, ''); // oversized bodies are ignored, a BOM is not an error
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (typeof b.code === 'string') {
      const retryAfterS = typeof b.retry_after_s === 'number' && Number.isFinite(b.retry_after_s) && b.retry_after_s >= 0 ? Math.min(Math.floor(b.retry_after_s), 86_400) : headerRetry;
      return new CentcomError({ kind: 'api', code: isCode(b.code) ? b.code : 'unknown', status: typeof b.status === 'number' ? b.status : res.status, requestId: requestIdOf(b.request_id), retryAfterS, fieldErrors: fieldErrors(b.errors), detail: sanitizeDetail(b.detail), serverTitle: typeof b.title === 'string' ? b.title.slice(0, 120) : undefined });
    }
  }
  return new CentcomError({ kind: 'api', code: 'unknown', status: res.status, requestId: requestIdOf(undefined), retryAfterS: headerRetry });
}

/** The body of a `sys.error` frame (same shape as problem+json). */
export function fromWsError(p: unknown): CentcomError {
  if (!p || typeof p !== 'object') return new CentcomError({ kind: 'protocol', code: 'unknown' });
  const b = p as Record<string, unknown>;
  return new CentcomError({ kind: 'api', code: isCode(b.code) ? b.code : 'unknown', status: typeof b.status === 'number' ? b.status : undefined, requestId: typeof b.request_id === 'string' && isId('req', b.request_id) ? b.request_id : undefined, retryAfterS: typeof b.retry_after_s === 'number' && b.retry_after_s >= 0 ? Math.min(Math.floor(b.retry_after_s), 86_400) : undefined, fieldErrors: fieldErrors(b.errors), detail: sanitizeDetail(b.detail) });
}

/** fetch/socket failures: timeouts and aborts are told apart from "could not reach the server". */
export function fromNetworkError(e: unknown): CentcomError {
  const name = (e as { name?: string })?.name; const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  if (name === 'AbortError') return new CentcomError({ kind: 'aborted', cause: e });
  if (name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return new CentcomError({ kind: 'timeout', cause: e });
  return new CentcomError({ kind: 'network', cause: e });
}
