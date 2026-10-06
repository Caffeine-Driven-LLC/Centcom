/** Subsequence matching with bonuses for consecutive characters, word starts and path separators, found by dynamic programming so the best alignment wins.
 *  Smart-case: a capital in the query makes it case-sensitive. */
export interface Fuzzy { score: number; indices: number[] }
const SEP = new Set([' ', '/', '\\', '-', '_', '.', ':']);
const NEG = -1e9;

export function fuzzyScore(query: string, text: string): Fuzzy | null {
  if (!query) return { score: 0, indices: [] };
  const cs = /[A-Z]/.test(query); const q = [...(cs ? query : query.toLowerCase())]; const t = cs ? text : text.toLowerCase(); const n = t.length; const m = q.length;
  if (m > n) return null;
  /* what a match at position j is worth by itself: a start of a word or path part, or a camelCase hump, beats a middle letter */
  const bonus = (j: number) => { const before = j === 0 ? ' ' : text[j - 1]!; return 1 + (j === 0 || SEP.has(before) ? 8 : /[a-z]/.test(before) && /[A-Z]/.test(text[j]!) ? 6 : 0); };
  const dp: number[][] = []; const from: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(n).fill(NEG); const src = new Array<number>(n).fill(-1); dp.push(row); from.push(src);
    /* best of the earlier row at positions up to j-5, where the gap penalty has stopped growing */
    let far = NEG; let farAt = -1;
    for (let j = 0; j < n; j++) {
      if (t[j] !== q[i]) { if (i > 0 && j - 5 >= 0 && dp[i - 1]![j - 5]! > far) { far = dp[i - 1]![j - 5]!; farAt = j - 5; } continue; }
      if (i === 0) { row[j] = bonus(j) - j * 0.25; continue; }
      if (j - 5 >= 0 && dp[i - 1]![j - 5]! > far) { far = dp[i - 1]![j - 5]!; farAt = j - 5; }
      let best = far > NEG / 2 ? far - 1.5 : NEG; let at = farAt;
      for (let k = Math.max(0, j - 4); k < j; k++) { const p = dp[i - 1]![k]!; if (p <= NEG / 2) continue; const v = p + (k === j - 1 ? 5 : -(j - k - 1) * 0.5); if (v > best) { best = v; at = k; } }
      if (best > NEG / 2) { row[j] = best + bonus(j); src[j] = at; }
    }
  }
  let bj = -1; let bs = NEG; for (let j = 0; j < n; j++) if (dp[m - 1]![j]! > bs) { bs = dp[m - 1]![j]!; bj = j; }
  if (bj < 0) return null;
  const idx = new Array<number>(m); for (let i = m - 1, j = bj; i >= 0; i--) { idx[i] = j; j = from[i]![j]!; }
  return { score: bs - (n - m) * 0.05, indices: idx };
}
