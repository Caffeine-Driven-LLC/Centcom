/** Server-origin control frames, surfaced as typed events only when they really come from the server. */
import type { DecodedEvent } from '../session/types.js';
export const SERVER_KINDS = new Set(['control.member_joined', 'control.member_left', 'control.roster', 'control.host_changed', 'control.session_state', 'control.rotate_key']);
export type LeftCode = 'left' | 'kicked' | 'timeout' | 'revoked';
export type ServerEvent =
  | { type: 'member-joined'; member: string; slot?: number; role?: string; device?: string }
  | { type: 'member-left'; member: string; code: LeftCode | string }
  | { type: 'roster'; version: number; members: unknown[] }
  | { type: 'host-changed'; host: string; code: 'transfer' | 'failover' | string }
  | { type: 'session-state'; state: string }
  | { type: 'rotate-key'; kid: string; reason: string };
/** `null` when it is not a server frame we know, or not from the server. `lastRosterVersion` makes an older roster a no-op. */
export function readServerFrame(e: DecodedEvent, o: { lastRosterVersion: number }): { event: ServerEvent | null; warn?: string } {
  if (!SERVER_KINDS.has(e.kind)) return { event: null }; if (e.from !== 'srv') return { event: null, warn: 'forged_server_frame' }; const p = e.p ?? {};
  switch (e.kind) {
    case 'control.member_joined': return { event: { type: 'member-joined', member: String(p.member), ...(typeof p.slot === 'number' ? { slot: p.slot } : {}), ...(typeof p.role === 'string' ? { role: p.role } : {}), ...(typeof p.device === 'string' ? { device: p.device } : {}) } };
    case 'control.member_left': return { event: { type: 'member-left', member: String(p.member), code: String(p.code ?? 'left') } };
    case 'control.roster': { const v = typeof p.version === 'number' ? p.version : -1; if (v <= o.lastRosterVersion) return { event: null, warn: 'stale_roster' }; return { event: { type: 'roster', version: v, members: Array.isArray(p.members) ? p.members : [] } }; }
    case 'control.host_changed': return { event: { type: 'host-changed', host: String(p.host), code: String(p.code ?? 'transfer') } };
    case 'control.session_state': return { event: { type: 'session-state', state: String(p.state) } };
    default: return { event: { type: 'rotate-key', kid: String(p.kid), reason: String(p.reason ?? 'requested') } };
  }
}
