/**
 * Pairing codes (CT-LAN §2): 8 characters from A-Z and 2-9 without 0 O 1 I L, shown ABCD-EFGH, from the platform CSPRNG.
 * Owns: generation with rejection sampling (uniform), normalisation of typed input, and the host-side code slot (5-minute validity on a monotonic clock, 5 attempts, single use).
 * Must not: log, persist or put the code in an error. It lives only in host memory and on the host's screen.
 */
import { randomBytes } from 'node:crypto';
import { mono, type LanClock } from '../clock.js';

/** 23 letters (no I, L, O) and 8 digits (no 0, 1): 31 symbols. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const CODE_TTL_MS = 5 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
const LIMIT = 256 - (256 % CODE_ALPHABET.length); // 248: bytes at or above are rejected so every symbol is equally likely

/** A fresh code. `rng` returns random bytes (any length > 0); the default is the platform CSPRNG. */
export function generatePairingCode(rng: () => Uint8Array = () => new Uint8Array(randomBytes(32))): { code: string; display: string } {
  let code = ''; let guard = 0;
  while (code.length < CODE_LENGTH) {
    const bytes = rng(); if (!(bytes instanceof Uint8Array) || bytes.length === 0 || ++guard > 1000) throw new RangeError('rng returned no usable bytes');
    for (const b of bytes) { if (b >= LIMIT) continue; code += CODE_ALPHABET[b % CODE_ALPHABET.length]; if (code.length === CODE_LENGTH) break; }
  }
  return { code, display: displayCode(code) };
}

export const displayCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Typed input to the canonical code: upper case, spaces and dashes removed. Null when it is not 8 symbols of the alphabet. */
export function normalizeCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export type CodeCheck = { ok: true; code: string } | { ok: false; reason: 'expired' | 'too_many' };

/**
 * The host's one open code. Validity uses the monotonic clock, so a wall-clock jump never extends it; attempts and consumption survive reconnects because they live here, not on a connection.
 */
export class CodeSlot {
  private code?: string; private until = 0; private attempts = 0; private consumed = false;
  constructor(private clock: LanClock, private rng?: () => Uint8Array) {}

  /** Open a new code (replacing any older one). Returns what the host UI shows. */
  open(ttlMs = CODE_TTL_MS): { display: string; expiresAt: string } {
    const { code, display } = generatePairingCode(this.rng); this.code = code; this.until = mono(this.clock) + ttlMs; this.attempts = 0; this.consumed = false;
    return { display, expiresAt: new Date(this.clock.now() + ttlMs).toISOString() };
  }

  /** The code if it may be tried now. */
  current(): CodeCheck {
    if (!this.code || this.consumed || mono(this.clock) > this.until) return { ok: false, reason: 'expired' };
    if (this.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'too_many' };
    return { ok: true, code: this.code };
  }

  /** Count a wrong confirmation. Returns true when the code is now used up. */
  fail(): boolean { this.attempts++; return this.attempts >= MAX_CODE_ATTEMPTS; }

  /** One successful use: the code cannot pair anyone else. */
  consume(): void { this.consumed = true; this.code = undefined; }

  /** Close the code early (host cancelled). */
  close(): void { this.code = undefined; }

  /** Failed attempts so far (no secret). */
  failures(): number { return this.attempts; }
}
