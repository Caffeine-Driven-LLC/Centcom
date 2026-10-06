import type { EventBody, NormalisedEvent } from '../../src/types.js';
export const AGT = 'agt_01JTEST0000000000000000001'; export const APR = 'apr_01JTEST0000000000000000001';
let n = 0; export const reset = () => { n = 0; };
export const mk = (b: EventBody, seq = ++n): NormalisedEvent => ({ ...b, v: 1, seq, ts: '2026-10-06T00:00:00.000Z', agent_id: AGT } as NormalisedEvent);
export const stream = (bodies: EventBody[]) => { reset(); return bodies.map((b) => mk(b)); };
export const START: EventBody = { type: 'session.started', engine: 'fake', engine_session_id: 's1', model: 'm', tools: [], mcp_servers: [], capabilities: ['streaming'], login_kind: 'unknown' };
