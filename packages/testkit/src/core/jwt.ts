/** Ed25519-signed JWTs (EdDSA) with a JWKS, like the real service. Keys come from the seed and are never written to disk. */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { b64u } from '@centcom/protocol';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
export interface KeyPair { kid: string; priv: KeyObject; pub: KeyObject; x: string }
export function keyFromSeed(seed: Uint8Array, kid: string): KeyPair {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed.subarray(0, 32))]), format: 'der', type: 'pkcs8' }); const pub = createPublicKey(priv);
  const jwk = pub.export({ format: 'jwk' }) as { x: string }; return { kid, priv, pub, x: jwk.x };
}
export const jwks = (keys: KeyPair[]) => ({ keys: keys.map((k) => ({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA', kid: k.kid, x: k.x })) });

const enc = (o: unknown) => b64u.encode(Buffer.from(JSON.stringify(o)));
export function signJwt(key: KeyPair, claims: Record<string, unknown>): string {
  const head = enc({ alg: 'EdDSA', typ: 'JWT', kid: key.kid }); const body = enc(claims); const sig = sign(null, Buffer.from(`${head}.${body}`), key.priv);
  return `${head}.${body}.${b64u.encode(sig)}`;
}
export type JwtResult = { ok: true; claims: Record<string, any> } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_audience' };
export function verifyJwt(keys: KeyPair[], token: string, o: { now: number; aud?: string }): JwtResult {
  const parts = token.split('.'); if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let head: any, claims: any; try { head = JSON.parse(Buffer.from(b64u.decode(parts[0]!)).toString()); claims = JSON.parse(Buffer.from(b64u.decode(parts[1]!)).toString()); } catch { return { ok: false, reason: 'malformed' }; }
  const key = keys.find((k) => k.kid === head.kid) ?? keys[0]; if (!key || head.alg !== 'EdDSA') return { ok: false, reason: 'bad_signature' };
  let good = false; try { good = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key.pub, Buffer.from(b64u.decode(parts[2]!))); } catch { good = false; }
  if (!good) return { ok: false, reason: 'bad_signature' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= o.now) return { ok: false, reason: 'expired' };
  if (o.aud && claims.aud !== o.aud) return { ok: false, reason: 'wrong_audience' };
  return { ok: true, claims };
}
