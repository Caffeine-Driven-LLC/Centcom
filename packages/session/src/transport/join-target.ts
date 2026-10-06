/** What a person types or pastes to join: `ip:port`, `[ipv6]:port`, a session id or a `centcom://join/<token>` link. */
import { isPublicAddress } from '@centcom/lan';
import type { TransportTarget } from './types.js';
const SES = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/; const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
export type JoinParse = TransportTarget | { error: 'invalid' };
export function parseJoinTarget(input: string, o: { allowWan?: boolean } = {}): JoinParse {
  const s = input.trim(); if (!s || /\s/.test(s) || s.length > 300) return { error: 'invalid' };
  if (SES.test(s)) return { kind: 'relay', sessionId: s };
  const link = /^centcom:\/\/join\/([^#?]+)(?:#(.*))?$/.exec(s); if (link) { if (!TOKEN.test(link[1]!)) return { error: 'invalid' }; return { kind: 'relay', sessionId: link[1]!, ...(link[2] ? { inviteSecret: link[2] } : {}) } as TransportTarget; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^\[|^\d/.test(s)) return { error: 'invalid' }; /* javascript:, http:, file: ... */
  const m = /^(?:\[([0-9a-fA-F:.]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})$/.exec(s); if (!m) return { error: 'invalid' };
  const host = m[1] ?? m[2]!; const port = Number(m[3]); if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'invalid' };
  if (m[2] && m[2].split('.').some((x) => Number(x) > 255)) return { error: 'invalid' };
  if (isPublicAddress(host) && !o.allowWan) return { error: 'invalid' };
  return { kind: 'lan', host, port };
}
