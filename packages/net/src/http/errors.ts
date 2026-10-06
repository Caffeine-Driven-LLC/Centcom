/** Typed errors the HTTP client throws. All extend the C006 CentcomError, so userMessage() and nextAction() work on them unchanged.
 *  Must not: carry a request or response body, a token, or a URL with a query string. Only codes, statuses, ids and pointers. */
import type { ErrorCode } from '@centcom/protocol';
import { CentcomError, type ErrorKind } from '../errors/index.js';

interface Where { operationId?: string; attempts?: number; /** the id we sent, used when the server's answer carries none */ requestId?: string }

/** A problem+json answer from the server (CT-ERR). `rawCode` keeps a code this build does not know; `code` is then 'unknown' and callers go by `status` (CT-ERR rule 7). */
export class ApiError extends CentcomError {
  readonly rawCode: string; readonly operationId?: string; readonly attempts: number;
  constructor(base: CentcomError, rawCode: string, w: Where = {}) {
    super({ kind: 'api', code: base.code, status: base.status, requestId: base.requestId ?? w.requestId, retryAfterS: base.retryAfterS, fieldErrors: [...base.fieldErrors], detail: base.detail, serverTitle: base.serverTitle });
    this.name = 'ApiError'; this.rawCode = rawCode; this.operationId = w.operationId; this.attempts = w.attempts ?? 1;
  }
}

/** A 401 token_expired that a refresh did not fix (the hook said no, threw, or the new token was refused too). */
export class AuthExpiredError extends ApiError {
  constructor(base: CentcomError, rawCode: string, w: Where = {}) { super(base, rawCode, w); this.name = 'AuthExpiredError'; }
}

export type TransportKind = 'offline' | 'timeout' | 'aborted' | 'tls' | 'bad_response';
const KIND: Record<TransportKind, ErrorKind> = { offline: 'network', timeout: 'timeout', aborted: 'aborted', tls: 'network', bad_response: 'protocol' };

/** We never got a usable answer: DNS, connection, TLS, timeout, abort, or a body that is not problem+json (a proxy's HTML page, malformed JSON). */
export class TransportError extends CentcomError {
  readonly transport: TransportKind; readonly operationId?: string; readonly attempts: number;
  constructor(o: { transport: TransportKind; status?: number; requestId?: string; retryAfterS?: number; cause?: unknown } & Where) {
    super({ kind: KIND[o.transport], status: o.status, requestId: o.requestId, retryAfterS: o.retryAfterS, cause: o.cause });
    this.name = 'TransportError'; this.message = o.status === undefined ? o.transport : `${o.transport} (HTTP ${o.status})`; this.transport = o.transport; this.operationId = o.operationId; this.attempts = o.attempts ?? 1;
  }
}

/** A 2xx body that does not fit the contract. Never retried. Carries the JSON pointer only, never the body. */
export class ContractViolationError extends CentcomError {
  readonly operationId: string; readonly pointer: string;
  constructor(o: { operationId: string; status: number; requestId?: string; pointer: string }) {
    super({ kind: 'protocol', status: o.status, requestId: o.requestId });
    this.name = 'ContractViolationError'; this.message = `contract violation in ${o.operationId} at ${o.pointer || '/'}`; this.operationId = o.operationId; this.pointer = o.pointer;
  }
}

/** Refused locally, before any network I/O: the JSON body is over the CT-PAGE size limit. */
export class RequestTooLargeError extends CentcomError {
  readonly operationId: string; readonly size: number; readonly limit: number;
  constructor(o: { operationId: string; size: number; limit: number }) {
    super({ kind: 'protocol', code: 'payload_too_large' as ErrorCode });
    this.name = 'RequestTooLargeError'; this.message = `request body is ${o.size} bytes; the limit is ${o.limit}`; this.operationId = o.operationId; this.size = o.size; this.limit = o.limit;
  }
}
