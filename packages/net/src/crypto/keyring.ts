/** Session keys per epoch (`kid = "k" + epoch`). In memory; persisted only encrypted under a 32-byte wrapping key that lives in the keychain. */
import type { Keychain } from './keychain.js';
import { b64, CryptoError, sodium, unb64, utf8 } from './sodium.js';

export const ROTATE_AFTER_MS = 7 * 24 * 3600_000; export const ROTATE_AFTER_FRAMES = 100_000;
export interface KeyRingStore { read(): Promise<string | undefined>; write(text: string): Promise<void> }
export const epochOf = (kid: string) => { const m = /^k([1-9]\d{0,8})$/.exec(kid); if (!m) throw new CryptoError('bad_input', 'A key id is "k" and a number from 1.'); return Number(m[1]); };
export class KeyRing {
  private keys = new Map<string, Uint8Array>(); private cur = 0; rotatedAt: Date;
  constructor(o: { now?: Date } = {}) { this.rotatedAt = o.now ?? new Date(); }
  /** A new session: epoch 1 with a fresh random key. */
  static create(now = new Date()): KeyRing { const r = new KeyRing({ now }); r.addEpoch('k1', sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); return r; }
  current(): { kid: string; key: Uint8Array } { if (!this.cur) throw new CryptoError('unknown_kid', 'There is no key yet.'); const kid = `k${this.cur}`; return { kid, key: this.keys.get(kid)! }; }
  get(kid: string): Uint8Array | undefined { return this.keys.get(kid); }
  kids(): string[] { return [...this.keys.keys()].sort((a, b) => epochOf(a) - epochOf(b)); }
  addEpoch(kid: string, key: Uint8Array): void { const e = epochOf(kid); if (key.length !== 32) throw new CryptoError('bad_input', 'A session key is 32 bytes.'); this.keys.set(kid, new Uint8Array(key)); if (e > this.cur) this.cur = e; }
  /** A new epoch with a fresh key; frames after this use it. */
  rotate(_reason: 'member_removed' | 'scheduled' | 'requested', now = new Date()): { kid: string; key: Uint8Array } { const kid = `k${this.cur + 1}`; this.addEpoch(kid, sodium().crypto_aead_xchacha20poly1305_ietf_keygen()); this.rotatedAt = now; return this.current(); }
  shouldRotate(now: Date, framesSinceRotation: number): 'scheduled' | null { return now.getTime() - this.rotatedAt.getTime() >= ROTATE_AFTER_MS || framesSinceRotation >= ROTATE_AFTER_FRAMES ? 'scheduled' : null; }
  /** Encrypted under the wrapping key from the keychain (created on first use). */
  async persist(store: KeyRingStore, keychain: Keychain, account = 'keyring-wrap'): Promise<void> {
    const s = sodium(); let wrap = await keychain.get(account); if (!wrap) { wrap = b64(s.crypto_secretbox_keygen()); await keychain.set(account, wrap); }
    const body = JSON.stringify({ v: 1, cur: this.cur, rotatedAt: this.rotatedAt.toISOString(), keys: this.kids().map((k) => [k, b64(this.keys.get(k)!)]) }); const n = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
    await store.write(JSON.stringify({ v: 1, n: b64(n), c: b64(s.crypto_secretbox_easy(utf8(body), n, unb64(wrap))) }));
  }
  static async restore(store: KeyRingStore, keychain: Keychain, account = 'keyring-wrap'): Promise<KeyRing | undefined> {
    const raw = await store.read(); const wrap = await keychain.get(account); if (!raw || !wrap) return undefined;
    try { const o = JSON.parse(raw) as { n: string; c: string }; const pt = sodium().crypto_secretbox_open_easy(unb64(o.c), unb64(o.n), unb64(wrap)); const j = JSON.parse(new TextDecoder().decode(pt)) as { rotatedAt: string; keys: [string, string][] }; const r = new KeyRing({ now: new Date(j.rotatedAt) }); for (const [k, v] of j.keys) r.addEpoch(k, unb64(v)); return r; } catch { return undefined; }
  }
}
