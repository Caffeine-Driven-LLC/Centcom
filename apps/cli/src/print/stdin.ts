/** Piped input for `-p`: read up to 1 MiB, then added to the prompt as a fenced block. */
export const STDIN_CAP = 1024 * 1024;
export class InputTooLarge extends Error { readonly code = 'usage'; constructor() { super('Input is too large (max 1 MiB).'); } }

export async function readStdin(stdin: NodeJS.ReadableStream = process.stdin, cap = STDIN_CAP): Promise<string> {
  const parts: Buffer[] = []; let n = 0;
  for await (const c of stdin) { const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c)); n += b.length; if (n > cap) { (stdin as { destroy?: () => void }).destroy?.(); throw new InputTooLarge(); } parts.push(b); }
  return Buffer.concat(parts).toString('utf8');
}
/** `cat log | centcom -p "explain"`: the instruction, then the piped text in a fence (longer than any fence inside it). */
export function buildPrompt(arg: string | undefined, piped: string | undefined): string {
  const a = (arg ?? '').trim(); const p = (piped ?? '').replace(/\s+$/, '');
  if (!p.trim()) return a; if (!a) return p.trim();
  const longest = Math.max(2, ...[...p.matchAll(/`+/g)].map((m) => m[0].length)); const fence = '`'.repeat(longest + 1);
  return `${a}\n\n${fence}\n${p}\n${fence}`;
}

/** `--input-format stream-json`: one JSON object per line, each a user message (`{"type":"user","message":{"role":"user","content":"..."}}`, content a string or text blocks). Returns the messages in order; a bad line is a usage error that names the line. */
export function parseStreamInput(text: string): string[] {
  const out: string[] = []; const bad = (n: number, why: string): never => { throw Object.assign(new Error(`--input-format stream-json: line ${n}: ${why}`), { code: 'usage' }); };
  text.split('\n').forEach((raw, i) => {
    const l = raw.trim(); if (!l) return; let j: unknown; try { j = JSON.parse(l); } catch { return bad(i + 1, 'not JSON'); }
    const o = j as { type?: unknown; message?: { content?: unknown } }; if (!o || typeof o !== 'object' || o.type !== 'user') return bad(i + 1, 'expected {"type":"user","message":{...}}');
    const c = o.message?.content; const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('') : undefined;
    if (t === undefined) return bad(i + 1, 'the message has no text content'); if (!t.trim()) return bad(i + 1, 'the message is empty'); out.push(t);
  });
  if (!out.length) throw Object.assign(new Error('--input-format stream-json: no messages on standard input.'), { code: 'usage' });
  return out;
}
