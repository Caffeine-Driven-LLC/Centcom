/** When to rotate: after a member leaves or is removed (immediately), and on schedule (7 days or 100 000 frames, whichever first). */
import type { KeyRing } from './keyring.js';

export type RotationReason = 'member_removed' | 'scheduled' | 'requested';
export function rotationDue(ring: KeyRing, o: { now: Date; framesSinceRotation: number; memberRemoved?: boolean; requested?: boolean }): RotationReason | null {
  if (o.memberRemoved) return 'member_removed'; if (o.requested) return 'requested'; return ring.shouldRotate(o.now, o.framesSinceRotation);
}
