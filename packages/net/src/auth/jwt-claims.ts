/** Reads (never verifies) the claims of a CT-AUTH access token. Claims are for scheduling (`exp`) and cache invalidation (`ent`) only.
 *  Must not: be used for authorisation decisions (the server is the authority, CT-RBAC); log or return the token itself. */
import { b64u, isId } from '@centcom/protocol';

/** The claims the client cares about. Anything missing or of the wrong type is left out. */
export interface AccessClaims {
  /** expiry, seconds since the epoch */
  exp: number;
  sub?: string; dev?: string; wsp?: string; plan?: string;
  /** entitlement revision (CT-ENTITLEMENTS) */
  ent?: number;
  /** space-separated scopes */
  scp?: string;
}

/** Decode the payload of a JWT. Returns null when it is not a JWT or has no numeric `exp`. No signature check: see the module header. */
export function decodeAccessClaims(token: string): AccessClaims | null {
  if (typeof token !== 'string' || token.length > 16_384) return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  let p: unknown;
  try { p = JSON.parse(new TextDecoder().decode(b64u.decode(parts[1]!))); } catch { return null; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.exp !== 'number' || !Number.isFinite(o.exp)) return null;
  const out: AccessClaims = { exp: o.exp };
  if (isId('usr', o.sub)) out.sub = o.sub;
  if (isId('dev', o.dev)) out.dev = o.dev;
  if (isId('wsp', o.wsp)) out.wsp = o.wsp;
  if (typeof o.plan === 'string' && o.plan.length <= 32) out.plan = o.plan;
  if (typeof o.ent === 'number' && Number.isInteger(o.ent)) out.ent = o.ent;
  if (typeof o.scp === 'string' && o.scp.length <= 1024) out.scp = o.scp;
  return out;
}
