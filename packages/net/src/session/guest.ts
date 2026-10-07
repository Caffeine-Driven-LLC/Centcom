/** What a guest does with keys: wait for a grant addressed to this device, open it, and say when it has enough to read. */
import { openGrants, type GrantSecret } from '../crypto/grants.js';
import type { DeviceKeyStore } from '../crypto/device-keys.js';
import type { KeyRing } from '../crypto/keyring.js';

export class GuestKeys {
  constructor(private readonly ring: KeyRing, private readonly device: Pick<DeviceKeyStore, 'unsealWith'> | undefined) {}
  /** The kids that were new to us. A grant for another device or with broken boxes gives nothing. */
  open(secret: GrantSecret): string[] { if (!this.device) return []; const added: string[] = []; for (const g of openGrants(this.device, secret)) { if (!this.ring.get(g.kid)) { this.ring.addEpoch(g.kid, g.key); added.push(g.kid); } } return added; }
  /** Can we read frames from the current epoch of the session? */
  hasKey(): boolean { try { this.ring.current(); return true; } catch { return false; } }
}
