// A copy of the diff helper in memory/text.ts (PR #14), kept here so this lane does not depend on that PR; to be unified once both are merged.
/** A unified diff of two texts: trims the common start and end, then compares the middle line by line (a whole-block replacement if that is very large). */
export function unifiedDiff(oldText: string, newText: string, label: string): string {
  if (oldText === newText) return '';
  const a = oldText.split('\n'); const b = newText.split('\n'); let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const am = a.slice(s, ea), bm = b.slice(s, eb); const ops: string[] = [];
  if (am.length * bm.length > 4_000_000) { for (const l of am) ops.push('-' + l); for (const l of bm) ops.push('+' + l); }
  else { const dp: number[][] = Array.from({ length: am.length + 1 }, () => new Array<number>(bm.length + 1).fill(0)); for (let i = am.length - 1; i >= 0; i--) for (let j = bm.length - 1; j >= 0; j--) dp[i]![j] = am[i] === bm[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    let i = 0, j = 0; while (i < am.length || j < bm.length) { if (i < am.length && j < bm.length && am[i] === bm[j]) { ops.push(' ' + am[i]); i++; j++; } else if (j < bm.length && (i === am.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) ops.push('+' + bm[j++]); else ops.push('-' + am[i++]); } }
  const ctx = 2; const before = a.slice(Math.max(0, s - ctx), s).map((l) => ' ' + l); const after = a.slice(ea, ea + ctx).map((l) => ' ' + l); const start = Math.max(0, s - ctx) + 1;
  const oldN = before.length + am.length + after.length, newN = before.length + bm.length + after.length;
  return [`--- ${label}`, `+++ ${label}`, `@@ -${start},${oldN} +${start},${newN} @@`, ...before, ...ops, ...after].join('\n');
}
