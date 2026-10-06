/** This device's X25519 (identity) and Ed25519 (signing) keys. Private halves only in the keychain; public halves as base64url. */
import { fingerprint } from './fingerprint.js';
import type { Keychain } from './keychain.js';
import { b64, CryptoError, sodium, unb64 } from './sodium.js';

interface Stored { v: 1; x_sk: string; x_pk: string; s_sk: string; s_pk: string }
export interface DeviceKeyProvider { getOrCreatePublicKeys(): Promise<{ x25519: string; ed25519: string }>; sign(msg: Uint8Array): Uint8Array; unsealWith(sealed: Uint8Array): Uint8Array | null; fingerprint(): string; rebindDeviceId(id: string): Promise<void> }
export class DeviceKeyStore implements DeviceKeyProvider {
  private keys?: { x_sk: Uint8Array; x_pk: Uint8Array; s_sk: Uint8Array; s_pk: Uint8Array };
  constructor(private keychain: Keychain, private deviceId: string = 'pending') {}
  private account(id = this.deviceId) { return `device-keys:${id}`; }
  async getOrCreatePublicKeys(): Promise<{ x25519: string; ed25519: string }> {
    if (!this.keys) {
      const raw = await this.keychain.get(this.account()); let j: Stored | undefined; try { j = raw ? (JSON.parse(raw) as Stored) : undefined; } catch { j = undefined; }
      if (j?.v === 1) this.keys = { x_sk: unb64(j.x_sk), x_pk: unb64(j.x_pk), s_sk: unb64(j.s_sk), s_pk: unb64(j.s_pk) };
      else { const s = sodium(); const x = s.crypto_box_keypair(); const g = s.crypto_sign_keypair(); this.keys = { x_sk: x.privateKey, x_pk: x.publicKey, s_sk: g.privateKey, s_pk: g.publicKey }; await this.save(); }
    }
    return { x25519: b64(this.keys.x_pk), ed25519: b64(this.keys.s_pk) };
  }
  private async save(id = this.deviceId) { const k = this.need(); await this.keychain.set(this.account(id), JSON.stringify({ v: 1, x_sk: b64(k.x_sk), x_pk: b64(k.x_pk), s_sk: b64(k.s_sk), s_pk: b64(k.s_pk) } satisfies Stored)); }
  private need() { if (!this.keys) throw new CryptoError('bad_input', 'Load the device keys first (getOrCreatePublicKeys).'); return this.keys; }
  sign(msg: Uint8Array): Uint8Array { return sodium().crypto_sign_detached(msg, this.need().s_sk); }
  /** The Ed25519 secret key, for signFrame. Never logged or written anywhere but the keychain. */
  signingKey(): Uint8Array { return this.need().s_sk; }
  unsealWith(sealed: Uint8Array): Uint8Array | null { const k = this.need(); try { return sodium().crypto_box_seal_open(sealed, k.x_pk, k.x_sk); } catch { return null; } }
  fingerprint(): string { const k = this.need(); return fingerprint(b64(k.x_pk), b64(k.s_pk)); }
  /** After login the backend gives the real device id: the keys move to that keychain entry. */
  async rebindDeviceId(id: string): Promise<void> { if (id === this.deviceId) return; const old = this.account(); this.deviceId = id; await this.save(); await this.keychain.delete(old); }
}
