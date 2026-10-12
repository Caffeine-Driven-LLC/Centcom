/** What a person pastes to join: a session id, an invite link or token, or a watch-only link. */
export type JoinTarget = { kind: 'session'; id: string } | { kind: 'invite'; token: string } | { kind: 'watch'; token: string; fragment: string };
const SES = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/; const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
export function parseJoinTarget(raw: string): JoinTarget | undefined {
  const s = raw.trim(); if (!s || s.length > 2048) return undefined; if (SES.test(s)) return { kind: 'session', id: s };
  let u: URL | undefined; try { u = new URL(s); } catch { /* not an address */ }
  if (u) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'centcom:') return undefined;
    const parts = (u.protocol === 'centcom:' ? [u.hostname, ...u.pathname.split('/')] : u.pathname.split('/')).filter(Boolean);
    const [kind, token] = parts; if (!token || !TOKEN.test(token)) return undefined;
    if (kind === 'i') return { kind: 'invite', token }; if (kind === 'j') return { kind: 'watch', token, fragment: u.hash };
    const sid = parts.find((p) => SES.test(p)); return sid ? { kind: 'session', id: sid } : undefined;
  }
  return TOKEN.test(s) ? { kind: 'invite', token: s } : undefined;
}
