import React from 'react';
/** A small, safe Markdown renderer: paragraphs, code, bold, italic, links and lists become React elements (text nodes only); raw HTML stays text, images are not drawn, and links open with rel="noopener noreferrer". */
const SAFE_LINK = /^https?:\/\/[^\s<>"']+$/i;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;
function inline(s: string, key: string): React.ReactNode[] {
  return s.split(INLINE).filter((x) => x !== '').map((part, i) => {
    const k = `${key}-${i}`; if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={k}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={k}>{part.slice(2, -2)}</strong>; if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    const m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part); if (m) return SAFE_LINK.test(m[2]!) ? <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a> : <span key={k}>{m[1]}</span>; /* javascript:, data: and relative links are only words */
    return <React.Fragment key={k}>{part}</React.Fragment>;
  });
}
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = []; const lines = text.replace(/\r\n?/g, '\n').split('\n'); let i = 0; let n = 0;
  while (i < lines.length) {
    const line = lines[i]!; if (line.trim() === '') { i++; continue; }
    if (line.startsWith('```')) { const body: string[] = []; i++; while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!); i++; blocks.push(<pre key={`b${n++}`} tabIndex={0}><code>{body.join('\n')}</code></pre>); continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, '')); blocks.push(<ul key={`b${n++}`}>{items.map((it, j) => <li key={j}>{inline(it, `l${n}${j}`)}</li>)}</ul>); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line); if (h) { blocks.push(<p key={`b${n++}`}><strong>{inline(h[2]!, `h${n}`)}</strong></p>); i++; continue; }
    const para: string[] = []; while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('```') && !/^\s*[-*]\s+/.test(lines[i]!)) para.push(lines[i++]!); blocks.push(<p key={`b${n++}`}>{inline(para.join(' '), `p${n}`)}</p>);
  }
  return <div className="cc-md">{blocks}</div>;
}
