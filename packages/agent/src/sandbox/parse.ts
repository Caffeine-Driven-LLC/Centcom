/** A shell reader that never runs anything and never trusts anything it cannot read. It splits a command into segments and understands quoting, escapes, substitutions, heredocs and redirections; whatever it cannot read makes the whole result "not ok", which the classifier treats as high risk. */
export interface Redirect { op: string; target: string }
export interface Segment { words: string[]; env: string[]; redirects: Redirect[]; /** The inner commands of $(...), backticks and <(...). */ subs: string[]; pipedFrom: boolean; pipedTo: boolean; background: boolean; heredoc: boolean; /** The command word itself comes from an expansion (`$CMD`, `$(x)`), so nobody can say what runs. */ dynamicCommand: boolean }
export interface Parsed { ok: boolean; reason?: 'too_long' | 'unparseable' | 'too_deep'; segments: Segment[] }
export const MAX_LENGTH = 64 * 1024; export const MAX_DEPTH = 4;
const FORK_BOMB = /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:?\s*&?[^}]*\}\s*;?\s*:/;

export function parseShell(cmd: string, depth = 0): Parsed {
  const bad = (reason: NonNullable<Parsed['reason']>): Parsed => ({ ok: false, reason, segments: [] });
  if (typeof cmd !== 'string') return bad('unparseable'); if (cmd.length > MAX_LENGTH) return bad('too_long'); if (depth > MAX_DEPTH) return bad('too_deep');
  if (cmd.includes('\0') || cmd.includes('\ufffd') || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cmd)) return bad('unparseable'); // NUL, replacement characters (bytes that were not UTF-8), lone surrogates
  if (FORK_BOMB.test(cmd)) return bad('unparseable');
  const segs: Segment[] = []; let i = 0; const n = cmd.length;
  let cur = fresh(); let word = ''; let inWord = false; let wordDynamic = false; let wordHadQuote = false; let plain = ''; const pendingHeredocs: { delim: string; quoted: boolean; strip: boolean; seg: Segment }[] = [];
  function fresh(): Segment { return { words: [], env: [], redirects: [], subs: [], pipedFrom: false, pipedTo: false, background: false, heredoc: false, dynamicCommand: false }; }
  const endWord = () => { if (!inWord) return; if (cur.words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(plain)) cur.env.push(plain.split('=')[0]!); else { if (cur.words.length === 0 && wordDynamic) cur.dynamicCommand = true; cur.words.push(word); } word = ''; plain = ''; inWord = false; wordDynamic = false; wordHadQuote = false; };
  const endSeg = (op: string) => { endWord(); const empty = !cur.words.length && !cur.env.length && !cur.redirects.length && !cur.subs.length; if (!empty) { if (op === '|' || op === '|&') cur.pipedTo = true; if (op === '&') cur.background = true; segs.push(cur); const next = fresh(); if (op === '|' || op === '|&') next.pipedFrom = true; cur = next; } else if (op === '|' || op === '|&') cur.pipedFrom = true; };
  // find the matching ')' of a "$(" or "<(": quotes and nesting respected. Returns the index of the ')' or -1.
  const matchParen = (from: number): number => { let d = 1; let q = ''; for (let j = from; j < n; j++) { const c = cmd[j]!; if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') j++; continue; } if (c === '\\') { j++; continue; } if (c === "'" || c === '"') { q = c; continue; } if (c === '(') d++; else if (c === ')') { d--; if (!d) return j; } } return -1; };
  const matchTick = (from: number): number => { for (let j = from; j < n; j++) { if (cmd[j] === '\\') { j++; continue; } if (cmd[j] === '`') return j; } return -1; };
  const readWordInto = (stopAtOperators: boolean): string | undefined => { // used for redirection targets
    while (i < n && (cmd[i] === ' ' || cmd[i] === '\t')) i++; let w = ''; let any = false;
    while (i < n) { const c = cmd[i]!; if (/\s/.test(c) || (stopAtOperators && ';&|<>()'.includes(c))) break; any = true;
      if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e < 0) return undefined; w += cmd.slice(i + 1, e); i = e + 1; continue; }
      if (c === '"') { let j = i + 1; let s = ''; while (j < n && cmd[j] !== '"') { if (cmd[j] === '\\' && j + 1 < n) { s += cmd[j + 1]; j += 2; continue; } if (cmd[j] === '`') { const e = matchTick(j + 1); if (e < 0) return undefined; cur.subs.push(cmd.slice(j + 1, e)); s += '$SUB'; j = e + 1; continue; } if (cmd[j] === '$' && cmd[j + 1] === '(') { const e = matchParen(j + 2); if (e < 0) return undefined; cur.subs.push(cmd.slice(j + 2, e)); s += '$SUB'; j = e + 1; continue; } s += cmd[j]; j++; } if (j >= n) return undefined; w += s; i = j + 1; continue; }
      if (c === '\\' && i + 1 < n) { w += cmd[i + 1]; i += 2; continue; }
      if (c === '`') { const e = matchTick(i + 1); if (e < 0) return undefined; cur.subs.push(cmd.slice(i + 1, e)); w += '$SUB'; i = e + 1; continue; }
      if (c === '$' && cmd[i + 1] === '(') { const e = matchParen(i + 2); if (e < 0) return undefined; cur.subs.push(cmd.slice(i + 2, e)); w += '$SUB'; i = e + 1; continue; }
      w += c; i++; } return any ? w : undefined;
  };
  const fail = (): Parsed => bad('unparseable');

  while (i < n) {
    const c = cmd[i]!; const next = cmd[i + 1];
    if (c === '\n') { endSeg(';'); i++; // heredoc bodies start on the line after the operator
      while (pendingHeredocs.length) { const h = pendingHeredocs.shift()!; let found = false; while (i <= n) { const e = cmd.indexOf('\n', i); const line = e < 0 ? cmd.slice(i) : cmd.slice(i, e); const cmp = h.strip ? line.replace(/^\t+/, '') : line; if (cmp === h.delim) { found = true; i = e < 0 ? n : e + 1; break; } if (!h.quoted) for (const m of line.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) h.seg.subs.push(m[1] ?? m[2] ?? ''); if (e < 0) { i = n + 1; break; } i = e + 1; } if (!found) return fail(); }
      continue; }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); i++; continue; }
    if (c === '#' && !inWord) { while (i < n && cmd[i] !== '\n') i++; continue; }
    if (c === ';') { endSeg(';'); i += next === ';' ? 2 : 1; continue; }
    if (c === '&' && next === '&') { endSeg('&&'); i += 2; continue; }
    if (c === '|' && next === '|') { endSeg('||'); i += 2; continue; }
    if (c === '|') { const op = next === '&' ? '|&' : '|'; endSeg(op); i += op.length; continue; }
    if (c === '&' && next === '>') { endWord(); i += 2; const app = cmd[i] === '>'; if (app) i++; const t = readWordInto(true); if (t === undefined) return fail(); cur.redirects.push({ op: app ? '&>>' : '&>', target: t }); continue; }
    if (c === '&') { endSeg('&'); i++; continue; }
    if (c === '(' || c === ')') { if (c === '(' && inWord) return fail(); endSeg(';'); i++; continue; } // grouping and subshells: their contents are read as ordinary segments
    if ((c === '<' || c === '>') && next === '(') { const e = matchParen(i + 2); if (e < 0) return fail(); cur.subs.push(cmd.slice(i + 2, e)); if (!inWord) inWord = true; word += '$SUB'; wordDynamic = true; i = e + 1; continue; }
    if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) { word = ''; inWord = false; wordDynamic = false; } else endWord(); // `2>file`: the 2 is a file descriptor, not an argument
      let op = c; i++; if (cmd[i] === c) { op += c; i++; if (c === '<' && cmd[i] === '<') { op += '<'; i++; } else if (c === '<' && cmd[i] === '-') { op += '-'; i++; } } else if (c === '>' && cmd[i] === '|') { op += '|'; i++; } else if (cmd[i] === '&') { op += '&'; i++; } else if (c === '<' && cmd[i] === '>') { op += '>'; i++; }
      const target = readWordInto(true); if (target === undefined) return fail();
      if (op === '<<' || op === '<<-') { const quoted = /^['"\\]/.test(cmd.slice(Math.max(0, i - target.length - 2), i)) || cmd.slice(0, i).match(/<<-?\s*(['"\\])/) !== null; cur.heredoc = true; pendingHeredocs.push({ delim: target, quoted, strip: op === '<<-', seg: cur }); continue; }
      if ((op.endsWith('&')) && /^(\d+|-)$/.test(target)) continue; // `2>&1`, `>&2`, `<&-`
      cur.redirects.push({ op, target }); continue;
    }
    // part of a word
    if (!inWord) { inWord = true; }
    if (c === "'") { const e = cmd.indexOf("'", i + 1); if (e < 0) return fail(); word += cmd.slice(i + 1, e); wordHadQuote = true; i = e + 1; continue; }
    if (c === '"') { wordHadQuote = true; let j = i + 1; while (j < n && cmd[j] !== '"') { const d = cmd[j]!; if (d === '\\' && j + 1 < n) { word += cmd[j + 1]; j += 2; continue; } if (d === '`') { const e = matchTick(j + 1); if (e < 0) return fail(); cur.subs.push(cmd.slice(j + 1, e)); word += '$SUB'; wordDynamic = true; j = e + 1; continue; } if (d === '$' && cmd[j + 1] === '(') { const e = matchParen(j + 2); if (e < 0) return fail(); cur.subs.push(cmd.slice(j + 2, e)); word += '$SUB'; wordDynamic = true; j = e + 1; continue; } if (d === '$' && /[A-Za-z_{]/.test(cmd[j + 1] ?? '')) wordDynamic = true; word += d; j++; } if (j >= n) return fail(); i = j + 1; continue; }
    if (c === '\\') { if (i + 1 >= n) return fail(); if (cmd[i + 1] === '\n') { i += 2; continue; } word += cmd[i + 1]; wordHadQuote = true; i += 2; continue; }
    if (c === '`') { const e = matchTick(i + 1); if (e < 0) return fail(); cur.subs.push(cmd.slice(i + 1, e)); word += '$SUB'; wordDynamic = true; i = e + 1; continue; }
    if (c === '$' && next === '(') { const e = matchParen(i + 2); if (e < 0) return fail(); cur.subs.push(cmd.slice(i + 2, e)); word += '$SUB'; wordDynamic = true; i = e + 1; continue; }
    if (c === '$' && /[A-Za-z_{]/.test(next ?? '')) wordDynamic = true;
    if (!wordHadQuote) plain += c;
    word += c; i++;
  }
  endSeg(';'); if (pendingHeredocs.length) return fail(); return { ok: true, segments: segs };
}
