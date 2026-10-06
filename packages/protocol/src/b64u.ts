/** Binary on the wire is base64url without padding (CT-IDS). */
export const b64u = {
  encode(bytes: Uint8Array): string { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new TypeError('not base64url without padding');
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  },
};
/** `<alg>:<hex>` hash strings, e.g. `sha256:ab12…` */
export const hashString = (alg: string, hex: string): string => `${alg}:${hex.toLowerCase()}`;
export const isHashString = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9]+:[0-9a-f]+$/.test(s);
