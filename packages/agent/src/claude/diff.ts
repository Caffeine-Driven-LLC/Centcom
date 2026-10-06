/** Unified-style diff text for an Edit/Write tool input, used by the diff view (lane C037). */
export function editDiff(path: string, oldText: string, newText: string): string {
  const o = oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n');
  const n = newText === '' ? [] : newText.replace(/\n$/, '').split('\n');
  // trim common prefix/suffix so the hunk shows the change with a little context
  let a = 0; while (a < o.length && a < n.length && o[a] === n[a]) a++;
  let b = 0; while (b < o.length - a && b < n.length - a && o[o.length - 1 - b] === n[n.length - 1 - b]) b++;
  const out = [`--- a/${path}`, `+++ b/${path}`, `@@ -${a + 1},${o.length - a - b} +${a + 1},${n.length - a - b} @@`];
  for (const l of o.slice(Math.max(0, a - 2), a)) out.push(' ' + l);
  for (const l of o.slice(a, o.length - b)) out.push('-' + l);
  for (const l of n.slice(a, n.length - b)) out.push('+' + l);
  for (const l of o.slice(o.length - b, o.length - b + 2)) out.push(' ' + l);
  return out.join('\n');
}
