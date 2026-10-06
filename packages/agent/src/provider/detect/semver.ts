/** A small semver comparator: `x.y.z` with optional `-pre`, and ranges made of space-separated comparators (`>=2.0.0 <3.0.0`). No dependency. */
export type Version = [number, number, number];
export function parseVersion(s: string): Version | undefined { const m = /(\d+)\.(\d+)\.(\d+)/.exec(s); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined; }
export function compare(a: Version, b: Version): number { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1; return 0; }
const OPS: Record<string, (c: number) => boolean> = { '>=': (c) => c >= 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '<': (c) => c < 0, '=': (c) => c === 0, '': (c) => c === 0 };
/** `satisfies('2.1.0', '>=2.0.0 <3.0.0')`. A version or range that cannot be read is false. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version); if (!v) return false; const parts = range.trim().split(/\s+/).filter(Boolean); if (!parts.length) return false;
  return parts.every((p) => { const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(p); if (!m) return false; const r = parseVersion(m[2]!)!; return OPS[m[1] ?? '']!(compare(v, r)); });
}
/** `'yes'` inside the range, `'below'` under its lowest bound, `'above'` at or over its upper bound, `'unknown'` when unreadable. */
export function rangePosition(version: string | undefined, range: string): 'yes' | 'below' | 'above' | 'unknown' {
  if (!version || !parseVersion(version)) return 'unknown'; if (satisfies(version, range)) return 'yes';
  const v = parseVersion(version)!; for (const p of range.trim().split(/\s+/)) { const m = /^(>=|>)(\d+\.\d+\.\d+)$/.exec(p); if (m && compare(v, parseVersion(m[2]!)!) < 0) return 'below'; } return 'above';
}
