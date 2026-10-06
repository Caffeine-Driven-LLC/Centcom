import { ERROR_BASE, ERROR_TABLE, type ErrorCode } from '@centcom/protocol';
export interface Problem { type: string; title: string; status: number; code: string; detail?: string; instance?: string; request_id: string; retry_after_s?: number; errors?: { pointer: string; code: string; detail?: string }[] }
export function problem(code: ErrorCode, requestId: string, o: { detail?: string; instance?: string; retryAfterS?: number; errors?: Problem['errors']; status?: number } = {}): Problem {
  const e = ERROR_TABLE[code];
  return { type: `${ERROR_BASE}${code}`, title: e.title, status: o.status ?? e.status, code, ...(o.detail ? { detail: o.detail } : {}), ...(o.instance ? { instance: o.instance } : {}), request_id: requestId, ...(o.retryAfterS !== undefined ? { retry_after_s: o.retryAfterS } : e.retryable && o.retryAfterS === undefined && (e.status === 429 || e.status === 503) ? { retry_after_s: 1 } : {}), ...(o.errors?.length ? { errors: o.errors } : {}) };
}
