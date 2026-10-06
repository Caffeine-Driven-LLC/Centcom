/** What the control frames add up to: who is host, our own mute and role, the policy, the session state, and the position from which a change counts. */
import type { Role, SessionPolicy } from '../session/types.js';
export type ControlSessionState = 'live' | 'paused' | 'ended' | 'expired';
export interface ControlState { me: { muted: boolean; mutedUntil?: string; role: Role }; host: string; policy: SessionPolicy; sessionState: ControlSessionState; /** a control frame applies to frames with a higher seq than this one */ effectiveFromSeq: number }
export type Change = { kind: 'became-host' | 'lost-host' | 'muted' | 'unmuted' | 'policy' | 'session-state' | 'role' | 'none' };
const STATES = new Set(['live', 'paused', 'ended', 'expired']);

/** Pure state: feed it the decoded control frames in seq order. */
export class ControlStateModel {
  private s: ControlState; private mutedAt = 0;
  constructor(init: { meId: string; role: Role; host: string; policy?: SessionPolicy }, private readonly now: () => number) { this.meId = init.meId; this.s = { me: { muted: false, role: init.role }, host: init.host, policy: { ...(init.policy ?? {}) }, sessionState: 'live', effectiveFromSeq: 0 }; }
  private meId: string;
  get(): ControlState { this.expireMute(); return { me: { ...this.s.me }, host: this.s.host, policy: { ...this.s.policy }, sessionState: this.s.sessionState, effectiveFromSeq: this.s.effectiveFromSeq }; }
  /** The mute ends by itself at `until`, even when no unmute frame arrives. Returns true when it just ended. */
  expireMute(): boolean { if (this.s.me.muted && this.s.me.mutedUntil !== undefined && this.now() >= Date.parse(this.s.me.mutedUntil)) { this.s.me.muted = false; delete this.s.me.mutedUntil; return true; } return false; }
  nextMuteEnd(): number | undefined { return this.s.me.muted && this.s.me.mutedUntil !== undefined ? Date.parse(this.s.me.mutedUntil) : undefined; }
  setMeId(id: string): void { this.meId = id; }
  apply(kind: string, p: Record<string, unknown>, seq: number): Change[] {
    const out: Change[] = []; if (seq > this.s.effectiveFromSeq) this.s.effectiveFromSeq = seq;
    switch (kind) {
      case 'control.mute': if (p.member === this.meId) { this.s.me.muted = true; if (typeof p.until === 'string' && Number.isFinite(Date.parse(p.until))) this.s.me.mutedUntil = p.until; else delete this.s.me.mutedUntil; this.mutedAt = seq; out.push({ kind: 'muted' }); } break;
      case 'control.unmute': if (p.member === this.meId && this.s.me.muted) { this.s.me.muted = false; delete this.s.me.mutedUntil; out.push({ kind: 'unmuted' }); } break;
      case 'control.role': if (p.member === this.meId && (p.role === 'editor' || p.role === 'viewer') && this.s.me.role !== 'host') { this.s.me.role = p.role; out.push({ kind: 'role' }); } break;
      case 'control.policy': { const { ...rest } = p; this.s.policy = { ...this.s.policy, ...rest } as SessionPolicy; out.push({ kind: 'policy' }); break; }
      case 'control.session_state': if (STATES.has(String(p.state))) { this.s.sessionState = p.state as ControlSessionState; out.push({ kind: 'session-state' }); } break;
      case 'control.host_changed': { const host = String(p.host ?? ''); if (!host) break; const was = this.s.host; this.s.host = host; if (host === this.meId && was !== this.meId) { this.s.me.role = 'host'; out.push({ kind: 'became-host' }); } else if (was === this.meId && host !== this.meId) { this.s.me.role = 'editor'; out.push({ kind: 'lost-host' }); } break; }
      default: break;
    }
    void this.mutedAt; return out;
  }
}
