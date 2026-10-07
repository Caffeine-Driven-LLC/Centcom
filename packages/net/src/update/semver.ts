/** Versions as in the release manifest: `1.2.3` or `1.2.3-beta.4`. A pre-release is older than the same version without one. */
export interface Version { major: number; minor: number; patch: number; pre: string[] }
const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export function parseVersion(s: string): Version | undefined { const m = RE.exec(s.trim()); return m ? { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? m[4].split('.') : [] } : undefined; }
const id = (a: string, b: string): number => { const na = /^\d+$/.test(a); const nb = /^\d+$/.test(b); if (na && nb) return Number(a) - Number(b); if (na) return -1; if (nb) return 1; return a < b ? -1 : a > b ? 1 : 0; };
/** Negative when a < b, 0 when equal, positive when a > b. Unparseable versions are treated as lowest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a); const y = parseVersion(b); if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) { if (x.pre[i] === undefined) return -1; if (y.pre[i] === undefined) return 1; const c = id(x.pre[i]!, y.pre[i]!); if (c) return c; }
  return 0;
}
export const isPrerelease = (v: string): boolean => (parseVersion(v)?.pre.length ?? 0) > 0;
