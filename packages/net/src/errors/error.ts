import type { ErrorCode } from '@centcom/protocol';

export type ErrorKind = 'api' | 'network' | 'timeout' | 'aborted' | 'protocol';
export interface FieldError { pointer: string; code: string; detail?: string }

/** What went wrong, described. Nothing here retries or shows anything; other lanes decide that from these fields. */
export class CentcomError extends Error {
  readonly kind: ErrorKind; readonly code: ErrorCode | 'unknown'; readonly status?: number; readonly requestId?: string; readonly retryAfterS?: number; readonly fieldErrors: readonly FieldError[]; readonly serverTitle?: string;
  /** The server's `detail`, with secrets removed and length capped. Safe to log; shown to people only after userMessage's own checks. */
  readonly detail?: string;
  constructor(o: { kind: ErrorKind; code?: ErrorCode | 'unknown'; status?: number; requestId?: string; retryAfterS?: number; fieldErrors?: FieldError[]; detail?: string; serverTitle?: string; cause?: unknown }) {
    super(o.detail ?? (o.code && o.code !== 'unknown' ? o.code : o.kind), o.cause === undefined ? undefined : { cause: o.cause });
    this.name = 'CentcomError'; this.kind = o.kind; this.code = o.code ?? 'unknown'; this.status = o.status; this.requestId = o.requestId; this.retryAfterS = o.retryAfterS; this.fieldErrors = o.fieldErrors ?? []; this.detail = o.detail; this.serverTitle = o.serverTitle;
  }
}
