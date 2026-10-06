/** Which words of a changed line pair differ. Words split at punctuation, spaces, `_` and camelCase humps, so `retryCount` against `retryLimit` marks only `Count`/`Limit`. */
export type Range = [number, number];
const TOKEN = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+|\s+|_|[^\w\s]/gy;
function tokens(s: string): { t: string; at: number }[] { const out: { t: string; at: number }[] = []; TOKEN.lastIndex = 0; let m: RegExpExecArray | null; while (TOKEN.lastIndex < s.length && (m = TOKEN.exec(s))) out.push({ t: m[0], at: m.index }); return out.length || !s ? out : [{ t: s, at: 0 }]; }
export const MAX_PAIR = 2000;
export function wordRanges(oldLine: string, newLine: string): { old: Range[]; new: Range[] } | null {
  if (oldLine.length > MAX_PAIR || newLine.length > MAX_PAIR) return null; const a = tokens(oldLine); const b = tokens(newLine); const w = b.length + 1; const dp = new Uint16Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i * w + j] = a[i]!.t === b[j]!.t ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
  const ra: Range[] = []; const rb: Range[] = []; const push = (r: Range[], at: number, len: number) => { const last = r.at(-1); if (last && last[1] === at) last[1] = at + len; else r.push([at, at + len]); };
  let i = 0; let j = 0; while (i < a.length || j < b.length) { if (i < a.length && j < b.length && a[i]!.t === b[j]!.t) { i++; j++; } else if (j < b.length && (i >= a.length || dp[i * w + j + 1]! > dp[(i + 1) * w + j]!)) { push(rb, b[j]!.at, b[j]!.t.length); j++; } else { push(ra, a[i]!.at, a[i]!.t.length); i++; } }
  return { old: ra, new: rb };
}
