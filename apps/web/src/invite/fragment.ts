/** The key in `#k=...` is read once into memory and the address is cleaned in the same step. It is never sent, logged, stored or put in a URL. */
const B64U = /^[A-Za-z0-9_-]{16,128}$/;
export class KeyHolder { private buf?: Uint8Array; constructor(b?: Uint8Array) { this.buf = b; } get present(): boolean { return !!this.buf; } use<T>(fn: (k: Uint8Array) => T): T { if (!this.buf) throw new Error('no key'); return fn(this.buf); } /** Overwrites the bytes. */ zero(): void { this.buf?.fill(0); this.buf = undefined; } }
export function decodeB64u(s: string): Uint8Array { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); const bin = atob(p); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function takeFragmentKey(loc: { hash: string; pathname: string; search: string }, history: { replaceState(s: unknown, t: string, u: string): void }): KeyHolder {
  const raw = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash; history.replaceState(null, '', loc.pathname + loc.search); /* gone from the address in the same step */
  const k = new URLSearchParams(raw).get('k'); if (!k || !B64U.test(k)) return new KeyHolder(); try { return new KeyHolder(decodeB64u(k)); } catch { return new KeyHolder(); }
}
/**
 * A watch link carries `#k=<key>&kid=<epoch>` in its address. The text is read once into memory and the address is cleaned in the same step; it is
 * returned only when it is well formed (a 43-character key and an epoch like `k1`). It is never sent to a server, logged or stored.
 */
export function takeShareFragment(loc: { hash: string; pathname: string; search: string }, history: { replaceState(s: unknown, t: string, u: string): void }): string | undefined {
  const raw = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash; history.replaceState(null, '', loc.pathname + loc.search);
  const p = new URLSearchParams(raw); const k = p.get('k'); const kid = p.get('kid') ?? 'k1';
  return k && /^[A-Za-z0-9_-]{43}$/.test(k) && /^k[1-9]\d{0,8}$/.test(kid) ? `#k=${k}&kid=${kid}` : undefined;
}
