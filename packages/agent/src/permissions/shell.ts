/** Just enough shell reading to be careful: no execution, no expansion. Anything it cannot read counts as "not simple". */
export interface ShellInfo { simple: boolean; segments: string[]; words: string[]; writeTargets: string[]; pathWords: string[] }

function scan(cmd: string): { segments: string[]; danger: boolean; redirects: string[] } {
  const segments: string[] = []; let cur = ''; let q: '"' | "'" | '' = ''; let danger = false; const redirects: string[] = [];
  const push = () => { if (cur.trim()) segments.push(cur.trim()); cur = ''; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!; const n = cmd[i + 1];
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') { cur += c + (n ?? ''); i++; continue; } else if (q === '"' && (c === '`' || (c === '$' && n === '('))) danger = true; cur += c; continue; }
    if (c === '\\') { cur += c + (n ?? ''); i++; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '`' || (c === '$' && n === '(') || ((c === '<' || c === '>') && n === '(')) { danger = true; cur += c; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') { if ((c === '|' || c === '&') && n === c) i++; danger = true; push(); continue; }
    if (c === '>' || c === '<') { danger = true; if (c === '>') redirects.push(''); cur += c; continue; }
    cur += c;
  }
  if (q) danger = true; push(); return { segments, danger, redirects };
}
export function splitWords(s: string): string[] {
  const out: string[] = []; let cur = ''; let q: '"' | "'" | '' = ''; let has = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]!; if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; else cur += c; continue; } if (c === '"' || c === "'") { q = c; has = true; continue; } if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; } if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; } cur += c; has = true; }
  if (cur || has) out.push(cur); return out;
}
const WRITERS = new Set(['rm', 'rmdir', 'mv', 'cp', 'tee', 'touch', 'mkdir', 'ln', 'chmod', 'chown', 'truncate', 'install', 'unlink', 'shred']);
const looksLikePath = (w: string) => w.startsWith('/') || w.startsWith('~') || w.startsWith('./') || w.startsWith('../') || w.includes('/') || /^[A-Za-z]:[\\/]/.test(w) || /^\.{1,2}$/.test(w) || /(^|[\\/])\.[a-z]/i.test(w) || /^(auth\.json|\.credentials\.json)$/.test(w);

export function readShell(cmd: string): ShellInfo {
  const { segments, danger } = scan(cmd); const words = splitWords(segments[0] ?? ''); const writeTargets: string[] = []; const pathWords: string[] = [];
  for (const seg of segments) {
    const w = splitWords(seg); const head = w[0]?.split('/').pop() ?? '';
    for (let i = 0; i < w.length; i++) { const t = w[i]!; if (i > 0 && looksLikePath(t) && !t.startsWith('-')) pathWords.push(t); }
    if (WRITERS.has(head)) for (const t of w.slice(1)) if (!t.startsWith('-')) writeTargets.push(t);
    if (head === 'sed' && w.some((t) => t === '-i' || t.startsWith('-i'))) for (const t of w.slice(1)) if (!t.startsWith('-') && looksLikePath(t)) writeTargets.push(t);
    if (head === 'dd') for (const t of w) if (t.startsWith('of=')) writeTargets.push(t.slice(3));
  }
  // redirections: `> file`, `>> file`, `>file`
  for (const m of cmd.matchAll(/(?:^|[^<>&0-9])\d*>>?\s*(?!&)(['"]?)([^\s;|&'"<>]+)\1/g)) writeTargets.push(m[2]!);
  return { simple: !danger && segments.length === 1, segments, words, writeTargets, pathWords };
}

/** Does the command start with these words (a Claude `git status:*` rule)? Word boundaries respected. */
export const hasPrefix = (words: string[], prefix: string[]) => prefix.length > 0 && prefix.length <= words.length && prefix.every((p, i) => words[i] === p);
/** The conservative rule text for "always allow this": the words up to the first flag. `undefined` for anything compound. */
export function alwaysPrefix(cmd: string): string | undefined {
  const s = readShell(cmd); if (!s.simple || !s.words.length) return undefined; const out: string[] = [];
  for (const w of s.words) { if (w.startsWith('-') || /[*?$`]/.test(w) || /[/\\]/.test(w) && out.length > 0 || out.length >= 3) break; out.push(w); }
  return out.length ? `${out.join(' ')}:*` : undefined;
}
