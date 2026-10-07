import type { SessionHandle } from '@centcom/net';
import type { HandoffClock, HandoffFrame, HandoffSession, MemberLite, Role } from './types.js';
/** Makes a `SessionHandle` (the session client) usable by handoff and pair mode. `missingKeys` comes from the roster's key info when the client has it. */
export function fromSessionHandle(h: SessionHandle, clock: HandoffClock): HandoffSession {
  return {
    get me() { return h.me.id; }, clock,
    role: () => (h.roster().find((m) => m.id === h.me.id)?.role ?? h.me.role) as Role,
    members: (): MemberLite[] => h.roster().map((m) => ({ id: m.id, role: m.role as Role, connected: m.online !== false, ...(m.keys === undefined && m.role !== 'viewer' ? {} : {}) })),
    send: (kind, body) => h.sendEvent(kind, body),
    onFrame: (fn) => h.onAny((e) => { fn({ kind: e.kind, seq: e.seq, from: e.from, ...(e.p ? { p: e.p } : {}), ...(e.secret ? { secret: e.secret } : {}) } as HandoffFrame); }),
  };
}
