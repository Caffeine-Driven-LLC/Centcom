import { randomBytes } from 'node:crypto';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0; let lastRand = new Uint8Array(10);

/** Monotonic ULID (26 chars Crockford base32) with a prefix, e.g. agt_01H... (CT-IDS). */
export function newId(prefix: string, now = Date.now()): string {
  let t = now;
  if (t <= lastTime) { t = lastTime; for (let i = 9; i >= 0; i--) { if (lastRand[i]! === 255) { lastRand[i] = 0; } else { lastRand[i] = lastRand[i]! + 1; break; } } }
  else { lastTime = t; lastRand = new Uint8Array(randomBytes(10)); }
  let time = '';
  for (let i = 0, v = t; i < 10; i++) { time = ALPHABET[v % 32]! + time; v = Math.floor(v / 32); }
  let rand = ''; let bits = 0, acc = 0;
  for (const b of lastRand) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { rand += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5; } }
  return `${prefix}_${time}${rand.slice(0, 16)}`;
}
