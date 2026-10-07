/** Close codes become the same typed errors whichever transport saw them. */
import { CentcomError, type ClosedInfo } from '@centcom/net';
const TABLE: Record<number, { code: string; status: number }> = { 4400: { code: 'protocol_violation', status: 400 }, 4401: { code: 'token_invalid', status: 401 }, 4403: { code: 'forbidden', status: 403 }, 4404: { code: 'session_not_found', status: 404 }, 4408: { code: 'timeout', status: 408 }, 4409: { code: 'conflict', status: 409 }, 4426: { code: 'client_too_old', status: 426 }, 4429: { code: 'rate_limited', status: 429 }, 4503: { code: 'service_unavailable', status: 503 } };
/** `undefined` for an ordinary close (1000, 1001, 1006...). */
export function transportCloseError(c: Pick<ClosedInfo, 'code'>): CentcomError | undefined { const t = TABLE[c.code]; return t ? new CentcomError({ kind: 'api', code: t.code as never, status: t.status }) : undefined; }
