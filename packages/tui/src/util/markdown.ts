/** A small Markdown renderer for assistant text: paragraphs, lists, headings, quotes, rules, fenced code, inline bold/italic/code/links. */
import { sp, wrapLine, type Line, type Span } from './text.js';

export function inline(text: string, base: Omit<Span, 't'> = {}): Line {
  const out: Line = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(sp(text.slice(last, m.index), base));
    const t = m[0];
    if (m[1]) out.push(sp(' ' + t.slice(1, -1) + ' ', { ...base, c: 'accent.hover', bg: 'bg.raised' }));
    else if (m[2] || m[3]) out.push(sp(t.slice(2, -2), { ...base, b: true }));
    else if (m[4]) out.push(sp(t.slice(1, -1), { ...base, i: true }));
    else if (m[5]) { const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!; out.push(sp(lm[1]!, { ...base, c: 'text.link', u: true })); }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(sp(text.slice(last), base));
  return out.length ? out : [sp('', base)];
}

export interface MdOptions { width: number; codeBg?: boolean }

/** Render Markdown to wrapped lines. Streaming-safe: an unterminated code fence renders as code. */
export function renderMarkdown(md: string, { width }: MdOptions): Line[] {
  const out: Line[] = [];
  const rows = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const blank = () => { if (out.length && out[out.length - 1]!.length) out.push([]); };
  while (i < rows.length) {
    const row = rows[i]!;
    const fence = /^\s*```(\w*)\s*$/.exec(row);
    if (fence) {
      blank(); i++;
      const code: string[] = [];
      while (i < rows.length && !/^\s*```\s*$/.test(rows[i]!)) code.push(rows[i++]!);
      i++;
      if (fence[1]) out.push([sp(' ' + fence[1] + ' ', { c: 'text.muted', d: true })]);
      for (const c of code) {
        for (const w of wrapLine([sp(' ' + c + ' ', { c: 'text.primary', bg: 'bg.sunken' })], width - 2)) out.push([sp('  '), ...w]);
      }
      out.push([]);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(row);
    if (h) { blank(); out.push(...wrapLine(inline(h[2]!, { b: true, c: h[1]!.length === 1 ? 'accent.hover' : 'text.primary' }), width)); out.push([]); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(row)) { out.push([sp('─'.repeat(Math.min(width, 40)), { c: 'border.default' })]); i++; continue; }
    const q = /^\s*>\s?(.*)$/.exec(row);
    if (q) { for (const w of wrapLine(inline(q[1]!, { i: true, c: 'text.secondary' }), width - 2)) out.push([sp('│ ', { c: 'border.strong' }), ...w]); i++; continue; }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(row);
    if (li) {
      const depth = Math.floor(li[1]!.length / 2);
      const bullet = /\d/.test(li[2]!) ? li[2]! : '•';
      const pre = [sp('  '.repeat(depth + 1)), sp(bullet + ' ', { c: 'accent.hover' })];
      const preW = (depth + 1) * 2 + bullet.length + 1;
      const wrapped = wrapLine(inline(li[3]!), width - preW);
      wrapped.forEach((w, k) => out.push(k === 0 ? [...pre, ...w] : [sp(' '.repeat(preW)), ...w]));
      i++; continue;
    }
    if (!row.trim()) { if (out.length && out[out.length - 1]!.length) out.push([]); i++; continue; }
    // paragraph: merge following plain lines
    const para: string[] = [row];
    while (i + 1 < rows.length && rows[i + 1]!.trim() && !/^\s*(```|#{1,3}\s|>|[-*+]\s|\d+[.)]\s)/.test(rows[i + 1]!)) para.push(rows[++i]!);
    out.push(...wrapLine(inline(para.join(' ')), width));
    i++;
  }
  while (out.length && out[out.length - 1]!.length === 0) out.pop();
  return out;
}
