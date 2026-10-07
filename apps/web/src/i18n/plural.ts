/** ICU-lite: `{name}` and `{n, plural, =0 {..} one {..} other {..}}` with `#` for the number. English plural rules (one when n is 1). */
function matchBrace(s: string, from: number): number { let d = 0; for (let i = from; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}' && --d === 0) return i; } return -1; }
export function format(msg: string, params: Record<string, string | number> = {}): string {
  let out = ''; let i = 0;
  while (i < msg.length) {
    const c = msg[i]!; if (c !== '{') { out += c; i++; continue; } const end = matchBrace(msg, i); if (end < 0) { out += msg.slice(i); break; } const inner = msg.slice(i + 1, end); const m = /^\s*([A-Za-z_]\w*)\s*(?:,\s*plural\s*,\s*([\s\S]*))?$/.exec(inner);
    if (!m) { out += msg.slice(i, end + 1); i = end + 1; continue; } const v = params[m[1]!];
    if (m[2] === undefined) { out += v === undefined ? `{${m[1]}}` : String(v); i = end + 1; continue; }
    const n = typeof v === 'number' ? v : Number(v); const forms = new Map<string, string>(); let j = 0; const body = m[2]!;
    while (j < body.length) { const k = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/y; k.lastIndex = j; const km = k.exec(body); if (!km) break; const open = km.index + km[0].length - 1; const close = matchBrace(body, open); if (close < 0) break; forms.set(km[1]!, body.slice(open + 1, close)); j = close + 1; }
    const pick = forms.get(`=${n}`) ?? (n === 1 ? forms.get('one') : undefined) ?? forms.get('other') ?? ''; out += format(pick.replace(/#/g, String(n)), params); i = end + 1;
  }
  return out;
}
