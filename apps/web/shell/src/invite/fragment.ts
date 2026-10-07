/** The key in `#k=...` is read once into memory and the address is cleaned in the same step. It is never sent, logged, stored or put in a URL. */
const B64U = /^[A-Za-z0-9_-]{16,128}$/;
export class KeyHolder { private buf?: Uint8Array; constructor(b?: Uint8Array) { this.buf = b; } get present(): boolean { return !!this.buf; } use<T>(fn: (k: Uint8Array) => T): T { if (!this.buf) throw new Error('no key'); return fn(this.buf); } /** Overwrites the bytes. */ zero(): void { this.buf?.fill(0); this.buf = undefined; } }
export function decodeB64u(s: string): Uint8Array { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); const bin = atob(p); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function takeFragmentKey(loc: { hash: string; pathname: string; search: string }, history: { replaceState(s: unknown, t: string, u: string): void }): KeyHolder {
  const raw = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash; history.replaceState(null, '', loc.pathname + loc.search); /* gone from the address in the same step */
  const k = new URLSearchParams(raw).get('k'); if (!k || !B64U.test(k)) return new KeyHolder(); try { return new KeyHolder(decodeB64u(k)); } catch { return new KeyHolder(); }
}
