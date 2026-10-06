/** CT-VER: contract version, protocol versions, the User-Agent and the minimum-client check. */
import { CONTRACT_VERSION } from './generated/contract-version.js';
export { CONTRACT_VERSION };
export const PROTOCOL_VERSIONS = [1] as const;

export interface ClientInfo { name: 'centcom-cli' | 'centcom-tui' | 'centcom-web'; version: string; platform: string; arch: string; node: string }
export const userAgent = (i: ClientInfo): string => `${i.name}/${i.version} (contract/${CONTRACT_VERSION}; ${i.platform}-${i.arch}; node/${i.node})`;

/** Semver ordering with prerelease support: 1.2.0 < 1.10.0 and 1.2.0-rc.1 < 1.2.0. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim()); if (!m) throw new TypeError(`not a version: ${v}`); return { n: [+m[1]!, +m[2]!, +m[3]!], pre: m[4]?.split('.') }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.n[i]! !== y.n[i]!) return x.n[i]! < y.n[i]! ? -1 : 1;
  if (!x.pre && !y.pre) return 0; if (!x.pre) return 1; if (!y.pre) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i]; if (p === undefined) return -1; if (q === undefined) return 1; if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q); if (pn && qn) return +p < +q ? -1 : 1; if (pn) return -1; if (qn) return 1; return p < q ? -1 : 1;
  }
  return 0;
}
export const isClientTooOld = (clientVersion: string, minClientVersion: string): boolean => compareVersions(clientVersion, minClientVersion) < 0;
