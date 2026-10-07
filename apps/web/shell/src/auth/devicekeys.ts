/** The browser's device keys: X25519 and Ed25519 from WebCrypto, private halves non-extractable and kept in IndexedDB. A browser without Ed25519 starts viewer-only and says so. */
import type { DevicePub } from './login.js';
import { b64url } from './pkce.js';
export interface KeyStore { get(): Promise<{ x25519: CryptoKeyPair; ed25519: CryptoKeyPair } | undefined>; put(k: { x25519: CryptoKeyPair; ed25519: CryptoKeyPair }): Promise<void> }
export async function ensureDeviceKeys(store: KeyStore, subtle: SubtleCrypto = crypto.subtle): Promise<{ pubkeys?: DevicePub; viewerOnly: boolean }> {
  try {
    let k = await store.get(); if (!k) { const ed = (await subtle.generateKey('Ed25519', false, ['sign', 'verify'])) as CryptoKeyPair; const x = (await subtle.generateKey('X25519', false, ['deriveBits'])) as CryptoKeyPair; k = { x25519: x, ed25519: ed }; await store.put(k); }
    const raw = async (key: CryptoKey): Promise<string> => b64url(new Uint8Array(await subtle.exportKey('raw', key))); return { pubkeys: { x25519: await raw(k.x25519.publicKey), ed25519: await raw(k.ed25519.publicKey) }, viewerOnly: false };
  } catch { return { viewerOnly: true }; }
}
export function idbKeyStore(name = 'centcom-device'): KeyStore {
  const open = (): Promise<IDBDatabase> => new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return { async get() { const db = await open(); return new Promise((res, rej) => { const q = db.transaction('keys').objectStore('keys').get('device'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }, async put(k) { const db = await open(); await new Promise<void>((res, rej) => { const q = db.transaction('keys', 'readwrite').objectStore('keys').put(k, 'device'); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); } };
}
