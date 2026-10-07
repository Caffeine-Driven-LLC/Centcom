/**
 * Devices trusted for the lifetime of one LAN session (trust on first use). Only public keys, the display name and the fingerprint are kept.
 * Owns: remembering paired devices and reporting a changed key as `changed`. Must not: silently replace keys for a known device id.
 */
export interface DeviceRecord { id: string; x25519: string; ed25519: string; name: string; fingerprint: string }
export type TrustCheck = 'new' | 'match' | 'changed';

/** The surface pairing needs (card interface). `remember` never overwrites a device whose keys changed. */
export interface PairingTrustStore { remember(d: DeviceRecord): void; get(id: string): DeviceRecord | null }

/** Compare a device with what the store knows. */
export function checkTrust(store: PairingTrustStore, d: Pick<DeviceRecord, 'id' | 'x25519' | 'ed25519'>): TrustCheck {
  const k = store.get(d.id); if (!k) return 'new'; return k.x25519 === d.x25519 && k.ed25519 === d.ed25519 ? 'match' : 'changed';
}

export class SessionTrustStore implements PairingTrustStore {
  private known = new Map<string, DeviceRecord>();
  constructor(private max = 64) {}
  /** First sighting is stored; the same keys update the name; different keys are ignored (use `accept` after the person compared fingerprints). */
  remember(d: DeviceRecord): void {
    const k = this.known.get(d.id);
    if (k && (k.x25519 !== d.x25519 || k.ed25519 !== d.ed25519)) return;
    if (!k && this.known.size >= this.max) return;
    this.known.set(d.id, pick(d));
  }
  get(id: string): DeviceRecord | null { const k = this.known.get(id); return k ? { ...k } : null; }
  /** Replace keys on purpose, after an out-of-band fingerprint comparison. */
  accept(d: DeviceRecord): void { this.known.set(d.id, pick(d)); }
  forget(id: string): void { this.known.delete(id); }
  /** Session ended. */
  clear(): void { this.known.clear(); }
  list(): DeviceRecord[] { return [...this.known.values()].map((d) => ({ ...d })); }
}

const pick = (d: DeviceRecord): DeviceRecord => ({ id: d.id, x25519: d.x25519, ed25519: d.ed25519, name: d.name, fingerprint: d.fingerprint });
