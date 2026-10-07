/** What the host does with keys: it holds them, gives them to each new device, and replaces them when someone leaves or is removed (CT-CRYPTO sections 4 and 5). */
import { grantKids, sealGrants } from '../crypto/grants.js';
import { epochOf, type KeyRing } from '../crypto/keyring.js';
import { sodium } from '../crypto/sodium.js';
import type { MemberInfo, SessionPolicy } from './types.js';

export interface HostContext {
  ring: KeyRing; deviceId: string; policy(): SessionPolicy; now(): Date;
  /** send one key.grant frame */ sendGrant(p: { to_device: string; kids: string[] }, secret: { grants: { kid: string; sealed: string }[] }): Promise<void>;
  recipients(): MemberInfo[]; log?(msg: string, ctx?: Record<string, unknown>): void; persist?(): Promise<void>;
}
export class HostDuties {
  private granted = new Set<string>(); private framesSinceRotation = 0;
  constructor(private readonly c: HostContext) {}
  noteFrame(): void { this.framesSinceRotation++; }
  get frames(): number { return this.framesSinceRotation; }
  /** Give a device the keys it may have: everything, or only the current epoch when history is not shared. Once per device and epoch, so a replayed `member_joined` does nothing. */
  async grantTo(m: MemberInfo, only?: string[]): Promise<boolean> {
    if (!m.keys || m.device === this.c.deviceId || m.role === 'viewer' || m.keyChanged || m.keys.revoked) return false;
    const kids = (only ?? grantKids(this.c.ring, this.c.policy().share_history !== false)).filter((k) => !this.granted.has(`${m.device}:${k}`)); if (kids.length === 0) return false;
    const g = sealGrants(this.c.ring, kids, m.keys.x25519, m.keys.device); await this.c.sendGrant(g.p, g.secret); for (const k of kids) this.granted.add(`${m.device}:${k}`); this.c.log?.('session.key_granted', { kids: kids.length }); return true;
  }
  /** The relay announced a new epoch (after a removal or a rotation request): make that key and give it to every remaining device. */
  async onRotateKey(kid: string, reason: 'member_removed' | 'scheduled' | 'requested'): Promise<void> {
    if (!this.c.ring.get(kid)) { this.c.ring.addEpoch(kid, sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); this.c.ring.rotatedAt = this.c.now(); }
    else if (epochOf(kid) < epochOf(this.c.ring.current().kid)) return; /* an old announcement we already passed */
    this.framesSinceRotation = 0; await this.c.persist?.().catch(() => undefined);
    for (const m of this.c.recipients()) await this.grantTo(m, [kid]);
    this.c.log?.('session.rotated', { reason });
  }
  /** True when the ring is due for its scheduled rotation (7 days or 100,000 frames). */
  rotationDue(): boolean { return this.c.ring.shouldRotate(this.c.now(), this.framesSinceRotation) !== null; }
}
