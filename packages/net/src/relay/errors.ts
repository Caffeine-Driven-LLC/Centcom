/** Typed errors of the relay client. All extend the C006 CentcomError so userMessage() and nextAction() work on them.
 *  Must not: carry a frame body, a ticket or a URL. Only codes, sizes and close codes. */
import type { ErrorCode } from '@centcom/protocol';
import { CentcomError, type ErrorKind } from '../errors/index.js';

/** Why the relay client refused or gave up, in words other lanes can switch on. */
export type RelayLocalCode =
  | 'protocol_mismatch' /* welcome chose a protocol we did not offer */
  | 'subprotocol' /* the server did not select centcom.v1 */
  | 'url_refused' /* plain ws to a public host, a relay host over ws, credentials or a query in the URL */
  | 'not_connected' /* send() while not ready, or the socket closed before the frame was written */
  | 'capability_not_negotiated' /* the frame needs a cap the server did not advertise */
  | 'frame_too_large'
  | 'outbound_buffer_full'
  | 'closed' /* the client stopped for good (close(), or a close code that must not be retried) */
  | 'ticket_failed';

/** One error class for the relay with a `localCode`; the two the card names get their own class. */
export class RelayError extends CentcomError {
  readonly localCode: RelayLocalCode; readonly closeCode?: number;
  constructor(localCode: RelayLocalCode, o: { kind?: ErrorKind; code?: ErrorCode; closeCode?: number; message?: string; cause?: unknown } = {}) {
    super({ kind: o.kind ?? 'protocol', code: o.code, cause: o.cause });
    this.name = 'RelayError'; this.localCode = localCode; this.closeCode = o.closeCode; this.message = o.message ?? localCode;
  }
}

/** A frame bigger than the limit (256 KiB, or less if the server says so). Nothing was written. */
export class FrameTooLargeError extends RelayError {
  readonly size: number; readonly limit: number;
  constructor(size: number, limit: number) { super('frame_too_large', { code: 'frame_too_large', message: `frame is ${size} bytes; the limit is ${limit}` }); this.name = 'FrameTooLargeError'; this.size = size; this.limit = limit; }
}

/** The 2 MiB outbound buffer is full (usually while paused by sys.slow_down). The caller keeps the frame and tries later. */
export class OutboundBufferFullError extends RelayError {
  readonly limit: number;
  constructor(limit: number) { super('outbound_buffer_full', { code: 'slow_consumer', message: `outbound buffer is over ${limit} bytes` }); this.name = 'OutboundBufferFullError'; this.limit = limit; }
}
