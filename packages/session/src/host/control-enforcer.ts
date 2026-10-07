/** The checks that go with each authority action (CT-WS-CONTROL), before anything changes. */
import type { HostRoster } from './roster.js';
export type CCheck = { ok: true } | { ok: false; code: 'forbidden' | 'invalid_frame' | 'not_a_member' };
const KICK = new Set(['abuse', 'inactive', 'request', 'other']); const END = new Set(['done', 'abandoned', 'error']);
export function checkControl(kind: string, p: Record<string, unknown>, roster: HostRoster, me: string): CCheck {
  const target = typeof p.member === 'string' ? roster.get(p.member) : undefined;
  switch (kind) {
    case 'control.kick': if (!target) return { ok: false, code: 'not_a_member' }; if (target.id === me || target.role === 'host') return { ok: false, code: 'forbidden' }; return typeof p.code === 'string' && KICK.has(p.code) ? { ok: true } : { ok: false, code: 'invalid_frame' };
    case 'control.mute': case 'control.unmute': if (!target) return { ok: false, code: 'not_a_member' }; return target.id === me || target.role === 'host' ? { ok: false, code: 'forbidden' } : { ok: true };
    case 'control.role': if (!target) return { ok: false, code: 'not_a_member' }; if (target.id === me || target.role === 'host') return { ok: false, code: 'forbidden' }; return p.role === 'editor' || p.role === 'viewer' ? { ok: true } : { ok: false, code: 'invalid_frame' };
    case 'control.transfer_host': { const to = typeof p.to === 'string' ? roster.get(p.to) : undefined; if (!to) return { ok: false, code: 'not_a_member' }; return to.role === 'editor' && to.connected ? { ok: true } : { ok: false, code: 'forbidden' }; }
    case 'control.end': return typeof p.code === 'string' && END.has(p.code) ? { ok: true } : { ok: false, code: 'invalid_frame' };
    case 'control.policy': return p.auto_approve === 'ask' || p.auto_approve === 'trusted' || p.auto_approve === 'everyone' ? { ok: true } : { ok: false, code: 'invalid_frame' };
    case 'control.rotate_request': return p.reason === 'scheduled' || p.reason === 'requested' ? { ok: true } : { ok: false, code: 'invalid_frame' };
    default: return { ok: true };
  }
}
