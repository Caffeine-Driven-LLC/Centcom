/** CT-DEEPLINK: the web and app forms of every link, parsed strictly. Anything else is `undefined`, never an error with details. */
export type DeepLink =
  | { kind: 'join'; token: string } | { kind: 'invite'; token: string } | { kind: 'share'; token: string }
  | { kind: 'session'; id: string; focus?: 'approval' | 'queue' } | { kind: 'auth_callback'; code: string; state: string } | { kind: 'billing' };
export const TOKEN_RE = /^[A-Za-z0-9_-]{27,64}$/; export const SES_RE = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/; const CODE_RE = /^[A-Za-z0-9._~-]{8,256}$/;
const WEB_HOSTS = new Set(['centcom.dev', 'www.centcom.dev', 'app.centcom.dev']);
export const isToken = (s: string | undefined | null): s is string => typeof s === 'string' && TOKEN_RE.test(s);
export function parseDeepLink(input: string): DeepLink | undefined {
  if (typeof input !== 'string' || input.length > 600) return undefined; let u: URL; try { u = new URL(input.trim()); } catch { return undefined; }
  if (u.username || u.password || u.port) return undefined;
  let kind: string; let rest: string[];
  if (u.protocol === 'centcom:') { kind = u.hostname; rest = u.pathname.split('/').filter(Boolean); }
  else if (u.protocol === 'https:' && WEB_HOSTS.has(u.hostname)) { const parts = u.pathname.split('/').filter(Boolean); const m: Record<string, string> = { j: 'join', i: 'invite', g: 'share', s: 'session', billing: 'billing' }; kind = m[parts[0] ?? ''] ?? ''; rest = parts.slice(1); }
  else return undefined;
  const q = u.searchParams; const one = (): string | undefined => (rest.length === 1 ? rest[0] : undefined);
  switch (kind) {
    case 'join': case 'invite': case 'share': { const t = one(); return isToken(t) ? { kind, token: t } : undefined; }
    case 'session': { const id = one(); if (!id || !SES_RE.test(id)) return undefined; const f = q.get('focus'); return { kind: 'session', id, ...(f === 'approval' || f === 'queue' ? { focus: f } : {}) }; } /* a bad focus is dropped, not an error */
    case 'auth': { if (u.protocol !== 'centcom:' || rest[0] !== 'callback' || rest.length !== 1) return undefined; const code = q.get('code'); const state = q.get('state'); return code && state && CODE_RE.test(code) && CODE_RE.test(state) ? { kind: 'auth_callback', code, state } : undefined; }
    case 'billing': return rest.length === 0 ? { kind: 'billing' } : undefined;
    default: return undefined;
  }
}
/** The address that opens a link in the desktop app. The key fragment is not part of it. */
export function appUrl(l: Extract<DeepLink, { kind: 'join' | 'invite' | 'share' }>): string { return `centcom://${l.kind}/${l.token}`; }
/** Where the page goes for a link. `auth_callback` has no screen: sign-in finishes it. */
export function routeFor(l: DeepLink): string | undefined { switch (l.kind) { case 'join': return `/j/${l.token}`; case 'invite': return `/i/${l.token}`; case 'share': return `/g/${l.token}`; case 'session': return `/s/${l.id}${l.focus ? `?focus=${l.focus}` : ''}`; case 'billing': return '/billing'; default: return undefined; } }
