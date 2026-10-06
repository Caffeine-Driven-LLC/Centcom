import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

marked.setOptions({ gfm: true, breaks: false });
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] }), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Diff({ text }: { text: string }) {
  return <pre className="diff">{text.split('\n').map((l, i) => <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>{l || ' '}</div>)}</pre>;
}
