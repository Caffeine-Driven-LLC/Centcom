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
