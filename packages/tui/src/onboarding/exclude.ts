/** Adds lines to `.git/info/exclude` (local to this clone, never committed). Appends only what is missing and keeps everything else as it was. */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ExcludeFs { read(p: string): Promise<string | undefined>; append(p: string, text: string): Promise<void> }
export const nodeExcludeFs: ExcludeFs = { async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } }, async append(p, t) { await mkdir(dirname(p), { recursive: true }); await appendFile(p, t); } };
/** Which of `lines` are missing. */
export async function missingLines(file: string, lines: string[], fs: ExcludeFs = nodeExcludeFs): Promise<string[]> { const cur = ((await fs.read(file)) ?? '').split(/\r?\n/).map((l) => l.trim()); return lines.filter((l) => !cur.includes(l)); }
/** Appends the missing lines (once). Returns what was added. */
export async function appendExclude(file: string, lines: string[], fs: ExcludeFs = nodeExcludeFs): Promise<string[]> {
  const add = await missingLines(file, lines, fs); if (!add.length) return []; const cur = (await fs.read(file)) ?? ''; await fs.append(file, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n'); return add;
}
