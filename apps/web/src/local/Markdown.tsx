import React from 'react';

/** A small, safe Markdown renderer for agent answers: paragraphs, headings, lists, fenced code, `code`, **bold**, *italic*. Links are shown as their text (nothing in an answer becomes clickable), and nothing is ever inserted as HTML. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []; const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={`${key}c${i}`} className="lc-code">{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={`${key}b${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={`${key}i${i}`}>{m[3]}</em>);
    else out.push(<span key={`${key}l${i}`}>{m[4]}</span>);
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export type Block = { t: 'p'; text: string } | { t: 'h'; level: number; text: string } | { t: 'ul' | 'ol'; items: string[] } | { t: 'code'; lang: string; text: string };
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n'); const out: Block[] = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line);
    if (fence) { const body: string[] = []; i++; while (i < lines.length && !lines[i]!.startsWith(fence[1]!)) body.push(lines[i++]!); i++; out.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') }); continue; }
    if (!line.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line); if (h) { out.push({ t: 'h', level: h[1]!.length, text: h[2]! }); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, '')); out.push({ t: 'ul', items }); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+[.)]\s+/, '')); out.push({ t: 'ol', items }); continue; }
    const para: string[] = []; while (i < lines.length && lines[i]!.trim() && !/^(`{3,}|~{3,})/.test(lines[i]!) && !/^(#{1,4}\s|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}
export function Markdown({ text }: { text: string }): React.JSX.Element {
  return <div className="lc-md">{parseBlocks(text).map((b, n) => {
    const k = `b${n}`;
    switch (b.t) {
      case 'p': return <p key={k}>{inline(b.text, k)}</p>;
      case 'h': return <p key={k} className="lc-md__h">{inline(b.text, k)}</p>;
      case 'ul': return <ul key={k}>{b.items.map((x, j) => <li key={j}>{inline(x, `${k}.${j}`)}</li>)}</ul>;
      case 'ol': return <ol key={k}>{b.items.map((x, j) => <li key={j}>{inline(x, `${k}.${j}`)}</li>)}</ol>;
      default: return <pre key={k} className="lc-pre" tabIndex={0} aria-label={b.lang ? `${b.lang} code` : 'code'}><code>{b.text}</code></pre>;
    }
  })}</div>;
}
