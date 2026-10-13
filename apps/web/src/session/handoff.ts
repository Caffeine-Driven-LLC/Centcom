/**
 * From the invite page to the session page, in memory only: the invite token and the key from its address fragment. The session page takes
 * them once (the key bundle can be fetched only once, and the session engine does it), and they are never put in a URL, a log or storage.
 */
export interface InviteHandoff { token: string; /** `#k=...`, as the session engine reads it; absent when the link had no key */ secret?: string }
const held = new Map<string, InviteHandoff>();
export function setInviteHandoff(sessionId: string, h: InviteHandoff): void { held.set(sessionId, h); }
const recent = new Map<string, { h: InviteHandoff; until: number }>();
/** Returns what was handed over for this session and forgets it. A second call within a few seconds (React renders a page twice in development) gets the same answer; after that it is gone. */
export function takeInviteHandoff(sessionId: string, now: number = Date.now()): InviteHandoff | undefined {
  for (const [k, v] of recent) if (v.until <= now) recent.delete(k);
  const h = held.get(sessionId); if (h) { held.delete(sessionId); recent.set(sessionId, { h, until: now + 5000 }); return h; }
  return recent.get(sessionId)?.h;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** The key bytes as the `#k=` fragment the engine expects (base64url, no padding). */
export function fragmentOf(key: Uint8Array): string {
  let out = ''; for (let i = 0; i < key.length; i += 3) { const a = key[i]!; const b = key[i + 1]; const c = key[i + 2]; out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!; if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!; if (c !== undefined) out += B64[c & 63]!; }
  return `#k=${out}`;
}
