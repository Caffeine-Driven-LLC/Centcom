/**
 * Per-session reconnect tokens (CT-LAN §2, §3): 256 random bits, base64url (43 characters), issued in lan.pair.4 and later sent as the `sys.hello` ticket.
 * Owns: issuing, constant-time validation, revocation, and the guest's copy in the OS keychain.
 * Must not: keep a token in clear on the host (only a keyed digest), log one, or survive the session (endSession forgets all).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Keychain } from '@centcom/net';
import type { MemberInfo } from './messages.js';

export const TOKEN_BYTES = 32;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** What the LAN host server (lane C072) calls on `sys.hello`. */
export interface TokenValidator { validate(token: string, ctx: { remoteIp: string }): Promise<{ memberId: string; deviceId: string; name: string; role: 'host' | 'editor' | 'viewer'; slot?: number } | null> }

const timingEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b);

export class ReconnectTokens {
  private key: Buffer; private byDevice = new Map<string, Uint8Array>(); private ended = false;
  /** `equal` exists so tests can prove every comparison goes through the constant-time path. */
  constructor(private o: { random?: (n: number) => Uint8Array; equal?: (a: Uint8Array, b: Uint8Array) => boolean } = {}) { this.key = randomBytes(32); }

  /** A new token for a device (replacing its previous one). Returned once; only a digest is kept. */
  issue(deviceId: string): string {
    if (this.ended) throw new Error('The session has ended.');
    const raw = (this.o.random ?? ((n) => new Uint8Array(randomBytes(n))))(TOKEN_BYTES); if (raw.length !== TOKEN_BYTES) throw new RangeError('need 32 random bytes');
    const token = Buffer.from(raw).toString('base64url'); this.byDevice.set(deviceId, this.digest(token)); return token;
  }

  /**
   * The device a token belongs to, or null. Every stored digest is compared (no early exit) in constant time; malformed tokens take the same path.
   * Tokens stay valid for later reconnects until revoked or the session ends. `remoteIp` is accepted for the C072 interface and future per-IP policy.
   */
  validate(token: string, _remoteIp: string): { deviceId: string } | null {
    const d = this.digest(typeof token === 'string' && TOKEN_RE.test(token) ? token : '\0invalid');
    const eq = this.o.equal ?? timingEqual; let found: string | null = null;
    for (const [dev, stored] of this.byDevice) if (eq(stored, d) && found === null) found = dev;
    return this.ended || found === null || !TOKEN_RE.test(token) ? null : { deviceId: found };
  }

  revoke(deviceId: string): void { this.byDevice.delete(deviceId); }
  /** Host stopped or session ended: every token is invalid from now on. */
  endSession(): void { this.ended = true; this.byDevice.clear(); }
  /** How many devices hold a token (no secrets). */
  size(): number { return this.byDevice.size; }

  private digest(token: string): Uint8Array { return new Uint8Array(createHmac('sha256', this.key).update(token, 'utf8').digest()); }
}

/** Adapt ReconnectTokens to the C072 TokenValidator, looking up the member each device was given at pairing. */
export function tokenValidator(tokens: ReconnectTokens, memberFor: (deviceId: string) => MemberInfo | null): TokenValidator {
  return { async validate(token, ctx) { const v = tokens.validate(token, ctx.remoteIp); if (!v) return null; const m = memberFor(v.deviceId); return m ? { memberId: m.id, deviceId: v.deviceId, name: m.name, role: m.role, slot: m.slot } : null; } };
}

// ---- guest side: the token lives only in memory and the OS keychain

const account = (sid: string) => `lan-token:${sid}`;
export async function saveGuestToken(keychain: Keychain, sid: string, token: string): Promise<void> { await keychain.set(account(sid), token); }
export async function loadGuestToken(keychain: Keychain, sid: string): Promise<string | undefined> { const t = await keychain.get(account(sid)); return t && TOKEN_RE.test(t) ? t : undefined; }
export async function forgetGuestToken(keychain: Keychain, sid: string): Promise<void> { await keychain.delete(account(sid)); }
