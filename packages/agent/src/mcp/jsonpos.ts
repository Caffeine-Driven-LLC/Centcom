/** Where is the first syntax error in this JSON text? Returns `line L column C`, or undefined if it is valid. A small recursive reader: V8's own messages do not always say. */
export function jsonErrorAt(text: string): string | undefined {
  let i = 0; const err = (): never => { const before = text.slice(0, i); const line = before.split('\n').length; const col = i - before.lastIndexOf('\n'); throw Object.assign(new Error('x'), { at: `line ${line} column ${col}` }); };
  const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  const str = () => { i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; else if (text[i]! < ' ') err(); i++; } if (i >= text.length) err(); i++; };
  const value = (): void => {
    ws(); const c = text[i];
    if (c === '{') { i++; ws(); if (text[i] === '}') { i++; return; } for (;;) { ws(); if (text[i] !== '"') err(); str(); ws(); if (text[i] !== ':') err(); i++; value(); ws(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') { i++; return; } err(); } }
    else if (c === '[') { i++; ws(); if (text[i] === ']') { i++; return; } for (;;) { value(); ws(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return; } err(); } }
    else if (c === '"') str(); else { const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i)); if (!m) err(); i += m![0].length; }
  };
  try { value(); ws(); if (i < text.length) err(); return undefined; } catch (e) { return (e as { at?: string }).at ?? 'line 1 column 1'; }
}
