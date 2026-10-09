import React from 'react';

export type DiffRow = { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'file'; text: string; old?: number; now?: number };
/** A unified diff as rows with line numbers; the +/- sign is part of the text, so colour is never the only cue. */
export function parseDiff(src: string): DiffRow[] {
  const rows: DiffRow[] = []; let o = 0; let n = 0;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) { rows.push({ kind: 'file', text: line }); continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line); if (h) { o = Number(h[1]); n = Number(h[2]); rows.push({ kind: 'hunk', text: line }); continue; }
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line, now: n++ }); else if (line.startsWith('-')) rows.push({ kind: 'del', text: line, old: o++ }); else if (line.length || rows.length) rows.push({ kind: 'ctx', text: line, old: o++, now: n++ });
  }
  while (rows.length && rows[rows.length - 1]!.kind === 'ctx' && !rows[rows.length - 1]!.text) rows.pop();
  return rows;
}
export function Diff({ diff, max = 14 }: { diff: string; max?: number }): React.JSX.Element {
  const rows = parseDiff(diff).filter((r) => r.kind !== 'file'); const shown = rows.slice(0, max); const more = rows.length - shown.length;
  const adds = rows.filter((r) => r.kind === 'add').length; const dels = rows.filter((r) => r.kind === 'del').length;
  return <figure className="lc-diff" aria-label={`Change: ${adds} added, ${dels} removed`}>
    <div className="lc-diff__rows">{shown.map((r, i) => <div key={i} className={`lc-diff__row lc-diff__row--${r.kind}`}><span className="lc-diff__no" aria-hidden="true">{r.kind === 'add' ? r.now : r.kind === 'del' ? r.old : r.kind === 'ctx' ? r.now : ''}</span><span className="lc-diff__text">{r.text || ' '}</span></div>)}</div>
    {more > 0 ? <figcaption className="lc-diff__more">{more} more line{more === 1 ? '' : 's'}</figcaption> : null}
  </figure>;
}
