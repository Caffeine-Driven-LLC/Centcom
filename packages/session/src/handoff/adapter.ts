import type { SessionHandle } from '@centcom/net';
import type { HandoffClock, HandoffFrame, HandoffSession, MemberLite, Role } from './types.js';
/**
 * Makes a `SessionHandle` (the session client) usable by handoff and pair mode.
 * `missingKeys` comes from the `key.grant` frames the session has shown: a member holds an epoch once a grant to its device named that epoch. A member that was never granted every epoch the host holds is not offered the transfer. Until the first grant is seen the member counts as missing keys.
 */
export function fromSessionHandle(h: SessionHandle, clock: HandoffClock): HandoffSession {
  const granted = new Map<string, Set<string>>(); /* device -> epochs it was granted */
  h.onAny((e) => { if (e.kind !== 'key.grant' || typeof e.p?.to_device !== 'string') return; const set = granted.get(e.p.to_device) ?? new Set<string>(); for (const k of Array.isArray(e.p.kids) ? e.p.kids : []) if (typeof k === 'string') set.add(k); granted.set(e.p.to_device, set); }, { replay: true });
  const missing = (device: string | undefined): boolean => { if (!device) return true; const have = granted.get(device); return h.heldEpochs().some((k) => !have?.has(k)); };
  return {
    get me() { return h.me.id; }, clock,
    role: () => (h.roster().find((m) => m.id === h.me.id)?.role ?? h.me.role) as Role,
    members: (): MemberLite[] => h.roster().map((m) => ({ id: m.id, role: m.role as Role, connected: m.online !== false, ...(m.role === 'editor' && m.id !== h.me.id ? { missingKeys: missing(m.device) } : {}) })),
    send: (kind, body) => h.sendEvent(kind, body),
    onFrame: (fn) => h.onAny((e) => { fn({ kind: e.kind, seq: e.seq, from: e.from, ...(e.p ? { p: e.p } : {}), ...(e.secret ? { secret: e.secret } : {}) } as HandoffFrame); }),
  };
}
