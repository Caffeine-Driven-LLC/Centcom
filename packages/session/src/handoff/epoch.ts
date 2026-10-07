/** The key epoch to encrypt with: it moves at the `control.rotate_key` frame, so nothing is sealed under a stale epoch after that frame (lane C079). */
import type { HandoffSession, Unsubscribe } from './types.js';
export class EpochTracker {
  private kid: string; private at = 0; private off: Unsubscribe;
  constructor(session: Pick<HandoffSession, 'onFrame'>, initialKid: string) { this.kid = initialKid; this.off = session.onFrame((f) => { if (f.kind === 'control.rotate_key' && typeof f.p?.kid === 'string' && f.seq >= this.at) { this.kid = f.p.kid; this.at = f.seq; } }); }
  current(): string { return this.kid; }
  /** The kid a new frame must be sealed with; a caller holding an older one must re-seal. */
  stamp(kid: string): string { return kid === this.kid ? kid : this.kid; }
  isStale(kid: string): boolean { return kid !== this.kid; }
  dispose(): void { this.off(); }
}
